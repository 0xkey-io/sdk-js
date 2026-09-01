import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
import { currentMalformedAmbiguousOfferCases, resolveFinalMalformedAmbiguousOfferProfile } from "../../src/ipc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2], { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
const row = `${input.fixture}-malformed-ambiguous-offer`, profile = resolveFinalMalformedAmbiguousOfferProfile(input.fixture, row, input.stage);

test(input.fixture + " final malformed and ambiguous offer aggregate", async t => {
  const contract = matrix.rows.find(item => item.id === row), directory = join(input.evidence, contract.id); await mkdir(directory, { mode: 0o700 });
  const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
  const run = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, "malformed-ambiguous-offer-controls"], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
  await writeFile(join(directory, "malformed-ambiguous-offer.process.json"), JSON.stringify(run, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  assert.equal(run.status, "PASSED"); assert.equal(run.cleanup.groupAbsent, true);
  const observed = JSON.parse(await readFile(join(directory, "observation.json")));
  assert.deepEqual([observed.coverage, observed.aggregateStatus, observed.stage], ["complete", "PASSED", "final-7b"]); assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
  assert.deepEqual(observed.catalog, currentMalformedAmbiguousOfferCases[profile.protocol]);
  assert.deepEqual(observed.malformedOfferContract, { protocol: profile.protocol, owner: profile.owner, version: profile.version, corpusExcluded: profile.protocol === "mpp" });
  const expected = Object.entries(profile.catalog).flatMap(([path, ids]) => ids.flatMap(caseId => ["import", "require"].map(condition => [path, caseId, condition])));
  assert.deepEqual(observed.subcases.map(value => [value.path, value.caseId, value.condition]), expected); assert.equal(observed.subcases.length, profile.protocol === "x402" ? 24 : 22);
  for (const subcase of observed.subcases) await t.test(`${subcase.path}/${subcase.caseId}/${subcase.condition}`, () => {
    assert.equal(subcase.status, "PASSED"); assert.ok(subcase.counters);
    if (subcase.path === "decoder") {
      assert.equal(subcase.phases.length, 2); assert.deepEqual(subcase.phases.map(phase => phase.stage), ["negative", "positive"]);
      for (const phase of subcase.phases) { assert.equal(phase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true); assert.equal(phase.ports.every(port => port.rebound), true); assert.equal(phase.tls.every(control => control.trusted && control.wrongCaRejected), true); assert.equal(phase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true); }
      return;
    }
    assert.equal(subcase.roles.every(role => role.identifiedBeforeIo && role.inventory.every(entry => entry.condition === subcase.condition)), true);
    assert.equal(subcase.ports.every(port => port.rebound), true); assert.equal(subcase.tls.every(control => control.trusted && control.wrongCaRejected), true);
    assert.equal(subcase.diagnostics.every(role => role.stdout.bytes === 0 && role.stderr.bytes === 0), true);
  });
});
