import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(
  new URL("../workflows/pay-publish.yml", import.meta.url),
  "utf8",
);

const required = [
  "workflow_dispatch:",
  "source_sha:",
  "expected_version:",
  "confirm_publish:",
  "default: false",
  "permissions:\n  contents: read",
  "environment: production",
  "if: ${{ inputs.confirm_publish }}",
  "ref: ${{ inputs.source_sha }}",
  "registry-url: https://registry.npmjs.org/",
  "PUBLIC_NPM_REGISTRY: https://registry.npmjs.org/",
  "Verify public npm registry configuration",
  "npm config get registry",
  'git fetch --no-tags origin "$DEFAULT_BRANCH"',
  "origin/$DEFAULT_BRANCH",
  'packageJson.name !== "@0xkey-io/pay"',
  "packageJson.version !== expectedVersion",
  "dist-tags.latest",
  '"0.2.0"',
  "pins:check",
  "docs:check",
  "typecheck:pay-v1",
  "test:pay-v1",
  "test:interop",
  "pnpm --filter @0xkey-io/pay build",
  "Pack and smoke the exact Pay release candidate",
  "id: pack",
  "pnpm --filter @0xkey-io/pay artifact:check",
  '--pack-destination "$RUNNER_TEMP/oxkey-pay-publish"',
  "Reconfirm source, package metadata, and npm state before mutation",
  'npm publish "${{ steps.pack.outputs.tarball }}"',
  "--tag next",
  "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
];

for (const value of required) {
  assert.ok(
    workflow.includes(value),
    `pay publish workflow is missing ${value}`,
  );
}

for (const forbidden of [
  "changeset",
  "publish -r",
  "echo $NPM_TOKEN",
  'echo "$NPM_TOKEN"',
]) {
  assert.ok(
    !workflow.includes(forbidden),
    `pay publish workflow must not contain ${forbidden}`,
  );
}
assert.doesNotMatch(
  workflow,
  /^\s*npm dist-tag(?:\s|$)/m,
  "pay publish workflow must not retag existing versions",
);

for (const input of ["source_sha", "expected_version"]) {
  assert.match(
    workflow,
    new RegExp(`${input}:\\n(?:.+\\n)*?\\s+required: true\\n\\s+type: string`),
    `${input} must be a required string input`,
  );
}

assert.match(
  workflow,
  /confirm_publish:\n(?:.+\n)*?\s+required: true\n\s+default: false\n\s+type: boolean/,
  "confirm_publish must be required and default to false",
);
assert.doesNotMatch(
  workflow,
  /\n  (?:push|pull_request):/,
  "pay publish workflow must be manual only",
);

const immutableSourceCheck = workflow.indexOf(
  "Verify immutable default-branch source",
);
const installDependencies = workflow.indexOf("Install dependencies");
const dependencyGraphBuild = workflow.indexOf("Build Pay dependency graph");
const payTypecheck = workflow.indexOf("Typecheck Pay");
const registryPreflight = workflow.indexOf(
  "Refuse existing version and protect latest",
);
const finalMutationPreflight = workflow.indexOf(
  "Reconfirm source, package metadata, and npm state before mutation",
);
const artifactCheck = workflow.indexOf(
  "Pack and smoke the exact Pay release candidate",
);
const publish = workflow.indexOf("Publish only @0xkey-io/pay to npm next");
const postPublishVerification = workflow.indexOf(
  "Verify published version and npm tags",
);
assert.ok(immutableSourceCheck >= 0 && immutableSourceCheck < publish);
assert.match(
  workflow,
  /- name: Build Pay dependency graph\n\s+run: pnpm turbo run build --filter='@0xkey-io\/pay\^\.\.\.'/,
  "Pay dependency graph build must use the conformance workflow command",
);
assert.ok(
  installDependencies >= 0 &&
    dependencyGraphBuild > installDependencies &&
    dependencyGraphBuild < payTypecheck,
  "Pay dependency graph must build after install and before Pay typecheck",
);
assert.ok(registryPreflight >= 0 && registryPreflight < publish);
assert.ok(
  artifactCheck >= 0 &&
    artifactCheck < finalMutationPreflight &&
    finalMutationPreflight < publish,
  "the shared artifact check must run before the final mutation preflight and publish",
);
assert.ok(postPublishVerification > publish);
assert.ok(
  workflow.lastIndexOf('packageJson.name !== "@0xkey-io/pay"') >
    finalMutationPreflight,
  "final mutation preflight must recheck the Pay package name",
);
assert.ok(
  workflow.lastIndexOf("packageJson.version !== expectedVersion") >
    finalMutationPreflight,
  "final mutation preflight must recheck the expected Pay version",
);

const registryConfiguration = workflow.indexOf(
  "Verify public npm registry configuration",
);
const firstTokenUse = workflow.indexOf(
  "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
);
assert.ok(registryConfiguration >= 0 && registryConfiguration < firstTokenUse);
assert.ok(
  workflow.lastIndexOf("npm config get registry") > finalMutationPreflight,
  "final mutation preflight must recheck the effective npm registry",
);
assert.match(
  workflow,
  /git diff --quiet\n\s+git diff --cached --quiet\n\s+if \[ -n "\$\(git status --porcelain=v1 --untracked-files=all\)" \]; then/,
  "final mutation preflight must require a clean source tree",
);

function step(name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, `pay publish workflow is missing step ${name}`);
  const next = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, next < 0 ? workflow.length : next);
}

const artifactStep = step("Pack and smoke the exact Pay release candidate");
assert.match(artifactStep, /^\s+id: pack$/m, "artifact step must have id pack");
assert.match(
  artifactStep,
  /pnpm --filter @0xkey-io\/pay artifact:check \\\n\s+--pack-destination "\$RUNNER_TEMP\/oxkey-pay-publish"/,
  "artifact step must use the shared checker with a retained pack destination",
);

const publishStep = step("Publish only @0xkey-io/pay to npm next");
assert.doesNotMatch(
  publishStep,
  /^\s+working-directory:/m,
  "Pay publish must target the verified tarball, not the package directory",
);
assert.match(
  publishStep,
  /npm publish "\$\{\{ steps\.pack\.outputs\.tarball \}\}"/,
  "Pay publish must target the exact tarball emitted by the artifact step",
);
assert.match(publishStep, /^\s+--tag next$/m, "Pay publish must use tag next");
assert.match(
  publishStep,
  /^\s+--registry="\$PUBLIC_NPM_REGISTRY"$/m,
  "Pay publish must pin npmjs",
);
assert.equal(
  (workflow.match(/\bnpm publish\b/g) ?? []).length,
  1,
  "workflow must contain one npm publish command",
);
assert.equal(
  (workflow.match(/^\s+--tag next$/gm) ?? []).length,
  1,
  "workflow must contain one --tag next publish",
);
assert.equal(
  (workflow.match(/\$\{\{ steps\.pack\.outputs\.tarball \}\}/g) ?? []).length,
  1,
  "the artifact output must be consumed only by the Pay publish command",
);

for (const command of workflow.match(/^\s*npm view\b.*$/gm) ?? []) {
  assert.match(
    command,
    /--registry="\$PUBLIC_NPM_REGISTRY"/,
    `npm registry command must pin npmjs: ${command.trim()}`,
  );
}

assert.match(
  workflow,
  /npm install --global corepack@0\.34\.1 --registry="\$PUBLIC_NPM_REGISTRY"/,
  "corepack install must pin npmjs",
);
assert.match(
  workflow,
  /pnpm install -r --frozen-lockfile --registry "\$PUBLIC_NPM_REGISTRY"/,
  "dependency install must pin npmjs",
);

const visibilityStep = step("Verify published version and npm tags");
const attempts = visibilityStep.match(/^\s+attempts=(\d+)$/m);
const waitSeconds = visibilityStep.match(/^\s+wait_seconds=(\d+)$/m);
assert.ok(
  attempts,
  "post-publish verification must set a numeric attempt bound",
);
assert.ok(waitSeconds, "post-publish verification must set a numeric wait");
assert.ok(
  Number(attempts[1]) > 1 && Number(attempts[1]) <= 30,
  "post-publish verification attempts must be bounded between 2 and 30",
);
assert.ok(
  Number(waitSeconds[1]) > 0 && Number(waitSeconds[1]) <= 60,
  "post-publish verification wait must be bounded between 1 and 60 seconds",
);
assert.match(
  visibilityStep,
  /for attempt in \$\(seq 1 "\$attempts"\); do/,
  "post-publish verification must use the attempt bound",
);
assert.match(
  visibilityStep,
  /if \[ "\$attempt" -lt "\$attempts" \]; then[\s\S]*sleep "\$wait_seconds"/,
  "post-publish verification must wait only between bounded attempts",
);
assert.match(
  visibilityStep,
  /echo "npm did not expose the expected state after \$attempts attempts\." >&2[\s\S]*exit 1/,
  "post-publish verification must fail after the bounded retry",
);
assert.doesNotMatch(
  visibilityStep,
  /\bwhile\b/,
  "post-publish verification must not use an unbounded while loop",
);

process.stdout.write("Pay publish workflow static checks passed.\n");
