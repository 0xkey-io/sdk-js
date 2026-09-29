import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = parse(
  readFileSync(
    new URL("../../.github/workflows/js-build.yml", import.meta.url),
    "utf8",
  ),
);

function stepNamed(name) {
  const matches = workflow.jobs["basic-ci"].steps.filter(
    (step) => step.name === name,
  );
  assert.equal(matches.length, 1, `expected one ${name} step`);
  return matches[0];
}

test("ordinary PR CI runs Core Jest", () => {
  assert.ok(workflow.on.pull_request !== undefined);
  assert.equal(
    stepNamed("Core unit tests").run,
    "pnpm --filter @0xkey-io/crypto \\\n  --filter @0xkey-io/encoding \\\n  --filter @0xkey-io/api-key-stamper \\\n  --filter @0xkey-io/core \\\n  --filter @0xkey-io/react-wallet-kit \\\n  test\n",
  );
});

test("ordinary PR CI regenerates and checks the two Auth Proxy outputs", () => {
  const steps = workflow.jobs["basic-ci"].steps;
  const codegen = stepNamed("Auth Proxy codegen drift");
  assert.ok(
    steps.indexOf(codegen) < steps.indexOf(stepNamed("Build packages")),
  );
  assert.equal(
    codegen.run,
    "pnpm --filter @0xkey-io/core codegen\n" +
      "pnpm --filter @0xkey-io/sdk-types codegen\n" +
      "pnpm exec prettier --write packages/core/src/__generated__/sdk-client-base.ts packages/sdk-types/src/__generated__/types.ts\n" +
      "git diff --exit-code -- packages/core/src/__generated__/sdk-client-base.ts packages/sdk-types/src/__generated__/types.ts\n",
  );
});
