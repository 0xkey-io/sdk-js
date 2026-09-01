import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareSourceContext } from "./prepare-npm-source-context.mjs";
import { collectReceipt } from "./collect-published-npm-receipt.mjs";

const version = "1.0.0-rc.1";
const repo = "0xkey-io/sdk-js";
const registry = "https://registry.npmjs.org";
const slsa = "https://slsa.dev/provenance/v1";
const tar = Buffer.from("synthetic opaque checked bytes\0never execute");
const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
const identity = (bytes) => ({
  size: bytes.length,
  sha1: hash(bytes, "sha1"),
  sha256: hash(bytes),
  sha512: hash(bytes, "sha512"),
  integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
});
const json = (value) => Buffer.from(JSON.stringify(value));

async function fixture() {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "pay-npm-synthetic-"),
  );
  const checkout = join(root, "checkout");
  await mkdir(join(checkout, "packages/pay"), { recursive: true });
  const manifest = {
    name: "@0xkey-io/pay",
    version,
    private: true,
    repository: {
      type: "git",
      url: "git+https://github.com/0xkey-io/sdk-js.git",
      directory: "packages/pay",
    },
    publishConfig: { access: "public", registry: `${registry}/`, tag: "next" },
  };
  await writeFile(join(checkout, "packages/pay/package.json"), json(manifest));
  const git = (...args) =>
    execFileSync(
      "/usr/bin/git",
      ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
      {
        cwd: checkout,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_NAME: "Synthetic",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid",
          GIT_COMMITTER_NAME: "Synthetic",
          GIT_COMMITTER_EMAIL: "fixture@example.invalid",
        },
      },
    ).trim();
  git("init", "-q", "--template=", "--initial-branch=main");
  git("add", ".");
  git("commit", "-qm", "synthetic source");
  const sha = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", sha);
  const tree = git("rev-parse", "HEAD^{tree}");
  const env = {
    GITHUB_REPOSITORY: repo,
    GITHUB_SERVER_URL: "https://github.com",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/pay-publish.yml@refs/heads/main`,
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_SHA: sha,
    GITHUB_RUN_ID: "123456789",
    GITHUB_RUN_ATTEMPT: "2",
    RUNNER_ENVIRONMENT: "github-hosted",
    PAY_PUBLISH_SOURCE_SHA: sha,
    PAY_PUBLISH_DEFAULT_BRANCH: "main",
  };
  const context = {
    schemaVersion: "pay-npm-source-context/v1",
    package: "@0xkey-io/pay",
    version,
    source: {
      repository: repo,
      server: "https://github.com",
      event: "workflow_dispatch",
      ref: "refs/heads/main",
      workflowRef: env.GITHUB_WORKFLOW_REF,
      runId: "123456789",
      runAttempt: "2",
      runner: "github-hosted",
      requestedSha: sha,
      runSha: sha,
      workflowSha: sha,
      mainRef: "refs/heads/main",
      mainSha: sha,
      treeSha: tree,
    },
    checkedTar: identity(tar),
  };
  const checkedTar = join(root, "original.tgz");
  const contextFile = join(root, "context.json");
  await writeFile(checkedTar, tar);
  await writeFile(contextFile, json(context));
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: `pkg:npm/%40xkey-io/pay@${version}`,
        digest: { sha512: hash(tar, "sha512") },
      },
    ],
    predicateType: slsa,
    predicate: {
      buildDefinition: {
        buildType:
          "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            repository: `https://github.com/${repo}`,
            ref: "refs/heads/main",
            path: ".github/workflows/pay-publish.yml",
          },
        },
        internalParameters: {
          github: {
            event_name: "workflow_dispatch",
            repository_id: "42",
            repository_owner_id: "43",
          },
        },
        resolvedDependencies: [
          {
            uri: `git+https://github.com/${repo}@refs/heads/main`,
            digest: { gitCommit: sha },
          },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId: `https://github.com/${repo}/actions/runs/123456789/attempts/2`,
        },
      },
    },
  };
  const bundle = {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    verificationMaterial: {
      certificate: { rawBytes: "Y2VydA==" },
      tlogEntries: [],
    },
    dsseEnvelope: {
      payloadType: "application/vnd.in-toto+json",
      payload: json(statement).toString("base64"),
      signatures: [{ sig: "c2lnbmF0dXJl", keyid: "" }],
    },
  };
  const metadata = {
    name: "@0xkey-io/pay",
    version,
    dist: {
      shasum: hash(tar, "sha1"),
      integrity: identity(tar).integrity,
      tarball: `${registry}/@0xkey-io/pay/-/pay-${version}.tgz`,
      attestations: {
        url: `${registry}/-/npm/v1/attestations/@0xkey-io%2fpay@${version}`,
      },
    },
  };
  const bodies = () => [
    json(metadata),
    tar,
    json({ attestations: [{ predicateType: slsa, bundle }] }),
  ];
  function transport(rawBodies = bodies()) {
    let index = 0;
    return async (options) => {
      const paths = [
        `/@0xkey-io%2fpay/${version}`,
        `/@0xkey-io/pay/-/pay-${version}.tgz`,
        `/-/npm/v1/attestations/@0xkey-io%2fpay@${version}`,
      ];
      assert.equal(options.path, paths[index]);
      const body = rawBodies[index];
      return {
        status: 200,
        rawHeaders: [
          "Content-Type",
          index++ === 1 ? "application/octet-stream" : "application/json",
          "Content-Length",
          String(body.length),
          "Date",
          "Thu, 27 Aug 2026 10:00:00 GMT",
        ],
        body,
      };
    };
  }
  return {
    root,
    checkout,
    git,
    sha,
    tree,
    env,
    checkedTar,
    contextFile,
    context,
    metadata,
    statement,
    bundle,
    bodies,
    transport,
    prepare: {
      checkout,
      checkedTar,
      expectedVersion: version,
      output: join(root, "preserved"),
      env,
    },
    capture: {
      checkedTar,
      contextFile,
      expectedVersion: version,
      expectedSource: sha,
      output: join(root, "pay-npm-publication-receipt-v1"),
    },
  };
}

test("preparation retains the exact original checked tar and immutable source object", async () => {
  const f = await fixture();
  await prepareSourceContext(f.prepare);
  assert.equal(
    existsSync(f.prepare.output),
    true,
    "checked package must survive a later failed registry capture",
  );
  assert.deepEqual((await readdir(f.prepare.output)).sort(), [
    "package.tgz",
    "source-context.json",
  ]);
  assert.deepEqual(await readFile(join(f.prepare.output, "package.tgz")), tar);
  assert.deepEqual(
    JSON.parse(await readFile(join(f.prepare.output, "source-context.json"))),
    f.context,
  );
  assert.deepEqual(await readFile(f.checkedTar), tar);
});

test("production preparation CLI preserves its environment-bound original inputs", async () => {
  const f = await fixture();
  const result = spawnSync(
    process.execPath,
    [
      new URL("./prepare-npm-source-context.mjs", import.meta.url).pathname,
      "--checked-tar",
      f.checkedTar,
      "--expected-version",
      version,
      "--output",
      f.prepare.output,
    ],
    {
      cwd: f.checkout,
      env: { PATH: process.env.PATH, ...f.env },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(await readFile(join(f.prepare.output, "source-context.json"))),
    f.context,
  );
  assert.deepEqual(await readFile(join(f.prepare.output, "package.tgz")), tar);
});

test("production collector CLI does not expose malformed context or path contents", async () => {
  const f = await fixture();
  await writeFile(f.contextFile, '{"SECRET_SENTINEL":');
  const result = spawnSync(
    process.execPath,
    [
      new URL("./collect-published-npm-receipt.mjs", import.meta.url).pathname,
      "--checked-tar",
      f.checkedTar,
      "--source-context",
      f.contextFile,
      "--expected-version",
      version,
      "--expected-source",
      f.sha,
      "--output",
      f.capture.output,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    process.versions.node === "24.3.0"
      ? "receipt-capture: PAY_NPM_JSON_SYNTAX\n"
      : "receipt-capture: PAY_NPM_RUNTIME\n",
  );
  assert.equal(existsSync(f.capture.output), false);
});

test("synthetic publication yields six immutable raw files with optional gitHead absent", async () => {
  const f = await fixture();
  await collectReceipt(f.capture, f.transport());
  assert.equal(
    existsSync(f.capture.output),
    true,
    "successful capture must publish a complete receipt",
  );
  assert.deepEqual((await readdir(f.capture.output)).sort(), [
    "package.tgz",
    "provenance.bundle.json",
    "receipt.json",
    "receipt.sha256",
    "registry-attestations.json",
    "registry-metadata.json",
  ]);
  assert.deepEqual(await readFile(join(f.capture.output, "package.tgz")), tar);
  assert.deepEqual(
    await readFile(join(f.capture.output, "provenance.bundle.json")),
    json(f.bundle),
  );
  const receiptBytes = await readFile(join(f.capture.output, "receipt.json"));
  assert.equal(
    await readFile(join(f.capture.output, "receipt.sha256"), "utf8"),
    `${hash(receiptBytes)}  receipt.json\n`,
  );
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.schemaVersion, "pay-npm-publication-receipt/v1");
  assert.deepEqual(receipt.sourceExpectations, f.context.source);
  assert.equal(receipt.provenance.verification, "unverified");
  assert.equal(Object.hasOwn(receipt, "gitHead"), false);
});

async function denied(f, options = f.capture, transport = f.transport()) {
  await assert.rejects(collectReceipt(options, transport), (error) => {
    assert.match(error.message, /^PAY_NPM_[A-Z0-9_]+$/);
    assert.doesNotMatch(String(error), /SECRET_SENTINEL/);
    return true;
  });
  assert.equal(existsSync(options.output), false);
  assert.deepEqual(await readFile(f.checkedTar), tar);
}

test("matching optional gitHead and all controlled advertised scoped spellings work", async (t) => {
  for (const leading of ["@", "%40"])
    for (const slash of ["%2f", "%2F"]) {
      await t.test(`${leading} ${slash}`, async () => {
        const f = await fixture();
        f.metadata.gitHead = f.sha;
        f.metadata.dist.attestations.url = `${registry}/-/npm/v1/attestations/${leading}0xkey-io${slash}pay@${version}`;
        await collectReceipt(f.capture, f.transport());
        const receipt = JSON.parse(
          await readFile(join(f.capture.output, "receipt.json")),
        );
        assert.equal(receipt.gitHead, f.sha);
        assert.equal(
          receipt.observations.attestations.advertisedUrl,
          f.metadata.dist.attestations.url,
        );
        assert.equal(
          receipt.observations.attestations.url,
          `${registry}/-/npm/v1/attestations/@0xkey-io%2fpay@${version}`,
        );
      });
    }
});

test("raw bundle ranges preserve multibyte prefix, escaped keys and braces without LF", async () => {
  const f = await fixture();
  const otherStatement = {
    ...f.statement,
    predicateType: "https://example.invalid/publish",
    predicate: { note: '前面 {\\"}' },
  };
  const other = {
    ...f.bundle,
    dsseEnvelope: {
      ...f.bundle.dsseEnvelope,
      payload: json(otherStatement).toString("base64"),
    },
    verificationMaterial: { note: '前面 {"}' },
  };
  const rawBundle = Buffer.from(
    JSON.stringify(f.bundle, null, 3).replace('"payload"', '"paylo\\u0061d"'),
  );
  const prefix = Buffer.from(
    `{ "attestations" : [${JSON.stringify({ predicateType: otherStatement.predicateType, bundle: other })}, {"predicateType": "${slsa}", "b\\u0075ndle": `,
  );
  const outer = Buffer.concat([prefix, rawBundle, Buffer.from("} ] }\n")]);
  await collectReceipt(f.capture, f.transport([json(f.metadata), tar, outer]));
  assert.deepEqual(
    await readFile(join(f.capture.output, "provenance.bundle.json")),
    rawBundle,
  );
  assert.deepEqual(
    await readFile(join(f.capture.output, "registry-attestations.json")),
    outer,
  );
  const receipt = JSON.parse(
    await readFile(join(f.capture.output, "receipt.json")),
  );
  assert.equal(receipt.provenance.index, 1);
  assert.deepEqual(receipt.provenance.range, {
    start: prefix.length,
    end: prefix.length + rawBundle.length,
  });
  assert.equal(receipt.attestations.length, 2);
  assert.equal(receipt.provenance.profile.sourceSha, f.sha);
});

test("read-only recapture does not depend on current checkout or advanced main", async () => {
  const f = await fixture();
  f.git("commit", "--allow-empty", "-qm", "advanced main");
  f.git("update-ref", "refs/remotes/origin/main", f.git("rev-parse", "HEAD"));
  await collectReceipt(f.capture, f.transport());
  assert.deepEqual(await readFile(join(f.capture.output, "package.tgz")), tar);
});

test("large bounded DSSE payload remains accepted without regex stack exhaustion", async () => {
  const f = await fixture();
  f.statement.predicate.padding = "x".repeat(240000);
  f.bundle.dsseEnvelope.payload = json(f.statement).toString("base64");
  await collectReceipt(f.capture, f.transport());
  assert.deepEqual(
    await readFile(join(f.capture.output, "provenance.bundle.json")),
    json(f.bundle),
  );
});

test("bundle media type cannot be supplied as a coercible array", async () => {
  const f = await fixture();
  f.bundle.mediaType = [f.bundle.mediaType];
  await denied(f);
});

test("preparation ignores replacement refs but rejects inconsistent original context", async (t) => {
  await t.test("replacement cannot select another source tree", async () => {
    const f = await fixture();
    await writeFile(join(f.checkout, "other"), "other tree");
    f.git("add", ".");
    f.git("commit", "-qm", "other tree");
    const other = f.git("rev-parse", "HEAD");
    f.git("update-ref", "refs/heads/main", f.sha);
    f.git("replace", f.sha, other);
    await prepareSourceContext(f.prepare);
    assert.equal(
      JSON.parse(await readFile(join(f.prepare.output, "source-context.json")))
        .source.treeSha,
      f.tree,
    );
  });
  for (const key of [
    "GITHUB_REPOSITORY",
    "GITHUB_SERVER_URL",
    "GITHUB_EVENT_NAME",
    "GITHUB_REF",
    "GITHUB_WORKFLOW_REF",
    "GITHUB_SHA",
    "GITHUB_WORKFLOW_SHA",
    "GITHUB_RUN_ID",
    "GITHUB_RUN_ATTEMPT",
    "RUNNER_ENVIRONMENT",
    "PAY_PUBLISH_SOURCE_SHA",
    "PAY_PUBLISH_DEFAULT_BRANCH",
  ]) {
    await t.test(key, async () => {
      const f = await fixture();
      f.prepare.env[key] = "SECRET_SENTINEL";
      await assert.rejects(
        prepareSourceContext(f.prepare),
        /^Error: PAY_NPM_[A-Z_]+$/,
      );
      assert.equal(existsSync(f.prepare.output), false);
    });
  }
  for (const mutation of [
    "main",
    "version",
    "source manifest",
    "output in checkout",
  ])
    await t.test(mutation, async () => {
      const f = await fixture();
      if (mutation === "main")
        f.git("update-ref", "-d", "refs/remotes/origin/main");
      if (mutation === "version") f.prepare.expectedVersion = "1.0.1";
      if (mutation === "source manifest")
        await writeFile(join(f.checkout, "packages/pay/package.json"), "{}");
      if (mutation === "output in checkout")
        f.prepare.output = join(f.checkout, "preserved");
      await assert.rejects(prepareSourceContext(f.prepare));
      assert.equal(existsSync(f.prepare.output), false);
    });
});

test("metadata must bind exact package, hashes, source and raw fixed URLs", async (t) => {
  const mutations = [
    [
      "name",
      (f) => {
        f.metadata.name = "other";
      },
    ],
    [
      "version",
      (f) => {
        f.metadata.version = 1;
      },
    ],
    [
      "SHA1",
      (f) => {
        f.metadata.dist.shasum = "0".repeat(40);
      },
    ],
    [
      "integrity",
      (f) => {
        f.metadata.dist.integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
      },
    ],
    [
      "multiple SRI",
      (f) => {
        f.metadata.dist.integrity += ` ${f.metadata.dist.integrity}`;
      },
    ],
    [
      "gitHead mismatch",
      (f) => {
        f.metadata.gitHead = "0".repeat(40);
      },
    ],
    [
      "gitHead type",
      (f) => {
        f.metadata.gitHead = null;
      },
    ],
    [
      "missing advertisement",
      (f) => {
        delete f.metadata.dist.attestations;
      },
    ],
    [
      "dist type",
      (f) => {
        f.metadata.dist = [];
      },
    ],
    [
      "SRI pad bits",
      (f) => {
        f.metadata.dist.integrity =
          f.metadata.dist.integrity.slice(0, -3) + "B==";
      },
    ],
  ];
  for (const [name, mutate] of mutations)
    await t.test(name, async () => {
      const f = await fixture();
      mutate(f);
      await denied(f);
    });
  for (const field of ["tarball", "attestation"])
    for (const variant of [
      "http",
      "host",
      "port",
      "userinfo",
      "query",
      "fragment",
      "backslash",
      "newline",
      "dot",
      "encodedDot",
      "double",
      "otherPackage",
      "otherVersion",
      "extra",
      "uppercaseHost",
    ]) {
      await t.test(`${field} ${variant}`, async () => {
        const f = await fixture();
        let value =
          field === "tarball"
            ? f.metadata.dist.tarball
            : f.metadata.dist.attestations.url;
        value = {
          http: value.replace("https:", "http:"),
          host: value.replace("registry.npmjs.org", "example.invalid"),
          port: value.replace("registry.npmjs.org", "registry.npmjs.org:443"),
          userinfo: value.replace("https://", "https://SECRET_SENTINEL@"),
          query: value + "?x=1",
          fragment: value + "#x",
          backslash: value.replace("/@0x", "/\\@0x"),
          newline: value + "\n",
          dot: value.replace(".org/", ".org/./"),
          encodedDot: value.replace(".org/", ".org/%2e/"),
          double: value.replace("pay", "%2570ay"),
          otherPackage: value.replace("pay", "other"),
          otherVersion: value.replace(version, "1.0.1"),
          extra: value + "/extra",
          uppercaseHost: value.replace("registry", "REGISTRY"),
        }[variant];
        // Attestation's scoped name follows a prefix, so inject its backslash separately.
        if (variant === "backslash") value = value.replace(".org/", ".org/\\");
        if (field === "tarball") f.metadata.dist.tarball = value;
        else f.metadata.dist.attestations.url = value;
        await denied(f);
      });
    }
});

test("strict JSON and provenance profile reject ambiguous or malformed evidence", async (t) => {
  const mutations = [
    [
      "wrong statement",
      (f) => {
        f.statement._type = "https://in-toto.io/Statement/v0.1";
      },
    ],
    [
      "subject count",
      (f) => {
        f.statement.subject.push(f.statement.subject[0]);
      },
    ],
    [
      "subject name",
      (f) => {
        f.statement.subject[0].name += "x";
      },
    ],
    [
      "subject digest",
      (f) => {
        f.statement.subject[0].digest.sha512 = "0".repeat(128);
      },
    ],
    [
      "extra digest",
      (f) => {
        f.statement.subject[0].digest.sha256 = hash(tar);
      },
    ],
    [
      "source",
      (f) => {
        f.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit =
          "0".repeat(40);
      },
    ],
    [
      "source uri",
      (f) => {
        f.statement.predicate.buildDefinition.resolvedDependencies[0].uri +=
          "/other";
      },
    ],
    [
      "source count",
      (f) => {
        f.statement.predicate.buildDefinition.resolvedDependencies.push(
          f.statement.predicate.buildDefinition.resolvedDependencies[0],
        );
      },
    ],
    [
      "build type",
      (f) => {
        f.statement.predicate.buildDefinition.buildType =
          "https://actions.github.io/buildtypes/workflow/v1";
      },
    ],
    [
      "workflow",
      (f) => {
        f.statement.predicate.buildDefinition.externalParameters.workflow.path =
          ".github/workflows/other.yml";
      },
    ],
    [
      "builder",
      (f) => {
        f.statement.predicate.runDetails.builder.id = "self-hosted";
      },
    ],
    [
      "run",
      (f) => {
        f.statement.predicate.runDetails.metadata.invocationId += "0";
      },
    ],
    [
      "event",
      (f) => {
        f.statement.predicate.buildDefinition.internalParameters.github.event_name =
          "push";
      },
    ],
    [
      "numeric id type",
      (f) => {
        f.statement.predicate.buildDefinition.internalParameters.github.repository_id = 42;
      },
    ],
  ];
  for (const [name, mutate] of mutations)
    await t.test(name, async () => {
      const f = await fixture();
      mutate(f);
      f.bundle.dsseEnvelope.payload = json(f.statement).toString("base64");
      await denied(f);
    });
  for (const [name, mutate] of [
    [
      "signature absent",
      (f) => {
        f.bundle.dsseEnvelope.signatures = [];
      },
    ],
    [
      "signature empty",
      (f) => {
        f.bundle.dsseEnvelope.signatures[0].sig = "";
      },
    ],
    [
      "signature type",
      (f) => {
        f.bundle.dsseEnvelope.signatures[0].sig = 42;
      },
    ],
    [
      "competing signature",
      (f) => {
        f.bundle.messageSignature = {};
      },
    ],
    [
      "snake-case alternative",
      (f) => {
        f.bundle.dsse_envelope = f.bundle.dsseEnvelope;
      },
    ],
    [
      "payload type",
      (f) => {
        f.bundle.dsseEnvelope.payloadType = "text/plain";
      },
    ],
    [
      "invalid base64",
      (f) => {
        f.bundle.dsseEnvelope.payload = "e30=\n";
      },
    ],
    [
      "payload size",
      (f) => {
        f.bundle.dsseEnvelope.payload = Buffer.alloc(262145, 32).toString(
          "base64",
        );
      },
    ],
    [
      "predicate mismatch",
      (f) => {
        f.statement.predicateType = "https://example.invalid/wrong";
        f.bundle.dsseEnvelope.payload = json(f.statement).toString("base64");
      },
    ],
    [
      "payload duplicate",
      (f) => {
        f.bundle.dsseEnvelope.payload = Buffer.from(
          '{"predicateType":1,"predicateType":2}',
        ).toString("base64");
      },
    ],
  ])
    await t.test(name, async () => {
      const f = await fixture();
      mutate(f);
      await denied(f);
    });
  for (const [name, outer] of [
    ["no entries", () => json({ attestations: [] })],
    [
      "two SLSA",
      (f) =>
        json({
          attestations: [
            { predicateType: slsa, bundle: f.bundle },
            { predicateType: slsa, bundle: f.bundle },
          ],
        }),
    ],
    [
      "nine entries",
      (f) =>
        json({
          attestations: Array.from({ length: 9 }, () => ({
            predicateType: slsa,
            bundle: f.bundle,
          })),
        }),
    ],
    [
      "extra outer key",
      (f) =>
        json({
          attestations: [{ predicateType: slsa, bundle: f.bundle }],
          extra: true,
        }),
    ],
    [
      "extra entry key",
      (f) =>
        json({
          attestations: [
            { predicateType: slsa, bundle: f.bundle, extra: true },
          ],
        }),
    ],
    [
      "duplicate decoded key",
      (f) =>
        Buffer.from(
          JSON.stringify({
            attestations: [{ predicateType: slsa, bundle: f.bundle }],
          }).replace('"bundle":', '"b\\u0075ndle":{},"bundle":'),
        ),
    ],
    ["invalid UTF8", () => Buffer.from([123, 34, 0xff, 34, 58, 49, 125])],
    ["depth", () => Buffer.from("[".repeat(65) + "0" + "]".repeat(65))],
    ["unsafe integer", () => Buffer.from('{"attestations":9007199254740993}')],
    ["trailing JSON", (f) => Buffer.concat([f.bodies()[2], Buffer.from("{}")])],
    [
      "bundle oversize",
      (f) =>
        json({
          attestations: [
            {
              predicateType: slsa,
              bundle: { ...f.bundle, padding: "x".repeat(1048576) },
            },
          ],
        }),
    ],
  ])
    await t.test(name, async () => {
      const f = await fixture();
      await denied(
        f,
        f.capture,
        f.transport([json(f.metadata), tar, outer(f)]),
      );
    });
});

test("HTTP observations fail closed without retaining partial evidence", async (t) => {
  for (const [name, mutate] of [
    [
      "redirect",
      (r) => {
        r.status = 302;
      },
    ],
    [
      "server error",
      (r) => {
        r.status = 500;
      },
    ],
    [
      "wrong content type",
      (r) => {
        r.rawHeaders[1] = "text/html";
      },
    ],
    [
      "duplicate content length",
      (r) => {
        r.rawHeaders.push("content-length", String(r.body.length));
      },
    ],
    [
      "conflicting framing",
      (r) => {
        r.rawHeaders.push("Transfer-Encoding", "chunked");
      },
    ],
    [
      "wrong length",
      (r) => {
        r.rawHeaders[3] = "1";
      },
    ],
    [
      "declared oversize",
      (r) => {
        r.rawHeaders[3] = "2097153";
      },
    ],
    [
      "actual oversize",
      (r) => {
        r.body = Buffer.alloc(2097153);
        r.rawHeaders[3] = String(r.body.length);
      },
    ],
    [
      "compression",
      (r) => {
        r.rawHeaders.push("Content-Encoding", "gzip");
      },
    ],
    [
      "bad Date",
      (r) => {
        r.rawHeaders[5] = "SECRET_SENTINEL";
      },
    ],
  ])
    await t.test(name, async () => {
      const f = await fixture();
      const next = f.transport();
      await denied(f, f.capture, async (options) => {
        const response = await next(options);
        mutate(response);
        return response;
      });
    });
  for (const name of ["TLS", "timeout", "network"])
    await t.test(name, async () => {
      const f = await fixture();
      await denied(f, f.capture, async () => {
        throw new Error(`SECRET_SENTINEL ${name}`);
      });
    });
});

test("changed contexts, tar inputs, links, collisions and concurrent captures are rejected", async (t) => {
  for (const name of [
    "context duplicate",
    "context extra",
    "context source",
    "context hash",
    "expected source",
    "version",
    "symlink",
    "hardlink",
    "executable",
    "tar mismatch",
    "context symlink",
    "traversal",
  ])
    await t.test(name, async () => {
      const f = await fixture();
      const options = { ...f.capture };
      if (name === "context duplicate")
        await writeFile(
          f.contextFile,
          json(f.context)
            .toString()
            .replace('"version":', '"version":0,"version":'),
        );
      if (name === "context extra") {
        f.context.extra = true;
        await writeFile(f.contextFile, json(f.context));
      }
      if (name === "context source") {
        f.context.source.runSha = "0".repeat(40);
        await writeFile(f.contextFile, json(f.context));
      }
      if (name === "context hash") {
        f.context.checkedTar.sha256 = "0".repeat(64);
        await writeFile(f.contextFile, json(f.context));
      }
      if (name === "expected source") options.expectedSource = "0".repeat(40);
      if (name === "version") options.expectedVersion = "01.0.0";
      if (name === "symlink") {
        options.checkedTar = join(f.root, "link");
        await symlink(f.checkedTar, options.checkedTar);
      }
      if (name === "hardlink") {
        options.checkedTar = join(f.root, "link");
        await link(f.checkedTar, options.checkedTar);
      }
      if (name === "executable") await chmod(f.checkedTar, 0o700);
      if (name === "tar mismatch") {
        options.checkedTar = join(f.root, "changed");
        await writeFile(options.checkedTar, "different opaque bytes");
      }
      if (name === "context symlink") {
        options.contextFile = join(f.root, "link");
        await symlink(f.contextFile, options.contextFile);
      }
      if (name === "traversal")
        options.output =
          join(f.root, "nested") + "/../pay-npm-publication-receipt-v1";
      await denied(f, options);
    });
  await t.test("existing empty or complete output untouched", async () => {
    const f = await fixture();
    await mkdir(f.capture.output);
    await assert.rejects(collectReceipt(f.capture, f.transport()));
    assert.deepEqual(await readdir(f.capture.output), []);
    await writeFile(join(f.capture.output, "sentinel"), "original");
    await assert.rejects(collectReceipt(f.capture, f.transport()));
    assert.equal(
      await readFile(join(f.capture.output, "sentinel"), "utf8"),
      "original",
    );
  });
  await t.test("only one concurrent writer can complete", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      collectReceipt(f.capture, f.transport()),
      collectReceipt(f.capture, f.transport()),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await readdir(f.capture.output)).length, 6);
    for (const name of await readdir(f.capture.output)) {
      const stat = await lstat(join(f.capture.output, name));
      assert.equal(stat.nlink, 1);
      assert.equal(stat.mode & 0o222, 0);
      assert.equal(stat.mode & 0o111, 0);
    }
  });
  await t.test(
    "input changed during observation cannot be accepted",
    async () => {
      const f = await fixture();
      const next = f.transport();
      await assert.rejects(
        collectReceipt(f.capture, async (options) => {
          await writeFile(f.contextFile, "{}");
          return next(options);
        }),
      );
      assert.equal(existsSync(f.capture.output), false);
    },
  );
});
