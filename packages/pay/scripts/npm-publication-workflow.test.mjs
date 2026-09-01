import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parse, stringify } from "yaml";
import { checkPayPublishWorkflow } from "../../../.github/scripts/check-pay-publish-workflow.mjs";

const source = await readFile(
  new URL("../../../.github/workflows/pay-publish.yml", import.meta.url),
  "utf8",
);
test("publication without original checked-package preservation is rejected", () => {
  const workflow = parse(source);
  workflow.jobs.publish.steps = workflow.jobs.publish.steps.filter(
    (step) =>
      step.name !== "Prepare checked npm source context" &&
      step.name !== "Preserve checked npm package before publication",
  );
  assert.throws(
    () => checkPayPublishWorkflow(stringify(workflow)),
    undefined,
    "a successful publication could lose its original checked tar before capture",
  );
});

test("current evidence workflow is accepted", () =>
  assert.doesNotThrow(() => checkPayPublishWorkflow(source)));

test("publisher rejects execution and tar consumers outside the closed step contract", async (t) => {
  for (const [scope, key, value] of [
    ["workflow", "name", "Unreviewed publisher"],
    ["workflow", "run-name", "${{steps.pack.outputs.tarball}}"],
    ["workflow", "env", { GH_TOKEN: "${{ github.token }}" }],
    ["workflow", "defaults", { run: { shell: "sh" } }],
    ["workflow", "concurrency", "unreviewed"],
    [
      "workflow",
      "permissions",
      { contents: "read", "id-token": "write", packages: "write" },
    ],
    ["job", "outputs", { checked_tar: "${{steps.pack.outputs.tarball}}" }],
    ["job", "container", { image: "example.invalid/unreviewed:latest" }],
    [
      "job",
      "services",
      { sidecar: { image: "example.invalid/unreviewed:latest" } },
    ],
    ["job", "strategy", { matrix: { replica: ["a", "b"] } }],
    ["job", "defaults", { run: { "working-directory": "/tmp/candidate" } }],
    ["job", "needs", "unreviewed"],
    ["job", "concurrency", "unreviewed"],
    ["job", "name", "${{steps.pack.outputs.tarball}}"],
    ["job", "timeout-minutes", 360],
    [
      "job",
      "permissions",
      { contents: "read", "id-token": "write", packages: "write" },
    ],
    ["job", "continue-on-error", true],
    ["job", "uses", "example/other/.github/workflows/publish.yml@main"],
    ["job", "secrets", "inherit"],
    ["job", "with", { tar: "${{steps.pack.outputs.tarball}}" }],
  ])
    await t.test(`${scope} ${key}`, () => {
      const workflow = parse(source);
      (scope === "workflow" ? workflow : workflow.jobs.publish)[key] = value;
      assert.throws(() => checkPayPublishWorkflow(stringify(workflow)));
    });
  for (const scope of ["workflow", "job"])
    await t.test(`${scope} missing required key`, () => {
      const workflow = parse(source);
      if (scope === "workflow") delete workflow.name;
      else delete workflow.jobs.publish["timeout-minutes"];
      assert.throws(() => checkPayPublishWorkflow(stringify(workflow)));
    });
});

test("evidence preparation, uploads and capture cannot be weakened or moved", async (t) => {
  const names = [
    "Prepare checked npm source context",
    "Preserve checked npm package before publication",
    "Collect immutable public npm publication receipt",
    "Retain immutable npm publication receipt",
  ];
  for (const name of names)
    for (const mutation of [
      "missing",
      "disabled",
      "continue",
      "noop",
      "reordered",
      "credentials",
      "cwd",
    ])
      await t.test(`${name}: ${mutation}`, () => {
        const workflow = parse(source);
        const steps = workflow.jobs.publish.steps;
        const index = steps.findIndex((step) => step.name === name);
        const step = steps[index];
        if (mutation === "missing") steps.splice(index, 1);
        if (mutation === "disabled") step.if = "${{ false }}";
        if (mutation === "continue") step["continue-on-error"] = true;
        if (mutation === "noop") {
          delete step.uses;
          delete step.with;
          step.run = "true";
        }
        if (mutation === "reordered")
          [steps[index], steps[index - 1]] = [steps[index - 1], steps[index]];
        if (mutation === "credentials")
          step.env = { ...step.env, GH_TOKEN: "${{ github.token }}" };
        if (mutation === "cwd") step["working-directory"] = "/tmp/candidate";
        assert.throws(() => checkPayPublishWorkflow(stringify(workflow)));
      });
  for (const name of [names[1], names[3]])
    for (const mutation of [
      "unpinned",
      "overwrite",
      "retention",
      "missing files",
      "mutable name",
      "path",
    ])
      await t.test(`${name}: ${mutation}`, () => {
        const workflow = parse(source);
        const step = workflow.jobs.publish.steps.find(
          (step) => step.name === name,
        );
        if (mutation === "unpinned") step.uses = "actions/upload-artifact@v4";
        if (mutation === "overwrite") step.with.overwrite = true;
        if (mutation === "retention") step.with["retention-days"] = 1;
        if (mutation === "missing files")
          step.with["if-no-files-found"] = "warn";
        if (mutation === "mutable name") step.with.name = "latest";
        if (mutation === "path")
          step.with.path = "${{ steps.pack.outputs.tarball }}";
        assert.throws(() => checkPayPublishWorkflow(stringify(workflow)));
      });
  for (const name of [names[0], names[2]])
    for (const mutation of [
      "fold",
      "continuation",
      "unicode",
      "failure swallowed",
      "package",
      "host",
      "context",
      "source",
    ])
      await t.test(`${name}: ${mutation}`, () => {
        const workflow = parse(source);
        const step = workflow.jobs.publish.steps.find(
          (step) => step.name === name,
        );
        if (mutation === "fold") step.run = step.run.replaceAll("\n", " ");
        if (mutation === "continuation")
          step.run = step.run.replaceAll("\n", " \\\n");
        if (mutation === "unicode") step.run = "\u00a0" + step.run;
        if (mutation === "failure swallowed")
          step.run = step.run.trimEnd() + " || true\n";
        if (mutation === "package")
          step.run += "node collector --package @other/pay\n";
        if (mutation === "host")
          step.run += "node collector --registry https://example.invalid\n";
        if (mutation === "context")
          step.run = step.run.replaceAll("pay-checked-package-v1", "other");
        if (mutation === "source")
          step.env.EXPECTED_SOURCE = "${{ github.sha }}";
        assert.throws(() => checkPayPublishWorkflow(stringify(workflow)));
      });
});

test("poll and sole publication remain mandatory successful predecessors", async (t) => {
  for (const name of [
    "Publish only @0xkey-io/pay to npm next",
    "Verify published version and npm tags",
  ])
    for (const mutation of ["disabled", "continue", "noop", "fold"])
      await t.test(`${name} ${mutation}`, () => {
        const workflow = parse(source);
        const step = workflow.jobs.publish.steps.find(
          (step) => step.name === name,
        );
        if (mutation === "disabled") step.if = "${{ false }}";
        if (mutation === "continue") step["continue-on-error"] = true;
        if (mutation === "noop") step.run = "true";
        if (mutation === "fold")
          step.run = "set -euo pipefail " + step.run.replaceAll("\n", " ");
        assert.throws(() => checkPayPublishWorkflow(stringify(workflow)));
      });
  for (const extra of [
    'echo "${{steps.pack.outputs.tarball}}"',
    "pnpm pack",
    'npm "publish" packages/pay',
    "npm dist-tag add @0xkey-io/pay@1.0.0 latest",
  ])
    await t.test(extra, () => {
      const workflow = parse(source);
      workflow.jobs.publish.steps.find(
        (step) => step.name === "Build Pay",
      ).run += `\n${extra}`;
      assert.throws(
        () => checkPayPublishWorkflow(stringify(workflow)),
        undefined,
        "extra tar consumers/pack/publish paths must fail even inside existing steps",
      );
    });
});

test("actual preparation and collector blocks propagate failures, not shell no-op success", () => {
  const workflow = parse(source);
  for (const name of [
    "Prepare checked npm source context",
    "Collect immutable public npm publication receipt",
  ]) {
    const step = workflow.jobs.publish.steps.find((step) => step.name === name);
    const result = spawnSync(
      "/bin/bash",
      ["--noprofile", "--norc", "-c", step.run],
      {
        cwd: "/private/tmp",
        encoding: "utf8",
        env: { PATH: process.env.PATH },
      },
    );
    assert.notEqual(
      result.status,
      0,
      "missing checked inputs must stop before later publication steps",
    );
    const folded = { ...step, run: step.run.replaceAll("\n", " ") };
    const mutated = parse(source);
    mutated.jobs.publish.steps[workflow.jobs.publish.steps.indexOf(step)] =
      folded;
    assert.throws(() => checkPayPublishWorkflow(stringify(mutated)));
  }
});
