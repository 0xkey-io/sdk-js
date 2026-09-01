import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, mkdir, readdir, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readExecutionInput } from "../src/execution-input.mjs";
import { isolatedEnvironment, runProcess } from "../src/process.mjs";

const root = new URL("../", import.meta.url).pathname;

// These real entrypoints must reject billing before inspecting even an absent
// consumer payload/fixture installation, creating evidence, importing a paid client or starting roles.
for (const entry of ["wrapper", "driver"]) {
  for (const fixture of ["mppx-0.8.19", "mppx-0.8.17"]) {
    test(`${entry} rejects final billing recovery before payload reads: ${fixture}`, async () => {
      const directory = await realpath(await mkdtemp(join(tmpdir(), "pay-recovery-")));
      const input = {
        stage: "final-7b", fixture,
        native: join(directory, "empty-native"), certificates: join(directory, "empty-certs"),
        corepack: join(directory, "empty-corepack"), evidence: join(directory, "empty-evidence"),
        consumer: { directory: join(directory, "empty-consumer"), artifact: join(directory, "missing.tgz"), artifactSha256: "1".repeat(64) },
      };
      for (const path of [input.native, input.certificates, input.corepack, input.evidence, input.consumer.directory]) await mkdir(path);
      const inputPath = join(directory, "ordinary-looking-input.json");
      await writeFile(inputPath, JSON.stringify(input));
      const args = entry === "wrapper"
        ? [join(root, "test/integration/native-billing-recovery.mjs"), inputPath]
        : [join(root, `fixtures/${fixture}/driver.mjs`), inputPath, `${fixture}-durable-aead-five-process-recovery`, join(input.evidence, `${fixture}-durable-aead-five-process-recovery`), "billing-recovery"];
      const { NODE_TEST_CONTEXT, ...env } = process.env;
      const result = spawnSync(process.execPath, args, { env, encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /BILLING_RECOVERY_REJECTED/);
      assert.doesNotMatch(result.stderr, /EXECUTION_INPUT_REJECTED|ENOENT/);
      assert.deepEqual(await readdir(input.evidence), []);
      assert.deepEqual(await readdir(input.consumer.directory), []);
    });
  }
}

for (const fixture of ["mppx-0.8.19", "mppx-0.8.17"]) for (const stage of ["development-only", "final-7b"]) {
  test(`ordinary wrapper and driver still reach consumer validation: ${fixture} ${stage}`, async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "pay-recovery-ordinary-")));
    const input = {
      stage, fixture, native: join(directory, "empty-native"), certificates: join(directory, "empty-certs"),
      corepack: join(directory, "empty-corepack"), evidence: join(directory, "evidence"),
      consumer: { directory: join(directory, "empty-consumer"), artifact: join(directory, "missing.tgz"), artifactSha256: "1".repeat(64) },
    };
    for (const path of [input.native, input.certificates, input.corepack, input.evidence, input.consumer.directory]) await mkdir(path);
    // Selection must not come from a misleading filename.
    const inputPath = join(directory, "billing-looking-input.json");
    await writeFile(inputPath, JSON.stringify(input));
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const wrapper = spawnSync(process.execPath, [join(root, "test/integration/native-recovery.mjs"), inputPath], { env, encoding: "utf8", timeout: 10000 });
    assert.equal(wrapper.status, 1);
    assert.doesNotMatch(wrapper.stdout + wrapper.stderr, /BILLING_RECOVERY_REJECTED/);
    const row = fixture + "-durable-aead-five-process-recovery", rowDirectory = join(input.evidence, row);
    const processResult = JSON.parse(await readFile(join(rowDirectory, "process.json")));
    assert.equal(processResult.status, "FAILED");
    assert.equal(processResult.cleanup.groupAbsent, true);
    const driver = spawnSync(process.execPath, [join(root, `fixtures/${fixture}/driver.mjs`), inputPath, row, rowDirectory], { env, encoding: "utf8", timeout: 10000 });
    assert.equal(driver.status, 1);
    assert.equal(driver.stdout, "");
    assert.match(driver.stderr, /ENOENT/);
    assert.match(driver.stderr, /missing\.tgz/);
    assert.match(driver.stderr, /consumer\.mjs/);
    assert.doesNotMatch(driver.stderr, /BILLING_RECOVERY_REJECTED/);
    assert.equal(processResult.stderr.sha256, createHash("sha256").update(driver.stderr).digest("hex"));
    assert.deepEqual((await readdir(rowDirectory)).sort(), ["environment", "process.json"]);
  });
}

// Explicit retained provisioning is required for these real driver failures;
// the default foundation run never installs or selects an ambient consumer.
if (process.argv[2]) for (const profile of ["ordinary", "billing"]) {
  test(`actual ${profile} recovery failure retains its selected row/stage/profile`, async () => {
    const { input } = await readExecutionInput(process.argv[2]);
    assert.ok(input.fixture.startsWith("mppx-"));
    const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
    const contract = matrix.rows.find(row => row.fixture === input.fixture && row.family === "recovery");
    const owned = await realpath(await mkdtemp(join(tmpdir(), "pay-recovery-failure-")));
    const certificates = join(owned, "empty-certs"), evidence = join(owned, "evidence");
    await mkdir(certificates); await mkdir(evidence);
    const inputPath = join(owned, "input.json");
    await writeFile(inputPath, JSON.stringify({ ...input, certificates, evidence }));
    const directory = join(evidence, contract.id);
    await mkdir(directory);
    const env = await isolatedEnvironment(join(directory, "environment"), { path: "/opt/homebrew/bin:/usr/bin:/bin", corepackHome: input.corepack });
    const result = await runProcess({ command: [process.execPath, join(root, contract.driver), inputPath, contract.id, directory, ...(profile === "billing" ? ["billing-recovery"] : [])], cwd: directory, env, expectedVersions: contract.expectedVersions, timeoutMs: 60000 });
    await writeFile(join(directory, "process.json"), JSON.stringify(result, null, 2));
    assert.equal(result.status, "FAILED");
    assert.equal(result.cleanup.groupAbsent, true);
    const failure = JSON.parse(await readFile(join(directory, "failure.json")));
    assert.match(failure.failure, /^[a-f0-9]{64}$/);
    assert.equal(failure.profile, profile);
    assert.equal(failure.row, contract.id);
    assert.equal(failure.stage, input.stage);
    assert.equal(failure.scope, "recovery");
    assert.deepEqual(failure.stages, []);
    assert.deepEqual(failure.ports, []);
  });
}
