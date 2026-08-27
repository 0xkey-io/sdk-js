import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const checker = new URL("./check-packed-artifact.mjs", import.meta.url);
const genericReleaseChecker = new URL(
  "./check-generic-release-exclusion.mjs",
  import.meta.url,
);
const genericPublisher = new URL(
  "./publish-generic-release.mjs",
  import.meta.url,
);

test("every Pay-affecting workflow selects the declared Node 22.12 baseline", async () => {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const workflowRoot = new URL(".github/workflows/", repositoryRoot);
  const workflowNames = (await readdir(workflowRoot)).filter((name) =>
    /\.ya?ml$/.test(name),
  );
  const [workflows, setup, nodeBaseline] = await Promise.all([
    Promise.all(
      workflowNames.map(async (name) => ({
        name,
        source: await readFile(new URL(name, workflowRoot), "utf8"),
      })),
    ),
    readFile(
      new URL(".github/actions/js-setup/action.yml", repositoryRoot),
      "utf8",
    ),
    readFile(new URL(".nvmrc", repositoryRoot), "utf8"),
  ]);

  assert.equal(nodeBaseline.trim(), "v22.12.0");
  assert.match(setup, /node-version-file:\s*["']?\.nvmrc["']?/);

  for (const { name, source } of workflows) {
    for (const match of source.matchAll(
      /node-version:\s*["']?v?(\d+)(?:\.(\d+))?/g,
    )) {
      const major = Number(match[1]);
      const minor = Number(match[2] ?? 0);
      assert.ok(
        major > 22 || (major === 22 && minor >= 12),
        `${name} selects unsupported Node ${match[1]}${match[2] ? `.${match[2]}` : ""}`,
      );
    }
  }

  const payExecution =
    /@0xkey-io\/pay|packages\/pay|\b(?:build-all|typecheck-all|test-all)\b|changeset\s+(?:version|publish)|pnpm\s+publish\s+-r|--filter\s+["']\.\/packages/;
  const payWorkflows = workflows.filter(({ source }) =>
    payExecution.test(source),
  );
  for (const genericWorkflow of ["js-build.yml", "version-and-publish.yml"]) {
    assert.ok(
      payWorkflows.some(({ name }) => name === genericWorkflow),
      `${genericWorkflow} must remain discoverable as Pay-affecting`,
    );
  }
  for (const { name, source } of payWorkflows) {
    assert.ok(
      source.includes("./.github/actions/js-setup") ||
        /node-version:\s*["']?v?(?:2[3-9]|22\.(?:1[2-9]|[2-9]\d))/.test(source),
      `${name} executes Pay without the repository Node baseline or a supported override`,
    );
  }
});

test("only the dedicated next workflow can mutably publish Pay", async () => {
  const repositoryRoot = new URL("../../../", import.meta.url);
  const workflowRoot = new URL(".github/workflows/", repositoryRoot);
  const workflowNames = (await readdir(workflowRoot)).filter((name) =>
    /\.ya?ml$/.test(name),
  );
  const workflows = await Promise.all(
    workflowNames.map(async (name) => ({
      name,
      source: await readFile(new URL(name, workflowRoot), "utf8"),
    })),
  );

  const mutableNpmPublishers = workflows.filter(({ source }) =>
    source
      .split("\n")
      .some((line) => line.trimStart().startsWith("npm publish ")),
  );
  assert.deepEqual(
    mutableNpmPublishers.map(({ name }) => name),
    ["pay-publish.yml"],
  );
  assert.match(
    mutableNpmPublishers[0].source,
    /npm publish[\s\S]{0,180}--tag next/,
  );
  assert.deepEqual(
    workflows.filter(({ source }) =>
      source.split("\n").some((line) => {
        const command = line.trimStart();
        return (
          command.startsWith("pnpm publish ") && !command.includes("--dry-run")
        );
      }),
    ),
    [],
  );

  const generic = workflows.find(
    ({ name }) => name === "version-and-publish.yml",
  );
  assert.ok(generic);
  assert.match(
    generic.source,
    /pnpm\s+--filter[=\s]+["']?!@0xkey-io\/pay["']?\s+publish\s+-r\s+--dry-run/,
  );
  assert.match(generic.source, /check-generic-release-exclusion\.mjs/g);
  assert.match(generic.source, /publish-generic-release\.mjs/);
  assert.ok(
    generic.source.lastIndexOf("check-generic-release-exclusion.mjs") <
      generic.source.indexOf("publish-generic-release.mjs"),
    "the publish job must fail closed before Changesets can publish",
  );
  assert.doesNotMatch(generic.source, /pnpm\s+exec\s+changeset\s+publish/);

  const changesetConfig = JSON.parse(
    await readFile(new URL(".changeset/config.json", repositoryRoot), "utf8"),
  );
  assert.ok(changesetConfig.ignore.includes("@0xkey-io/pay"));
});

test("generic Changesets publisher hides Pay and always restores its manifest", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-publisher-"));
  const changesetRoot = join(fixtureRoot, ".changeset");
  const payRoot = join(fixtureRoot, "packages", "pay");
  const manifestPath = join(payRoot, "package.json");
  const originalManifest = `${JSON.stringify(
    {
      name: "@0xkey-io/pay",
      version: "1.0.0-rc.1",
    },
    null,
    2,
  )}\n`;
  try {
    await mkdir(changesetRoot, { recursive: true });
    await mkdir(payRoot, { recursive: true });
    await writeFile(
      join(changesetRoot, "config.json"),
      `${JSON.stringify({ ignore: ["@0xkey-io/pay"] })}\n`,
    );
    await writeFile(manifestPath, originalManifest);

    const { publishGenericRelease } = await import(genericPublisher);
    let calls = 0;
    await publishGenericRelease({
      repositoryRoot: fixtureRoot,
      publish: async () => {
        calls += 1;
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        assert.equal(manifest.private, true);
      },
    });
    assert.equal(calls, 1);
    assert.equal(await readFile(manifestPath, "utf8"), originalManifest);

    await assert.rejects(
      publishGenericRelease({
        repositoryRoot: fixtureRoot,
        publish: async () => {
          const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
          assert.equal(manifest.private, true);
          throw new Error("fixture publish failure");
        },
      }),
      /fixture publish failure/,
    );
    assert.equal(await readFile(manifestPath, "utf8"), originalManifest);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("generic release guard refuses any Pay release candidate", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-release-guard-"));
  const changesetRoot = join(fixtureRoot, ".changeset");
  try {
    await mkdir(changesetRoot);
    await writeFile(
      join(changesetRoot, "config.json"),
      `${JSON.stringify({ ignore: ["@0xkey-io/pay"] })}\n`,
    );
    await writeFile(
      join(changesetRoot, "pay-candidate.md"),
      `---\n"@0xkey-io/pay": patch\n---\n\nPay candidate.\n`,
    );
    await assert.rejects(
      execFileAsync(process.execPath, [
        genericReleaseChecker.pathname,
        "--root",
        fixtureRoot,
      ]),
      (error) => {
        assert.match(error.stderr, /refuses.*@0xkey-io\/pay/i);
        return true;
      },
    );

    await rm(join(changesetRoot, "pay-candidate.md"));
    await writeFile(
      join(changesetRoot, "other.md"),
      `---\n"@0xkey-io/crypto": patch\n---\n\nOther package.\n`,
    );
    await execFileAsync(process.execPath, [
      genericReleaseChecker.pathname,
      "--root",
      fixtureRoot,
    ]);

    await writeFile(
      join(changesetRoot, "config.json"),
      `${JSON.stringify({ ignore: [] })}\n`,
    );
    await assert.rejects(
      execFileAsync(process.execPath, [
        genericReleaseChecker.pathname,
        "--root",
        fixtureRoot,
      ]),
      /Command failed/,
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("source manifest has one complete exact peer contract", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
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
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "@0xkey-io/pay",
        version: "1.0.0",
        engines: { node: ">=18.0.0" },
      })}\n`,
    );
    await execFileAsync("tar", ["-czf", tarball, "-C", fixtureRoot, "package"]);
    await assert.rejects(
      execFileAsync(process.execPath, [
        checker.pathname,
        "--verify-only",
        tarball,
      ]),
      (error) => {
        assert.match(error.stderr, />=22\.12\.0/);
        return true;
      },
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
