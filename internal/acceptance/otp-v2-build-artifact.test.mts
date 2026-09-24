import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFile,
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  stat,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sdkArtifactsDigest } from "./otp-v2-evidence.mts";
import { packageOtpAcceptanceBuild } from "./otp-v2-build-artifact.mts";

const sha256 = (bytes: string) =>
  createHash("sha256").update(bytes).digest("hex");
const metadata = {
  gitHead: "a".repeat(40),
  gitTree: "b".repeat(40),
  nodeVersion: "v22.12.0",
  pnpmVersion: "10.6.3",
  workflowRunId: "12345",
};

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), "otp-acceptance-build-"));
  const root = join(parent, "source");
  await mkdir(join(root, "packages/core/dist"), { recursive: true });
  await mkdir(join(root, "packages/crypto/dist"), { recursive: true });
  await mkdir(join(root, "packages/sdk-server/dist"), { recursive: true });
  await mkdir(join(root, "internal/codec/dist"), { recursive: true });
  await writeFile(join(root, "pnpm-lock.yaml"), "lock-A");
  await writeFile(join(root, "packages/core/dist/index.mjs"), "core-A");
  await writeFile(join(root, "packages/crypto/dist/index.mjs"), "crypto-A");
  await writeFile(join(root, "packages/sdk-server/dist/index.mjs"), "server-A");
  await writeFile(join(root, "internal/codec/dist/index.mjs"), "codec-A");
  await writeFile(join(root, "packages/core/src.ts"), "not a built file");
  return { parent, root, expectedLockSha256: sha256("lock-A") };
}

test("complete synthetic build preserves relative dist paths and public provenance", async () => {
  const { parent, root, expectedLockSha256 } = await fixture();
  const destination = join(parent, "artifact");
  const result = await packageOtpAcceptanceBuild(root, destination, {
    ...metadata,
    expectedLockSha256,
  });
  assert.equal(result, destination);
  for (const relativePath of [
    "packages/core/dist/index.mjs",
    "packages/crypto/dist/index.mjs",
    "packages/sdk-server/dist/index.mjs",
    "internal/codec/dist/index.mjs",
    "pnpm-lock.yaml",
  ]) {
    assert.equal(
      await readFile(join(destination, relativePath), "utf8"),
      await readFile(join(root, relativePath), "utf8"),
    );
  }
  await assert.rejects(stat(join(destination, "packages/core/src.ts")), {
    code: "ENOENT",
  });
  const provenance = JSON.parse(
    await readFile(join(destination, "provenance.json"), "utf8"),
  );
  assert.deepEqual(provenance, {
    schema: "0xkey.sdk.otp-acceptance-build.v1",
    gitHead: metadata.gitHead,
    gitTree: metadata.gitTree,
    nodeVersion: metadata.nodeVersion,
    pnpmVersion: metadata.pnpmVersion,
    lockSha256: expectedLockSha256,
    sdkArtifactsDigest: await sdkArtifactsDigest(root),
    workflowRunId: metadata.workflowRunId,
  });
  assert.equal(
    await sdkArtifactsDigest(destination),
    provenance.sdkArtifactsDigest,
  );
  assert.doesNotMatch(JSON.stringify(provenance), /secret|token|password/i);
});

test("changing an internal dist byte changes the packaged digest", async () => {
  const { parent, root, expectedLockSha256 } = await fixture();
  await packageOtpAcceptanceBuild(root, join(parent, "first"), {
    ...metadata,
    expectedLockSha256,
  });
  await writeFile(join(root, "internal/codec/dist/index.mjs"), "codec-B");
  await packageOtpAcceptanceBuild(root, join(parent, "second"), {
    ...metadata,
    expectedLockSha256,
  });
  const first = JSON.parse(
    await readFile(join(parent, "first/provenance.json"), "utf8"),
  );
  const second = JSON.parse(
    await readFile(join(parent, "second/provenance.json"), "utf8"),
  );
  assert.notEqual(first.sdkArtifactsDigest, second.sdkArtifactsDigest);
});

test("missing core or crypto entry and symlinked build content are rejected", async () => {
  for (const missing of ["core", "crypto"]) {
    const { parent, root, expectedLockSha256 } = await fixture();
    await unlink(join(root, `packages/${missing}/dist/index.mjs`));
    await assert.rejects(
      packageOtpAcceptanceBuild(root, join(parent, "artifact"), {
        ...metadata,
        expectedLockSha256,
      }),
      /SDK_BUILD_MISSING/,
    );
  }
  const { parent, root, expectedLockSha256 } = await fixture();
  await symlink(
    join(root, "pnpm-lock.yaml"),
    join(root, "packages/core/dist/link"),
  );
  await assert.rejects(
    packageOtpAcceptanceBuild(root, join(parent, "artifact"), {
      ...metadata,
      expectedLockSha256,
    }),
    /SDK_BUILD_UNSAFE_PATH/,
  );
});

test("lockfile drift fails before an artifact directory is created", async () => {
  const { parent, root, expectedLockSha256 } = await fixture();
  await writeFile(join(root, "pnpm-lock.yaml"), "lock-B");
  const destination = join(parent, "artifact");
  await assert.rejects(
    packageOtpAcceptanceBuild(root, destination, {
      ...metadata,
      expectedLockSha256,
    }),
    /SDK_LOCK_DRIFT/,
  );
  await assert.rejects(stat(destination), { code: "ENOENT" });
});

test("CI entrypoint records the checked-out HEAD and tree, not a supplied SHA", async () => {
  const { parent, root, expectedLockSha256 } = await fixture();
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "pnpm-lock.yaml"]);
  execFileSync("git", [
    "-C",
    root,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "synthetic lock",
  ]);
  const expectedHead = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const expectedTree = execFileSync(
    "git",
    ["-C", root, "rev-parse", "HEAD^{tree}"],
    {
      encoding: "utf8",
    },
  ).trim();
  const bin = join(parent, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "pnpm"), "#!/bin/sh\nprintf '10.6.3\\n'\n", {
    mode: 0o755,
  });
  const output = join(parent, "github-output");
  await writeFile(output, "");
  const destination = join(parent, "artifact");
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  execFileSync(
    process.execPath,
    [
      join(repo, "node_modules/tsx/dist/cli.js"),
      join(repo, "internal/acceptance/otp-v2-build-artifact.mts"),
      destination,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:/usr/bin:/bin`,
        GITHUB_OUTPUT: output,
        GITHUB_RUN_ID: "12345",
        GITHUB_SHA: "f".repeat(40),
      },
    },
  );
  const provenance = JSON.parse(
    await readFile(join(destination, "provenance.json"), "utf8"),
  );
  assert.equal(provenance.gitHead, expectedHead);
  assert.equal(provenance.gitTree, expectedTree);
  assert.notEqual(provenance.gitHead, "f".repeat(40));
  assert.equal(provenance.pnpmVersion, "10.6.3");
  assert.equal(provenance.lockSha256, expectedLockSha256);
  assert.equal(
    await readFile(output, "utf8"),
    `artifact_path=${destination}\n`,
  );
});
