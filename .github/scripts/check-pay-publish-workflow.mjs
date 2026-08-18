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
  "pack --pack-destination",
  "Reconfirm source and npm state before mutation",
  "npm publish --tag next",
  "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
];

for (const value of required) {
  assert.ok(workflow.includes(value), `pay publish workflow is missing ${value}`);
}

for (const forbidden of [
  "changeset",
  "publish -r",
  "echo $NPM_TOKEN",
  "echo \"$NPM_TOKEN\"",
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

const immutableSourceCheck = workflow.indexOf("Verify immutable default-branch source");
const registryPreflight = workflow.indexOf("Refuse existing version and protect latest");
const finalMutationPreflight = workflow.indexOf(
  "Reconfirm source and npm state before mutation",
);
const publish = workflow.indexOf("npm publish --tag next");
const postPublishVerification = workflow.indexOf("Verify published version and npm tags");
assert.ok(immutableSourceCheck >= 0 && immutableSourceCheck < publish);
assert.ok(registryPreflight >= 0 && registryPreflight < publish);
assert.ok(finalMutationPreflight >= 0 && finalMutationPreflight < publish);
assert.ok(postPublishVerification > publish);
assert.equal((workflow.match(/npm publish --tag next/g) ?? []).length, 1);

process.stdout.write("Pay publish workflow static checks passed.\n");
