import { execFile } from "node:child_process";
import { resolve, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  PACKAGE,
  REPOSITORY,
  REGISTRY,
  WORKFLOW,
  TAR_LIMIT,
  atomicDirectory,
  cliArguments,
  equal,
  fail,
  fullHash,
  jsonBytes,
  readData,
  safeError,
  safePath,
  strictJson,
  tarIdentity,
  validateContext,
} from "./npm-receipt-data.mjs";

const execute = promisify(execFile);
async function gitObject(checkout, args) {
  try {
    const { stdout } = await execute(
      "/usr/bin/git",
      [
        "--no-replace-objects",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        ...args,
      ],
      {
        cwd: checkout,
        encoding: "buffer",
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        env: {
          PATH: "/usr/bin:/bin",
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_ATTR_NOSYSTEM: "1",
          GIT_NO_LAZY_FETCH: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_ALLOW_PROTOCOL: "",
        },
      },
    );
    return stdout;
  } catch {
    fail("SOURCE_OBJECT");
  }
}

export async function prepareSourceContext({
  checkout,
  checkedTar,
  expectedVersion,
  output,
  env = process.env,
}) {
  await safePath(checkout);
  await safePath(output, true);
  if (output === checkout || output.startsWith(checkout + sep))
    fail("OUTPUT_IN_CHECKOUT");
  const sha = fullHash(env.PAY_PUBLISH_SOURCE_SHA);
  const checked = await readData(checkedTar, TAR_LIMIT);
  const source = {
    repository: env.GITHUB_REPOSITORY,
    server: env.GITHUB_SERVER_URL,
    event: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    workflowRef: env.GITHUB_WORKFLOW_REF,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    runner: env.RUNNER_ENVIRONMENT,
    requestedSha: sha,
    runSha: env.GITHUB_SHA,
    workflowSha: env.GITHUB_WORKFLOW_SHA,
    mainRef: "refs/heads/main",
    mainSha: sha,
    treeSha: "0".repeat(40),
  };
  const context = {
    schemaVersion: "pay-npm-source-context/v1",
    package: PACKAGE,
    version: expectedVersion,
    source,
    checkedTar: tarIdentity(checked),
  };
  validateContext(context, expectedVersion, sha);
  equal(env.PAY_PUBLISH_DEFAULT_BRANCH, "main");
  equal(
    (await gitObject(checkout, ["rev-parse", "--verify", "HEAD"])).toString(
      "ascii",
    ),
    `${sha}\n`,
  );
  equal(
    (
      await gitObject(checkout, [
        "rev-parse",
        "--verify",
        "refs/remotes/origin/main",
      ])
    ).toString("ascii"),
    `${sha}\n`,
  );
  // cat-file's explicit type prevents a tag/tree from masquerading as a commit.
  const commit = await gitObject(checkout, ["cat-file", "commit", sha]);
  const tree = /^tree ([0-9a-f]{40})\n/.exec(commit.toString("utf8"));
  if (!tree) fail("SOURCE_OBJECT");
  source.treeSha = tree[1];
  const manifestBytes = await gitObject(checkout, [
    "cat-file",
    "blob",
    `${sha}:packages/pay/package.json`,
  ]);
  equal(
    await readData(join(checkout, "packages/pay/package.json"), 1024 * 1024),
    manifestBytes,
    "SOURCE_MANIFEST",
  );
  const manifest = strictJson(manifestBytes, 1024 * 1024).value;
  equal(manifest.name, PACKAGE);
  equal(manifest.version, expectedVersion);
  equal(manifest.private, true);
  equal(manifest.repository, {
    type: "git",
    url: `git+https://github.com/${REPOSITORY}.git`,
    directory: "packages/pay",
  });
  equal(manifest.publishConfig, {
    access: "public",
    registry: `${REGISTRY}/`,
    tag: "next",
  });
  validateContext(context, expectedVersion, sha);
  equal(await readData(checkedTar, TAR_LIMIT), checked, "FILE_CHANGED");
  // The preceding artifact:check is the pack/smoke authority. This helper never
  // extracts, installs or executes the tar; it preserves that original input.
  await atomicDirectory(output, {
    "source-context.json": jsonBytes(context),
    "package.tgz": checked,
  });
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  (async () => {
    const args = cliArguments(process.argv.slice(2), [
      "--checked-tar",
      "--expected-version",
      "--output",
    ]);
    await prepareSourceContext({
      checkout: process.cwd(),
      checkedTar: args["--checked-tar"],
      expectedVersion: args["--expected-version"],
      output: args["--output"],
    });
    process.stdout.write(
      "npm checked-package preservation completed (source expectations only).\n",
    );
  })().catch((error) => safeError(error, "preservation"));
}
