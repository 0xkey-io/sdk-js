import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUatApp } from "./app.js";
import { createFilePendingPaymentStore } from "./file-store.js";

const payTo = "0x00000000000000000000000000000000000000aa";
const handle = createUatApp({
  ZEROXKEY_ORGANIZATION_ID: "00000000-0000-0000-0000-000000000001",
  ZEROXKEY_PAY_TO: payTo,
  ZEROXKEY_PUBLIC_KEY: "02".padEnd(66, "1"),
  ZEROXKEY_PRIVATE_KEY: "1".repeat(64),
  MPP_SECRET_KEY: "uat-smoke-secret-is-at-least-32-bytes",
});

const response = await handle(new Request("https://pay-uat.example/paid/ping"));
assert.equal(response.status, 402);
assert.match(response.headers.get("www-authenticate") ?? "", /^Payment /);

const encodedX402 = response.headers.get("payment-required");
assert.ok(encodedX402, "PAYMENT-REQUIRED challenge is missing");
const challenge = JSON.parse(
  Buffer.from(encodedX402, "base64").toString("utf8"),
) as {
  accepts: Array<{
    amount: string;
    asset: string;
    network: string;
    payTo: string;
    scheme: string;
  }>;
  x402Version: number;
};
assert.equal(challenge.x402Version, 2);
assert.equal(challenge.accepts.length, 1);
const accepted = challenge.accepts[0];
assert.equal(accepted?.amount, "1000");
assert.equal(
  accepted?.asset.toLowerCase(),
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
);
assert.equal(accepted?.network, "eip155:84532");
assert.equal(accepted?.payTo.toLowerCase(), payTo.toLowerCase());
assert.equal(accepted?.scheme, "exact");

const storeDirectory = await mkdtemp(join(tmpdir(), "pay-v1-uat-store-"));
const storeFile = join(storeDirectory, "pending.aead");
const store = createFilePendingPaymentStore({
  file: storeFile,
  keyHex: "22".repeat(32),
});
const record = {
  digest: `0x${"33".repeat(32)}` as const,
  payment: {
    version: 2 as const,
    requestDigest: `0x${"44".repeat(32)}` as const,
    url: "https://pay-uat.example/paid/ping",
    method: "GET",
    headers: [["payment-signature", "encrypted-by-store"]] as Array<
      [string, string]
    >,
  },
};
assert.equal(await store.saveIfAbsent(record), true);
assert.equal(await store.saveIfAbsent(record), false);
assert.deepEqual(await store.load(), record);
assert.doesNotMatch(await readFile(storeFile, "utf8"), /payment-signature/);
const envelope = JSON.parse(await readFile(storeFile, "utf8")) as {
  ciphertext: string;
};
envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${
  envelope.ciphertext.endsWith("A") ? "B" : "A"
}`;
await writeFile(storeFile, JSON.stringify(envelope));
await assert.rejects(store.load());
await rm(storeDirectory, { recursive: true });

console.info("pay_v1_uat_smoke_passed", {
  amountAtomic: challenge.accepts[0]?.amount,
  network: challenge.accepts[0]?.network,
  protocols: ["x402", "mpp"],
  storeProtection: store.protection,
});
