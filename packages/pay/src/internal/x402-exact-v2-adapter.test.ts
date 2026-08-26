import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { X402ExactV2Adapter } from "./x402-exact-v2-adapter";

const requirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "10000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 300,
  extra: {
    assetTransferMethod: "eip3009",
    paymentFlow: "upfront",
    name: "USDC",
    version: "2",
  },
} satisfies PaymentRequirements;
const payload = {
  x402Version: 2,
  accepted: requirements,
  payload: {
    signature: `0x${"11".repeat(65)}`,
    authorization: {
      from: "0x2222222222222222222222222222222222222222",
      to: requirements.payTo,
      value: requirements.amount,
      validAfter: "0",
      validBefore: "9999999999",
      nonce: `0x${"22".repeat(32)}`,
    },
  },
} satisfies PaymentPayload;

test("x402 adapter maps only the validated EIP-3009 economic effect", () => {
  const command = new X402ExactV2Adapter("eip155:84532").toCommand(
    payload,
    requirements,
  );
  expect(command).toEqual({
    protocolId: "x402-exact-v2-eip3009",
    adapterRevision: "x402-exact-v2",
    network: "eip155:84532",
    asset: requirements.asset,
    amount: "10000",
    payer: payload.payload.authorization.from,
    payTo: requirements.payTo,
    authorization: {
      domain: {
        name: "USDC",
        version: "2",
        chainId: 84532,
        verifyingContract: requirements.asset,
      },
      nonce: payload.payload.authorization.nonce,
      validAfter: "0",
      validBefore: "9999999999",
      signature: payload.payload.signature,
    },
  });
});

test.each([
  ["Permit2", { ...requirements, extra: { ...requirements.extra, assetTransferMethod: "permit2" } }],
  ["wrong network", { ...requirements, network: "eip155:8453" }],
  ["wrong asset", { ...requirements, asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }],
  ["unknown extension", { ...requirements, extra: { ...requirements.extra, provider: "forbidden" } }],
] as const)("rejects %s before settlement", (_label, candidate) => {
  expect(() =>
    new X402ExactV2Adapter("eip155:84532").toCommand(
      { ...payload, accepted: candidate } as PaymentPayload,
      candidate as PaymentRequirements,
    ),
  ).toThrow("PAYMENT_CHALLENGE_INVALID");
});

test.each([
  ["accepted private extra", {
    ...payload,
    accepted: { ...requirements, extra: { ...requirements.extra, organizationId: "private" } },
  }],
  ["accepted deferred field", {
    ...payload,
    accepted: { ...requirements, deferred: true },
  }],
  ["payload private field", {
    ...payload,
    payload: { ...payload.payload, paymentId: "private" },
  }],
  ["payment payload extension", {
    ...payload,
    extensions: { provider: "forbidden" },
  }],
  ["resource private field", {
    ...payload,
    resource: { url: "https://merchant.example/weather", paymentId: "private" },
  }],
  ["authorization unknown field", {
    ...payload,
    payload: {
      ...payload.payload,
      authorization: { ...payload.payload.authorization, provider: "forbidden" },
    },
  }],
] as const)("rejects client-controlled %s before settlement", (_label, candidate) => {
  expect(() =>
    new X402ExactV2Adapter("eip155:84532").toCommand(
      candidate as PaymentPayload,
      requirements,
    ),
  ).toThrow("PAYMENT_CHALLENGE_INVALID");
});
