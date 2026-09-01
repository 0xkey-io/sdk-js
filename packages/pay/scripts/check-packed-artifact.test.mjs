import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
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
const workflowChecker = new URL(
  "../../../.github/scripts/check-pay-publish-workflow.mjs",
  import.meta.url,
);
const repository = {
  type: "git",
  url: "git+https://github.com/0xkey-io/sdk-js.git",
  directory: "packages/pay",
};
const publishConfig = {
  access: "public",
  registry: "https://registry.npmjs.org/",
  tag: "next",
};

function publicManifest(overrides = {}) {
  return {
    name: "@0xkey-io/pay",
    version: "1.0.0-rc.1",
    private: false,
    repository,
    publishConfig,
    engines: { node: ">=22.12.0" },
    peerDependencies: {
      "@x402/core": "2.23.0",
      mppx: "0.8.19",
      viem: ">=2.54.0 <3",
    },
    ...overrides,
  };
}

test("Pay source is structurally private with exact public artifact metadata", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.name, "@0xkey-io/pay");
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.repository, repository);
  assert.deepEqual(manifest.publishConfig, publishConfig);
  assert.deepEqual(manifest.peerDependencies, {
    "@x402/core": "2.23.0",
    mppx: "0.8.19",
    viem: ">=2.54.0 <3",
  });

  const { listPublicPackages } = await import(
    "../../../internal/contract-guard/scripts/lib/paths.mjs"
  );
  assert.ok(
    listPublicPackages().some(({ pkg }) => pkg.name === "@0xkey-io/pay"),
    "contract guards must audit the public Pay artifact even though source is private",
  );
});

test("artifact manifest scope restores exact source bytes on success and failure", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-private-scope-"));
  const manifestPath = join(fixtureRoot, "package.json");
  const original = `${JSON.stringify({ ...publicManifest(), private: true }, null, 4)}\r\n`;
  try {
    await writeFile(manifestPath, original);
    const { withPublicPayManifest } = await import(checker);
    await withPublicPayManifest(manifestPath, async (publicSource) => {
      const onDisk = JSON.parse(await readFile(manifestPath, "utf8"));
      assert.equal(onDisk.private, false);
      assert.equal(publicSource.private, false);
    });
    assert.equal(await readFile(manifestPath, "utf8"), original);

    await assert.rejects(
      withPublicPayManifest(manifestPath, async () => {
        throw new Error("fixture pack failed");
      }),
      /fixture pack failed/,
    );
    assert.equal(await readFile(manifestPath, "utf8"), original);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("bounded workflow checker enforces current OIDC Pay publish path", async () => {
  await execFileAsync(process.execPath, [workflowChecker.pathname]);
  const { checkPayPublishWorkflow } = await import(workflowChecker);
  const source = await readFile(
    new URL("../../../.github/workflows/pay-publish.yml", import.meta.url),
    "utf8",
  );
  for (const [label, mutate, expected] of [
    [
      "token auth",
      (value) => `${value}\nenv:\n  NPM_TOKEN: secret\n`,
      /NPM_TOKEN/i,
    ],
    [
      "old Node",
      (value) =>
        value.replace('node-version: "24.3.0"', 'node-version: "22.12.0"'),
      /22\.14|24\.3/i,
    ],
    [
      "missing provenance",
      (value) => value.replace(" --provenance", ""),
      /provenance/i,
    ],
    [
      "wrong tag",
      (value) => value.replace(" --tag next", " --tag latest"),
      /checked tarball|publish command/i,
    ],
    [
      "second publish",
      (value) => `${value}\n# second\nnpm publish packages/pay\n`,
      /exactly one npm publish/i,
    ],
    [
      "missing source-binding invocation",
      (value) =>
        value.replace(
          'git --no-replace-objects show "$GITHUB_WORKFLOW_SHA:.github/scripts/check-pay-publish-source.sh" | bash --noprofile --norc',
          'echo "skip source binding"',
        ),
      /source binding/i,
    ],
  ]) {
    assert.throws(
      () => checkPayPublishWorkflow(mutate(source)),
      expected,
      label,
    );
  }

  const { checkJsSetupAction } = await import(workflowChecker);
  const setupSource = await readFile(
    new URL("../../../.github/actions/js-setup/action.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotThrow(() => checkJsSetupAction(setupSource));
  assert.throws(
    () =>
      checkJsSetupAction(
        setupSource.replace(
          'node-version-file: ".nvmrc"',
          'node-version-file: ".node-version"',
        ),
      ),
    /\.nvmrc|repository Node/i,
  );
});

test("authoritative Pay workflows run full and public-surface typechecks", async () => {
  const repositoryRoot = new URL("../../../", import.meta.url);
  for (const name of ["pay-v1.yml", "pay-publish.yml"]) {
    const source = await readFile(
      new URL(`.github/workflows/${name}`, repositoryRoot),
      "utf8",
    );
    assert.match(source, /pnpm --filter @0xkey-io\/pay typecheck(?:\s|$)/);
    assert.match(source, /pnpm --filter @0xkey-io\/pay typecheck:pay-v1/);
  }
});

test("generic Changesets publisher leaves permanently-private Pay source untouched", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-publisher-"));
  const changesetRoot = join(fixtureRoot, ".changeset");
  const payRoot = join(fixtureRoot, "packages", "pay");
  const manifestPath = join(payRoot, "package.json");
  const originalManifest = `${JSON.stringify({ ...publicManifest(), private: true }, null, 2)}\n`;
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
        assert.equal(await readFile(manifestPath, "utf8"), originalManifest);
      },
    });
    assert.equal(calls, 1);
    assert.equal(await readFile(manifestPath, "utf8"), originalManifest);
    await assert.rejects(
      publishGenericRelease({
        repositoryRoot: fixtureRoot,
        publish: async () => {
          assert.equal(await readFile(manifestPath, "utf8"), originalManifest);
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

test("generic release guard refuses legal Pay candidates and malformed input", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-release-guard-"));
  const changesetRoot = join(fixtureRoot, ".changeset");
  try {
    await mkdir(changesetRoot);
    await writeFile(
      join(changesetRoot, "config.json"),
      `${JSON.stringify({ ignore: ["@0xkey-io/pay"] })}\n`,
    );
    for (const frontmatter of [
      `"@0xkey-io/pay": patch`,
      `"@0xkey-io/pay": "patch"`,
      `  '@0xkey-io/pay'  :  patch # release candidate`,
      `{ "@0xkey-io/pay": patch }`,
      `\r\n  "@0xkey-io/pay" : patch  \r`,
    ]) {
      await writeFile(
        join(changesetRoot, "pay-candidate.md"),
        `---\n${frontmatter}\n---\n\nPay candidate.\n`,
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
    }
    await rm(join(changesetRoot, "pay-candidate.md"));
    await writeFile(
      join(changesetRoot, "other.md"),
      `---\n"@0xkey-io/crypto": patch\n---\n\nOther.\n`,
    );
    await execFileAsync(process.execPath, [
      genericReleaseChecker.pathname,
      "--root",
      fixtureRoot,
    ]);
    await writeFile(
      join(changesetRoot, "malformed.md"),
      `---\n"@0xkey-io/crypto": [unterminated\n---\n\nBroken.\n`,
    );
    await assert.rejects(
      execFileAsync(process.execPath, [
        genericReleaseChecker.pathname,
        "--root",
        fixtureRoot,
      ]),
      (error) => {
        assert.match(error.stderr, /could not parse changeset/i);
        return true;
      },
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test(
  "pack output is public and source bytes are restored before output",
  { timeout: 180_000 },
  async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-pack-output-"));
    const githubOutput = join(fixtureRoot, "github-output");
    const sourcePath = new URL("../package.json", import.meta.url);
    const sourceBefore = await readFile(sourcePath, "utf8");
    try {
      await mkdir(join(fixtureRoot, "pack"));
      await writeFile(githubOutput, "");
      await execFileAsync(
        process.execPath,
        [checker.pathname, "--pack-destination", join(fixtureRoot, "pack")],
        {
          env: { ...process.env, GITHUB_OUTPUT: githubOutput },
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
      const tarball = (await readFile(githubOutput, "utf8")).match(
        /^tarball=(.+)$/m,
      )?.[1];
      assert.ok(tarball);
      const { stdout } = await execFileAsync("tar", [
        "-xOf",
        tarball,
        "package/package.json",
      ]);
      const packed = JSON.parse(stdout);
      assert.equal(packed.private, false);
      assert.deepEqual(packed.publishConfig, publishConfig);
      assert.deepEqual(packed.repository, repository);
    } finally {
      assert.equal(await readFile(sourcePath, "utf8"), sourceBefore);
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  },
);

test("accepts exact packed publication metadata with reversed JSON key order", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-key-order-"));
  const packageRoot = join(fixtureRoot, "package");
  const tarball = join(fixtureRoot, "reordered-pay.tgz");
  try {
    await mkdir(packageRoot);
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify(
        publicManifest({
          repository: {
            directory: "packages/pay",
            url: "git+https://github.com/0xkey-io/sdk-js.git",
            type: "git",
          },
          publishConfig: {
            tag: "next",
            registry: "https://registry.npmjs.org/",
            access: "public",
          },
        }),
      )}\n`,
    );
    await execFileAsync("tar", ["-czf", tarball, "-C", fixtureRoot, "package"]);
    await assert.rejects(
      execFileAsync(process.execPath, [
        checker.pathname,
        "--verify-only",
        tarball,
      ]),
      (error) => {
        assert.doesNotMatch(
          error.stderr,
          /Packed (?:repository|publishConfig)/,
        );
        assert.match(error.stderr, /missing package\/dist\/admin\/index\.js/);
        return true;
      },
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

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
        `${JSON.stringify(publicManifest({ [dependencyGroup]: { bad: "workspace:*" } }))}\n`,
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

test("rejects a packed manifest without the Node 22.12 baseline", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "oxkey-pay-engine-test-"));
  const packageRoot = join(fixtureRoot, "package");
  const tarball = join(fixtureRoot, "bad-engine.tgz");
  try {
    await mkdir(packageRoot);
    await writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify(publicManifest({ engines: { node: ">=18.0.0" } }))}\n`,
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

// A disposable real CLI copy has no build inputs. Reaching its build is a
// regression: invalid prerequisites must fail before build/public mutation.
async function preflightFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "pay-artifact-preflight-")));
  const sdk = join(root, "sdk");
  const scripts = join(sdk, "packages/pay/scripts");
  await cp(fileURLToPath(new URL("./", checker)), scripts, { recursive: true });
  await cp(fileURLToPath(new URL("../../../internal/pay-conformance/fixtures", checker)), join(sdk, "internal/pay-conformance/fixtures"), { recursive: true });
  await cp(fileURLToPath(new URL("../../../package.json", checker)), join(sdk, "package.json"));
  const source = await readFile(new URL("../package.json", checker));
  await writeFile(join(sdk, "packages/pay/package.json"), source);
  for (const name of ["api-key-stamper", "crypto", "http", "viem"]) {
    await mkdir(join(sdk, "packages", name), { recursive: true });
    await cp(fileURLToPath(new URL(`../../${name}/package.json`, checker)), join(sdk, "packages", name, "package.json"));
  }
  const output = join(root, "github-output");
  await writeFile(output, "prior=value\n");
  return { root, sdk, source, output, checker: join(scripts, "check-packed-artifact.mjs") };
}

for (const [label, setup, expected] of [
  ["missing explicit cache", async (f, env) => { delete env.PAY_ARTIFACT_NPM_CACHE; }, /PAY_ARTIFACT_CACHE_REQUIRED/],
  ["empty cache", async (f, env) => { env.PAY_ARTIFACT_NPM_CACHE = join(f.root, "empty-cache"); await mkdir(env.PAY_ARTIFACT_NPM_CACHE); }, /PAY_ARTIFACT_CACHE_MISSING/],
  ["nonempty explicit npm config", async (f, env) => { const path = join(f.root, "injected.npmrc"); await writeFile(path, "legacy-peer-deps=true\n"); env.NPM_CONFIG_USERCONFIG = path; env.npm_config_userconfig = path; }, /PAY_ARTIFACT_CONFIG_REJECTED/],
  ["output file is a directory", async (f, env) => { env.GITHUB_OUTPUT = f.root; }, /PAY_ARTIFACT_OUTPUT_REJECTED/],
  ["source dependency graph drift", async (f) => { const path = join(f.sdk, "packages/pay/package.json"); const value = JSON.parse(f.source); value.peerDependencies.mppx = "0.8.17"; f.source = Buffer.from(JSON.stringify(value)); await writeFile(path, f.source); }, /CONSUMER_MANIFEST_MISMATCH/],
  ["output path control injection", async (f, env) => { f.destination = join(f.root, "pack\nforged=value"); }, /PAY_ARTIFACT_PATH_REJECTED/],
]) test(`artifact CLI rejects ${label} before build, preserves source and output`, { timeout: 30_000 }, async () => {
  const f = await preflightFixture();
  const env = { ...process.env, GITHUB_OUTPUT: f.output };
  await setup(f, env);
  try {
    await assert.rejects(execFileAsync(process.execPath, [f.checker, "--pack-destination", f.destination ?? join(f.root, "pack")], { cwd: f.root, env, timeout: 20_000 }), error => {
      assert.match(error.stderr, expected);
      assert.doesNotMatch(error.stdout, /rollup|> .*build/);
      return true;
    });
    assert.deepEqual(await readFile(join(f.sdk, "packages/pay/package.json")), f.source);
    assert.equal(await readFile(f.output, "utf8"), "prior=value\n");
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("preflight binds tool lookup to SDK context across a different caller cwd", { timeout: 30_000 }, async () => {
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", `const { prepareOfflineConsumer } = await import(${JSON.stringify(new URL("./offline-consumer.mjs", checker).href)}); console.log(JSON.stringify((await prepareOfflineConsumer()).identity));`], { cwd: tmpdir(), env: process.env });
  const identity = JSON.parse(stdout);
  assert.equal(identity.pnpm, "10.6.3");
  assert.equal(identity.platform, process.platform);
  assert.ok(identity.cacheContent.length > 250);
});

test("valid preflight inputs reach the actual build on an owned writable pack directory", { timeout: 30_000 }, async () => {
  const f = await preflightFixture();
  const destination = join(f.root, "pack");
  await mkdir(destination);
  await chmod(destination, 0o755);
  try {
    await access(destination, constants.W_OK | constants.X_OK);
    await assert.rejects(execFileAsync(process.execPath, [f.checker, "--pack-destination", destination], { cwd: f.root, env: { ...process.env, GITHUB_OUTPUT: f.output }, timeout: 20_000 }), error => {
      assert.match(error.stdout, /> .*build|rollup -c/);
      assert.match(error.stderr, /Cannot find module .*rollup.config/);
      return true;
    });
    assert.deepEqual(await readFile(join(f.sdk, "packages/pay/package.json")), f.source);
    assert.equal(await readFile(f.output, "utf8"), "prior=value\n");
  } finally {
    await chmod(destination, 0o700);
    await rm(f.root, { recursive: true, force: true });
  }
});

test("readable searchable but nonwritable pack directory is rejected before build", { timeout: 30_000 }, async () => {
  const f = await preflightFixture();
  const destination = join(f.root, "pack");
  await mkdir(destination);
  await chmod(destination, 0o555);
  try {
    // Exercise actual OS access, not a mode-bit simulation or mocked write.
    await access(destination, constants.R_OK | constants.X_OK);
    await assert.rejects(access(destination, constants.W_OK), { code: "EACCES" });
    await assert.rejects(execFileAsync(process.execPath, [f.checker, "--pack-destination", destination], { cwd: f.root, env: { ...process.env, GITHUB_OUTPUT: f.output }, timeout: 20_000 }), error => {
      assert.match(error.stderr, /PAY_ARTIFACT_DESTINATION_REJECTED/);
      assert.doesNotMatch(error.stdout, /rollup|> .*build/);
      return true;
    });
  } finally {
    await chmod(destination, 0o700);
    try {
      assert.deepEqual(await readFile(join(f.sdk, "packages/pay/package.json")), f.source);
      assert.equal(await readFile(f.output, "utf8"), "prior=value\n");
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("isolated npm disables auxiliary update discovery", async () => {
  const { prepareOfflineConsumer } = await import("./offline-consumer.mjs");
  const preparation = await prepareOfflineConsumer();
  const result = await execFileAsync(process.execPath, [preparation.npm, "config", "get", "update-notifier"], { env: preparation.env });
  assert.equal(result.stdout.trim(), "false");
});
