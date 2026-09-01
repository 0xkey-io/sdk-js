import type { ChargeSettlementCommand } from "./charge-settlement-command";
import { ZeroXkeySettlementAdapter } from "./zeroxkey-settlement-adapter";

const command: ChargeSettlementCommand = {
  protocolId: "x402-exact-v2-eip3009",
  adapterRevision: "x402-exact-v2",
  network: "eip155:84532",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "10000",
  payer: "0x2222222222222222222222222222222222222222",
  payTo: "0x1111111111111111111111111111111111111111",
  authorization: {
    domain: {
      name: "USDC",
      version: "2",
      chainId: 84532,
      verifyingContract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    },
    nonce: `0x${"22".repeat(32)}`,
    validAfter: "0",
    validBefore: "9999999999",
    signature: `0x${"11".repeat(65)}`,
  },
};

test.each([
  ["x402-exact-v2-eip3009", "x402-exact-v2", "x402"],
  ["mpp-evm-charge-v0", "mpp-evm-charge-v0", "mpp"],
] as const)("derives %s command X-Stamp protocol and uses the versioned path", async (
  protocolId,
  adapterRevision,
  expectedWire,
) => {
  const stamps: Array<{ url: string; wireProtocol: string }> = [];
  const adapter = new ZeroXkeySettlementAdapter({
    network: "eip155:84532",
    organizationId: "11111111-1111-4111-8111-111111111111",
    stamper: {
      async stampRequest(input) {
        stamps.push({ url: input.url, wireProtocol: input.wireProtocol });
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
      },
    },
    async fetch(url, init) {
      expect(String(url)).toBe("https://api-pay.0xkey.io/base-sepolia/v1/settlements/charge");
      expect(init?.redirect).toBe("error");
      return Response.json({
        settlement: {
          success: true,
          transaction: `0x${"ab".repeat(32)}`,
          network: "eip155:84532",
          payer: command.payer,
        },
        paymentId: "22222222-2222-4222-8222-222222222222",
      });
    },
  });

  await expect(adapter.settle({ ...command, protocolId, adapterRevision })).resolves.toEqual({
    paymentId: "22222222-2222-4222-8222-222222222222",
    reference: `0x${"ab".repeat(32)}`,
  });
  expect(stamps).toEqual([{
    url: "https://api-pay.0xkey.io/base-sepolia/v1/settlements/charge",
    wireProtocol: expectedWire,
  }]);
});

test("rejects protocol/revision mismatch before stamping", async () => {
  const stamper = { stampRequest: jest.fn() };
  const adapter = new ZeroXkeySettlementAdapter({
    network: "eip155:84532",
    organizationId: "11111111-1111-4111-8111-111111111111",
    stamper,
    fetch: jest.fn(),
  });
  await expect(adapter.settle({
    ...command,
    adapterRevision: "mpp-evm-charge-v0",
  } as ChargeSettlementCommand)).rejects.toMatchObject({
    code: "PAYMENT_CHALLENGE_INVALID",
  });
  expect(stamper.stampRequest).not.toHaveBeenCalled();
});

test.each([
  ["flattened compatibility", {
    success: true,
    transaction: `0x${"ab".repeat(32)}`,
    paymentId: "22222222-2222-4222-8222-222222222222",
  }],
  ["nested private extension", {
    settlement: {
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:84532",
      paymentId: "must-not-be-standard",
    },
    paymentId: "22222222-2222-4222-8222-222222222222",
  }],
  ["wrong response network", {
    settlement: {
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:8453",
      payer: command.payer,
    },
    paymentId: "22222222-2222-4222-8222-222222222222",
  }],
  ["missing success payer", {
    settlement: {
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:84532",
    },
    paymentId: "22222222-2222-4222-8222-222222222222",
  }],
  ["invalid optional amount", {
    settlement: {
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:84532",
      payer: command.payer,
      amount: 0,
    },
    paymentId: "22222222-2222-4222-8222-222222222222",
  }],
  ["invalid optional error", {
    settlement: {
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:84532",
      payer: command.payer,
      errorReason: { private: true },
    },
    paymentId: "22222222-2222-4222-8222-222222222222",
  }],
  ["invalid optional object", {
    settlement: {
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:84532",
      payer: command.payer,
      extra: [],
    },
    paymentId: "22222222-2222-4222-8222-222222222222",
  }],
])("rejects %s success", async (_label, responseBody) => {
  const adapter = new ZeroXkeySettlementAdapter({
    network: "eip155:84532",
    organizationId: "11111111-1111-4111-8111-111111111111",
    stamper: {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
      },
    },
    async fetch() {
      return Response.json(responseBody);
    },
  });
  await expect(adapter.settle(command)).rejects.toMatchObject({
    code: "PAYMENT_STATUS_UNKNOWN",
  });
});

test.each([
  [400, "PAYMENT_REQUEST_INVALID", false, undefined],
  [409, "PAYMENT_INTENT_CONFLICT", false, "22222222-2222-4222-8222-222222222222"],
  [502, "PAYMENT_SERVICE_UNAVAILABLE", true, undefined],
  [503, "PAYMENT_STATUS_UNKNOWN", true, "22222222-2222-4222-8222-222222222222"],
] as const)("preserves structured %i %s settlement errors", async (
  status,
  errorCode,
  retryable,
  paymentId,
) => {
  const adapter = adapterWithResponse(Response.json({
    errorCode,
    retryable,
    ...(paymentId ? { paymentId } : {}),
  }, { status }));

  await expect(adapter.settle(command)).rejects.toMatchObject({
    code: errorCode,
    retryable,
    ...(paymentId ? { paymentId } : {}),
  });
});

test("classifies a strict success:false envelope as deterministic and preserves paymentId", async () => {
  const adapter = adapterWithResponse(Response.json({
    settlement: {
      success: false,
      transaction: "",
      network: command.network,
      payer: command.payer.toUpperCase().replace("0X", "0x"),
      errorReason: "authorization rejected",
    },
    paymentId: "22222222-2222-4222-8222-222222222222",
  }));

  await expect(adapter.settle(command)).rejects.toMatchObject({
    code: "PAYMENT_CHALLENGE_INVALID",
    retryable: false,
    paymentId: "22222222-2222-4222-8222-222222222222",
  });
});

test("accepts checksum/case differences for the same validated EVM payer", async () => {
  const alphabeticPayer = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const adapter = adapterWithResponse(Response.json({
    settlement: {
      success: true,
      transaction: `0x${"ab".repeat(32)}`,
      network: command.network,
      payer: alphabeticPayer.toUpperCase().replace("0X", "0x"),
    },
    paymentId: "22222222-2222-4222-8222-222222222222",
  }));

  await expect(adapter.settle({ ...command, payer: alphabeticPayer })).resolves.toMatchObject({
    reference: `0x${"ab".repeat(32)}`,
  });
});

test("treats malformed or status-mismatched error envelopes as indeterminate", async () => {
  for (const response of [
    Response.json({ errorCode: "PAYMENT_INTENT_CONFLICT", retryable: false }, { status: 503 }),
    Response.json({ errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true, secret: "leak" }, { status: 503 }),
  ]) {
    await expect(adapterWithResponse(response).settle(command)).rejects.toMatchObject({
      code: "PAYMENT_STATUS_UNKNOWN",
      retryable: true,
    });
  }
});

function adapterWithResponse(response: Response): ZeroXkeySettlementAdapter {
  return new ZeroXkeySettlementAdapter({
    network: "eip155:84532",
    organizationId: "11111111-1111-4111-8111-111111111111",
    stamper: {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
      },
    },
    async fetch() {
      return response;
    },
  });
}
