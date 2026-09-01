import { createHash } from "node:crypto";
import { materializeConsumer, verifyConsumer, verifySourceGraph } from "./fixed-consumer.mjs";
import { prepareOfflineConsumer, safeArtifactPath } from "./offline-consumer.mjs";
import { execFile, spawn } from "node:child_process";
import {
  appendFile,
  access,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { constants } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRegistry = "https://registry.npmjs.org/";
const expectedRepository = {
  type: "git",
  url: "git+https://github.com/0xkey-io/sdk-js.git",
  directory: "packages/pay",
};
const expectedPublishConfig = {
  access: "public",
  registry: publicRegistry,
  tag: "next",
};
const dependencyGroups = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
const requiredEntries = [
  ...["admin", "client", "express", "hono", "next", "server"].flatMap(
    (entry) => [
      `package/dist/${entry}/index.js`,
      `package/dist/${entry}/index.mjs`,
      `package/dist/${entry}/index.d.ts`,
    ],
  ),
  ...["mpp", "x402"].flatMap((entry) => [
    `package/dist/${entry}/index.js`,
    `package/dist/${entry}/index.mjs`,
    `package/dist/${entry}/index.d.mts`,
  ]),
  "package/docs/generated-support.md",
  "package/docs/migrating-to-1.0.md",
  "package/docs/protocol-selection-and-recovery.md",
];

function run(command, args, options = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        accept();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed${
            signal ? ` with signal ${signal}` : ` with exit code ${code}`
          }`,
        ),
      );
    });
  });
}

async function readPackedManifest(tarball) {
  const { stdout } = await execFileAsync(
    "tar",
    ["-xOf", tarball, "package/package.json"],
    { maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

function assertExactObject(actual, expected, label) {
  const prototype =
    actual && typeof actual === "object" ? Object.getPrototypeOf(actual) : null;
  if (
    !actual ||
    typeof actual !== "object" ||
    Array.isArray(actual) ||
    prototype !== Object.prototype ||
    !isDeepStrictEqual(actual, expected)
  ) {
    throw new Error(`${label} must be ${JSON.stringify(expected)}`);
  }
}

function assertSourceManifest(manifest) {
  if (manifest.name !== "@0xkey-io/pay") {
    throw new Error("Pay source package name must be @0xkey-io/pay");
  }
  if (manifest.private !== true) {
    throw new Error("Pay source package must remain private:true");
  }
  assertExactObject(
    manifest.repository,
    expectedRepository,
    "Pay source repository",
  );
  assertExactObject(
    manifest.publishConfig,
    expectedPublishConfig,
    "Pay source publishConfig",
  );
}

export async function withPublicPayManifest(manifestPath, operation) {
  const originalBytes = await readFile(manifestPath);
  const sourceManifest = JSON.parse(originalBytes.toString("utf8"));
  assertSourceManifest(sourceManifest);
  const publicManifest = { ...sourceManifest, private: false };

  try {
    await writeFile(
      manifestPath,
      `${JSON.stringify(publicManifest, null, 2)}\n`,
    );
    return await operation(publicManifest);
  } finally {
    await writeFile(manifestPath, originalBytes);
  }
}

async function verifyTarball(tarball, sourceManifest) {
  const manifest = await readPackedManifest(tarball);

  if (manifest.name !== "@0xkey-io/pay") {
    throw new Error(
      `Packed package name must be @0xkey-io/pay; found ${String(manifest.name)}`,
    );
  }
  if (manifest.private !== false) {
    throw new Error("Packed Pay artifact must be public with private:false");
  }
  assertExactObject(
    manifest.repository,
    expectedRepository,
    "Packed repository",
  );
  assertExactObject(
    manifest.publishConfig,
    expectedPublishConfig,
    "Packed publishConfig",
  );

  if (manifest.engines?.node !== ">=22.12.0") {
    throw new Error(
      `Packed engines.node must be >=22.12.0 for the supported require(ESM) baseline; found ${String(manifest.engines?.node)}`,
    );
  }
  for (const group of dependencyGroups) {
    for (const [name, value] of Object.entries(manifest[group] ?? {})) {
      if (typeof value === "string" && value.startsWith("workspace:")) {
        throw new Error(
          `Packed ${group}.${name} must not use ${value}; workspace:* cannot be installed outside this repository`,
        );
      }
    }
  }
  if (manifest.peerDependencies?.mppx !== "0.8.19") {
    throw new Error(
      "Packed peerDependencies.mppx must be exactly 0.8.19 for PaymentError class identity",
    );
  }
  if (manifest.peerDependencies?.["@x402/core"] !== "2.23.0") {
    throw new Error(
      "Packed peerDependencies.@x402/core must be exactly 2.23.0 for facilitator error class identity",
    );
  }
  if (manifest.peerDependencies?.viem !== ">=2.54.0 <3") {
    throw new Error(
      "Packed peerDependencies.viem must preserve the >=2.54.0 <3 public runtime contract",
    );
  }

  if (sourceManifest) {
    for (const field of ["name", "version"]) {
      if (manifest[field] !== sourceManifest[field]) {
        throw new Error(
          `Packed ${field} must match the source package (${sourceManifest[field]}); found ${manifest[field]}`,
        );
      }
    }
  }

  const { stdout } = await execFileAsync("tar", ["-tf", tarball], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const entries = new Set(stdout.split("\n").filter(Boolean));

  for (const entry of entries) {
    if (/\/(?:commerce|verifier)(?:\/|$)/.test(entry)) {
      throw new Error(
        `Standalone Pay tarball must not contain Commerce artifact ${entry}`,
      );
    }
  }

  for (const entry of requiredEntries) {
    if (!entries.has(entry)) {
      throw new Error(`Packed Pay artifact is missing ${entry}`);
    }
  }

  for (const entry of [
    "package/dist/index.d.ts",
    "package/dist/client/index.d.ts",
    "package/dist/server/index.d.ts",
  ]) {
    const { stdout: declaration } = await execFileAsync(
      "tar",
      ["-xOf", tarball, entry],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    if (/from ["'](?:mppx|@x402\/)/.test(declaration)) {
      throw new Error(`${entry} leaks an upstream payment wire type`);
    }
  }

  return manifest;
}

async function externalInstallSmoke(tarball, preparation) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "oxkey-pay-external-")));
  const externalRoot = join(parent, "consumer");
  const binding = { directory: externalRoot, artifact: await realpath(tarball), artifactSha256: createHash("sha256").update(await readFile(tarball)).digest("hex") };
  const env = preparation.env;
  try {
    const before = await materializeConsumer(binding);
    await run(process.execPath, [preparation.npm, "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--strict-peer-deps"], { cwd: externalRoot, env });
    const after = await verifyConsumer(binding, true);
    if (before.manifestSha256 !== after.manifestSha256 || before.lockSha256 !== after.lockSha256) throw new Error("CONSUMER_GRAPH_MISMATCH");
    await run(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ls", "mppx", "--all"],
      { cwd: externalRoot, env },
    );
    const { stdout: mppxPaths } = await execFileAsync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ls", "mppx", "--all", "--parseable"],
      { cwd: externalRoot, env },
    );
    const installedMppx = mppxPaths.trim().split("\n").filter(Boolean);
    if (installedMppx.length !== 1) {
      throw new Error(
        `Packed Pay must resolve one mppx instance; found ${installedMppx.length}`,
      );
    }
    await run(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ls", "@x402/core", "--all"],
      { cwd: externalRoot, env },
    );
    const { stdout: x402CorePaths } = await execFileAsync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ls", "@x402/core", "--all", "--parseable"],
      { cwd: externalRoot, env },
    );
    const installedX402Core = x402CorePaths.trim().split("\n").filter(Boolean);
    if (installedX402Core.length !== 1) {
      throw new Error(
        `Packed Pay must resolve one @x402/core instance; found ${installedX402Core.length}`,
      );
    }
    await run(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ls", "viem", "--all"],
      { cwd: externalRoot, env },
    );
    await run(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          'import * as root from "@0xkey-io/pay";',
          'import "@0xkey-io/pay/admin";',
          'import * as client from "@0xkey-io/pay/client";',
          'import "@0xkey-io/pay/express";',
          'import "@0xkey-io/pay/hono";',
          'import "@0xkey-io/pay/next";',
          'import "@0xkey-io/pay/server";',
          'import * as mpp from "@0xkey-io/pay/mpp";',
          'import * as x402 from "@0xkey-io/pay/x402";',
          'import { getAddress } from "viem";',
          'if (typeof client.createPayClient !== "function") throw new Error("missing createPayClient");',
          'if (typeof mpp.create0xkeyEvmChargeMethod !== "function") throw new Error("missing MPP factory");',
          'if (typeof x402.create0xkeyFacilitatorClient !== "function") throw new Error("missing x402 factory");',
          'if (getAddress("0x1111111111111111111111111111111111111111").length !== 42) throw new Error("direct viem peer import failed");',
          'if ("createPayFetch" in client || "createPayFetch" in root) throw new Error("legacy createPayFetch is exported");',
        ].join("\n"),
      ],
      { cwd: externalRoot, env },
    );
    await writeFile(
      join(externalRoot, "mpp-runtime-smoke.mjs"),
      mppRuntimeSmoke("esm"),
    );
    await writeFile(
      join(externalRoot, "mpp-runtime-smoke.cjs"),
      mppRuntimeSmoke("cjs"),
    );
    await run(process.execPath, ["mpp-runtime-smoke.mjs"], {
      cwd: externalRoot, env,
    });
    await run(process.execPath, ["mpp-runtime-smoke.cjs"], {
      cwd: externalRoot, env,
    });
    await run(
      process.execPath,
      [
        "--input-type=commonjs",
        "--eval",
        [
          'const entries = ["@0xkey-io/pay", "@0xkey-io/pay/client", "@0xkey-io/pay/server", "@0xkey-io/pay/x402", "@0xkey-io/pay/mpp", "@0xkey-io/pay/admin", "@0xkey-io/pay/express", "@0xkey-io/pay/hono", "@0xkey-io/pay/next"];',
          "for (const entry of entries) require(entry);",
        ].join("\n"),
      ],
      { cwd: externalRoot, env },
    );
    await writeFile(
      join(externalRoot, "public-contract.ts"),
      [
        'import { createPayClient, type CreatePayClientOptions, type PayClient, type PayProtocolId } from "@0xkey-io/pay/client";',
        'import type { PayError, PendingPaymentSummary, SerializedPendingPayment } from "@0xkey-io/pay";',
        'import { createPayServer, type PayServer } from "@0xkey-io/pay/server";',
        'import { create0xkeyFacilitatorClient } from "@0xkey-io/pay/x402";',
        'import { create0xkeyEvmChargeMethod } from "@0xkey-io/pay/mpp";',
        "void createPayClient; void (null as unknown as CreatePayClientOptions); void (null as unknown as PayClient);",
        "void (null as unknown as PayProtocolId); void (null as unknown as PayError);",
        "void (null as unknown as PendingPaymentSummary); void (null as unknown as SerializedPendingPayment);",
        "void createPayServer; void (null as unknown as PayServer);",
        "void create0xkeyFacilitatorClient; void create0xkeyEvmChargeMethod;",
        "// @ts-expect-error pre-GA callable API is intentionally removed",
        'import { createPayFetch } from "@0xkey-io/pay/client";',
        "// @ts-expect-error upstream x402 wire types are not exported from root",
        'import type { PaymentPayload } from "@0xkey-io/pay";',
        "void createPayFetch; void (null as unknown as PaymentPayload);",
      ].join("\n"),
    );
    await writeFile(
      join(externalRoot, "public-x402-upfront.ts"),
      await readFile(join(externalRoot, "node_modules/@0xkey-io/pay/docs/examples/x402-upfront.ts"), "utf8"),
    );
    await writeFile(
      join(externalRoot, "tsconfig.json"),
      `${JSON.stringify({
        compilerOptions: {
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
        },
        files: ["public-contract.ts", "public-x402-upfront.ts"],
      })}\n`,
    );
    await run(
      process.platform === "win32"
        ? join(packageRoot, "node_modules", ".bin", "tsc.cmd")
        : join(packageRoot, "node_modules", ".bin", "tsc"),
      ["-p", "tsconfig.json", "--pretty", "false"],
      { cwd: externalRoot, env },
    );
    const final = await verifyConsumer(binding, true);
    if (before.manifestSha256 !== final.manifestSha256 || before.lockSha256 !== final.lockSha256) throw new Error("CONSUMER_GRAPH_MISMATCH");
    return final;
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

function mppRuntimeSmoke(moduleKind) {
  const imports =
    moduleKind === "esm"
      ? [
          'import assert from "node:assert/strict";',
          'import { Challenge, Credential } from "mppx";',
          'import { Mppx } from "mppx/server";',
          'import { authorizationDomain, authorizationTypes, challengeHash } from "mppx/evm";',
          'import { privateKeyToAccount } from "viem/accounts";',
          'import { create0xkeyEvmChargeMethod } from "@0xkey-io/pay/mpp";',
          'import { create0xkeyFacilitatorClient } from "@0xkey-io/pay/x402";',
          'import { paymentMiddlewareFromHTTPServer } from "@x402/express";',
          'import { FacilitatorResponseError, x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";',
          'import { ExactEvmScheme } from "@x402/evm/exact/server";',
          'import { encodePaymentSignatureHeader } from "@x402/core/http";',
        ]
      : [
          'const assert = require("node:assert/strict");',
          'const { Challenge, Credential } = require("mppx");',
          'const { Mppx } = require("mppx/server");',
          'const { authorizationDomain, authorizationTypes, challengeHash } = require("mppx/evm");',
          'const { privateKeyToAccount } = require("viem/accounts");',
          'const { create0xkeyEvmChargeMethod } = require("@0xkey-io/pay/mpp");',
          'const { create0xkeyFacilitatorClient } = require("@0xkey-io/pay/x402");',
          'const { paymentMiddlewareFromHTTPServer } = require("@x402/express");',
          'const { FacilitatorResponseError, x402ResourceServer, x402HTTPResourceServer } = require("@x402/core/server");',
          'const { ExactEvmScheme } = require("@x402/evm/exact/server");',
          'const { encodePaymentSignatureHeader } = require("@x402/core/http");',
        ];
  return `${imports.join("\n")}
(async () => {
  const secret = "packed-secret-must-not-be-logged";
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...values) => logged.push(values);
  try {
    const method = create0xkeyEvmChargeMethod({
      network: "eip155:84532",
      organizationId: "11111111-1111-4111-8111-111111111111",
      payTo: "0x1111111111111111111111111111111111111111",
      stamper: { async stampRequest() { return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" }; } },
      async fetch() { throw new Error(secret); },
    });
    const server = Mppx.create({ methods: [method], secretKey: "01234567890123456789012345678901" });
    const route = server.evm.charge({ amount: "0.01" });
    const offered = await route(new Request("https://merchant.example/weather"));
    assert.equal(offered.status, 402);
    const challenge = Challenge.fromResponse(offered.challenge.clone());
    const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    const nonce = challengeHash(challenge);
    const validBefore = String(Math.floor(Date.now() / 1000) + 300);
    const signature = await account.signTypedData({
      domain: authorizationDomain({
        authorization: { name: "USDC", version: "2" },
        chainId: challenge.request.methodDetails.chainId,
        currency: challenge.request.currency,
      }),
      message: {
        from: account.address,
        nonce,
        to: challenge.request.recipient,
        validAfter: 0n,
        validBefore: BigInt(validBefore),
        value: BigInt(challenge.request.amount),
      },
      primaryType: "TransferWithAuthorization",
      types: authorizationTypes,
    });
    const credential = Credential.serialize({ challenge, payload: {
      from: account.address, nonce, signature, to: challenge.request.recipient,
      type: "authorization", validAfter: "0", validBefore, value: challenge.request.amount,
    }});
    const result = await route(new Request("https://merchant.example/weather", {
      headers: { Authorization: credential },
    }));
    let handlerCalls = 0;
    const response = result.status === 402
      ? result.challenge
      : result.withReceipt((handlerCalls += 1, new Response("paid")));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "2");
    assert.equal(response.headers.has("WWW-Authenticate"), false);
    assert.equal(response.headers.has("Payment-Receipt"), false);
    assert.equal(handlerCalls, 0);
    assert.doesNotMatch(JSON.stringify(logged), /packed-secret-must-not-be-logged/);

    const requirements = {
      scheme: "exact", network: "eip155:84532", amount: "1000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x1111111111111111111111111111111111111111",
      maxTimeoutSeconds: 300,
      extra: { assetTransferMethod: "eip3009", paymentFlow: "upfront", name: "USDC", version: "2" },
    };
    const payload = {
      x402Version: 2, accepted: requirements,
      payload: { signature: "0x" + "11".repeat(65), authorization: {
        from: account.address, to: requirements.payTo, value: requirements.amount,
        validAfter: "0", validBefore: "9999999999", nonce: "0x" + "22".repeat(32),
      }},
    };
    let x402Calls = 0;
    for (const configured of [false, true]) {
    const x402Client = create0xkeyFacilitatorClient({
      network: "eip155:84532",
      organizationId: "11111111-1111-4111-8111-111111111111",
      ...(configured ? { facilitatorResponseError: FacilitatorResponseError } : {}),
      stamper: { async stampRequest() { return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" }; } },
      async fetch(url) {
        if (String(url).endsWith("/supported")) return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network: requirements.network }], extensions: [], signers: {} });
        x402Calls += 1; return new Response(null, { status: 503 });
      },
    });
    const exact = new ExactEvmScheme();
    const resource = new x402ResourceServer(x402Client).register(requirements.network, {
      scheme: exact.scheme, defaultAssetTransferMethod: exact.defaultAssetTransferMethod,
      paymentFlows: { eip3009: { supported: ["upfront"], default: "upfront" } },
      parsePrice: exact.parsePrice.bind(exact), enhancePaymentRequirements: exact.enhancePaymentRequirements.bind(exact), getAssetDecimals: exact.getAssetDecimals.bind(exact),
    });
    const httpServer = new x402HTTPResourceServer(resource, { "GET /weather": { accepts: {
      scheme: "exact", network: requirements.network, payTo: requirements.payTo, price: "$0.001",
      extra: { assetTransferMethod: "eip3009", paymentFlow: "upfront" },
    } } });
    const middleware = paymentMiddlewareFromHTTPServer(httpServer);
    const statusCodes = [];
    const bodies = [];
    const res = {
      status(code) { statusCodes.push(code); return this; },
      json(body) { bodies.push(body); return this; },
      setHeader() { return this; },
    };
    let nextCalls = 0;
    await middleware({
      body: undefined, headers: { host: "merchant.example" }, header(name) { return name.toLowerCase() === "payment-signature" ? encodePaymentSignatureHeader(payload) : undefined; },
      method: "GET", originalUrl: "/weather", path: "/weather", protocol: "https", query: {},
    }, res, () => { nextCalls += 1; });
    assert.deepEqual(statusCodes, [502]);
    assert.equal(nextCalls, 0);
    assert.equal(x402Calls, configured ? 2 : 1);
    }
  } finally {
    console.error = originalConsoleError;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;
}

function parseArguments(args) {
  if (args[0] === "--verify-only" && args.length === 2) {
    return { verifyOnly: safeArtifactPath(args[1]) };
  }

  if (args.length === 0) return {};
  if (args[0] === "--pack-destination" && args.length === 2) {
    return { packDestination: safeArtifactPath(args[1]) };
  }

  throw new Error(
    "Usage: check-packed-artifact.mjs [--pack-destination PATH | --verify-only TARBALL]",
  );
}

async function main(args) {
  const options = parseArguments(args);
  if (options.verifyOnly) {
    await verifyTarball(options.verifyOnly);
    process.stdout.write(
      `Verified packed Pay artifact ${options.verifyOnly}\n`,
    );
    return;
  }

  if (process.env.GITHUB_OUTPUT) {
    const output = safeArtifactPath(process.env.GITHUB_OUTPUT);
    try {
      await access(dirname(output), constants.W_OK);
      try { if (!(await lstat(output)).isFile()) throw new Error("invalid output"); await access(output, constants.W_OK); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    } catch { throw new Error("PAY_ARTIFACT_OUTPUT_REJECTED"); }
  }
  const preparation = await prepareOfflineConsumer();
  const manifestPath = join(packageRoot, "package.json");
  const sourceManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assertSourceManifest(sourceManifest);
  await verifySourceGraph(sourceManifest, packageRoot);
  const ownsPackDirectory = !options.packDestination;
  const packDirectory =
    options.packDestination ??
    (await mkdtemp(join(tmpdir(), "oxkey-pay-artifact-")));

  try {
    await mkdir(packDirectory, { recursive: true });
    try {
      await access(packDirectory, constants.W_OK | constants.X_OK);
    } catch { throw new Error("PAY_ARTIFACT_DESTINATION_REJECTED"); }
    const existingTarballs = (await readdir(packDirectory)).filter((entry) =>
      entry.endsWith(".tgz"),
    );
    if (existingTarballs.length !== 0) {
      throw new Error(
        `Pack destination must not contain tarballs; found ${existingTarballs.join(", ")}`,
      );
    }

    await run(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["run", "build"],
      { cwd: packageRoot, env: preparation.env },
    );
    await withPublicPayManifest(manifestPath, async () =>
      run(
        process.platform === "win32" ? "pnpm.cmd" : "pnpm",
        ["pack", "--pack-destination", packDirectory],
        { cwd: packageRoot, env: preparation.env },
      ),
    );

    const tarballs = (await readdir(packDirectory)).filter((entry) =>
      entry.endsWith(".tgz"),
    );
    if (tarballs.length !== 1) {
      throw new Error(
        `Expected exactly one packed Pay tarball; found ${tarballs.length}`,
      );
    }

    const tarball = resolve(packDirectory, tarballs[0]);
    await verifyTarball(tarball, sourceManifest);
    const consumer = await externalInstallSmoke(tarball, preparation);
    await verifyTarball(tarball, sourceManifest);
    if (createHash("sha256").update(await readFile(tarball)).digest("hex") !== consumer.artifactSha256) throw new Error("CONSUMER_ARTIFACT_MISMATCH");
    const finalPreparation = await prepareOfflineConsumer();
    if (!isDeepStrictEqual(finalPreparation.identity, preparation.identity)) throw new Error("PAY_ARTIFACT_INPUT_CHANGED");

    if (options.packDestination && process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `tarball=${tarball}\n`);
    }

    process.stdout.write(`Pay exact-graph evidence ${JSON.stringify({ toolchain: preparation.identity, consumer })}\n`);
    process.stdout.write(
      `Packed, verified, installed, and imported ${basename(tarball)}\n`,
    );
  } finally {
    if (ownsPackDirectory) {
      await rm(packDirectory, { recursive: true, force: true });
    }
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Pay artifact check failed"}\n`,
    );
    process.exitCode = 1;
  });
}
