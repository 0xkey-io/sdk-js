import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createDecipheriv, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export async function nativeRecoveryContract(inputPath, profile = "ordinary") {
  assert.ok(["ordinary", "billing"].includes(profile));
  const { input } = await readExecutionInput(inputPath);
  if (profile === "billing" && input.stage !== "development-only") throw new Error("BILLING_RECOVERY_REJECTED");
  const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
  const contract = matrix.rows.find(
    (row) => row.fixture === input.fixture && row.family === "recovery",
  );
  assert.ok(contract, "declared durable recovery row");
  if (profile === "billing") assert.ok(input.fixture.startsWith("mppx-"));
  test(
    contract.id + (profile === "billing" ? " / native billing realm" : ""),
    async () => {
      const directory = join(input.evidence, contract.id);
      await mkdir(directory, { mode: 0o700 });
      const env = await isolatedEnvironment(join(directory, "environment"), {
        path: "/opt/homebrew/bin:/usr/bin:/bin",
        corepackHome: input.corepack,
      });
      const processResult = await runProcess({
        command: [
          process.execPath,
          join(root, contract.driver),
          inputPath,
          contract.id,
          directory,
          ...(profile === "billing" ? ["billing-recovery"] : []),
        ],
        cwd: directory,
        env,
        expectedVersions: contract.expectedVersions,
        timeoutMs: 60000,
      });
      await writeFile(
        join(directory, "process.json"),
        JSON.stringify(processResult, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      assert.equal(
        processResult.status,
        "PASSED",
        "fresh public clients must authenticate and resume the same durable credential after indeterminate outcomes",
      );
      assert.equal(processResult.cleanup.groupAbsent, true);
      const result = JSON.parse(
        await readFile(join(directory, "observation.json")),
      );
      assert.equal(result.row, contract.id);
      assert.equal(result.stage, input.stage);
      assert.equal(result.profile, profile);
      assert.deepEqual(
        result.stages.map((stage) => stage.name),
        [
          "save-before-send-exit",
          "unknown",
          "disconnect",
          "timeout",
          "rejected",
          "missing",
          "malformed",
          "mismatch",
          "rpc-unavailable",
          "rpc-mismatch",
          "proof",
        ],
      );
      assert.equal(new Set(result.stages.map((stage) => stage.pid)).size, 11);
      assert.deepEqual(
        result.stages.map((stage) => stage.counters.sign),
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      );
      assert.deepEqual(
        result.stages.map((stage) => stage.counters.save),
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      );
      assert.deepEqual(
        result.stages.map((stage) => stage.counters.clear),
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
      );
      assert.equal(result.stages[0].counters.signedSend, 0);
      assert.equal(result.stages[0].termination.signal, "SIGKILL");
      assert.equal(
        new Set(result.stages.map((stage) => stage.credentialSha256)).size,
        1,
      );
      assert.equal(
        new Set(
          result.stages.slice(0, -1).map((stage) => stage.ciphertextSha256),
        ).size,
        1,
      );
      assert.equal(result.stages.at(-1).ciphertextSha256, null);
      assert.equal(result.counters.economicEffect, 1);
      assert.equal(result.counters.applicationEffect, 1);
      assert.equal(result.counters.signedSend, 10);
      assert.equal(result.stages.at(-1).counters.rpc, 4);
      assert.equal(result.saveBeforeSend, true);
      assert.equal(result.proofBeforeClear, true);
      if (input.fixture.startsWith("x402")) {
        assert.deepEqual(
          result.roleObservations.merchant.dependencyErrors.map(
            (error) => error.step,
          ),
          ["unknown", "disconnect", "timeout", "rejected"],
        );
        assert.equal(
          result.roleObservations.merchant.dependencyErrors.every(
            (error) => error.owner === "x402-facilitator",
          ),
          true,
        );
        assert.deepEqual(result.roleObservations.merchant.failures, []);
      }
      if (profile === "billing") {
        const bytes = await readFile(
          join(directory, "durable", "recovery-saved.aead"),
        );
        const key = await readFile(join(directory, "durable", "storage.key"));
        const cipher = createDecipheriv(
          "aes-256-gcm",
          key,
          bytes.subarray(0, 12),
        );
        cipher.setAAD(Buffer.from("pay-conformance-v1"));
        cipher.setAuthTag(bytes.subarray(12, 28));
        const record = JSON.parse(
          Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]),
        );
        const require = createRequire(
          join(input.consumer.directory, "package.json"),
        );
        const { Credential } = require("mppx");
        const header = record.payment.headers.find(
          ([name]) => name === "authorization",
        )[1];
        assert.equal(Credential.deserialize(header).challenge.realm, "billing");
        assert.equal(
          createHash("sha256").update(header).digest("hex"),
          result.stages[0].credentialSha256,
        );
        assert.equal(
          createHash("sha256").update(bytes).digest("hex"),
          result.stages[0].ciphertextSha256,
        );
      }
      assert.equal(
        result.ports.every((port) => port.rebound),
        true,
      );
    },
  );
}
