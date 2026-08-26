import assert from "node:assert/strict";
import test from "node:test";
import { Challenge } from "mppx";
import { Mppx } from "mppx/server";
import { create0xkeyEvmChargeMethod } from "./index.mts";

const ORG = "11111111-1111-4111-8111-111111111111";

test("method is accepted by Mppx.create and offers only native MPP HTTP", async () => {
  const method = create0xkeyEvmChargeMethod({
    network: "eip155:84532",
    organizationId: ORG,
    payTo: "0x1111111111111111111111111111111111111111",
    stamper: {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
      },
    },
  });
  const server = Mppx.create({
    methods: [method],
    secretKey: "01234567890123456789012345678901",
  });

  const result = await server.evm.charge({ amount: "0.01" })(
    new Request("https://merchant.example/weather"),
  );

  assert.equal(result.status, 402);
  if (result.status !== 402) throw new Error("expected challenge");
  assert.equal(result.challenge.headers.has("WWW-Authenticate"), true);
  assert.equal(result.challenge.headers.has("PAYMENT-REQUIRED"), false);
  assert.equal(result.challenge.headers.has("PAYMENT-SIGNATURE"), false);
  const challenge = Challenge.fromResponse(result.challenge.clone());
  assert.equal(challenge.method, "evm");
  assert.equal(challenge.intent, "charge");
  assert.deepEqual(
    {
      amount: challenge.request.amount,
      currency: challenge.request.currency,
      recipient: challenge.request.recipient,
      methodDetails: challenge.request.methodDetails,
    },
    {
      amount: "10000",
      currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      recipient: "0x1111111111111111111111111111111111111111",
      methodDetails: { chainId: 84532, credentialTypes: ["authorization"], decimals: 6 },
    },
  );
});

test("method validates seller configuration", () => {
  const base = {
    network: "eip155:84532" as const,
    organizationId: ORG,
    payTo: "0x1111111111111111111111111111111111111111" as const,
    stamper: {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp" as const, stampHeaderValue: "signed" };
      },
    },
  };
  assert.throws(
    () => create0xkeyEvmChargeMethod({ ...base, payTo: "0x1234" }),
    /PAY_PROFILE_INVALID/,
  );
  assert.throws(
    () => create0xkeyEvmChargeMethod({ ...base, organizationId: "tenant-name" }),
    /PAY_PROFILE_INVALID/,
  );
});
