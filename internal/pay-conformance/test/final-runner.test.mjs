import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBlockedReport, createFinal7bPlan } from "../src/run.mjs";
import { createFinal7bUnits, finalOutputAllowed, integrationArguments, recordedCommand, sanitizeFinalEvidence, sanitizeFinalEvidenceRoot, validateCertificateConfig, verifyCertificateHashes, verifyPrivateKeyPair } from "../src/final-runner.mjs";
import { sha256 } from "../src/redact.mjs";
import { validateReport } from "../src/report.mjs";

const matrix = JSON.parse(await readFile(new URL("../matrix.json", import.meta.url)));

test("final 7B plan binds every task-7b row to a closed integration executor", () => {
  const plan = createFinal7bPlan();
  assert.equal(Object.isFrozen(plan), true);
  assert.deepEqual([plan.phase, plan.releaseDecision, plan.rows.length], ["7B", "not_approved", 132]);
  assert.equal(new Set(plan.rows.map(row => row.id)).size, 132);
  assert.equal(plan.rows.every(row => row.owner === "task-7b" && row.integration.startsWith("test/integration/") && row.integration.endsWith(".mjs")), true);
  assert.deepEqual(Object.fromEntries(Object.entries(Object.groupBy(plan.rows, row => row.family)).map(([family, rows]) => [family, rows.length])), {
    "native-direction": 16, fault: 76, recovery: 4, injection: 20, "owner-control": 12, "native-corpus": 4,
  });
  assert.deepEqual(plan.deferred, { "task-7c": 12, "external-operator": 1 });
  const units = createFinal7bUnits(plan);
  assert.equal(units.length, 120);
  assert.equal(units.flatMap(unit => unit.rows).length, 132);
  assert.equal(units.filter(unit => unit.rows.length === 4).length, 4);
  for (const unit of units) {
    const family = plan.rows.find(row => row.id === unit.rows[0]).family;
    assert.equal(integrationArguments(unit, "/input.json").length, ["injection", "owner-control", "native-corpus"].includes(family) ? 4 : 3);
  }
});

test("final report output must remain outside the repository", () => {
  assert.equal(finalOutputAllowed("/repo", "/repo"), false);
  assert.equal(finalOutputAllowed("/repo/evidence", "/repo"), false);
  assert.equal(finalOutputAllowed("/repo-sibling", "/repo"), true);
});

test("final row rejects a substituted child command", () => {
  assert.deepEqual(recordedCommand(["/node", "/driver", "row"], ["/node", "/driver", "row"]), ["/node", "/driver", "row"]);
  assert.throws(() => recordedCommand(["/node", "/driver", "row"], ["/node", "/other", "row"]), /FINAL_CHILD_COMMAND_MISMATCH/);
});

test("final evidence sanitation removes secret material and external symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pay-final-sanitize-"));
  const durable = join(directory, "durable"); await mkdir(durable);
  await writeFile(join(durable, "signer.key"), "private");
  await writeFile(join(durable, "pending.aead"), "ciphertext");
  await writeFile(join(durable, "safe.json"), "{}\n");
  await symlink(tmpdir(), join(directory, "external"));
  assert.deepEqual(await sanitizeFinalEvidence(directory), {
    schemaVersion: "0xkey.pay.evidence-sanitization/v1",
    policy: "no-key-aead-or-symlink",
    removed: { secretFiles: 2, symbolicLinks: 1 },
  });
  for (const path of [join(durable, "signer.key"), join(durable, "pending.aead"), join(directory, "external")])
    await assert.rejects(access(path), { code: "ENOENT" });
  assert.equal(await readFile(join(durable, "safe.json"), "utf8"), "{}\n");
  assert.match(await readFile(join(directory, "sanitization.json"), "utf8"), /no-key-aead-or-symlink/);
});

test("certificate binding rejects substituted public bytes and later mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pay-final-certificates-"));
  const path = join(directory, "leaf.pem"); await writeFile(path, "bound-public-certificate");
  const expected = { "leaf.pem": sha256("bound-public-certificate") };
  await verifyCertificateHashes(directory, expected, "FINAL_CERTIFICATE_HASH");
  await writeFile(path, "substituted-public-certificate");
  await assert.rejects(verifyCertificateHashes(directory, expected, "FINAL_CERTIFICATE_MUTATED"), /FINAL_CERTIFICATE_MUTATED/);
  await assert.rejects(verifyCertificateHashes(directory, { "leaf.pem": "0".repeat(64) }, "FINAL_CERTIFICATE_HASH"), /FINAL_CERTIFICATE_HASH/);
  await assert.rejects(verifyCertificateHashes(directory, expected, "FINAL_CERTIFICATE_COPY"), /FINAL_CERTIFICATE_COPY/);
});

test("certificate binding rejects a private key from another key pair", () => {
  const first = generateKeyPairSync("ed25519"), second = generateKeyPairSync("ed25519");
  verifyPrivateKeyPair(first.privateKey, first.publicKey);
  assert.throws(() => verifyPrivateKeyPair(first.privateKey, second.publicKey), /FINAL_CERTIFICATE_KEY_PAIR/);
});

test("final root closure removes late controller secrets and rejects external links", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pay-final-root-sanitize-"));
  const controller = join(directory, "controller"); await mkdir(controller);
  await writeFile(join(controller, "late.key"), "private");
  await writeFile(join(controller, "late.aead"), "ciphertext");
  await symlink(tmpdir(), join(directory, "late-link"));
  const result = await sanitizeFinalEvidenceRoot(directory);
  assert.deepEqual(result.removed, { secretFiles: 2, symbolicLinks: 1 });
  for (const path of [join(controller, "late.key"), join(controller, "late.aead"), join(directory, "late-link")])
    await assert.rejects(access(path), { code: "ENOENT" });
});

test("row sanitation rejects a root symlink without touching its external target", async () => {
  const evidence = await mkdtemp(join(tmpdir(), "pay-final-root-link-"));
  const external = await mkdtemp(join(tmpdir(), "pay-final-external-"));
  const sentinel = join(external, "sentinel.key"); await writeFile(sentinel, "must-remain");
  const row = join(evidence, "row"); await symlink(external, row);
  await assert.rejects(sanitizeFinalEvidence(row, evidence), /FINAL_EVIDENCE_ROOT/);
  assert.equal(await readFile(sentinel, "utf8"), "must-remain");
});

test("certificate binding refuses a symlinked source member", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pay-final-cert-link-"));
  const external = join(directory, "external"); await writeFile(external, "public");
  await symlink(external, join(directory, "leaf.pem"));
  await assert.rejects(verifyCertificateHashes(directory, { "leaf.pem": sha256("public") }, "FINAL_CERTIFICATE_HASH"), /FINAL_CERTIFICATE_FILE/);
});

test("certificate config accepts order-independent exact names and rejects omissions", () => {
  const names = ["b.pem", "a.pem"], value = { "a.pem": "a".repeat(64), "b.pem": "b".repeat(64) };
  assert.equal(validateCertificateConfig(value, names), undefined);
  assert.throws(() => validateCertificateConfig({ "a.pem": "a".repeat(64) }, names), /FINAL_CERTIFICATE_CONFIG/);
  for (const digest of ["a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64), 1, null])
    assert.throws(() => validateCertificateConfig({ "a.pem": digest, "b.pem": "b".repeat(64) }, names), /FINAL_CERTIFICATE_CONFIG/);
});

test("7B report requires every task-7b row passed and keeps later owners deferred", () => {
  const report = createBlockedReport(); report.phase = "7B";
  for (const row of report.rows) {
    const contract = matrix.rows.find(value => value.id === row.id);
    if (contract.owner === "task-7b") Object.assign(row, { status: "PASSED", observedVersions: structuredClone(row.expectedVersions), command: ["/usr/bin/node", "driver.mjs"], exitCode: 0, startedAt: "2026-09-01T00:00:00.000Z", durationMs: 1, artifactSha256: "1".repeat(64), stdoutSha256: "2".repeat(64), stderrSha256: "3".repeat(64), evidence: [{ path: `rows/${row.id}.json`, sha256: "4".repeat(64) }], blocker: null, lifecycle: ["spawned", "identified", "ready", "observed", "completed", "closed"] });
    else if (contract.owner === "task-7c" && !contract.capabilityEvidence) row.blocker = { probe: "final-7c-not-executed", expected: contract.driver, observed: "not-executed", owner: contract.owner, remediation: "execute-applicable-final-7c" };
  }
  assert.equal(validateReport(report, matrix), report);
  report.rows.find(row => matrix.rows.find(value => value.id === row.id).owner === "task-7b").status = "FAILED";
  assert.throws(() => validateReport(report, matrix), /RESULT_REJECTED/);
});
