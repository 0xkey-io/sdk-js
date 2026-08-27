import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fail, strictJson } from "./npm-receipt-json.mjs";

export { fail, strictJson };
export const PACKAGE = "@0xkey-io/pay";
export const REPOSITORY = "0xkey-io/sdk-js";
export const REGISTRY = "https://registry.npmjs.org";
export const WORKFLOW = ".github/workflows/pay-publish.yml";
export const TAR_LIMIT = 10 * 1024 * 1024;
export const JSON_LIMIT = 2 * 1024 * 1024;
export const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
export const jsonBytes = (value) =>
  Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export function tarIdentity(bytes) {
  return {
    size: bytes.length,
    sha1: hash(bytes, "sha1"),
    sha256: hash(bytes),
    sha512: hash(bytes, "sha512"),
    integrity: `sha512-${hash(bytes, "sha512", "base64")}`,
  };
}
export function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("SHAPE");
  return value;
}
export function keys(value, required, optional = []) {
  object(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    fail("SHAPE");
}
export function equal(actual, expected, code = "BINDING") {
  if (!isDeepStrictEqual(actual, expected)) fail(code);
}
export function fullHash(value, length = 40) {
  if (
    typeof value !== "string" ||
    !new RegExp(`^[0-9a-f]{${length}}$`).test(value)
  )
    fail("HASH");
  return value;
}
export function numericId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value))
    fail("IDENTITY");
  return value;
}
export function exactVersion(value) {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.test(
      value,
    )
  )
    fail("VERSION");
  const pre = value.split("+")[0].split("-").slice(1).join("-");
  if (
    pre &&
    pre
      .split(".")
      .some(
        (part) => /^[0-9]+$/.test(part) && part.length > 1 && part[0] === "0",
      )
  )
    fail("VERSION");
  return value;
}
export function base64(value, limit) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4 * Math.ceil(limit / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    fail("BASE64");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length > limit || decoded.toString("base64") !== value)
    fail("BASE64");
  return decoded;
}
export function validateContext(context, expectedVersion, expectedSource) {
  exactVersion(expectedVersion);
  fullHash(expectedSource);
  keys(context, [
    "schemaVersion",
    "package",
    "version",
    "source",
    "checkedTar",
  ]);
  equal(context.schemaVersion, "pay-npm-source-context/v1");
  equal(context.package, PACKAGE);
  equal(context.version, expectedVersion);
  const source = context.source;
  keys(source, [
    "repository",
    "server",
    "event",
    "ref",
    "workflowRef",
    "runId",
    "runAttempt",
    "runner",
    "requestedSha",
    "runSha",
    "workflowSha",
    "mainRef",
    "mainSha",
    "treeSha",
  ]);
  equal(source.repository, REPOSITORY);
  equal(source.server, "https://github.com");
  equal(source.event, "workflow_dispatch");
  equal(source.ref, "refs/heads/main");
  equal(source.mainRef, "refs/heads/main");
  equal(source.runner, "github-hosted");
  equal(source.workflowRef, `${REPOSITORY}/${WORKFLOW}@refs/heads/main`);
  numericId(source.runId);
  numericId(source.runAttempt);
  fullHash(source.treeSha);
  for (const field of ["requestedSha", "runSha", "workflowSha", "mainSha"])
    equal(fullHash(source[field]), expectedSource);
  keys(context.checkedTar, ["size", "sha1", "sha256", "sha512", "integrity"]);
  const tar = context.checkedTar;
  if (!Number.isSafeInteger(tar.size) || tar.size <= 0 || tar.size > TAR_LIMIT)
    fail("TAR_SIZE");
  fullHash(tar.sha1);
  fullHash(tar.sha256, 64);
  fullHash(tar.sha512, 128);
  equal(
    tar.integrity,
    `sha512-${Buffer.from(tar.sha512, "hex").toString("base64")}`,
  );
  return context;
}

// Only canonical absolute local paths; no links in any existing component.
export async function safePath(path, missingLeaf = false) {
  if (
    typeof path !== "string" ||
    path.length > 4096 ||
    !isAbsolute(path) ||
    resolve(path) !== path ||
    /[\x00-\x1f\x7f\\]/.test(path)
  )
    fail("PATH");
  const parts = path.split(sep).filter(Boolean);
  let current = sep;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (missingLeaf && index === parts.length - 1 && error.code === "ENOENT")
        return path;
      fail("PATH");
    }
    if (
      stat.isSymbolicLink() ||
      (index < parts.length - 1 && !stat.isDirectory())
    )
      fail("PATH");
  }
  return path;
}
export async function readData(path, limit) {
  await safePath(path);
  let file;
  try {
    file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.mode & 0o111 ||
      before.size <= 0 ||
      before.size > limit
    )
      fail("FILE");
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await file.stat();
    const current = await lstat(path);
    if (
      length !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      current.ino !== before.ino ||
      current.dev !== before.dev ||
      current.nlink !== 1 ||
      current.isSymbolicLink()
    )
      fail("FILE_CHANGED");
    return bytes.subarray(0, length);
  } catch (error) {
    if (/^PAY_NPM_/.test(error.message)) throw error;
    fail("FILE");
  } finally {
    await file?.close();
  }
}
async function syncDirectory(path) {
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function absent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    fail("OUTPUT");
  }
  fail("OUTPUT_EXISTS");
}

// Cooperative no-overwrite lock in a caller-owned local parent; never reuse a
// stale lock automatically. A host/user able to replace this parent is outside
// the local filesystem trust boundary, not authenticated by receipt hashes.
export async function atomicDirectory(output, files) {
  await safePath(output, true);
  const parent = dirname(output);
  const parentStat = await lstat(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.mode & 0o022 ||
    parentStat.uid !== process.getuid()
  )
    fail("OUTPUT_PARENT");
  const allowed = files["source-context.json"]
    ? ["package.tgz", "source-context.json"]
    : [
        "receipt.json",
        "receipt.sha256",
        "registry-metadata.json",
        "package.tgz",
        "registry-attestations.json",
        "provenance.bundle.json",
      ];
  equal(Object.keys(files).sort(), allowed.sort(), "OUTPUT_FILES");
  const lock = join(parent, `.${basename(output)}.lock`);
  let locked = false;
  let pending;
  try {
    await mkdir(lock, { mode: 0o700 });
    locked = true;
    await absent(output);
    pending = await mkdtemp(join(parent, `.${basename(output)}.pending-`));
    for (const [name, bytes] of Object.entries(files)) {
      const limit = name === "package.tgz" ? TAR_LIMIT : JSON_LIMIT;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > limit)
        fail("OUTPUT_SIZE");
      const handle = await open(
        join(pending, name),
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o400,
      );
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      equal(
        await readData(join(pending, name), limit),
        bytes,
        "OUTPUT_CHANGED",
      );
    }
    equal((await readdir(pending)).sort(), allowed);
    await chmod(pending, 0o500);
    await syncDirectory(pending);
    await absent(output);
    await rename(pending, output);
    pending = undefined;
    await syncDirectory(parent);
  } catch (error) {
    if (/^PAY_NPM_/.test(error.message)) throw error;
    fail("OUTPUT");
  } finally {
    if (pending) {
      await chmod(pending, 0o700);
      await rm(pending, { recursive: true, force: true });
    }
    if (locked) await rmdir(lock);
  }
}

export function cliArguments(args, required, optional = []) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      ![...required, ...optional].includes(name) ||
      Object.hasOwn(parsed, name) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--")
    )
      fail("ARGUMENTS");
    parsed[name] = value;
  }
  if (required.some((name) => !Object.hasOwn(parsed, name))) fail("ARGUMENTS");
  return parsed;
}
export function safeError(error, phase) {
  const code = /^PAY_NPM_[A-Z0-9_]+$/.test(error?.message)
    ? error.message
    : "PAY_NPM_FAILURE";
  process.stderr.write(`${phase}: ${code}\n`);
  process.exitCode = 1;
}
