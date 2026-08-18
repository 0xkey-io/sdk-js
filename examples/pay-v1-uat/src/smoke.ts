import assert from "node:assert/strict";
import { createUatApp } from "./app.js";

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

console.info("pay_v1_uat_smoke_passed", {
  amountAtomic: challenge.accepts[0]?.amount,
  network: challenge.accepts[0]?.network,
  protocols: ["x402", "mpp"],
});
