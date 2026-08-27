import https from "node:https";
import { rootCertificates, checkServerIdentity } from "node:tls";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  PACKAGE,
  REPOSITORY,
  REGISTRY,
  WORKFLOW,
  TAR_LIMIT,
  JSON_LIMIT,
  atomicDirectory,
  base64,
  cliArguments,
  equal,
  exactVersion,
  fail,
  fullHash,
  hash,
  jsonBytes,
  keys,
  numericId,
  object,
  readData,
  safeError,
  strictJson,
  tarIdentity,
  validateContext,
} from "./npm-receipt-data.mjs";

const SLSA = "https://slsa.dev/provenance/v1";
const BUILD_TYPE =
  "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const BUILDER = "https://github.com/actions/runner/github-hosted";
const SLICE_LIMIT = 1024 * 1024;
const PAYLOAD_LIMIT = 256 * 1024;

function headers(response, kind, limit) {
  if (response.status !== 200) fail("HTTP_STATUS");
  if (
    !Array.isArray(response.rawHeaders) ||
    response.rawHeaders.length > 128 ||
    response.rawHeaders.length % 2
  )
    fail("HTTP_HEADERS");
  const selected = {};
  let size = 0;
  for (let index = 0; index < response.rawHeaders.length; index += 2) {
    const name = response.rawHeaders[index];
    const value = response.rawHeaders[index + 1];
    if (
      typeof name !== "string" ||
      typeof value !== "string" ||
      !/^[A-Za-z0-9-]+$/.test(name) ||
      /[^\x20-\x7e]/.test(value)
    )
      fail("HTTP_HEADERS");
    size += name.length + value.length;
    if (size > 16384) fail("HTTP_HEADERS");
    const key = name.toLowerCase();
    if (
      [
        "content-type",
        "content-length",
        "transfer-encoding",
        "content-encoding",
        "date",
      ].includes(key)
    ) {
      if (Object.hasOwn(selected, key)) fail("HTTP_FRAMING");
      selected[key] = value;
    }
  }
  if (
    selected["content-encoding"] !== undefined &&
    selected["content-encoding"] !== "identity"
  )
    fail("HTTP_ENCODING");
  if (
    selected["transfer-encoding"] !== undefined &&
    (selected["transfer-encoding"] !== "chunked" ||
      selected["content-length"] !== undefined)
  )
    fail("HTTP_FRAMING");
  const length = selected["content-length"];
  if (
    length !== undefined &&
    (!/^(0|[1-9][0-9]{0,8})$/.test(length) || Number(length) > limit)
  )
    fail("HTTP_SIZE");
  const contentType = selected["content-type"];
  const allowed =
    kind === "tar"
      ? /^(?:application\/(?:octet-stream|gzip|x-gzip))$/
      : /^application\/json(?:;\s*charset=utf-8)?$/i;
  if (typeof contentType !== "string" || !allowed.test(contentType))
    fail("HTTP_CONTENT_TYPE");
  const date = selected.date ?? null;
  if (
    date !== null &&
    (date.length !== 29 || new Date(date).toUTCString() !== date)
  )
    fail("HTTP_DATE");
  return {
    status: 200,
    date,
    contentType,
    length: length === undefined ? null : Number(length),
  };
}

// Internal request boundary, not a public SDK API. Injection is available only
// to local unit tests; the CLI has no transport, endpoint, CA or executable flag.
export function requestRegistry(options, request = https.request) {
  return new Promise((accept, reject) => {
    const agent = new https.Agent({
      keepAlive: false,
      maxSockets: 1,
      ca: rootCertificates,
      rejectUnauthorized: true,
      proxyEnv: {},
    });
    let req;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) req?.destroy();
      agent.destroy();
      if (error) reject(error);
      else accept(result);
    };
    const timer = setTimeout(
      () => finish(new Error("PAY_NPM_HTTP_TIMEOUT")),
      30000,
    );
    try {
      req = request(
        {
          protocol: "https:",
          hostname: "registry.npmjs.org",
          port: 443,
          servername: "registry.npmjs.org",
          method: "GET",
          path: options.path,
          agent,
          ca: rootCertificates,
          rejectUnauthorized: true,
          checkServerIdentity,
          minVersion: "TLSv1.2",
          maxHeaderSize: 16384,
          headers: {
            Accept:
              options.kind === "tar"
                ? "application/octet-stream, application/gzip"
                : "application/json",
            "Accept-Encoding": "identity",
          },
        },
        (response) => {
          try {
            if (response.socket?.authorized !== true) fail("HTTP_TLS");
            const observed = {
              status: response.statusCode,
              rawHeaders: response.rawHeaders,
            };
            const checked = headers(observed, options.kind, options.limit);
            const chunks = [];
            let length = 0;
            response.on("data", (chunk) => {
              length += chunk.length;
              if (length > options.limit) {
                finish(new Error("PAY_NPM_HTTP_SIZE"));
                return;
              }
              chunks.push(chunk);
            });
            response.on("aborted", () =>
              finish(new Error("PAY_NPM_HTTP_TRUNCATED")),
            );
            response.on("error", () =>
              finish(new Error("PAY_NPM_HTTP_TRANSPORT")),
            );
            response.on("end", () => {
              if (
                !response.complete ||
                (checked.length !== null && checked.length !== length)
              ) {
                finish(new Error("PAY_NPM_HTTP_TRUNCATED"));
                return;
              }
              finish(null, {
                ...observed,
                body: Buffer.concat(chunks, length),
              });
            });
          } catch (error) {
            response.destroy();
            finish(error);
          }
        },
      );
      req.on("error", () => finish(new Error("PAY_NPM_HTTP_TRANSPORT")));
      req.end();
    } catch {
      finish(new Error("PAY_NPM_HTTP_TRANSPORT"));
    }
  });
}

async function observe(path, kind, transport) {
  const limit = kind === "tar" ? TAR_LIMIT : JSON_LIMIT;
  let response;
  try {
    response = await transport({ path, kind, limit });
  } catch (error) {
    if (/^PAY_NPM_HTTP_[A-Z_]+$/.test(error?.message)) throw error;
    fail("HTTP_TRANSPORT");
  }
  object(response);
  const checked = headers(response, kind, limit);
  if (
    !Buffer.isBuffer(response.body) ||
    response.body.length === 0 ||
    response.body.length > limit ||
    (checked.length !== null && checked.length !== response.body.length)
  )
    fail("HTTP_SIZE");
  return {
    bytes: response.body,
    observation: {
      url: REGISTRY + path,
      status: checked.status,
      date: checked.date,
      contentType: checked.contentType,
      observedAt: new Date().toISOString(),
      size: response.body.length,
      sha256: hash(response.body),
    },
  };
}

function metadataContract(bytes, version, source) {
  const metadata = object(strictJson(bytes).value);
  equal(metadata.name, PACKAGE);
  equal(metadata.version, version);
  const dist = object(metadata.dist);
  fullHash(dist.shasum);
  if (
    typeof dist.integrity !== "string" ||
    !dist.integrity.startsWith("sha512-")
  )
    fail("INTEGRITY");
  if (base64(dist.integrity.slice(7), 64).length !== 64) fail("INTEGRITY");
  // Compare raw strings BEFORE URL parsing; no normalization, decoding or
  // redirects can turn a different endpoint into this fixed request graph.
  equal(dist.tarball, `${REGISTRY}/@0xkey-io/pay/-/pay-${version}.tgz`, "URL");
  const advertised = object(dist.attestations).url;
  const prefix = `${REGISTRY}/-/npm/v1/attestations/`;
  if (typeof advertised !== "string" || !advertised.startsWith(prefix))
    fail("URL");
  const suffix = advertised.slice(prefix.length);
  const spelling = /^(?:@|%40)0xkey-io%2[fF]pay@/.exec(suffix);
  if (!spelling || suffix.slice(spelling[0].length) !== version) fail("URL");
  equal(decodeURIComponent(suffix), `${PACKAGE}@${version}`, "URL");
  if (Object.hasOwn(metadata, "gitHead"))
    equal(fullHash(metadata.gitHead), source);
  return metadata;
}

function profile(statement, context) {
  const source = context.source;
  equal(statement._type, "https://in-toto.io/Statement/v1");
  equal(statement.predicateType, SLSA);
  equal(statement.subject, [
    {
      name: `pkg:npm/%40xkey-io/pay@${context.version}`,
      digest: { sha512: context.checkedTar.sha512 },
    },
  ]);
  const predicate = object(statement.predicate);
  const build = object(predicate.buildDefinition);
  equal(build.buildType, BUILD_TYPE);
  equal(object(build.externalParameters).workflow, {
    repository: `https://github.com/${REPOSITORY}`,
    ref: "refs/heads/main",
    path: WORKFLOW,
  });
  equal(build.resolvedDependencies, [
    {
      uri: `git+https://github.com/${REPOSITORY}@refs/heads/main`,
      digest: { gitCommit: source.requestedSha },
    },
  ]);
  const github = object(object(build.internalParameters).github);
  keys(github, ["event_name"], ["repository_id", "repository_owner_id"]);
  equal(github.event_name, "workflow_dispatch");
  const observedIds = {};
  for (const field of ["repository_id", "repository_owner_id"])
    if (Object.hasOwn(github, field))
      observedIds[field] = numericId(github[field]);
  const run = object(predicate.runDetails);
  equal(object(run.builder).id, BUILDER);
  const invocation = `https://github.com/${REPOSITORY}/actions/runs/${source.runId}/attempts/${source.runAttempt}`;
  equal(object(run.metadata).invocationId, invocation);
  return {
    statementType: statement._type,
    predicateType: SLSA,
    subject: statement.subject[0],
    buildType: BUILD_TYPE,
    workflow: build.externalParameters.workflow,
    sourceSha: source.requestedSha,
    sourceUri: build.resolvedDependencies[0].uri,
    builder: BUILDER,
    invocationId: invocation,
    event: github.event_name,
    observedGithubIds: observedIds,
  };
}

function selectBundle(bytes, context) {
  const parsed = strictJson(bytes);
  keys(parsed.value, ["attestations"]);
  const entries = parsed.value.attestations;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 8)
    fail("ATTESTATION_COUNT");
  const index = [];
  const candidates = [];
  for (let position = 0; position < entries.length; position++) {
    const entry = entries[position];
    keys(entry, ["predicateType", "bundle"]);
    if (
      typeof entry.predicateType !== "string" ||
      entry.predicateType.length > 256 ||
      !/^[a-z][a-z0-9+.-]*:\/\/[\x21-\x7e]+$/.test(entry.predicateType)
    )
      fail("PREDICATE");
    const bundle = entry.bundle;
    keys(bundle, ["mediaType", "verificationMaterial", "dsseEnvelope"]);
    if (
      typeof bundle.mediaType !== "string" ||
      !/^application\/vnd\.dev\.sigstore\.bundle\.v0\.[123]\+json$/.test(
        bundle.mediaType,
      )
    )
      fail("BUNDLE_TYPE");
    if (!Object.keys(object(bundle.verificationMaterial)).length)
      fail("BUNDLE_MATERIAL");
    const range = parsed.ranges.get(bundle);
    const raw = bytes.subarray(range.start, range.end);
    if (raw.length > SLICE_LIMIT) fail("BUNDLE_SIZE");
    const envelope = bundle.dsseEnvelope;
    keys(envelope, ["payloadType", "payload", "signatures"]);
    equal(envelope.payloadType, "application/vnd.in-toto+json");
    if (
      !Array.isArray(envelope.signatures) ||
      envelope.signatures.length < 1 ||
      envelope.signatures.length > 8
    )
      fail("SIGNATURE");
    const signatures = new Set();
    for (const signature of envelope.signatures) {
      keys(signature, ["sig"], ["keyid"]);
      base64(signature.sig, 16384);
      if (
        Object.hasOwn(signature, "keyid") &&
        (typeof signature.keyid !== "string" || signature.keyid.length > 256)
      )
        fail("SIGNATURE");
      if (signatures.has(signature.sig)) fail("SIGNATURE");
      signatures.add(signature.sig);
    }
    const statement = object(
      strictJson(base64(envelope.payload, PAYLOAD_LIMIT), PAYLOAD_LIMIT).value,
    );
    equal(statement.predicateType, entry.predicateType);
    if (!Array.isArray(statement.subject) || statement.subject.length !== 1)
      fail("SUBJECT");
    equal(statement.subject, [
      {
        name: `pkg:npm/%40xkey-io/pay@${context.version}`,
        digest: { sha512: context.checkedTar.sha512 },
      },
    ]);
    index.push({
      index: position,
      predicateType: entry.predicateType,
      size: raw.length,
      sha256: hash(raw),
      range,
    });
    if (entry.predicateType === SLSA)
      candidates.push({
        index: position,
        raw,
        range,
        profile: profile(statement, context),
      });
  }
  if (candidates.length !== 1) fail("SLSA_COUNT");
  return { selected: candidates[0], index };
}

export async function collectReceipt(
  {
    checkedTar,
    contextFile,
    expectedVersion,
    expectedSource,
    output,
    artifactId,
    artifactDigest,
  },
  transport = requestRegistry,
) {
  exactVersion(expectedVersion);
  fullHash(expectedSource);
  const contextBytes = await readData(contextFile, JSON_LIMIT);
  const context = validateContext(
    strictJson(contextBytes).value,
    expectedVersion,
    expectedSource,
  );
  const original = await readData(checkedTar, TAR_LIMIT);
  equal(tarIdentity(original), context.checkedTar, "CHECKED_TAR");
  let artifact;
  if (artifactId !== undefined || artifactDigest !== undefined) {
    artifact = {
      id: numericId(artifactId),
      archiveSha256: fullHash(artifactDigest, 64),
      meaning: "transport-only",
    };
  }
  const metadata = await observe(
    `/@0xkey-io%2fpay/${expectedVersion}`,
    "json",
    transport,
  );
  const declared = metadataContract(
    metadata.bytes,
    expectedVersion,
    expectedSource,
  );
  const tar = await observe(
    `/@0xkey-io/pay/-/pay-${expectedVersion}.tgz`,
    "tar",
    transport,
  );
  equal(tar.bytes, original, "TAR_BYTES");
  const actual = tarIdentity(tar.bytes);
  equal(actual, context.checkedTar, "TAR_HASH");
  equal(actual.sha1, declared.dist.shasum, "TAR_HASH");
  equal(actual.integrity, declared.dist.integrity, "TAR_HASH");
  const attestations = await observe(
    `/-/npm/v1/attestations/@0xkey-io%2fpay@${expectedVersion}`,
    "json",
    transport,
  );
  const { selected, index } = selectBundle(attestations.bytes, context);
  equal(await readData(contextFile, JSON_LIMIT), contextBytes, "FILE_CHANGED");
  equal(await readData(checkedTar, TAR_LIMIT), original, "FILE_CHANGED");
  const files = {
    "registry-metadata.json": metadata.bytes,
    "package.tgz": tar.bytes,
    "registry-attestations.json": attestations.bytes,
    "provenance.bundle.json": selected.raw,
  };
  const receipt = {
    schemaVersion: "pay-npm-publication-receipt/v1",
    package: PACKAGE,
    version: expectedVersion,
    registry: REGISTRY,
    sourceExpectations: context.source,
    sourceContext: { size: contextBytes.length, sha256: hash(contextBytes) },
    checkedTar: context.checkedTar,
    observations: {
      metadata: metadata.observation,
      tar: { ...tar.observation, ...actual },
      attestations: {
        ...attestations.observation,
        advertisedUrl: declared.dist.attestations.url,
      },
    },
    files: Object.fromEntries(
      Object.entries(files).map(([name, bytes]) => [
        name,
        { size: bytes.length, sha256: hash(bytes) },
      ]),
    ),
    attestations: index,
    provenance: {
      verification: "unverified",
      representation: "raw-json-byte-slice/v1",
      index: selected.index,
      range: selected.range,
      sha256: hash(selected.raw),
      profile: selected.profile,
    },
    ...(Object.hasOwn(declared, "gitHead")
      ? { gitHead: declared.gitHead }
      : {}),
    ...(artifact ? { checkedPackageArtifact: artifact } : {}),
  };
  const receiptBytes = jsonBytes(receipt);
  await atomicDirectory(output, {
    ...files,
    "receipt.json": receiptBytes,
    "receipt.sha256": Buffer.from(`${hash(receiptBytes)}  receipt.json\n`),
  });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  (async () => {
    const args = cliArguments(
      process.argv.slice(2),
      [
        "--checked-tar",
        "--source-context",
        "--expected-version",
        "--expected-source",
        "--output",
      ],
      ["--artifact-id", "--artifact-digest"],
    );
    if (process.versions.node !== "24.3.0") fail("RUNTIME");
    await collectReceipt({
      checkedTar: args["--checked-tar"],
      contextFile: args["--source-context"],
      expectedVersion: args["--expected-version"],
      expectedSource: args["--expected-source"],
      output: args["--output"],
      artifactId: args["--artifact-id"],
      artifactDigest: args["--artifact-digest"],
    });
    process.stdout.write(
      "npm receipt capture completed (unverified observations only).\n",
    );
  })().catch((error) => safeError(error, "receipt-capture"));
}
