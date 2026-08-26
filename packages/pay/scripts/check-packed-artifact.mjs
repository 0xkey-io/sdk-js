import { execFile, spawn } from "node:child_process";
import {
  appendFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const publicRegistry = "https://registry.npmjs.org/";
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

async function verifyTarball(tarball, sourceManifest) {
  const manifest = await readPackedManifest(tarball);

  if (manifest.name !== "@0xkey-io/pay") {
    throw new Error(
      `Packed package name must be @0xkey-io/pay; found ${String(manifest.name)}`,
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

async function externalInstallSmoke(tarball) {
  const externalRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-external-"));
  try {
    await writeFile(
      join(externalRoot, "package.json"),
      `${JSON.stringify({ name: "pay-artifact-smoke", private: true, type: "module" })}\n`,
    );
    await run(
      process.platform === "win32" ? "npm.cmd" : "npm",
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        `--registry=${publicRegistry}`,
        tarball,
      ],
      { cwd: externalRoot },
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
          'if (typeof client.createPayClient !== "function") throw new Error("missing createPayClient");',
          'if (typeof mpp.create0xkeyEvmChargeMethod !== "function") throw new Error("missing MPP factory");',
          'if (typeof x402.create0xkeyFacilitatorClient !== "function") throw new Error("missing x402 factory");',
          'if ("createPayFetch" in client || "createPayFetch" in root) throw new Error("legacy createPayFetch is exported");',
        ].join("\n"),
      ],
      { cwd: externalRoot },
    );
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
      { cwd: externalRoot },
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
        files: ["public-contract.ts"],
      })}\n`,
    );
    await run(
      process.platform === "win32"
        ? join(packageRoot, "node_modules", ".bin", "tsc.cmd")
        : join(packageRoot, "node_modules", ".bin", "tsc"),
      ["-p", "tsconfig.json", "--pretty", "false"],
      { cwd: externalRoot },
    );
  } finally {
    await rm(externalRoot, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  if (args[0] === "--verify-only" && args.length === 2) {
    return { verifyOnly: resolve(args[1]) };
  }

  if (args.length === 0) return {};
  if (args[0] === "--pack-destination" && args.length === 2) {
    return { packDestination: resolve(args[1]) };
  }

  throw new Error(
    "Usage: check-packed-artifact.mjs [--pack-destination PATH | --verify-only TARBALL]",
  );
}

const options = parseArguments(process.argv.slice(2));

if (options.verifyOnly) {
  await verifyTarball(options.verifyOnly);
  process.stdout.write(`Verified packed Pay artifact ${options.verifyOnly}\n`);
} else {
  const sourceManifest = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  const ownsPackDirectory = !options.packDestination;
  const packDirectory =
    options.packDestination ??
    (await mkdtemp(join(tmpdir(), "oxkey-pay-artifact-")));

  try {
    await mkdir(packDirectory, { recursive: true });
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
      { cwd: packageRoot },
    );
    await run(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["pack", "--pack-destination", packDirectory],
      { cwd: packageRoot },
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
    await externalInstallSmoke(tarball);

    if (options.packDestination && process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `tarball=${tarball}\n`);
    }

    process.stdout.write(
      `Packed, verified, installed, and imported ${basename(tarball)}\n`,
    );
  } finally {
    if (ownsPackDirectory) {
      await rm(packDirectory, { recursive: true, force: true });
    }
  }
}
