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
  "package/docs/generated-support.md",
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
          'import "@0xkey-io/pay";',
          'import "@0xkey-io/pay/admin";',
          'import "@0xkey-io/pay/client";',
          'import "@0xkey-io/pay/express";',
          'import "@0xkey-io/pay/hono";',
          'import "@0xkey-io/pay/next";',
          'import "@0xkey-io/pay/server";',
        ].join("\n"),
      ],
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

    if (process.env.GITHUB_OUTPUT) {
      if (ownsPackDirectory) {
        throw new Error(
          "--pack-destination is required when writing the tarball path to GITHUB_OUTPUT",
        );
      }
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
