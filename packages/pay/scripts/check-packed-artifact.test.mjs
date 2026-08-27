import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const checker = new URL("./check-packed-artifact.mjs", import.meta.url);

test("every Pay-affecting workflow selects the declared Node 22.12 baseline", async () => {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const payWorkflows = [
    "pay-v1.yml",
    "pay-publish.yml",
    "commerce-contract.yml",
    "commerce-verifier.yml",
  ];
  const [workflows, setup] = await Promise.all([
    Promise.all(payWorkflows.map(async (name) => ({
      name,
      source: await readFile(new URL(`.github/workflows/${name}`, repositoryRoot), "utf8"),
    }))),
    readFile(new URL(".github/actions/js-setup/action.yml", repositoryRoot), "utf8"),
  ]);
  for (const { name, source } of workflows) {
    assert.match(source, /node-version:\s*["']?22\.12\.0["']?/, name);
  }
  assert.match(setup, /inputs:\s*[\s\S]*node-version:/);
});

test("source manifest has one complete exact peer contract", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(manifest.peerDependencies, {
    "@x402/core": "2.23.0",
    mppx: "0.8.19",
    viem: ">=2.54.0 <3",
  });
});

test(
  "ignores ambient GITHUB_OUTPUT without a persistent pack destination",
  { timeout: 180_000 },
  async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), "oxkey-pay-ambient-output-test-"),
    );
    const githubOutput = join(fixtureRoot, "github-output");

    try {
      await writeFile(githubOutput, "");
      await execFileAsync(process.execPath, [checker.pathname], {
        env: { ...process.env, GITHUB_OUTPUT: githubOutput },
        maxBuffer: 10 * 1024 * 1024,
      });
      assert.equal(
        await readFile(githubOutput, "utf8"),
        "",
        "an owned temporary tarball must not be written to GitHub step outputs",
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);

for (const dependencyGroup of [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
]) {
  test(`rejects workspace protocol in ${dependencyGroup}`, async () => {
    const fixtureRoot = await mkdtemp(
      join(tmpdir(), "oxkey-pay-artifact-test-"),
    );
    const packageRoot = join(fixtureRoot, "package");
    const tarball = join(fixtureRoot, "bad-pay.tgz");

    try {
      await mkdir(packageRoot);
      await writeFile(
        join(packageRoot, "package.json"),
        `${JSON.stringify({
          name: "@0xkey-io/pay",
          version: "0.3.0-test",
          engines: { node: ">=22.12.0" },
          [dependencyGroup]: { "bad-dependency": "workspace:*" },
        })}\n`,
      );
      await execFileAsync("tar", [
        "-czf",
        tarball,
        "-C",
        fixtureRoot,
        "package",
      ]);

      await assert.rejects(
        execFileAsync(process.execPath, [
          checker.pathname,
          "--verify-only",
          tarball,
        ]),
        (error) => {
          assert.match(error.stderr, /workspace:\*/);
          assert.match(error.stderr, new RegExp(dependencyGroup));
          return true;
        },
      );
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
}

test("rejects a packed manifest without the Node 22.12 require(ESM) baseline", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-engine-test-"));
  const packageRoot = join(fixtureRoot, "package");
  const tarball = join(fixtureRoot, "bad-engine.tgz");
  try {
    await mkdir(packageRoot);
    await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
      name: "@0xkey-io/pay", version: "1.0.0", engines: { node: ">=18.0.0" },
    })}\n`);
    await execFileAsync("tar", ["-czf", tarball, "-C", fixtureRoot, "package"]);
    await assert.rejects(
      execFileAsync(process.execPath, [checker.pathname, "--verify-only", tarball]),
      (error) => {
        assert.match(error.stderr, />=22\.12\.0/);
        return true;
      },
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
