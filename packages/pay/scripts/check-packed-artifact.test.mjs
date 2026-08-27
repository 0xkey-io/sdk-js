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
const releaseAuditor = new URL(
  "./audit-pay-release-safety.mjs",
  import.meta.url,
);

test("workflow audit is job-local, resolves aliases, and rejects later Node downgrades", async () => {
  const { auditWorkflowSource } = await import(releaseAuditor);
  const rootScripts = {
    build: `turbo --filter "./packages/**" build`,
    "build-alias": "pnpm run build",
  };
  const safeSetup = `
      - uses: ./.github/actions/js-setup
      - run: pnpm run build-alias`;

  assert.doesNotThrow(() =>
    auditWorkflowSource({
      name: "safe.yml",
      source: `jobs:\n  safe:\n    steps:${safeSetup}\n`,
      rootScripts,
      rootNodeVersion: "v22.12.0",
    }),
  );
  assert.throws(
    () =>
      auditWorkflowSource({
        name: "cross-job.yml",
        source: `jobs:
  setup_only:
    steps:
      - uses: ./.github/actions/js-setup
  unsafe:
    steps:
      - run: pnpm run build-alias
`,
        rootScripts,
        rootNodeVersion: "v22.12.0",
      }),
    /cross-job\.yml.*unsafe.*before a supported Node setup/i,
  );
  assert.throws(
    () =>
      auditWorkflowSource({
        name: "downgrade.yml",
        source: `jobs:
  pay:
    steps:
      - uses: ./.github/actions/js-setup
      - run: pnpm run build
      - uses: actions/setup-node@pinned
        with:
          node-version: "20"
`,
        rootScripts,
        rootNodeVersion: "v22.12.0",
      }),
    /downgrade\.yml.*pay.*unsupported Node 20/i,
  );
  assert.throws(
    () =>
      auditWorkflowSource({
        name: "dynamic.yml",
        source: `jobs:
  pay:
    steps:
      - uses: actions/setup-node@pinned
        with:
          node-version: \${{ matrix.node }}
      - run: pnpm run build
`,
        rootScripts,
        rootNodeVersion: "v22.12.0",
      }),
    /dynamic\.yml.*pay.*cannot prove Node/i,
  );
  assert.throws(
    () =>
      auditWorkflowSource({
        name: "mixed-command.yml",
        source: `jobs:
  pay:
    steps:
      - run: |
          pnpm --filter '!@0xkey-io/pay' publish -r --dry-run
          pnpm -r test
`,
        rootScripts: {},
        rootNodeVersion: "v22.12.0",
      }),
    /mixed-command\.yml.*pay.*before a supported Node setup/i,
  );
  assert.doesNotThrow(() =>
    auditWorkflowSource({
      name: "excluded-only.yml",
      source: `jobs:
  generic:
    steps:
      - run: pnpm --filter '!@0xkey-io/pay' publish -r --dry-run
`,
      rootScripts: {},
      rootNodeVersion: "v22.12.0",
    }),
  );
});

test("workflow audit models working directories, actions, conditions, and unfiltered workspaces", async () => {
  const { auditWorkflowSource } = await import(releaseAuditor);
  const options = {
    rootScripts: {},
    rootNodeVersion: "v22.12.0",
  };
  for (const [name, source] of [
    [
      "job-cwd.yml",
      `jobs:
  pay:
    defaults:
      run:
        working-directory: packages/pay
    steps:
      - run: pnpm test
`,
    ],
    [
      "step-cwd.yml",
      `jobs:
  pay:
    steps:
      - working-directory: ./packages/pay
        run: npm test
`,
    ],
    [
      "dynamic-cwd.yml",
      `jobs:
  pay:
    steps:
      - working-directory: \${{ matrix.directory }}
        run: pnpm test
`,
    ],
    [
      "unfiltered-turbo.yml",
      `jobs:
  pay:
    steps:
      - run: turbo build
`,
    ],
    [
      "workspace-alias.yml",
      `jobs:
  pay:
    steps:
      - run: pnpm run -w pay-alias
`,
    ],
    [
      "false-setup.yml",
      `jobs:
  pay:
    steps:
      - if: false
        uses: actions/setup-node@pinned
        with:
          node-version: "22.12.0"
      - run: pnpm --filter @0xkey-io/pay test
`,
    ],
    [
      "fallible-setup.yml",
      `jobs:
  pay:
    steps:
      - continue-on-error: true
        uses: actions/setup-node@pinned
        with:
          node-version: "22.12.0"
      - run: pnpm --filter @0xkey-io/pay test
`,
    ],
  ]) {
    assert.throws(
      () =>
        auditWorkflowSource({
          name,
          source,
          ...options,
          rootScripts: { "pay-alias": "pnpm -r test" },
        }),
      /Pay executes before|cannot prove/i,
      name,
    );
  }

  const payComposite = `name: Pay tests
runs:
  using: composite
  steps:
    - run: pnpm --filter @0xkey-io/pay test
      shell: bash
`;
  assert.throws(
    () =>
      auditWorkflowSource({
        name: "composite.yml",
        source: `jobs:
  pay:
    steps:
      - uses: ./.github/actions/pay-tests
`,
        ...options,
        localActions: new Map([["./.github/actions/pay-tests", payComposite]]),
      }),
    /Pay executes before/i,
  );
  assert.throws(
    () =>
      auditWorkflowSource({
        name: "unmodelled-composite.yml",
        source: `jobs:
  pay:
    steps:
      - uses: ./.github/actions/pay-tests
`,
        ...options,
      }),
    /unmodelled.*Pay/i,
  );

  const supportedSetup = `name: Setup
runs:
  using: composite
  steps:
    - if: \${{ inputs.node-version == '' }}
      uses: actions/setup-node@pinned
      with:
        node-version-file: .nvmrc
    - if: \${{ inputs.node-version != '' }}
      uses: actions/setup-node@pinned
      with:
        node-version: \${{ inputs.node-version }}
`;
  const unsafeSetup = `${supportedSetup}    - uses: actions/setup-node@pinned
      with:
        node-version: "20"
`;
  const safeConditionalDowngrade = `${supportedSetup}    - if: false
      uses: actions/setup-node@pinned
      with:
        node-version: "20"
`;
  const workflowUsingSetup = `jobs:
  pay:
    steps:
      - uses: ./.github/actions/js-setup
      - run: pnpm --filter @0xkey-io/pay test
`;
  assert.doesNotThrow(() =>
    auditWorkflowSource({
      name: "composite-setup.yml",
      source: workflowUsingSetup,
      ...options,
      localActions: new Map([["./.github/actions/js-setup", supportedSetup]]),
    }),
  );
  assert.throws(
    () =>
      auditWorkflowSource({
        name: "composite-downgrade.yml",
        source: workflowUsingSetup,
        ...options,
        localActions: new Map([["./.github/actions/js-setup", unsafeSetup]]),
      }),
    /unsupported Node 20/i,
  );
  assert.doesNotThrow(() =>
    auditWorkflowSource({
      name: "composite-false-downgrade.yml",
      source: workflowUsingSetup,
      ...options,
      localActions: new Map([
        ["./.github/actions/js-setup", safeConditionalDowngrade],
      ]),
    }),
  );

  const reusable = `jobs:
  pay:
    steps:
      - run: pnpm --filter @0xkey-io/pay test
`;
  assert.throws(
    () =>
      auditWorkflowSource({
        name: "caller.yml",
        source: `jobs:
  called:
    uses: ./.github/workflows/pay-tests.yml
`,
        ...options,
        localWorkflows: new Map([
          ["./.github/workflows/pay-tests.yml", reusable],
        ]),
      }),
    /pay-tests\.yml.*Pay executes before/i,
  );

  assert.doesNotThrow(() =>
    auditWorkflowSource({
      name: "false-positive.yml",
      source: `jobs:
  docs:
    steps:
      - uses: actions/checkout@pinned
      - run: echo packages/pay
      - run: '# pnpm --filter @0xkey-io/pay test'
`,
      ...options,
    }),
  );
});

test("repository audit parses every workflow job and authoritative release document", async () => {
  const { auditRepositoryReleaseSafety, auditPublishText } = await import(
    releaseAuditor
  );
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const [releasing, contributing] = await Promise.all([
    readFile(join(repositoryRoot, "RELEASING.md"), "utf8"),
    readFile(join(repositoryRoot, "CONTRIBUTING.md"), "utf8"),
  ]);
  const rootManifest = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.equal(rootManifest.devDependencies["@changesets/read"], "0.6.5");
  assert.equal(rootManifest.devDependencies.yaml, "2.8.1");
  assert.match(
    releasing,
    /Pay release candidate[\s\S]*checked tarball[\s\S]*`next`/i,
  );
  assert.match(
    releasing,
    /public GA[\s\S]*`latest`[\s\S]*future gated operation/i,
  );
  assert.match(
    contributing,
    /recursive publish[\s\S]*exclude `@0xkey-io\/pay`/i,
  );
  await auditRepositoryReleaseSafety(repositoryRoot);
  assert.throws(
    () =>
      auditPublishText({
        name: "unsafe.md",
        source: "```bash\npnpm publish -r --no-git-checks\n```",
      }),
    /unsafe\.md.*must exclude @0xkey-io\/pay/i,
  );
  assert.throws(
    () =>
      auditPublishText({
        name: "reordered.md",
        source: "```bash\npnpm -r publish --no-git-checks\n```",
      }),
    /reordered\.md.*must exclude @0xkey-io\/pay/i,
  );
  assert.doesNotThrow(() =>
    auditPublishText({
      name: "safe.md",
      source:
        "```bash\npnpm --filter '!@0xkey-io/pay' publish -r --no-git-checks\n```",
    }),
  );
});

test("Markdown audit inspects executable shell fences without scanning prose", async () => {
  const { auditPublishText } = await import(releaseAuditor);
  for (const source of [
    "Never run `pnpm publish -r`; it is unsafe.",
    "```text\npnpm publish -r\n```",
    "```bash\n# pnpm publish -r\necho 'pnpm publish -r'\nprintf '%s' packages/pay\n```",
  ]) {
    assert.doesNotThrow(() => auditPublishText({ name: "advice.md", source }));
  }
  assert.throws(
    () =>
      auditPublishText({
        name: "nested-shell.md",
        source:
          "```bash\nsh -c 'cd packages/pay && npm publish --tag latest'\n```",
      }),
    /nested-shell\.md.*Pay/i,
  );
  assert.throws(
    () =>
      auditPublishText({
        name: "command-block.md",
        source: "Release command:\n\n```console\n$ pnpm publish -r\n```",
      }),
    /command-block\.md.*exclude @0xkey-io\/pay/i,
  );
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

test("publish audit segments commands and permits only one checked Pay tarball mutation", async () => {
  const { auditPublishText } = await import(releaseAuditor);
  for (const [name, source] of [
    [
      "masked.md",
      "```bash\npnpm --filter '!@0xkey-io/pay' publish -r; pnpm publish -r\n```",
    ],
    [
      "wrong-boundary.md",
      "```bash\npnpm --filter '!@0xkey-io/payment' publish -r\n```",
    ],
    [
      "filtered-pay.md",
      "```bash\npnpm --filter @0xkey-io/pay publish --tag latest\n```",
    ],
    ["changesets.md", "```bash\npnpm changeset publish\n```"],
    ["pay-cwd.md", "```bash\ncd packages/pay && npm publish --tag latest\n```"],
    [
      "pay-prefix.md",
      "```bash\nnpm --prefix packages/pay publish --tag latest\n```",
    ],
  ]) {
    assert.throws(
      () => auditPublishText({ name, source }),
      new RegExp(
        `${name.replace(".", "\\.")}.*Pay|${name.replace(".", "\\.")}.*@0xkey-io/pay`,
        "i",
      ),
      name,
    );
  }

  const dedicated = (publishSteps) => `jobs:
  publish:
    steps:
      - id: pack
        run: pnpm --filter @0xkey-io/pay artifact:check --pack-destination "$RUNNER_TEMP/pay"
${publishSteps}`;
  assert.doesNotThrow(() =>
    auditPublishText({
      name: ".github/workflows/pay-publish.yml",
      source:
        dedicated(`      - run: npm publish "\${{ steps.pack.outputs.tarball }}" --tag next
`),
    }),
  );
  for (const [label, source] of [
    [
      "unbound tarball",
      dedicated("      - run: npm publish packages/pay --tag next\n"),
    ],
    [
      "wrong tag",
      dedicated(
        `      - run: npm publish "\${{ steps.pack.outputs.tarball }}" --tag latest\n`,
      ),
    ],
    [
      "second mutation",
      dedicated(
        `      - run: npm publish "\${{ steps.pack.outputs.tarball }}" --tag next
      - run: npm --prefix packages/pay publish --tag next
`,
      ),
    ],
    [
      "missing checked pack",
      `jobs:
  publish:
    steps:
      - id: pack
        run: echo pnpm --filter @0xkey-io/pay artifact:check --pack-destination /tmp/pay
      - run: npm publish "\${{ steps.pack.outputs.tarball }}" --tag next
`,
    ],
  ]) {
    assert.throws(
      () =>
        auditPublishText({
          name: ".github/workflows/pay-publish.yml",
          source,
        }),
      /pay-publish|checked tarball|single/i,
      label,
    );
  }
});

test("authoritative Pay workflows run full and public-surface typechecks", async () => {
  const repositoryRoot = new URL("../../../", import.meta.url);
  for (const name of ["pay-v1.yml", "pay-publish.yml"]) {
    const source = await readFile(
      new URL(`.github/workflows/${name}`, repositoryRoot),
      "utf8",
    );
    assert.match(
      source,
      /pnpm --filter @0xkey-io\/pay typecheck(?:\s|$)/,
      `${name} must run the full package typecheck`,
    );
    assert.match(source, /pnpm --filter @0xkey-io\/pay typecheck:pay-v1/);
  }
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
      `---\n"@0xkey-io/crypto": patch\n---\n\nOther package.\n`,
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
    await rm(join(changesetRoot, "malformed.md"));

    await mkdir(join(changesetRoot, "unreadable.md"));
    await assert.rejects(
      execFileAsync(process.execPath, [
        genericReleaseChecker.pathname,
        "--root",
        fixtureRoot,
      ]),
      (error) => {
        assert.match(error.stderr, /cannot read Changesets/i);
        return true;
      },
    );
    await rm(join(changesetRoot, "unreadable.md"), {
      recursive: true,
      force: true,
    });

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
