import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { createHash, createDecipheriv } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess, isolatedEnvironment } from "../../src/process.mjs";
import { readExecutionInput } from "../../src/execution-input.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
export async function nativeRealmContract(inputPath, profile) {
  assert.ok(["x402", "billing"].includes(profile));
  const { input } = await readExecutionInput(inputPath);
  assert.ok(["mppx-0.8.19", "mppx-0.8.17"].includes(input.fixture));
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const matrix = JSON.parse(await readFile(join(root, "matrix.json")));
  // Genuine native realm is a protection-space label, not a protocol selector.
  // Dropping its MPP offer or making a second signature must fail this boundary.
  test(
    input.fixture +
      (profile === "x402"
        ? " accepts a genuine MPP realm coincident with x402"
        : " accepts a genuine MPP realm equal to billing"),
    async (t) => {
      const row = matrix.rows.find(
          (row) => row.id === input.fixture + "-protocol-freeze",
        ),
        directory = join(input.evidence, row.id);
      await mkdir(directory, { mode: 0o700 });
      const env = await isolatedEnvironment(join(directory, "environment"), {
        path: "/opt/homebrew/bin:/usr/bin:/bin",
        corepackHome: input.corepack,
      });
      const run = await runProcess({
        command: [
          process.execPath,
          join(root, row.driver),
          inputPath,
          row.id,
          directory,
          profile === "billing" ? "billing-controls" : "realm-controls",
        ],
        cwd: directory,
        env,
        expectedVersions: row.expectedVersions,
        timeoutMs: 60000,
      });
      await writeFile(
        join(directory, "realm.process.json"),
        JSON.stringify(run, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
      assert.equal(
        run.status,
        "PASSED",
        "ordinary and genuine coincident native MPP realms must both succeed",
      );
      assert.deepEqual(run.cleanup, { groupAbsent: true, forced: false });
      const observed = JSON.parse(
        await readFile(join(directory, "realm-observations.json")),
      );
      assert.equal(observed.coverage, "partial");
      assert.equal(observed.aggregateStatus, "BLOCKED");
      assert.equal(observed.scope, "realm-controls-slice");
      assert.deepEqual(
        observed.subcases.map((item) => [item.profile, item.condition]),
        [
          ["ordinary", "import"],
          ["ordinary", "require"],
          [profile, "import"],
          [profile, "require"],
        ],
      );
      await assert.rejects(access(join(directory, "observation.json")), {
        code: "ENOENT",
      });
      for (const item of observed.subcases)
        await t.test(item.profile + "/" + item.condition, async () => {
          assert.equal(item.status, "PASSED");
          assert.equal(item.buyer.error, null);
          assert.deepEqual(item.buyer.preference, ["mpp"]);
          assert.equal(item.buyer.pending, false);
          assert.equal(item.buyer.receiptValid, true);
          assert.equal(item.buyer.status, 200);
          assert.deepEqual(
            [item.buyer.saveAttempts, item.buyer.clearAttempts],
            [1, 1],
          );
          assert.deepEqual(
            [
              item.counters.sign,
              item.counters.save,
              item.counters.signedSend,
              item.counters.settle,
              item.counters.handler,
              item.counters.economicEffect,
              item.counters.applicationEffect,
              item.counters.clear,
              item.counters.rpc,
            ],
            [1, 1, 1, 1, 1, 1, 1, 1, 4],
          );
          assert.equal(item.counters.supported, 0);
          assert.equal(item.counters.verify, 0);
          assert.equal(item.roles.length, 3);
          assert.equal(
            item.roles.every(
              (role) =>
                role.identifiedBeforeIo &&
                role.inventory.every(
                  (entry) => entry.condition === item.condition,
                ),
            ),
            true,
          );
          assert.equal(item.ports.length, 2);
          assert.equal(
            item.ports.every((port) => port.rebound),
            true,
          );
          assert.equal(
            item.tls.every((tls) => tls.trusted && tls.wrongCaRejected),
            true,
          );
          assert.equal(
            item.diagnostics.every(
              (role) => !role.stdout.bytes && !role.stderr.bytes,
            ),
            true,
          );
          const offer = item.merchant.realmOffers[0];
          assert.equal(item.merchant.realmOffers.length, 1);
          assert.equal(
            offer.realm,
            item.profile === "ordinary" ? "127.0.0.1" : profile,
          );
          assert.equal(offer.method, "evm");
          assert.equal(offer.intent, "charge");
          assert.equal(offer.amount, "10000");
          assert.equal(offer.network, "eip155:84532");
          assert.equal(offer.headerSha256, item.buyer.offers[0].headerSha256);
          assert.equal(offer.urlSha256, item.buyer.offers[0].urlSha256);
          assert.equal(item.buyer.offers[0].x402Present, false);
          assert.deepEqual(
            item.merchant.realmArrivals.map((value) => value.protocol),
            [null, "mpp"],
          );
          assert.equal(
            item.facilitator.realmPrivateArrivals.every(
              (value) => value.wireProtocol === "mpp",
            ),
            true,
          );
          assert.deepEqual(
            item.facilitator.realmPrivateArrivals.map((value) => value.path),
            ["/v1/settlements/charge"],
          );
          for (const name of ["mppx/server", "mppx"])
            assert.equal(
              item.roles
                .find((role) => role.role === "merchant")
                .inventory.some(
                  (entry) =>
                    entry.name === name &&
                    entry.entry.startsWith(input.native + "/node_modules/") &&
                    entry.version === input.fixture.slice(5),
                ),
              true,
            );
          const store = join(
              directory,
              item.profile + "-" + item.condition,
              "durable",
            ),
            bytes = await readFile(join(store, "realm-saved.aead")),
            key = await readFile(join(store, "storage.key"));
          assert.equal(hash(bytes), item.buyer.saved.ciphertextSha256);
          assert.equal(hash(key), item.buyer.saved.keySha256);
          const decipher = createDecipheriv(
            "aes-256-gcm",
            key,
            bytes.subarray(0, 12),
          );
          decipher.setAAD(Buffer.from("pay-conformance-v1"));
          decipher.setAuthTag(bytes.subarray(12, 28));
          const record = JSON.parse(
            Buffer.concat([
              decipher.update(bytes.subarray(28)),
              decipher.final(),
            ]),
          );
          const { requestDigest, ...unsigned } = record.payment;
          assert.equal(requestDigest, "0x" + hash(JSON.stringify(unsigned)));
          assert.equal(record.digest, requestDigest);
          assert.equal(record.payment.protocolId, "mpp-evm-charge-v0");
          assert.equal(record.payment.network, "eip155:84532");
          assert.equal(
            record.payment.economicEffectDigest,
            "0x" + item.buyer.saved.economicSha256,
          );
          assert.equal(
            hash(
              record.payment.headers.find(
                ([name]) => name === "authorization",
              )[1],
            ),
            item.buyer.sent[0].credentialSha256,
          );
          await assert.rejects(access(join(store, "pending.aead")), {
            code: "ENOENT",
          });
        });
      const ordinary = observed.subcases.filter(
          (item) => item.profile === "ordinary",
        ),
        coincident = observed.subcases.filter(
          (item) => item.profile === profile,
        );
      assert.ok(
        Math.max(...ordinary.map((item) => Date.parse(item.completedAt))) <=
          Math.min(...coincident.map((item) => Date.parse(item.startedAt))),
      );
      assert.equal(
        new Set(observed.subcases.map((item) => item.buyer.saved.keySha256))
          .size,
        4,
      );
    },
  );
}
