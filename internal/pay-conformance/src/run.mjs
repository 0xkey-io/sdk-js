import { isDeepStrictEqual } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import { join, isAbsolute, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256 } from "./redact.mjs";
import { writeReport } from "./report.mjs";
import { materializeConsumer, verifyConsumer } from "./consumer.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const inventory = JSON.parse(
  await readFile(join(root, "fixtures/inventory.json")),
);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));

function finalIntegration(contract) {
  if (contract.family === "native-direction") return "test/integration/native-directions.mjs";
  if (contract.family === "recovery") return "test/integration/native-recovery.mjs";
  if (["injection", "owner-control"].includes(contract.family)) return "test/integration/native-framework-final.mjs";
  if (contract.family === "native-corpus") return "test/integration/native-mpp-malformed-corpus-final.mjs";
  if (contract.family !== "fault") throw new Error("FINAL_EXECUTOR_MISSING");
  const family = contract.id.slice(contract.fixture.length + 1);
  if (["asset-mismatch", "payee-mismatch", "amount-mismatch", "unsupported-authorization"].includes(family) && contract.fixture.startsWith("mppx-"))
    return `test/integration/native-mpp-${family}.mjs`;
  const exact = {
    "network-mismatch": "native-network-mismatch.mjs",
    "asset-mismatch": "native-asset-mismatch.mjs",
    "payee-mismatch": "native-payee-mismatch.mjs",
    "amount-mismatch": "native-amount-mismatch.mjs",
    "unsupported-authorization": "native-unsupported-authorization.mjs",
    "supported-failure": "native-supported-final.mjs",
    "malformed-ambiguous-offer": "native-malformed-ambiguous-offer-final.mjs",
    "temporal-validity": "native-temporal-validity-final.mjs",
  }[family] ?? `native-${family}-final.mjs`;
  return `test/integration/${exact}`;
}

export function createFinal7bPlan() {
  const rows = matrix.rows.filter(row => row.owner === "task-7b").map(row => Object.freeze({
    id: row.id,
    fixture: row.fixture,
    family: row.family,
    owner: row.owner,
    integration: finalIntegration(row),
  }));
  if (rows.length !== 132 || new Set(rows.map(row => row.id)).size !== 132) throw new Error("FINAL_PLAN_REJECTED");
  return Object.freeze({ phase: "7B", releaseDecision: "not_approved", rows: Object.freeze(rows), deferred: Object.freeze({ "task-7c": 12, "external-operator": 1 }) });
}

export function assertLoopbackUrl(value) {
  // Literal loopback only. In particular, URL normalization must not turn a
  // DNS name, integer host or shortened IPv4 spelling into an approved target.
  if (
    typeof value !== "string" ||
    !/^https:\/\/(127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?(?:\/|$)/.test(
      value,
    ) ||
    /[\s\\#]/.test(value)
  ) {
    throw new Error("TRANSPORT_TARGET_REJECTED");
  }
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) throw new Error();
    return url;
  } catch {
    throw new Error("TRANSPORT_TARGET_REJECTED");
  }
}

export function assertVersions(expected, observed) {
  if (!isDeepStrictEqual(expected, observed))
    throw new Error("VERSION_MISMATCH");
}

export async function verifyInventory(directory = root, bindings = {}) {
  if (!isDeepStrictEqual(Object.keys(bindings), []) && !isDeepStrictEqual(Object.keys(bindings), ["consumer"]))
    throw new Error("INPUT_BINDING_REJECTED");
  const candidate = JSON.parse(
    await readFile(join(directory, "fixtures/inventory.json")),
  );
  if (!isDeepStrictEqual(candidate, inventory))
    throw new Error("INPUT_INVENTORY_MISMATCH");
  const base = await realpath(directory);
  let inputCount = 0;
  for (const fixture of candidate.fixtures)
    for (const input of fixture.inputs) {
      const file = await realpath(join(base, input.path));
      if (
        !file.startsWith(base + "/") ||
        sha256(await readFile(file)) !== input.sha256
      )
        throw new Error("INPUT_INTEGRITY_MISMATCH");
      inputCount++;
    }
  for (const upstream of candidate.upstreams)
    for (const license of upstream.licenseFiles) {
      const location = await realpath(join(base, license.path));
      if (
        !location.startsWith(base + "/") ||
        sha256(await readFile(location)) !== license.sha256
      )
        throw new Error("INPUT_INTEGRITY_MISMATCH");
    }
  for (const input of candidate.consumerTemplate.inputs) {
    const file = await realpath(join(base, input.path));
    if (!file.startsWith(base + "/") || sha256(await readFile(file)) !== input.sha256)
      throw new Error("INPUT_INTEGRITY_MISMATCH");
  }
  const consumer = Object.hasOwn(bindings, "consumer") ? await verifyConsumer(bindings.consumer) : undefined;
  return {
    fixtureCount: candidate.fixtures.length,
    inputCount,
    stagedInputs: candidate.fixtures.flatMap((fixture) => fixture.stagedInputs),
    ...(consumer ? { consumer } : {}),
  };
}

export function createBlockedReport() {
  return {
    schemaVersion: "0xkey.pay.conformance/v1",
    phase: "7A",
    releaseDecision: "not_approved",
    matrixSha256: sha256(JSON.stringify(matrix)),
    rows: matrix.rows.map((contract) => ({
      id: contract.id,
      requirement: contract.requirement,
      status: contract.capabilityEvidence ? "NOT_APPLICABLE" : "BLOCKED",
      expectedVersions: structuredClone(contract.expectedVersions),
      observedVersions: {},
      sourceSnapshots: structuredClone(contract.sourceSnapshots),
      command: [],
      exitCode: null,
      startedAt: null,
      durationMs: 0,
      network: "loopback_no_chain",
      externalMutations: false,
      artifactSha256: null,
      stdoutSha256: null,
      stderrSha256: null,
      evidence: contract.capabilityEvidence
        ? [structuredClone(contract.capabilityEvidence)]
        : [],
      blocker: contract.capabilityEvidence
        ? null
        : {
            probe:
              contract.requirement === "external"
                ? "authorized-environment-absent"
                : "driver-not-implemented",
            expected: contract.driver,
            observed:
              contract.requirement === "external"
                ? "not-executed"
                : "not-implemented",
            owner: contract.owner,
            remediation:
              contract.requirement === "external"
                ? "authorized-operator-required"
                : "implement-and-review-driver",
          },
      lifecycle: [],
    })),
  };
}

async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(
      "Usage: node src/run.mjs --output /absolute/new-report.json\n       node src/run.mjs --final-7b /absolute/config.json --output /absolute/new-report.json\n7A records implementation blockers only. Final 7B executes the closed local driver plan and retains releaseDecision:not_approved.",
    );
    return;
  }
  try {
    if (args.length === 4 && args[0] === "--final-7b" && isAbsolute(args[1]) && args[2] === "--output" && isAbsolute(args[3])) {
      const { executeFinal7b } = await import("./final-runner.mjs");
      console.log(JSON.stringify(await executeFinal7b({ plan: createFinal7bPlan(), configPath: args[1], outputPath: args[3] })));
      return;
    }
    if (args.length === 2 && args[0] === "--prepare-consumer" && isAbsolute(args[1])) {
      await verifyInventory();
      const binding = JSON.parse(await readFile(args[1]));
      const identity = await materializeConsumer(binding);
      console.log(JSON.stringify({ status: "PREPARED", installed: false, ...identity, releaseDecision: "not_approved" }));
      return;
    }
    if (args.length !== 2 || args[0] !== "--output" || !isAbsolute(args[1]))
      throw new Error();
    // Runtime evidence must not become a tracked harness input.
    const parent = await realpath(dirname(args[1]));
    const repository = await realpath(resolve(root, "../.."));
    if (parent === repository || parent.startsWith(repository + "/"))
      throw new Error();
    const inputs = await verifyInventory();
    const report = createBlockedReport();
    const reportSha256 = await writeReport(args[1], report, matrix, root);
    console.log(
      JSON.stringify({
        status: "BLOCKED",
        phase: "7A",
        rows: report.rows.length,
        inputCount: inputs.inputCount,
        reportSha256,
        releaseDecision: "not_approved",
      }),
    );
  } catch {
    // Never print filesystem, schema, dependency, argv or raw diagnostic text.
    console.log(
      JSON.stringify({
        status: "FAILED",
        reason: "PREFLIGHT_OR_OUTPUT_REJECTED",
        releaseDecision: "not_approved",
      }),
    );
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.argv.slice(2));
