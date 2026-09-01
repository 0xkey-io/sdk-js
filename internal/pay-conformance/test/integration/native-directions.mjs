import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { verifyInventory } from "../../src/run.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inputPath = process.argv[2];
const { input } = await readExecutionInput(inputPath);
const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
await verifyInventory(root, { consumer: input.consumer });
for (const contract of matrix.rows.filter(row => row.fixture === input.fixture && row.family === "native-direction")) {
  test(contract.id, async () => {
    const directory = join(input.evidence, contract.id);
    await mkdir(directory, { mode: 0o700 });
    const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
    const result = await runProcess({
      command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory],
      cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 30000,
    });
    await writeFile(join(directory, "process.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    assert.equal(result.status, "PASSED", "real public 402/sign/retry/receipt exchange must complete");
    assert.equal(result.cleanup.groupAbsent, true);
    const observed = JSON.parse(await readFile(join(directory, "observation.json")));
    assert.equal(observed.row, contract.id);
    assert.equal(observed.artifactSha256, input.consumer.artifactSha256);
    assert.equal(observed.scope, "native-direction");
    assert.equal(observed.status, 200);
    assert.equal(observed.receiptValid, true);
    assert.equal(observed.credentialSha256.length, 64);
    assert.equal(observed.counters.sign, 1);
    assert.equal(observed.counters.signedSend, 1);
    assert.equal(observed.counters.settle, 1);
    assert.equal(observed.counters.economicEffect, 1);
    assert.equal(observed.counters.handler, 1);
    assert.equal(observed.counters.applicationEffect, 1);
    assert.equal(observed.counters.challenge, 1);
    const payBuyer = contract.id.includes("pay-buyer-to-official");
    assert.equal(observed.counters.save, payBuyer ? 1 : 0);
    assert.equal(observed.counters.clear, payBuyer ? 1 : 0);
    assert.equal(observed.counters.rpc, payBuyer ? 4 : 0);
    assert.equal(observed.counters.fulfillment, payBuyer ? 0 : 1);
    assert.equal(new Set(observed.roles.map(role => role.pid)).size, 3);
    assert.equal(observed.roles.every(role => role.identifiedBeforeIo), true);
    assert.equal(observed.ports.length, 2);
    assert.equal(observed.ports.every(port => port.rebound), true);
    assert.equal(observed.tls.every(control => control.trusted && control.wrongCaRejected), true);
  });
}
