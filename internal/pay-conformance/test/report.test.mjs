import assert from "node:assert/strict";
import test from "node:test";
import {
  validateRow,
  mandatoryPassed,
  validateReport,
  writeReport,
} from "../src/report.mjs";
import { readFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../src/redact.mjs";

const blocked = () => ({
  id: "x402-test",
  requirement: "mandatory_local",
  status: "BLOCKED",
  expectedVersions: { "@x402/core": "2.23.0" },
  observedVersions: {},
  sourceSnapshots: {},
  command: [],
  exitCode: null,
  startedAt: null,
  durationMs: 0,
  network: "loopback_no_chain",
  externalMutations: false,
  artifactSha256: null,
  stdoutSha256: null,
  stderrSha256: null,
  evidence: [],
  blocker: {
    probe: "driver-absent",
    expected: "fixtures/x402-2.23/driver.mjs",
    observed: "not-implemented",
    owner: "task-7b",
    remediation: "implement-and-review-driver",
  },
  lifecycle: [],
});

const root = new URL("../", import.meta.url);
const matrix = JSON.parse(await readFile(new URL("matrix.json", root)));
function report() {
  return createBlockedReport();
}

import { createBlockedReport } from "../src/run.mjs";

test("unexecuted rows cannot claim observations, artifacts, evidence or invented prerequisites", () => {
  for (const change of [
    { observedVersions: { "@x402/core": "2.23.0" } },
    { artifactSha256: "a".repeat(64) },
    {
      evidence: [
        { path: "fixtures/capabilities.json", sha256: "b".repeat(64) },
      ],
    },
    {
      blocker: {
        ...report().rows[0].blocker,
        observed: "missing-public-cache",
      },
    },
  ]) {
    const value = report();
    Object.assign(value.rows[0], change);
    assert.throws(() => validateReport(value, matrix), {
      message: "RESULT_REJECTED",
    });
  }
  const value = report();
  value.rows
    .find((row) => row.status === "NOT_APPLICABLE")
    .evidence.push(
      value.rows.find((row) => row.status === "NOT_APPLICABLE").evidence[0],
    );
  assert.throws(() => validateReport(value, matrix), {
    message: "RESULT_REJECTED",
  });
});

test("a blocked mandatory row cannot approve a run and omitted rows cannot vacuously pass", () => {
  validateRow(blocked());
  assert.equal(mandatoryPassed([blocked()]), false);
  assert.equal(mandatoryPassed([]), false);
});

test("all five terminal statuses are distinct; illegal lifecycle jumps cannot pass", () => {
  const executed = {
    ...blocked(),
    status: "PASSED",
    blocker: null,
    observedVersions: { "@x402/core": "2.23.0" },
    command: ["node", "driver.mjs"],
    startedAt: "2026-08-28T00:00:00.000Z",
    exitCode: 0,
    artifactSha256: "a".repeat(64),
    stdoutSha256: "b".repeat(64),
    stderrSha256: "c".repeat(64),
    evidence: [{ path: "rows/control.json", sha256: "b".repeat(64) }],
    lifecycle: [
      "spawned",
      "identified",
      "ready",
      "observed",
      "completed",
      "closed",
    ],
  };
  for (const row of [
    executed,
    { ...executed, status: "FAILED", exitCode: 1 },
    {
      ...executed,
      status: "UNKNOWN",
      exitCode: null,
      lifecycle: ["spawned", "identified", "closed"],
    },
    blocked(),
    {
      ...blocked(),
      status: "NOT_APPLICABLE",
      requirement: "not_applicable",
      blocker: null,
      evidence: [{ path: "capability.json", sha256: "a".repeat(64) }],
    },
  ])
    validateRow(row);
  assert.equal(mandatoryPassed([executed]), true);
  assert.throws(
    () =>
      validateRow({
        ...executed,
        lifecycle: ["spawned", "completed", "closed"],
      }),
    { message: "RESULT_REJECTED" },
  );
});

test("complete matrix cannot be reduced, duplicated, widened or promoted at checkpoint 7A", () => {
  validateReport(report(), matrix);
  for (const mutate of [
    (r) => r.rows.pop(),
    (r) => r.rows.push(r.rows[0]),
    (r) => {
      r.rows[0].extra = true;
    },
    (r) => {
      r.rows[0].status = "PASSED";
    },
    (r) => {
      r.rows[0].expectedVersions = {};
    },
  ]) {
    const value = report();
    mutate(value);
    assert.throws(() => validateReport(value, matrix), {
      message: "RESULT_REJECTED",
    });
  }
  const reduced = structuredClone(matrix);
  reduced.rows.pop();
  const value = report();
  value.rows.pop();
  value.matrixSha256 = sha256(JSON.stringify(reduced));
  assert.throws(() => validateReport(value, reduced), {
    message: "RESULT_REJECTED",
  });
});

test("report publication is atomic, exclusive and verifies actual capability evidence bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pay-report-"));
  const path = join(directory, "result.json");
  const { fileURLToPath } = await import("node:url");
  const outcomes = await Promise.allSettled([
    writeReport(path, report(), matrix, fileURLToPath(root)),
    writeReport(path, report(), matrix, fileURLToPath(root)),
  ]);
  assert.equal(
    outcomes.filter((item) => item.status === "fulfilled").length,
    1,
  );
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  assert.deepEqual(JSON.parse(await readFile(path)), report());
  assert.deepEqual(await readdir(directory), ["result.json"]);
  const altered = report();
  altered.rows.find(
    (row) => row.status === "NOT_APPLICABLE",
  ).evidence[0].sha256 = "f".repeat(64);
  await assert.rejects(
    writeReport(
      join(directory, "bad.json"),
      altered,
      matrix,
      fileURLToPath(root),
    ),
    { message: "RESULT_REJECTED" },
  );
  assert.deepEqual(await readdir(directory), ["result.json"]);
  const bad = report();
  bad.rows.pop();
  await assert.rejects(
    writeReport(
      join(directory, "invalid.json"),
      bad,
      matrix,
      fileURLToPath(root),
    ),
    { message: "RESULT_REJECTED" },
  );
});

test("unknown statuses, unknown keys, missing hashes and unevidenced success are rejected", () => {
  for (const row of [
    { ...blocked(), status: "SKIPPED" },
    { ...blocked(), rawCredential: "secret" },
    { ...blocked(), status: "PASSED", blocker: null },
    { ...blocked(), status: "UNKNOWN", blocker: null },
    { ...blocked(), status: "FAILED", blocker: null },
    { ...blocked(), status: "NOT_APPLICABLE", blocker: null },
  ])
    assert.throws(() => validateRow(row), { message: "RESULT_REJECTED" });
});
