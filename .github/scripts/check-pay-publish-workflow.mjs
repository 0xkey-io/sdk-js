import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const knownPayWorkflows = [
  "commerce-contract.yml",
  "commerce-verifier.yml",
  "js-build.yml",
  "pay-publish.yml",
  "pay-v1.yml",
  "version-and-publish.yml",
];
const knownNonPayWorkflows = ["meta.yml"];
const expectedRepository = {
  type: "git",
  url: "git+https://github.com/0xkey-io/sdk-js.git",
  directory: "packages/pay",
};
const expectedPublishConfig = {
  access: "public",
  registry: "https://registry.npmjs.org/",
  tag: "next",
};

function command(value) {
  return String(value ?? "")
    .replace(/\\\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function workflowDocument(source, name) {
  try {
    const document = parse(source);
    assert.ok(document && typeof document === "object", `${name} must be YAML`);
    return document;
  } catch (error) {
    throw new Error(
      `${name} could not be parsed: ${error instanceof Error ? error.message : "invalid YAML"}`,
    );
  }
}

function stepNamed(steps, name) {
  const matches = steps.filter((step) => step?.name === name);
  assert.equal(matches.length, 1, `pay-publish.yml must have one ${name} step`);
  return matches[0];
}

function checkSourceBindingStep(step) {
  // This is an exact bounded workflow contract, not a shell-code substring
  // audit. Preserve shell statement boundaries: folding or continuing a newline
  // can make `set` consume the guard as arguments without ever executing it.
  assert.deepEqual(Object.keys(step).sort(), ["name", "run", "shell"]);
  assert.equal(step.shell, "bash");
  assert.equal(
    step.run,
    [
      "set -euo pipefail",
      '[[ "${GITHUB_WORKFLOW_SHA:-}" =~ ^[0-9a-f]{40}$ ]]',
      'git --no-replace-objects show "$GITHUB_WORKFLOW_SHA:.github/scripts/check-pay-publish-source.sh" | bash --noprofile --norc',
      "",
    ].join("\n"),
    "source binding must execute the trusted workflow blob with pipefail and no replacement objects",
  );
}

function versionAtLeast(value, major, minor) {
  const match = /^v?(\d+)\.(\d+)(?:\.\d+)?$/.exec(String(value));
  return (
    Boolean(match) &&
    (Number(match[1]) > major ||
      (Number(match[1]) === major && Number(match[2]) >= minor))
  );
}

export function checkPayPublishWorkflow(source) {
  assert.equal(
    (source.match(/\bnpm publish\b/g) ?? []).length,
    1,
    "pay-publish.yml must contain exactly one npm publish",
  );
  assert.doesNotMatch(
    source,
    /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/i,
    "pay-publish.yml must use OIDC, not NPM_TOKEN",
  );

  const workflow = workflowDocument(source, "pay-publish.yml");
  assert.deepEqual(workflow.on, {
    workflow_dispatch: {
      inputs: {
        source_sha: {
          description: "Full merged default-branch commit SHA to publish",
          required: true,
          type: "string",
        },
        expected_version: {
          description: "Exact @0xkey-io/pay version to publish",
          required: true,
          type: "string",
        },
        confirm_publish: {
          description: "Publish @0xkey-io/pay with npm dist-tag next",
          required: true,
          default: false,
          type: "boolean",
        },
      },
    },
  });
  assert.equal(workflow.permissions?.contents, "read");
  assert.equal(
    workflow.permissions?.["id-token"],
    "write",
    "trusted publishing requires top-level id-token: write",
  );

  const publish = workflow.jobs?.publish;
  assert.ok(publish, "pay-publish.yml must have a publish job");
  assert.equal(publish.if, "${{ inputs.confirm_publish }}");
  assert.equal(
    publish["runs-on"],
    "ubuntu-latest",
    "trusted publishing requires a GitHub-hosted runner",
  );
  assert.equal(publish.environment, "production");
  assert.equal(publish["continue-on-error"], undefined);
  assert.equal(workflow.env, undefined);
  assert.equal(workflow.defaults, undefined);
  assert.equal(publish.defaults, undefined);
  assert.deepEqual(publish.env, {
    PUBLIC_NPM_REGISTRY: "https://registry.npmjs.org/",
    PAY_PUBLISH_DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
    PAY_PUBLISH_SOURCE_SHA: "${{ inputs.source_sha }}",
  });
  assert.equal(publish.permissions?.contents, "read");
  assert.equal(
    publish.permissions?.["id-token"],
    "write",
    "publish job requires id-token: write",
  );

  const steps = publish.steps ?? [];
  assert.deepEqual(Object.keys(workflow.jobs), ["publish"]);
  assert.doesNotMatch(
    steps.map((step) => command(step?.run)).join("\n"),
    /\bnpm dist-tag\b/,
    "pay-publish.yml must not mutate dist-tags",
  );
  const checkout = stepNamed(steps, "Checkout the executing workflow source");
  assert.deepEqual(Object.keys(checkout).sort(), ["name", "uses", "with"]);
  assert.match(checkout.uses, /^actions\/checkout@[0-9a-f]{40}$/);
  assert.deepEqual(
    checkout.with,
    {
      "fetch-depth": 0,
      ref: "${{ github.workflow_sha }}",
    },
    "candidate input must not select executable checker code",
  );
  const immutableSource = stepNamed(
    steps,
    "Verify immutable default-branch source",
  );
  const finalSource = stepNamed(
    steps,
    "Reconfirm immutable default-branch source",
  );
  checkSourceBindingStep(immutableSource);
  checkSourceBindingStep(finalSource);
  assert.equal(steps.indexOf(checkout), 0, "trusted checkout must be first");
  assert.equal(
    steps.indexOf(immutableSource),
    1,
    "source binding must precede dependency and artifact code",
  );
  const node = stepNamed(steps, "Set up Node and pnpm");
  assert.match(node.uses, /^actions\/setup-node@[0-9a-f]{40}$/);
  assert.equal(
    node.with?.["node-version"],
    "24.3.0",
    "trusted publishing pins Node 24.3.0 (>=22.14)",
  );
  assert.equal(
    node.with?.["registry-url"],
    undefined,
    "trusted publishing must not create a NODE_AUTH_TOKEN npmrc",
  );

  const install = stepNamed(steps, "Install dependencies");
  assert.match(
    command(install.run),
    /npm install --global npm@11\.5\.1 corepack@0\.34\.1 --registry="\$PUBLIC_NPM_REGISTRY"/,
  );

  const pack = stepNamed(
    steps,
    "Pack and smoke the exact Pay release candidate",
  );
  assert.equal(pack.id, "pack");
  assert.equal(
    pack.run,
    'set -euo pipefail\npnpm --filter @0xkey-io/pay artifact:check \\\n  --pack-destination "$RUNNER_TEMP/oxkey-pay-publish"\n',
    "artifact step must emit the one checked Pay tarball",
  );

  const publishStep = stepNamed(
    steps,
    "Publish only @0xkey-io/pay to npm next",
  );
  assert.equal(
    publishStep.run,
    'npm publish "${{ steps.pack.outputs.tarball }}" --tag next --access public --registry="$PUBLIC_NPM_REGISTRY" --provenance --ignore-scripts',
    "publish command must publish only the checked tarball with next and provenance",
  );

  for (const name of [
    "Verify exact protocol pins",
    "Verify Pay documentation",
    "Typecheck Pay",
    "Test Pay",
    "Run Pay interoperability checks",
    "Reconfirm source, package metadata, and npm state before mutation",
    "Verify published version and npm tags",
  ]) {
    stepNamed(steps, name);
  }
  const typecheck = command(stepNamed(steps, "Typecheck Pay").run);
  assert.match(typecheck, /pnpm --filter @0xkey-io\/pay typecheck(?:\s|$)/);
  assert.match(
    typecheck,
    /pnpm --filter @0xkey-io\/pay typecheck:pay-v1(?:\s|$)/,
  );
  const reconfirm = stepNamed(
    steps,
    "Reconfirm source, package metadata, and npm state before mutation",
  );
  const reconfirmCommand = command(reconfirm.run);
  assert.match(reconfirmCommand, /packageJson\.private !== true/);
  assert.ok(
    steps.indexOf(pack) < steps.indexOf(reconfirm) &&
      steps.indexOf(reconfirm) < steps.indexOf(finalSource),
    "artifact check and final preflight must precede publication",
  );
  assert.equal(
    steps.indexOf(finalSource) + 1,
    steps.indexOf(publishStep),
    "final source binding must immediately precede publication",
  );
  assert.equal(
    (source.match(/\$\{\{ steps\.pack\.outputs\.tarball \}\}/g) ?? []).length,
    3,
    "checked tarball output must have exactly three named consumers",
  );
  checkPublicationEvidence(steps, pack, reconfirm, publishStep);
}

function checkPublicationEvidence(steps, pack, reconfirm, publishStep) {
  const prepare = stepNamed(steps, "Prepare checked npm source context");
  const preserve = stepNamed(
    steps,
    "Preserve checked npm package before publication",
  );
  const collect = stepNamed(
    steps,
    "Collect immutable public npm publication receipt",
  );
  const retain = stepNamed(steps, "Retain immutable npm publication receipt");
  const poll = stepNamed(steps, "Verify published version and npm tags");
  assert.deepEqual(prepare, {
    name: "Prepare checked npm source context",
    shell: "bash",
    env: {
      EXPECTED_VERSION: "${{ inputs.expected_version }}",
      CHECKED_TAR: "${{ steps.pack.outputs.tarball }}",
    },
    run: 'set -euo pipefail\nnode packages/pay/scripts/prepare-npm-source-context.mjs --checked-tar "$CHECKED_TAR" --expected-version "$EXPECTED_VERSION" --output "$RUNNER_TEMP/pay-checked-package-v1"\n',
  });
  assert.deepEqual(collect, {
    name: "Collect immutable public npm publication receipt",
    shell: "bash",
    env: {
      EXPECTED_VERSION: "${{ inputs.expected_version }}",
      EXPECTED_SOURCE: "${{ inputs.source_sha }}",
      CHECKED_TAR: "${{ steps.pack.outputs.tarball }}",
      CHECKED_ARTIFACT_ID: "${{ steps.checked_package.outputs.artifact-id }}",
      CHECKED_ARTIFACT_DIGEST:
        "${{ steps.checked_package.outputs.artifact-digest }}",
    },
    run: 'set -euo pipefail\nnode packages/pay/scripts/collect-published-npm-receipt.mjs --checked-tar "$CHECKED_TAR" --source-context "$RUNNER_TEMP/pay-checked-package-v1/source-context.json" --expected-version "$EXPECTED_VERSION" --expected-source "$EXPECTED_SOURCE" --output "$RUNNER_TEMP/pay-npm-publication-receipt-v1" --artifact-id "$CHECKED_ARTIFACT_ID" --artifact-digest "$CHECKED_ARTIFACT_DIGEST"\n',
  });
  for (const [step, prefix, path, id] of [
    [
      preserve,
      "pay-checked-package",
      "pay-checked-package-v1",
      "checked_package",
    ],
    [
      retain,
      "pay-npm-publication-receipt",
      "pay-npm-publication-receipt-v1",
      undefined,
    ],
  ])
    assert.deepEqual(step, {
      name: step.name,
      ...(id ? { id } : {}),
      uses: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
      with: {
        name: `${prefix}-\${{ inputs.source_sha }}-\${{ github.run_id }}-\${{ github.run_attempt }}`,
        path: `\${{ runner.temp }}/${path}`,
        "if-no-files-found": "error",
        "retention-days": 90,
        overwrite: false,
      },
    });
  assert.deepEqual(Object.keys(pack).sort(), ["id", "name", "run"]);
  assert.deepEqual(Object.keys(publishStep).sort(), ["name", "run"]);
  assert.deepEqual(Object.keys(poll).sort(), ["env", "name", "run"]);
  assert.deepEqual(poll.env, {
    EXPECTED_VERSION: "${{ inputs.expected_version }}",
  });
  // Exact executable poll semantics: no disabled/no-op poll before collection.
  assert.equal(
    poll.run,
    [
      "set -euo pipefail",
      "attempts=12",
      "wait_seconds=10",
      'for attempt in $(seq 1 "$attempts"); do',
      '  published_version="$(npm view "@0xkey-io/pay@$EXPECTED_VERSION" version --registry="$PUBLIC_NPM_REGISTRY" 2>/dev/null || true)"',
      '  next="$(npm view @0xkey-io/pay dist-tags.next --registry="$PUBLIC_NPM_REGISTRY" 2>/dev/null || true)"',
      '  latest="$(npm view @0xkey-io/pay dist-tags.latest --registry="$PUBLIC_NPM_REGISTRY" 2>/dev/null || true)"',
      '  if [ "$published_version" = "$EXPECTED_VERSION" ] \\',
      '    && [ "$next" = "$EXPECTED_VERSION" ] \\',
      '    && [ "$latest" = "0.2.0" ]; then',
      "    exit 0",
      "  fi",
      '  if [ "$attempt" -lt "$attempts" ]; then',
      '    echo "npm has not exposed the expected version and tags yet (attempt $attempt/$attempts); waiting ${wait_seconds}s."',
      '    sleep "$wait_seconds"',
      "  fi",
      "done",
      'echo "npm did not expose the expected state after $attempts attempts." >&2',
      'echo "version=$published_version next=$next latest=$latest" >&2',
      "exit 1",
      "",
    ].join("\n"),
  );
  const positions = [pack, prepare, preserve, reconfirm].map((step) =>
    steps.indexOf(step),
  );
  assert.ok(
    positions.every(
      (position, index) => index === 0 || position === positions[index - 1] + 1,
    ),
    "preservation must succeed before final checks and publish",
  );
  assert.equal(steps.indexOf(publishStep) + 1, steps.indexOf(poll));
  assert.equal(steps.indexOf(poll) + 1, steps.indexOf(collect));
  assert.equal(steps.indexOf(collect) + 1, steps.indexOf(retain));
  assert.equal(steps.indexOf(retain), steps.length - 1);
  const expectedNames = [
    "Checkout the executing workflow source",
    "Verify immutable default-branch source",
    "Set up Node and pnpm",
    "Verify public npm registry configuration",
    "Install dependencies",
    "Build Pay dependency graph",
    "Verify Pay package metadata",
    "Refuse existing version and protect latest",
    "Verify exact protocol pins",
    "Verify Pay documentation",
    "Typecheck Pay",
    "Test Pay",
    "Build Pay",
    "Run Pay interoperability checks",
    pack.name,
    prepare.name,
    preserve.name,
    reconfirm.name,
    "Reconfirm immutable default-branch source",
    publishStep.name,
    poll.name,
    collect.name,
    retain.name,
  ];
  assert.deepEqual(
    steps.map((step) => step.name),
    expectedNames,
    "no extra pack, publish, capture or token-bearing steps",
  );
  // Preserve supporting steps from reviewed GateP sdk-js@53050213582d67c96a6510efc45e277d2cbdf8ee.
  // Without this, an extra quoted publish/pack or tar consumer can hide inside
  // any earlier run block. This is a fixed workflow contract, not a shell parser.
  // Sort object keys only; executable run-string bytes are never normalized.
  const baseline = {
    "Set up Node and pnpm":
      "83a60fa34e9f0cf0c08c585758b34f9903fa7ba2bd85461678492fc1e56729a9",
    "Verify public npm registry configuration":
      "f1356ec6c34ad24c807b84add4999dceba0862c2b97449f1d349d6097591d151",
    "Install dependencies":
      "dc62465b03be017d30bf0ebc6c8f49b6c96dd279649c6ba1fe86d3ad5faba75f",
    "Build Pay dependency graph":
      "0e284371f4a819b45285f595276ba462b09b1a6b7ff6fb2dba6fcd416fb31ae6",
    "Verify Pay package metadata":
      "299c395e4cfc1f70b0fe78d49c1e67df60246272426620e8d32ff895ed2f3844",
    "Refuse existing version and protect latest":
      "b0630567fbd30f06efc5467f7e92ac60770e1c68ec1c2600529327ac539c45ac",
    "Verify exact protocol pins":
      "659a0498be26ea89d197879ed2afcadb2fa5a9c14f88fbc6f87b97acc007b2ed",
    "Verify Pay documentation":
      "b0794d9c6620771243661825f11e2c9b0dae745b953ecb8380a7f066ca343088",
    "Typecheck Pay":
      "2f149abe3f364561460dde0207b0bb755bedf9769abc31a280ae9b3c7c47ef6e",
    "Test Pay":
      "bc6d6d2c761d6721b2cbe75d97a4d1a01046067b7af3b5852c203338bad07002",
    "Build Pay":
      "1b693a9c5ec2312640525436a098e91b975937071ce70cfd3f742bab59bb8ca9",
    "Run Pay interoperability checks":
      "0c609bd766a95b8501890d990f23e2899ffba5484c1b844cc04d695568a36f27",
    "Reconfirm source, package metadata, and npm state before mutation":
      "a84876101622d8735516189bcbbf209e3391ddc3e98ade7e0e05496476420a7e",
  };
  for (const [name, expected] of Object.entries(baseline)) {
    const bytes = JSON.stringify(stepNamed(steps, name), (_, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          )
        : value,
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      expected,
      `${name} executable contract changed; review the GateP supporting-step pin`,
    );
  }
}

function checkSourceManifest(manifest) {
  assert.equal(manifest.name, "@0xkey-io/pay");
  assert.equal(
    manifest.private,
    true,
    "Pay source manifest must be private:true",
  );
  assert.deepEqual(manifest.repository, expectedRepository);
  assert.deepEqual(manifest.publishConfig, expectedPublishConfig);
}

function checkKnownWorkflowNodeVersions(sources, rootNodeVersion) {
  assert.ok(
    versionAtLeast(rootNodeVersion, 22, 12),
    ".nvmrc must be Node >=22.12",
  );
  for (const [name, source] of sources) {
    const workflow = workflowDocument(source, name);
    for (const job of Object.values(workflow.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (typeof step?.uses !== "string") continue;
        if (step.uses.startsWith("actions/setup-node@")) {
          assert.ok(
            versionAtLeast(step.with?.["node-version"], 22, 12),
            `${name} has an unsupported explicit Node version`,
          );
        }
        if (step.uses === "./.github/actions/js-setup") {
          const selected = step.with?.["node-version"] ?? rootNodeVersion;
          assert.ok(
            versionAtLeast(selected, 22, 12),
            `${name} has an unsupported js-setup Node version`,
          );
        }
      }
    }
  }
}

export function checkJsSetupAction(source) {
  const action = workflowDocument(
    source,
    ".github/actions/js-setup/action.yml",
  );
  assert.equal(action.runs?.using, "composite");
  const steps = action.runs?.steps ?? [];
  const nodeSteps = steps.filter((step) =>
    String(step?.uses ?? "").startsWith("actions/setup-node@"),
  );
  assert.equal(
    nodeSteps.length,
    2,
    "js-setup must have exactly two setup-node branches",
  );

  const repositoryNode = stepNamed(steps, "Install repository Node.js");
  assert.match(repositoryNode.uses, /^actions\/setup-node@[0-9a-f]{40}$/);
  assert.equal(repositoryNode.if, "${{ inputs.node-version == '' }}");
  assert.equal(
    repositoryNode.with?.["node-version-file"],
    ".nvmrc",
    "repository Node setup must use .nvmrc",
  );

  const overrideNode = stepNamed(steps, "Install overridden Node.js");
  assert.match(overrideNode.uses, /^actions\/setup-node@[0-9a-f]{40}$/);
  assert.equal(overrideNode.if, "${{ inputs.node-version != '' }}");
  assert.equal(
    overrideNode.with?.["node-version"],
    "${{ inputs.node-version }}",
  );
  assert.equal(
    command(stepNamed(steps, "Use recent version of npm").run),
    "npm install -g npm@11.5.1",
  );
}

async function main() {
  const workflowDirectory = resolve(repositoryRoot, ".github/workflows");
  const actualWorkflows = (await readdir(workflowDirectory))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
  assert.deepEqual(
    actualWorkflows,
    [...knownPayWorkflows, ...knownNonPayWorkflows].sort(),
    "workflow inventory changed; classify it explicitly before changing the bounded Pay release check",
  );

  const [
    paySource,
    manifestSource,
    rootNodeVersion,
    setupSource,
    ...payWorkflowSources
  ] = await Promise.all([
    readFile(resolve(workflowDirectory, "pay-publish.yml"), "utf8"),
    readFile(resolve(repositoryRoot, "packages/pay/package.json"), "utf8"),
    readFile(resolve(repositoryRoot, ".nvmrc"), "utf8"),
    readFile(
      resolve(repositoryRoot, ".github/actions/js-setup/action.yml"),
      "utf8",
    ),
    ...knownPayWorkflows.map((name) =>
      readFile(resolve(workflowDirectory, name), "utf8"),
    ),
  ]);
  checkPayPublishWorkflow(paySource);
  checkSourceManifest(JSON.parse(manifestSource));
  checkJsSetupAction(setupSource);
  checkKnownWorkflowNodeVersions(
    knownPayWorkflows.map((name, index) => [name, payWorkflowSources[index]]),
    rootNodeVersion.trim(),
  );
  process.stdout.write(
    "Bounded Pay workflow and source-manifest checks passed.\n",
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Pay workflow check failed"}\n`,
    );
    process.exitCode = 1;
  });
}
