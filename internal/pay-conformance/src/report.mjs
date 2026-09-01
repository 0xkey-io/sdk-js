import Ajv from "ajv";
import { readFile, open, link, unlink, realpath } from "node:fs/promises";
import { dirname, basename, join, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { sha256 } from "./redact.mjs";

const schema = JSON.parse(
  await readFile(
    new URL("../schema/result.schema.json", import.meta.url),
    "utf8",
  ),
);
const committedMatrix = JSON.parse(
  await readFile(new URL("../matrix.json", import.meta.url), "utf8"),
);
const valid = new Ajv({ strict: true }).compile(schema);
const reject = () => {
  throw new Error("RESULT_REJECTED");
};
const phases = [
  "spawned",
  "identified",
  "ready",
  "observed",
  "completed",
  "closed",
];

export function validateRow(row) {
  if (!valid(row)) reject();
  let previous = -1;
  for (const phase of row.lifecycle) {
    const position = phases.indexOf(phase);
    if (position <= previous || (phase === "completed" && previous < 3))
      reject();
    previous = position;
  }
  const executed = row.startedAt !== null;
  if (executed) {
    if (
      !row.command.length ||
      !row.stdoutSha256 ||
      !row.stderrSha256 ||
      !row.evidence.length ||
      row.lifecycle[0] !== "spawned"
    )
      reject();
  } else if (
    row.command.length ||
    row.exitCode !== null ||
    row.durationMs !== 0 ||
    row.stdoutSha256 ||
    row.stderrSha256 ||
    row.lifecycle.length ||
    row.artifactSha256 ||
    Object.keys(row.observedVersions).length
  )
    reject();
  if (row.status === "PASSED") {
    if (
      !executed ||
      row.exitCode !== 0 ||
      !row.artifactSha256 ||
      row.blocker ||
      !isDeepStrictEqual(row.lifecycle, phases) ||
      !isDeepStrictEqual(row.expectedVersions, row.observedVersions)
    )
      reject();
  } else if (row.status === "FAILED" || row.status === "UNKNOWN") {
    if (!executed || row.blocker) reject();
  } else if (row.status === "BLOCKED") {
    if (!row.blocker || executed) reject();
  } else if (row.status === "NOT_APPLICABLE") {
    if (
      executed ||
      row.blocker ||
      !row.evidence.length ||
      row.requirement !== "not_applicable"
    )
      reject();
  }
  return row;
}

export function mandatoryPassed(rows) {
  rows.forEach(validateRow);
  const mandatory = rows.filter((row) =>
    row.requirement.startsWith("mandatory_"),
  );
  return (
    mandatory.length > 0 && mandatory.every((row) => row.status === "PASSED")
  );
}

export function validateReport(report, matrix) {
  if (
    !isDeepStrictEqual(matrix, committedMatrix) ||
    matrix.rows.length !== matrix.expectedRowCount
  )
    reject();
  if (
    !report ||
    Object.keys(report).sort().join() !==
      "matrixSha256,phase,releaseDecision,rows,schemaVersion" ||
    report.schemaVersion !== "0xkey.pay.conformance/v1" ||
    !["7A", "7B"].includes(report.phase) ||
    report.releaseDecision !== "not_approved" ||
    report.matrixSha256 !== sha256(JSON.stringify(matrix)) ||
    !Array.isArray(report.rows)
  )
    reject();
  const ids = report.rows.map((row) => row.id);
  if (
    new Set(ids).size !== ids.length ||
    !isDeepStrictEqual([...ids].sort(), matrix.rows.map((row) => row.id).sort())
  )
    reject();
  for (const row of report.rows) {
    validateRow(row);
    const contract = matrix.rows.find((item) => item.id === row.id);
    if (
      row.requirement !== contract.requirement ||
      !isDeepStrictEqual(row.expectedVersions, contract.expectedVersions) ||
      !isDeepStrictEqual(row.sourceSnapshots, contract.sourceSnapshots)
    )
      reject();
    if (report.phase === "7B" && contract.owner === "task-7b") {
      if (row.status !== "PASSED") reject();
      continue;
    }
    // 7A has no executors; 7B cannot promote deferred 7C/external rows.
    if (!["BLOCKED", "NOT_APPLICABLE"].includes(row.status)) reject();
    if (contract.capabilityEvidence) {
      if (
        row.status !== "NOT_APPLICABLE" ||
        !isDeepStrictEqual(row.evidence, [contract.capabilityEvidence])
      )
        reject();
    } else {
      const external = contract.requirement === "external";
      const finalDeferred = report.phase === "7B" && contract.owner === "task-7c";
      const blocker = {
        probe: external ? "authorized-environment-absent" : finalDeferred ? "final-7c-not-executed" : "driver-not-implemented",
        expected: contract.driver,
        observed: external || finalDeferred ? "not-executed" : "not-implemented",
        owner: contract.owner,
        remediation: external ? "authorized-operator-required" : finalDeferred ? "execute-applicable-final-7c" : "implement-and-review-driver",
      };
      if (
        row.status !== "BLOCKED" ||
        row.evidence.length ||
        !isDeepStrictEqual(row.blocker, blocker)
      )
        reject();
    }
  }
  return report;
}

export async function writeReport(path, report, matrix, evidenceRoot) {
  validateReport(report, matrix);
  if (!isAbsolute(path) || !isAbsolute(evidenceRoot)) reject();
  const root = await realpath(evidenceRoot);
  for (const row of report.rows) {
    const contract = matrix.rows.find((item) => item.id === row.id);
    for (const item of row.evidence) {
      const location = await realpath(resolve(root, item.path));
      if (
        !location.startsWith(root + "/") ||
        sha256(await readFile(location)) !== item.sha256 ||
        (row.status === "NOT_APPLICABLE" &&
          !isDeepStrictEqual(item, contract.capabilityEvidence))
      )
        reject();
    }
  }
  const directory = await realpath(dirname(path));
  const target = join(directory, basename(path));
  const draft = join(directory, ".pay-report-" + randomUUID());
  // Exclusive same-filesystem link publishes complete fsynced bytes without
  // rename's overwrite behavior, including when two writers race.
  try {
    const file = await open(draft, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(report, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    await link(draft, target);
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  } finally {
    try {
      await unlink(draft);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return sha256(await readFile(target));
}
