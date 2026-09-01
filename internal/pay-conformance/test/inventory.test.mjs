import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyInventory, createBlockedReport } from "../src/run.mjs";
import { validateReport } from "../src/report.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
test("portable exact inputs verify without any reference clones or installed runtimes", async () => {
  const copy = await mkdtemp(join(tmpdir(), "pay-inventory-"));
  await cp(join(root, "fixtures"), join(copy, "fixtures"), { recursive: true });
  await cp(join(root, "licenses"), join(copy, "licenses"), { recursive: true });
  const result = await verifyInventory(copy);
  assert.equal(result.fixtureCount, 11);
  assert.equal(result.inputCount, 24);
  assert.equal(result.stagedInputs.length, 1);
  const lock = join(copy, "fixtures/x402-2.22/pnpm-lock.yaml");
  await writeFile(
    lock,
    (await readFile(lock, "utf8")).replace("2.22.0", "2.23.0"),
  );
  await assert.rejects(verifyInventory(copy), {
    message: "INPUT_INTEGRITY_MISMATCH",
  });
});

test("7A creates the entire declared matrix with implementation blockers, not a success", async () => {
  const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
  const report = createBlockedReport();
  validateReport(report, matrix);
  assert.equal(report.rows.length, 145);
  assert.equal(
    report.rows.filter((row) => row.status === "NOT_APPLICABLE").length,
    3,
  );
  assert.equal(
    report.rows.filter((row) => row.status === "BLOCKED").length,
    142,
  );
  assert.equal(
    report.rows.some((row) => row.status === "PASSED"),
    false,
  );
});

test("CLI writes an immutable non-approved report and returns nonzero; it cannot execute arbitrary arguments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pay-inventory-cli-"));
  const output = join(directory, "report.json");
  const execute = promisify(execFile);
  await assert.rejects(
    execute(process.execPath, [join(root, "src/run.mjs"), "--output", output]),
    (error) =>
      error.code === 1 &&
      !error.stderr &&
      JSON.parse(error.stdout).status === "BLOCKED",
  );
  const first = await readFile(output);
  await assert.rejects(
    execute(process.execPath, [join(root, "src/run.mjs"), "--output", output]),
    (error) =>
      error.code === 1 &&
      !error.stderr &&
      JSON.parse(error.stdout).status === "FAILED",
  );
  assert.deepEqual(await readFile(output), first);
  await assert.rejects(
    execute(process.execPath, [
      join(root, "src/run.mjs"),
      "--command",
      "publish",
    ]),
    (error) => error.code === 1 && !error.stderr,
  );
  await assert.rejects(
    execute(process.execPath, [
      join(root, "src/run.mjs"),
      "--output",
      join(root, "must-not-write.json"),
    ]),
    (error) =>
      error.code === 1 &&
      !error.stderr &&
      JSON.parse(error.stdout).status === "FAILED",
  );
  await assert.rejects(readFile(join(root, "must-not-write.json")), {
    code: "ENOENT",
  });
});

test("license tampering is rejected, not accepted merely because a file remains nonempty", async () => {
  const copy = await mkdtemp(join(tmpdir(), "pay-license-"));
  await cp(join(root, "fixtures"), join(copy, "fixtures"), { recursive: true });
  await cp(join(root, "licenses"), join(copy, "licenses"), { recursive: true });
  await writeFile(join(copy, "licenses/x402-LICENSE"), "wrong-license");
  await assert.rejects(verifyInventory(copy), {
    message: "INPUT_INTEGRITY_MISMATCH",
  });
});
