import assert from "node:assert/strict";
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
  assert.equal(publish.permissions?.contents, "read");
  assert.equal(
    publish.permissions?.["id-token"],
    "write",
    "publish job requires id-token: write",
  );

  const steps = publish.steps ?? [];
  assert.doesNotMatch(
    steps.map((step) => command(step?.run)).join("\n"),
    /\bnpm dist-tag\b/,
    "pay-publish.yml must not mutate dist-tags",
  );
  const checkout = stepNamed(steps, "Checkout the requested source commit");
  assert.equal(checkout.with?.ref, "${{ inputs.source_sha }}");
  const immutableSource = command(
    stepNamed(steps, "Verify immutable default-branch source").run,
  );
  assert.match(
    immutableSource,
    /git fetch --no-tags origin "\$DEFAULT_BRANCH"/,
    "immutable source step must fetch the default-branch head",
  );
  assert.match(immutableSource, /requested_sha.*default_head/);
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
    command(pack.run),
    'set -euo pipefail pnpm --filter @0xkey-io/pay artifact:check --pack-destination "$RUNNER_TEMP/oxkey-pay-publish"',
    "artifact step must emit the one checked Pay tarball",
  );

  const publishStep = stepNamed(
    steps,
    "Publish only @0xkey-io/pay to npm next",
  );
  assert.equal(
    command(publishStep.run),
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
  assert.match(
    reconfirmCommand,
    /git fetch --no-tags origin "\$DEFAULT_BRANCH"/,
    "final preflight must fetch the default-branch head",
  );
  assert.match(reconfirmCommand, /git diff --quiet git diff --cached --quiet/);
  assert.match(reconfirmCommand, /packageJson\.private !== true/);
  assert.ok(
    steps.indexOf(pack) < steps.indexOf(reconfirm) &&
      steps.indexOf(reconfirm) < steps.indexOf(publishStep),
    "artifact check and final preflight must precede publication",
  );
  assert.equal(
    (source.match(/\$\{\{ steps\.pack\.outputs\.tarball \}\}/g) ?? []).length,
    1,
    "checked tarball output must have one consumer",
  );
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
