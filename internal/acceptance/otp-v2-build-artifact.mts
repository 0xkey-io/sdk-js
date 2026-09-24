/** Assemble the public, complete Linux SDK build evidence without changing built files. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { sdkArtifactsDigest } from "./otp-v2-evidence.mts";

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

export type PublicBuildMetadata = {
  gitHead: string;
  gitTree: string;
  nodeVersion: string;
  pnpmVersion: string;
  workflowRunId: string;
  expectedLockSha256: string;
};

async function builtFiles(root: string): Promise<string[]> {
  const files = ["pnpm-lock.yaml"];
  async function visit(path: string): Promise<void> {
    const info = await lstat(join(root, path));
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
      throw Error("SDK_BUILD_UNSAFE_PATH");
    if (info.isFile()) {
      files.push(path);
      return;
    }
    for (const name of await readdir(join(root, path))) {
      await visit(join(path, name));
    }
  }
  for (const category of ["packages", "internal"]) {
    for (const child of await readdir(join(root, category))) {
      const childPath = join(category, child);
      const info = await lstat(join(root, childPath));
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile()))
        throw Error("SDK_BUILD_UNSAFE_PATH");
      if (!info.isDirectory()) continue;
      const dist = join(childPath, "dist");
      try {
        await visit(dist);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return files;
}

/** Copy only lock and built outputs, keeping the repository-relative paths. */
export async function packageOtpAcceptanceBuild(
  root: string,
  destination: string,
  metadata: PublicBuildMetadata,
): Promise<string> {
  const source = resolve(root);
  const target = resolve(destination);
  const targetRelative = relative(source, target);
  if (
    targetRelative === "" ||
    (targetRelative !== ".." &&
      !targetRelative.startsWith(`..${sep}`) &&
      !isAbsolute(targetRelative))
  )
    throw Error("SDK_BUILD_UNSAFE_DESTINATION");

  const sourceDigest = await sdkArtifactsDigest(source);
  const lockHandle = await open(
    join(source, "pnpm-lock.yaml"),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let lockBytes: Buffer;
  try {
    if (!(await lockHandle.stat()).isFile())
      throw Error("SDK_BUILD_UNSAFE_PATH");
    lockBytes = await lockHandle.readFile();
  } finally {
    await lockHandle.close();
  }
  const lockSha256 = sha256(lockBytes);
  if (lockSha256 !== metadata.expectedLockSha256) throw Error("SDK_LOCK_DRIFT");

  const files = await builtFiles(source);
  await mkdir(target);
  for (const path of files) {
    const handle = await open(
      join(source, path),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let bytes: Buffer;
    try {
      if (!(await handle.stat()).isFile()) throw Error("SDK_BUILD_UNSAFE_PATH");
      bytes = await handle.readFile();
    } finally {
      await handle.close();
    }
    const outputPath = join(target, path);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes, { flag: "wx" });
  }
  if ((await sdkArtifactsDigest(target)) !== sourceDigest)
    throw Error("SDK_BUILD_CHANGED_DURING_PACKAGING");

  const provenance = {
    schema: "0xkey.sdk.otp-acceptance-build.v1",
    gitHead: metadata.gitHead,
    gitTree: metadata.gitTree,
    nodeVersion: metadata.nodeVersion,
    pnpmVersion: metadata.pnpmVersion,
    lockSha256,
    sdkArtifactsDigest: sourceDigest,
    workflowRunId: metadata.workflowRunId,
  };
  await writeFile(
    join(target, "provenance.json"),
    `${JSON.stringify(provenance, null, 2)}\n`,
    { flag: "wx" },
  );
  return target;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function main(): Promise<void> {
  const destination = process.argv[2];
  const outputPath = process.env.GITHUB_OUTPUT;
  const workflowRunId = process.env.GITHUB_RUN_ID;
  if (!destination || !outputPath || !workflowRunId)
    throw Error("SDK_BUILD_CI_INPUT_MISSING");
  const root = process.cwd();
  const trackedLock = execFileSync("git", ["show", "HEAD:pnpm-lock.yaml"], {
    cwd: root,
  });
  const metadata: PublicBuildMetadata = {
    gitHead: git(root, "rev-parse", "HEAD"),
    gitTree: git(root, "rev-parse", "HEAD^{tree}"),
    nodeVersion: process.version,
    pnpmVersion: execFileSync("pnpm", ["--version"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    workflowRunId,
    expectedLockSha256: sha256(trackedLock),
  };
  const path = await packageOtpAcceptanceBuild(root, destination, metadata);
  await appendFile(outputPath, `artifact_path=${path}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
