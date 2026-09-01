import { privateKeyToAccount } from "viem/accounts";
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  sha256,
  stringToBytes,
  stringToHex,
  type Hex,
} from "viem";
import {
  createPayClient,
  type BasePaymentNetwork,
  type CreatePayClientOptions,
  PayError,
  type PayClient,
  type PayEvmAccount,
  type PayProtocol,
  type PaymentReceiptVerifier,
  type PaymentReceiptVerificationInput,
  type PendingPaymentRecord,
  type PendingPaymentStore,
} from "./client";

interface TestClientOptions {
  account: PayEvmAccount;
  allowHosts: string[];
  maxAmount: string;
  network?: BasePaymentNetwork;
  protocolPreference?: PayProtocol[];
  allowInsecureLocalhost?: boolean;
  fetch?: typeof globalThis.fetch;
  receiptVerifier?: PaymentReceiptVerifier;
  rpcUrls?: Partial<Record<BasePaymentNetwork, string>>;
  pendingPaymentStore?: PendingPaymentStore;
  onReceipt?: CreatePayClientOptions["onReceipt"];
}

function createTestClient(options: TestClientOptions): PayClient {
  const network = options.network ?? "eip155:84532";
  return createPayClient({
    account: options.account,
    network,
    policy: {
      allowHosts: options.allowHosts,
      maxAmount: options.maxAmount,
      ...(options.protocolPreference
        ? { preference: options.protocolPreference }
        : {}),
    },
    recovery: options.pendingPaymentStore ?? createRecovery(),
    verification: options.receiptVerifier
      ? { verifier: options.receiptVerifier }
      : {
          rpcUrl:
            options.rpcUrls?.[network] ??
            (network === "eip155:8453"
              ? "https://rpc.example"
              : "https://sepolia.base.org"),
        },
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.allowInsecureLocalhost ? { allowInsecureLocalhost: true } : {}),
    ...(options.onReceipt ? { onReceipt: options.onReceipt } : {}),
  });
}

jest.mock("mppx", () => ({
  Constants: {
    Headers: {
      authorization: "Authorization",
      wwwAuthenticate: "WWW-Authenticate",
    },
  },
  Challenge: { fromResponseList: jest.fn() },
  Credential: {
    deserialize: jest.fn(),
    extractPaymentScheme: jest.fn((header: string) =>
      header.startsWith("Payment ") ? header : null,
    ),
  },
  Receipt: { deserialize: jest.fn() },
  x402: {
    paymentRequiredHeader: "PAYMENT-REQUIRED",
    paymentSignatureHeader: "PAYMENT-SIGNATURE",
    paymentResponseHeader: "PAYMENT-RESPONSE",
    Header: {
      decodePaymentResponse: jest.fn(),
      decodePaymentSignature: jest.fn(),
    },
    Types: {
      ExactEip3009PayloadSchema: { parse: jest.fn((value) => value) },
    },
  },
}));
jest.mock("mppx/client", () => ({
  Transport: { from: (transport: unknown) => transport },
  Mppx: {
    create: jest.fn((config) => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        config.fetch(input, init),
    })),
  },
}));
jest.mock("mppx/evm/client", () => ({
  assets: {
    base: { USDC: { address: "0xbase", network: "eip155:8453" } },
    baseSepolia: {
      USDC: { address: "0xsepolia", network: "eip155:84532" },
    },
  },
  charge: jest.fn((config) => config),
}));
jest.mock("mppx/evm", () => ({
  assets: {
    base: {
      USDC: {
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        network: "eip155:8453",
        transfer: { name: "USD Coin", type: "eip3009", version: "2" },
      },
    },
    baseSepolia: {
      USDC: {
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        network: "eip155:84532",
        transfer: { name: "USDC", type: "eip3009", version: "2" },
      },
    },
    matches: jest.fn(
      (asset: { address: string }, accepted: string) =>
        asset.address.toLowerCase() === accepted.toLowerCase(),
    ),
  },
  Types: {
    AuthorizationPayloadSchema: { parse: jest.fn((value) => value) },
    ChargeRequestSchema: { parse: jest.fn((value) => value) },
    challengeHash: jest.fn(() => `0x${"11".repeat(32)}`),
    chargeIntent: "charge",
    networkOf: jest.fn((chainId) => `eip155:${chainId}`),
    paymentMethod: "evm",
  },
}));
jest.mock("@x402/core/client", () => ({
  x402Client: class {
    register() {
      return this;
    }
    registerPolicy() {
      return this;
    }
  },
}));
jest.mock("@x402/evm", () => ({
  ExactEvmScheme: class {},
  toClientEvmSigner: jest.fn((signer) => signer),
}));
jest.mock("@x402/fetch", () => ({
  wrapFetchWithPayment: jest.fn((fetch) => fetch),
}));

const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const payTo = "0x1111111111111111111111111111111111111111";
test("MPP execution uses native-only wire decoding and preserves transport parameters", async () => {
  const { Challenge } = jest.requireMock("mppx");
  const { Mppx } = jest.requireMock("mppx/client");
  const challenge = {
    id: "native-id",
    realm: "merchant.example",
    method: "evm",
    intent: "charge",
    request: {
      amount: "10000",
      currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      recipient: payTo,
      methodDetails: { chainId: 84532, decimals: 6 },
    },
  };
  Challenge.fromResponseList.mockReturnValue([challenge]);
  const response = new Response(null, {
    status: 402,
    headers: { "WWW-Authenticate": "Payment native" },
  });
  let calls = 0;
  const client = createTestClient({
    account,
    allowHosts: ["merchant.example"],
    maxAmount: "$0.01",
    protocolPreference: ["mpp"],
    fetch: async () =>
      ++calls === 1 ? response.clone() : new Response(null, { status: 204 }),
  });
  // The upstream factory double does not sign; inspect the real transport
  // supplied by Pay after its native-offer selection has run.
  await expect(
    client.fetch("https://merchant.example/paid"),
  ).rejects.toMatchObject({ code: "PAYMENT_OFFER_UNSUPPORTED" });
  const transport = Mppx.create.mock.calls.at(-1)[0].transport;
  expect(transport).toBeDefined();
  expect(transport.getChallenges(response)).toEqual([challenge]);
  expect(
    transport.getChallenges(
      new Response(null, {
        status: 402,
        headers: { "PAYMENT-REQUIRED": "x402-only" },
      }),
    ),
  ).toEqual([]);
  expect(
    transport.getChallenges(
      new Response(null, {
        status: 200,
        headers: { "WWW-Authenticate": "Payment native" },
      }),
    ),
  ).toEqual([]);
  const controller = new AbortController();
  const init = {
    method: "POST",
    body: "original-body",
    signal: controller.signal,
    credentials: "omit",
    cache: "no-store",
    redirect: "manual",
    headers: new Headers({
      Authorization: "stale-auth",
      "PAYMENT-REQUIRED": "stale-required",
      "PAYMENT-RESPONSE": "stale-response",
      "PAYMENT-SIGNATURE": "stale-signature",
      "X-Request-Id": "original-id",
    }),
  };
  const attached = transport.setCredential(init, "Payment native-credential");
  expect(attached).toEqual({
    ...init,
    headers: new Headers({
      Authorization: "Payment native-credential",
      "X-Request-Id": "original-id",
    }),
  });
  expect(attached.signal).toBe(controller.signal);
  expect(init.headers.get("Authorization")).toBe("stale-auth");
  for (const header of [
    "PAYMENT-REQUIRED",
    "PAYMENT-RESPONSE",
    "PAYMENT-SIGNATURE",
  ])
    expect(attached.headers.has(header)).toBe(false);
});

test("MPP offer selection rejects non-USDC decimals before protocol execution", async () => {
  const { Challenge } = jest.requireMock("mppx");
  Challenge.fromResponseList.mockReturnValue([{
    id: "wrong-decimals",
    realm: "merchant.example",
    method: "evm",
    intent: "charge",
    request: {
      amount: "10000",
      currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      recipient: payTo,
      methodDetails: { chainId: 84532, decimals: 18 },
    },
  }]);
  let calls = 0;
  const client = createTestClient({
    account,
    allowHosts: ["merchant.example"],
    maxAmount: "$0.01",
    protocolPreference: ["mpp"],
    fetch: async () => ++calls === 1
      ? new Response(null, { status: 402, headers: { "WWW-Authenticate": "Payment native" } })
      : new Response(null, { status: 204 }),
  });
  await expect(client.fetch("https://merchant.example/paid")).rejects.toMatchObject({
    code: "PAYMENT_POLICY_DENIED",
    phase: "policy",
    retryable: false,
  });
  expect(calls).toBe(1);
});

test("MPP offer selection accepts the frozen Ruby canonical-USDC profile without a decimals extension", async () => {
  const { Challenge } = jest.requireMock("mppx");
  Challenge.fromResponseList.mockReturnValue([{
    id: "ruby-canonical-usdc",
    realm: "merchant.example",
    method: "evm",
    intent: "charge",
    request: {
      amount: "10000",
      currency: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      recipient: payTo,
      methodDetails: { chainId: 84532, credentialTypes: ["authorization"] },
    },
  }]);
  let calls = 0;
  const client = createTestClient({
    account,
    allowHosts: ["merchant.example"],
    maxAmount: "$0.01",
    protocolPreference: ["mpp"],
    fetch: async () => ++calls === 1
      ? new Response(null, { status: 402, headers: { "WWW-Authenticate": "Payment native" } })
      : new Response(null, { status: 204 }),
  });
  await expect(client.fetch("https://merchant.example/paid")).rejects.toMatchObject({
    code: "PAYMENT_OFFER_UNSUPPORTED",
  });
  expect(calls).toBe(1);
});
const baseSepoliaUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const transaction = `0x${"ab".repeat(32)}`;
const authorizationNonce = `0x${"11".repeat(32)}`;
const economicEffectId = `eip3009:${sha256(
  stringToBytes(
    JSON.stringify({
      from: account.address.toLowerCase(),
      kind: "eip3009/transferWithAuthorization",
      name: "USDC",
      network: "eip155:84532",
      nonce: authorizationNonce,
      to: payTo.toLowerCase(),
      validAfter: "0",
      validBefore: "9999999999",
      value: "10000",
      verifyingContract: baseSepoliaUsdc.toLowerCase(),
      version: "2",
    }),
  ),
).slice(2)}`;

function expectedEconomicEffectDigest(): `0x${string}` {
  return sha256(
    stringToBytes(
      JSON.stringify({
        network: "eip155:84532",
        asset: getAddress(baseSepoliaUsdc),
        authorizationDomain: { name: "USDC", version: "2" },
        authorization: {
          from: getAddress(account.address),
          to: getAddress(payTo),
          value: "10000",
          validAfter: "0",
          validBefore: "9999999999",
          nonce: authorizationNonce,
        },
        economicEffectId,
      }),
    ),
  );
}

function expectedRequestDigest(
  payment: Omit<PendingPaymentRecord["payment"], "requestDigest">,
): `0x${string}` {
  return sha256(stringToBytes(JSON.stringify(payment)));
}

function createRecovery(): PendingPaymentStore {
  let record: PendingPaymentRecord | undefined;
  return {
    protection: "aead",
    async load() {
      return record;
    },
    async saveIfAbsent(next) {
      if (record) return false;
      record = next;
      return true;
    },
    async clear(expectedDigest) {
      if (record?.digest !== expectedDigest) return false;
      record = undefined;
      return true;
    },
  };
}

function createClientOptions(
  overrides: Partial<CreatePayClientOptions> = {},
): CreatePayClientOptions {
  return {
    account,
    network: "eip155:84532",
    policy: {
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
    },
    recovery: createRecovery(),
    verification: { verifier: async () => true },
    fetch: async () => Response.json({ ok: true }),
    ...overrides,
  };
}

describe("Pay client 1.0 public contract", () => {
  it("returns an explicit client object instead of a callable fetch wrapper", async () => {
    const client = createPayClient(createClientOptions());

    expect(typeof client).toBe("object");
    expect(Object.keys(client).sort()).toEqual(["fetch", "pending", "resume"]);
    await expect(
      client.fetch("https://merchant.example/weather"),
    ).resolves.toMatchObject({ status: 200 });
    await expect(client.pending()).resolves.toBeUndefined();
  });

  it("fails missing durable recovery with stable structured fields", () => {
    let caught: unknown;
    try {
      createPayClient(
        createClientOptions({
          recovery: undefined as unknown as PendingPaymentStore,
        }),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PayError);
    expect(caught).toMatchObject({
      name: "PayError",
      code: "PENDING_PAYMENT_STORE_REQUIRED",
      phase: "configuration",
      retryable: false,
    });
  });
});

describe("buyer error provenance", () => {
  // Each former marker must be inert at unowned callback boundaries, even
  // when the text is an exact match rather than incidental diagnostic prose.
  const markers = [
    "PAY_HOST_DENIED",
    "PAY_INSECURE_TRANSPORT",
    "PAY_REDIRECT_DENIED",
    "PAYMENT_IN_PROGRESS",
    "PAYMENT_RESUME_REQUIRED",
    "PAYMENT_RESUME_UNAVAILABLE",
    "PENDING_PAYMENT_CLAIMED",
    "PENDING_PAYMENT_CLEAR_CONFLICT",
    "PENDING_PAYMENT_CONFLICT",
    "PENDING_PAYMENT_POLICY_DENIED",
    "PENDING_PAYMENT_INVALID",
    "PAYMENT_RECEIPT_MISSING",
    "PAYMENT_RECEIPT_MISMATCH",
    "PAYMENT_RECEIPT_UNVERIFIED",
    "PAY_RECEIPT_RPC",
    "PAY_SIGNER_UNSUPPORTED",
  ];
  const cases: Array<[string, unknown]> = markers.flatMap((marker) => [
    [`${marker}-exact`, new Error(marker)],
    [`${marker}-prefix`, new Error(`${marker}: diagnostic`)],
    [`${marker}-embedded`, new Error(`diagnostic ${marker} detail`)],
  ]);
  cases.push(
    ["multiple-markers", new Error(markers.join(" "))],
    ["string", "PAY_HOST_DENIED"],
    ["null", null],
    ["undefined", undefined],
    ["number", 7],
    [
      "forged-object",
      {
        name: "PayError",
        message: "PAY_HOST_DENIED",
        code: "PAY_HOST_DENIED",
        phase: "policy",
        retryable: false,
      },
    ],
    [
      "forged-error",
      Object.assign(new Error("PAY_HOST_DENIED"), {
        name: "PayError",
        code: "PAY_HOST_DENIED",
        phase: "policy",
        retryable: false,
      }),
    ],
    [
      "throwing-message",
      Object.defineProperty(new Error(), "message", {
        get() {
          throw new Error("message must not be inspected");
        },
      }),
    ],
  );
  describe.each(["fetch", "pending", "resume"] as const)("%s", (operation) => {
    it.each(cases)("uses operation context for %s", async (_label, cause) => {
      const recovery = createRecovery();
      const client = createPayClient(
        createClientOptions({
          recovery:
            operation === "fetch"
              ? recovery
              : {
                  ...recovery,
                  async load() {
                    throw cause;
                  },
                },
          fetch: async () => {
            throw cause;
          },
        }),
      );
      const result =
        operation === "fetch"
          ? client.fetch("https://merchant.example/weather")
          : client[operation]();
      let caught: unknown;
      try {
        await result;
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PayError);
      expect(caught).toMatchObject({
        code: "PAYMENT_SERVICE_UNAVAILABLE",
        phase: operation === "fetch" ? "request" : "recovery",
        retryable: true,
      });
      expect((caught as PayError).message).toBe(
        "PAYMENT_SERVICE_UNAVAILABLE: Payment service unavailable",
      );
      expect((caught as PayError).cause).toBe(cause);
      expect((caught as PayError).paymentId).toBeUndefined();
    });

    it("preserves a local typed error and its identity", async () => {
      const cause = new PayError("PAYMENT_AUTH_FORBIDDEN", "owned failure", {
        phase: "policy",
        retryable: false,
      });
      const recovery = createRecovery();
      const client = createPayClient(
        createClientOptions({
          recovery: {
            ...recovery,
            async load() {
              throw cause;
            },
          },
        }),
      );
      const result =
        operation === "fetch"
          ? client.fetch("https://merchant.example/weather")
          : client[operation]();
      await expect(result).rejects.toBe(cause);
    });
  });

  it("uses configuration context for an unowned policy getter failure", () => {
    const cause = new Error("PAYMENT_IN_PROGRESS");
    const options = createClientOptions();
    Object.defineProperty(options.policy, "allowHosts", {
      get() {
        throw cause;
      },
    });
    expect(() => createPayClient(options)).toThrow(
      expect.objectContaining({
        code: "PAY_PROFILE_INVALID",
        phase: "configuration",
        retryable: false,
        cause,
      }),
    );
  });

  it("wraps even a local typed signer exception before handing it to the protocol", async () => {
    const cause = new PayError("PAY_HOST_DENIED", "signer rejected", {
      phase: "policy",
    });
    createPayClient(
      createClientOptions({
        account: {
          address: account.address,
          async signTypedData() {
            throw cause;
          },
        },
      }),
    );
    // Capture only the protocol dependency seam; the SDK's signer wrapper is real.
    const dependency = jest.requireMock("@x402/evm") as {
      toClientEvmSigner: jest.Mock;
    };
    const signer = dependency.toClientEvmSigner.mock.calls.at(-1)![0];
    let caught: unknown;
    try {
      await signer.signTypedData({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PayError);
    expect(caught).toMatchObject({
      code: "PAYMENT_SIGNING_FAILED",
      phase: "signing",
      retryable: false,
    });
    expect((caught as PayError).cause).toBe(cause);
    expect(caught).not.toBe(cause);
  });
});

describe("network selection", () => {
  it("requires an explicit supported Base network at runtime", () => {
    expect(() =>
      createPayClient(
        createClientOptions({
          network: undefined as unknown as BasePaymentNetwork,
        }),
      ),
    ).toThrow("PAY_NETWORK_UNSUPPORTED");
  });

  it("rejects networks outside the two supported Base channels", () => {
    expect(() =>
      createPayClient(
        createClientOptions({ network: "eip155:1" as BasePaymentNetwork }),
      ),
    ).toThrow("PAY_NETWORK_UNSUPPORTED");
  });
});

describe("receipt verification profile", () => {
  it.each([
    ["missing", undefined],
    ["empty", { rpcUrl: "" }],
    ["whitespace", { rpcUrl: "   " }],
    ["malformed", { rpcUrl: "not-a-url" }],
    ["non-HTTPS", { rpcUrl: "http://rpc.example" }],
    ["missing both choices", {}],
    ["non-function verifier", { verifier: "yes" }],
    [
      "both choices",
      { rpcUrl: "https://rpc.example", verifier: async () => true },
    ],
  ])("rejects a %s verification configuration", (_name, verification) => {
    expect(() =>
      createPayClient(
        createClientOptions({
          verification:
            verification as unknown as CreatePayClientOptions["verification"],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "PAY_PROFILE_INVALID",
        phase: "configuration",
        retryable: false,
      }),
    );
  });

  it("accepts exactly one HTTPS RPC URL or verifier function", () => {
    expect(() =>
      createPayClient(
        createClientOptions({
          verification: { rpcUrl: "https://rpc.example" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      createPayClient(
        createClientOptions({
          verification: { verifier: async () => true },
        }),
      ),
    ).not.toThrow();
  });
});

function x402Receipt() {
  return {
    success: true,
    transaction,
    network: "eip155:84532",
    payer: account.address,
  };
}

const transferWithAuthorizationAbi = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

interface RpcFixture {
  block: { hash: string };
  chainId: string;
  receipt: {
    blockHash: string;
    blockNumber: string;
    logs: Array<{ address: string; data: string; topics: string[] }>;
    status: string;
    transactionHash: string;
  };
  transaction: {
    blockHash: string;
    hash: string;
    input: Hex;
    to: string;
  };
}

function matchingRpcFixture(): RpcFixture {
  const blockHash = `0x${"66".repeat(32)}`;
  const nonce = `0x${"11".repeat(32)}` as Hex;
  return {
    chainId: "0x14a34",
    block: { hash: blockHash },
    receipt: {
      blockHash,
      blockNumber: "0x123",
      status: "0x1",
      transactionHash: transaction,
      logs: [
        {
          address: baseSepoliaUsdc,
          data: uintTopic(10_000n),
          topics: [
            keccak256(stringToHex("Transfer(address,address,uint256)")),
            addressTopic(account.address),
            addressTopic(payTo),
          ],
        },
        {
          address: baseSepoliaUsdc,
          data: "0x",
          topics: [
            keccak256(stringToHex("AuthorizationUsed(address,bytes32)")),
            addressTopic(account.address),
            nonce,
          ],
        },
      ],
    },
    transaction: {
      blockHash,
      hash: transaction,
      to: baseSepoliaUsdc,
      input: transferInput(),
    },
  };
}

function transferInput(
  overrides: {
    from?: `0x${string}`;
    to?: `0x${string}`;
    value?: bigint;
    validAfter?: bigint;
    validBefore?: bigint;
    nonce?: Hex;
  } = {},
): Hex {
  return encodeFunctionData({
    abi: transferWithAuthorizationAbi,
    functionName: "transferWithAuthorization",
    args: [
      overrides.from ?? account.address,
      overrides.to ?? (payTo as `0x${string}`),
      overrides.value ?? 10_000n,
      overrides.validAfter ?? 0n,
      overrides.validBefore ?? 9_999_999_999n,
      overrides.nonce ?? (`0x${"11".repeat(32)}` as Hex),
      27,
      `0x${"22".repeat(32)}`,
      `0x${"33".repeat(32)}`,
    ],
  });
}

function createRpcFetch(fixture: RpcFixture): typeof globalThis.fetch {
  return jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { method: string };
    const result =
      request.method === "eth_chainId"
        ? fixture.chainId
        : request.method === "eth_getTransactionReceipt"
          ? fixture.receipt
          : request.method === "eth_getTransactionByHash"
            ? fixture.transaction
            : request.method === "eth_getBlockByNumber"
              ? fixture.block
              : undefined;
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  }) as typeof globalThis.fetch;
}

function addressTopic(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function uintTopic(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

const invalidRpcMutations: Array<[string, (fixture: RpcFixture) => void]> = [
  [
    "network",
    (fixture) => {
      fixture.chainId = "0x2105";
    },
  ],
  [
    "asset",
    (fixture) => {
      fixture.transaction.to = "0x2222222222222222222222222222222222222222";
    },
  ],
  [
    "payer",
    (fixture) => {
      fixture.transaction.input = transferInput({
        from: "0x2222222222222222222222222222222222222222",
      });
    },
  ],
  [
    "recipient",
    (fixture) => {
      fixture.transaction.input = transferInput({
        to: "0x2222222222222222222222222222222222222222",
      });
    },
  ],
  [
    "amount",
    (fixture) => {
      fixture.transaction.input = transferInput({ value: 10_001n });
    },
  ],
  [
    "authorization nonce",
    (fixture) => {
      fixture.transaction.input = transferInput({
        nonce: `0x${"44".repeat(32)}`,
      });
    },
  ],
  [
    "authorization window",
    (fixture) => {
      fixture.transaction.input = transferInput({
        validBefore: 9_999_999_998n,
      });
    },
  ],
  [
    "transaction",
    (fixture) => {
      fixture.receipt.transactionHash = `0x${"55".repeat(32)}`;
    },
  ],
  [
    "failed receipt",
    (fixture) => {
      fixture.receipt.status = "0x0";
    },
  ],
  [
    "canonical block hash",
    (fixture) => {
      fixture.block.hash = `0x${"77".repeat(32)}`;
    },
  ],
  [
    "Transfer event",
    (fixture) => {
      fixture.receipt.logs.splice(0, 1);
    },
  ],
  [
    "AuthorizationUsed event",
    (fixture) => {
      fixture.receipt.logs.splice(1, 1);
    },
  ],
];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("createPayClient", () => {
  beforeEach(() => {
    const mppx = jest.requireMock("mppx") as {
      Credential: { deserialize: jest.Mock };
      Receipt: { deserialize: jest.Mock };
      x402: {
        Header: {
          decodePaymentResponse: jest.Mock;
          decodePaymentSignature: jest.Mock;
        };
      };
    };
    mppx.Credential.deserialize.mockReset();
    mppx.Receipt.deserialize.mockReset();
    mppx.x402.Header.decodePaymentResponse.mockReset();
    mppx.x402.Header.decodePaymentSignature.mockReturnValue({
      x402Version: 2,
      accepted: {
        scheme: "exact",
        network: "eip155:84532",
        amount: "10000",
        asset: baseSepoliaUsdc,
        payTo,
        maxTimeoutSeconds: 300,
      },
      payload: {
        authorization: {
          from: account.address,
          to: payTo,
          value: "10000",
          validAfter: "0",
          validBefore: "9999999999",
          nonce: `0x${"11".repeat(32)}`,
        },
        signature: `0x${"22".repeat(65)}`,
      },
    });
  });

  it("validates an explicit production receipt RPC before signing", () => {
    expect(() =>
      createPayClient(
        createClientOptions({
          network: "eip155:8453",
          verification: { rpcUrl: "https://mainnet.base.org" },
        }),
      ),
    ).toThrow("PAY_PROFILE_INVALID");
  });

  it("wraps a credential decoder exception as owned policy denial with direct cause", async () => {
    const cause = new Error("decoder diagnostic PAY_HOST_DENIED");
    const native = jest.requireMock("mppx");
    native.x402.Header.decodePaymentSignature.mockImplementation(() => {
      throw cause;
    });
    let sends = 0;
    const client = createPayClient(
      createClientOptions({
        fetch: async () => {
          sends++;
          return new Response(null);
        },
      }),
    );
    let caught: unknown;
    try {
      await client.fetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PayError);
    expect(caught).toMatchObject({
      code: "PAYMENT_POLICY_DENIED",
      phase: "policy",
      retryable: false,
    });
    expect((caught as PayError).cause).toBe(cause);
    expect(sends).toBe(0);
    await expect(client.pending()).resolves.toBeUndefined();
  });

  it("requires durable pending-payment storage by default", () => {
    expect(() =>
      createPayClient(
        createClientOptions({
          recovery: undefined as unknown as PendingPaymentStore,
        }),
      ),
    ).toThrow("PENDING_PAYMENT_STORE_REQUIRED");
  });

  it("allows only one ordinary payment call to run at a time", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const rawFetch = jest.fn(async () => {
      entered.resolve();
      await release.promise;
      return Response.json({ ok: true });
    }) as typeof globalThis.fetch;
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
    });

    const first = payFetch.fetch("https://merchant.example/weather");
    await entered.promise;
    const second = payFetch.fetch("https://merchant.example/weather");
    release.resolve();

    await expect(second).rejects.toThrow("PAYMENT_IN_PROGRESS");
    await expect(first).resolves.toMatchObject({ status: 200 });
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });

  it("uses the same single-flight lock for resume", async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let callCount = 0;
    const rawFetch = jest.fn(async () => {
      callCount += 1;
      if (callCount === 2) {
        entered.resolve();
        await release.promise;
      }
      return new Response(null, { status: 401 });
    }) as typeof globalThis.fetch;
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
    });

    await payFetch.fetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });
    const first = payFetch.resume();
    await entered.promise;
    const second = payFetch.resume();
    release.resolve();

    await expect(second).rejects.toThrow("PAYMENT_IN_PROGRESS");
    await expect(first).resolves.toMatchObject({ status: 401 });
    expect(rawFetch).toHaveBeenCalledTimes(2);
  });

  it("saves a signed request before sending it", async () => {
    const saveEntered = deferred<void>();
    const releaseSave = deferred<void>();
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async () => {
        saveEntered.resolve();
        await releaseSave.promise;
        return true;
      }),
      clear: jest.fn(async () => true),
    };
    const rawFetch = jest.fn(
      async () => new Response(null, { status: 401 }),
    ) as typeof fetch;
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      pendingPaymentStore: store,
    });

    const result = payFetch.fetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });
    await saveEntered.promise;

    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.saveIfAbsent).toHaveBeenCalledTimes(1);
    expect(rawFetch).not.toHaveBeenCalled();

    releaseSave.resolve();
    await expect(result).resolves.toMatchObject({ status: 401 });
    expect(rawFetch).toHaveBeenCalledTimes(1);

    await expect(payFetch.resume()).resolves.toMatchObject({ status: 401 });
    expect(store.saveIfAbsent).toHaveBeenCalledTimes(1);
    expect(rawFetch).toHaveBeenCalledTimes(2);
  });

  it("does not send when another process wins the durable claim", async () => {
    let savedCandidate: PendingPaymentRecord | undefined;
    let loadCount = 0;
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => {
        loadCount += 1;
        return loadCount === 1 ? undefined : savedCandidate;
      }),
      saveIfAbsent: jest.fn(async (record: PendingPaymentRecord) => {
        savedCandidate = record;
        return false;
      }),
      clear: jest.fn(async () => true),
    };
    const rawFetch = jest.fn(
      async () => new Response(null, { status: 401 }),
    ) as typeof fetch;
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      pendingPaymentStore: store,
    });

    await expect(
      payFetch.fetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      }),
    ).rejects.toThrow("PENDING_PAYMENT_CLAIMED");
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("does not send when durable storage fails", async () => {
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async () => {
        throw new Error("store unavailable");
      }),
      clear: jest.fn(async () => true),
    };
    const rawFetch = jest.fn(
      async () => new Response(null, { status: 401 }),
    ) as typeof fetch;
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      pendingPaymentStore: store,
    });

    await expect(
      payFetch.fetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_SERVICE_UNAVAILABLE",
      retryable: true,
      cause: expect.objectContaining({ message: "store unavailable" }),
    });
    expect(rawFetch).not.toHaveBeenCalled();
    expect(await payFetch.pending()).toBeDefined();
  });

  it.each(["save", "clear", "onReceipt"] as const)(
    "preserves lifecycle when %s throws marker-bearing prose",
    async (boundary) => {
      const cause = new Error("diagnostic PAY_HOST_DENIED PAYMENT_IN_PROGRESS");
      const events: string[] = [];
      let stored: PendingPaymentRecord | undefined;
      const native = jest.requireMock("mppx");
      native.x402.Header.decodePaymentResponse.mockReturnValue(x402Receipt());
      const client = createPayClient(
        createClientOptions({
          recovery: {
            protection: "aead",
            async load() {
              events.push("load");
              return stored;
            },
            async saveIfAbsent(record) {
              events.push("save");
              if (boundary === "save") throw cause;
              stored = record;
              return true;
            },
            async clear(digest) {
              events.push("clear");
              expect(digest).toBe(stored?.digest);
              if (boundary === "clear") throw cause;
              stored = undefined;
              return true;
            },
          },
          fetch: async () => {
            events.push("send");
            return new Response(null, {
              headers: { "PAYMENT-RESPONSE": "receipt" },
            });
          },
          verification: {
            verifier: async () => {
              events.push("verify");
              return true;
            },
          },
          onReceipt() {
            events.push("callback");
            throw cause;
          },
        }),
      );
      let caught: unknown;
      try {
        await client.fetch("https://merchant.example/weather", {
          headers: { "PAYMENT-SIGNATURE": "signed-payment" },
        });
      } catch (error) {
        caught = error;
      }
      expect(events).toEqual(
        boundary === "save"
          ? ["load", "save"]
          : boundary === "clear"
            ? ["load", "save", "send", "verify", "clear"]
            : ["load", "save", "send", "verify", "clear", "callback"],
      );
      expect(Boolean(stored)).toBe(boundary === "clear");
      expect(Boolean(await client.pending())).toBe(boundary !== "onReceipt");
      if (boundary !== "onReceipt") {
        await expect(
          client.fetch("https://merchant.example/weather"),
        ).rejects.toMatchObject({
          code: "PAYMENT_RESUME_REQUIRED",
          phase: "recovery",
          retryable: false,
        });
      }
      expect(caught).toMatchObject({
        code: "PAYMENT_SERVICE_UNAVAILABLE",
        phase: "request",
        retryable: true,
      });
      expect((caught as PayError).cause).toBe(cause);
    },
  );

  it("keeps the signed request after any response without a receipt", async () => {
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async () => true),
      clear: jest.fn(async () => true),
    };
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () => new Response(null, { status: 401 }),
      pendingPaymentStore: store,
    });

    const response = await payFetch.fetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });

    expect(response.status).toBe(401);
    expect(await payFetch.pending()).toBeDefined();
    expect(store.clear).not.toHaveBeenCalled();
    await expect(
      payFetch.fetch("https://merchant.example/weather"),
    ).rejects.toThrow("PAYMENT_RESUME_REQUIRED");
  });

  it("keeps the durable slot when the receipt has no matching on-chain proof", async () => {
    const mppx = jest.requireMock("mppx") as {
      x402: { Header: { decodePaymentResponse: jest.Mock } };
    };
    mppx.x402.Header.decodePaymentResponse.mockReturnValue({
      success: true,
      transaction,
      network: "eip155:84532",
      payer: account.address,
    });
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async () => true),
      clear: jest.fn(async () => true),
    };
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      pendingPaymentStore: store,
      receiptVerifier: async () => false,
      fetch: async () =>
        new Response(null, {
          status: 200,
          headers: { "PAYMENT-RESPONSE": "receipt" },
        }),
    });

    await expect(
      payFetch.fetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      }),
    ).rejects.toThrow("PAYMENT_RECEIPT_MISMATCH");
    expect(store.clear).not.toHaveBeenCalled();
    expect(await payFetch.pending()).toBeDefined();
    await expect(
      payFetch.fetch("https://merchant.example/weather"),
    ).rejects.toThrow("PAYMENT_RESUME_REQUIRED");
  });

  it("clears the durable record by its digest after a matching receipt", async () => {
    const mppx = jest.requireMock("mppx") as {
      x402: { Header: { decodePaymentResponse: jest.Mock } };
    };
    mppx.x402.Header.decodePaymentResponse.mockReturnValue(x402Receipt());
    let savedRecord: PendingPaymentRecord | undefined;
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async (record: PendingPaymentRecord) => {
        savedRecord = record;
        return true;
      }),
      clear: jest.fn(async () => true),
    };
    const receiptVerifier = jest.fn(async () => true);
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      pendingPaymentStore: store,
      receiptVerifier,
      fetch: async () =>
        new Response(null, {
          status: 200,
          headers: { "PAYMENT-RESPONSE": "receipt" },
        }),
    });

    await payFetch.fetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });

    expect(savedRecord).toBeDefined();
    expect(store.clear).toHaveBeenCalledWith(savedRecord!.digest);
    expect(await payFetch.pending()).toBeUndefined();
    expect(receiptVerifier).toHaveBeenCalledWith({
      protocol: "x402",
      network: "eip155:84532",
      asset: baseSepoliaUsdc,
      authorizationDomain: { name: "USDC", version: "2" },
      authorization: {
        from: account.address,
        to: payTo,
        value: "10000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"11".repeat(32)}`,
      },
      economicEffectId,
      transaction,
    } satisfies PaymentReceiptVerificationInput);
  });

  it("accepts a normal official x402 receipt after Base proves the full effect", async () => {
    const mppx = jest.requireMock("mppx") as {
      x402: { Header: { decodePaymentResponse: jest.Mock } };
    };
    mppx.x402.Header.decodePaymentResponse.mockReturnValue(x402Receipt());
    const rpcFetch = createRpcFetch(matchingRpcFixture());
    const rpcSpy = jest.spyOn(globalThis, "fetch").mockImplementation(rpcFetch);
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async () => true),
      clear: jest.fn(async () => true),
    };
    try {
      const payFetch = createTestClient({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        pendingPaymentStore: store,
        fetch: async () =>
          new Response(null, {
            status: 200,
            headers: { "PAYMENT-RESPONSE": "receipt" },
          }),
      });

      await payFetch.fetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      });

      expect(store.clear).toHaveBeenCalledTimes(1);
      expect(await payFetch.pending()).toBeUndefined();
      expect(rpcFetch).toHaveBeenCalledTimes(4);
    } finally {
      rpcSpy.mockRestore();
    }
  });

  it.each(invalidRpcMutations)(
    "keeps the pending request when Base proves a different %s",
    async (_field, mutate) => {
      const mppx = jest.requireMock("mppx") as {
        x402: { Header: { decodePaymentResponse: jest.Mock } };
      };
      mppx.x402.Header.decodePaymentResponse.mockReturnValue(x402Receipt());
      const fixture = matchingRpcFixture();
      mutate(fixture);
      const rpcSpy = jest
        .spyOn(globalThis, "fetch")
        .mockImplementation(createRpcFetch(fixture));
      try {
        const payFetch = createTestClient({
          account,
          allowHosts: ["merchant.example"],
          maxAmount: "$0.10",
          fetch: async () =>
            new Response(null, {
              status: 200,
              headers: { "PAYMENT-RESPONSE": "receipt" },
            }),
        });

        await expect(
          payFetch.fetch("https://merchant.example/weather", {
            headers: { "PAYMENT-SIGNATURE": "signed-payment" },
          }),
        ).rejects.toThrow("PAYMENT_RECEIPT_MISMATCH");
        expect(await payFetch.pending()).toBeDefined();
      } finally {
        rpcSpy.mockRestore();
      }
    },
  );

  it("keeps the pending request when Base RPC cannot prove the receipt", async () => {
    const mppx = jest.requireMock("mppx") as {
      x402: { Header: { decodePaymentResponse: jest.Mock } };
    };
    mppx.x402.Header.decodePaymentResponse.mockReturnValue(x402Receipt());
    const rpcSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async () => true),
      clear: jest.fn(async () => true),
    };
    try {
      const payFetch = createTestClient({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        pendingPaymentStore: store,
        fetch: async () =>
          new Response(null, {
            status: 200,
            headers: { "PAYMENT-RESPONSE": "receipt" },
          }),
      });

      await expect(
        payFetch.fetch("https://merchant.example/weather", {
          headers: { "PAYMENT-SIGNATURE": "signed-payment" },
        }),
      ).rejects.toThrow("PAYMENT_RECEIPT_UNVERIFIED");
      expect(store.clear).not.toHaveBeenCalled();
      expect(await payFetch.pending()).toBeDefined();
      await expect(
        payFetch.fetch("https://merchant.example/weather"),
      ).rejects.toThrow("PAYMENT_RESUME_REQUIRED");
    } finally {
      rpcSpy.mockRestore();
    }
  });

  it("clears the durable record only after a matching MPP receipt", async () => {
    const mppx = jest.requireMock("mppx") as {
      Credential: { deserialize: jest.Mock };
      Receipt: { deserialize: jest.Mock };
    };
    mppx.Credential.deserialize.mockReturnValue({
      challenge: {
        id: "mpp-challenge",
        realm: "merchant.example",
        method: "evm",
        intent: "charge",
        request: {
          amount: "10000",
          currency: baseSepoliaUsdc,
          recipient: payTo,
          methodDetails: { chainId: 84532, decimals: 6 },
        },
      },
      payload: {
        from: account.address,
        to: payTo,
        value: "10000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"11".repeat(32)}`,
        signature: `0x${"22".repeat(65)}`,
      },
    });
    mppx.Receipt.deserialize.mockReturnValue({
      method: "evm",
      reference: transaction,
      status: "success",
      timestamp: "2026-08-17T00:00:00.000Z",
    });
    let savedRecord: PendingPaymentRecord | undefined;
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async (record: PendingPaymentRecord) => {
        savedRecord = record;
        return true;
      }),
      clear: jest.fn(async () => true),
    };
    const rpcSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(createRpcFetch(matchingRpcFixture()));
    try {
      const payFetch = createTestClient({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        pendingPaymentStore: store,
        fetch: async () =>
          new Response(null, {
            status: 200,
            headers: { "Payment-Receipt": "receipt" },
          }),
      });

      await payFetch.fetch("https://merchant.example/weather", {
        headers: { Authorization: "Payment signed-payment" },
      });

      expect(store.clear).toHaveBeenCalledWith(savedRecord!.digest);
      expect(await payFetch.pending()).toBeUndefined();
    } finally {
      rpcSpy.mockRestore();
    }
  });

  it("keeps the durable slot when an MPP receipt has no matching on-chain proof", async () => {
    const mppx = jest.requireMock("mppx") as {
      Credential: { deserialize: jest.Mock };
      Receipt: { deserialize: jest.Mock };
    };
    mppx.Credential.deserialize.mockReturnValue({
      challenge: {
        id: "mpp-challenge",
        realm: "merchant.example",
        method: "evm",
        intent: "charge",
        request: {
          amount: "10000",
          currency: baseSepoliaUsdc,
          recipient: payTo,
          methodDetails: { chainId: 84532, decimals: 6 },
        },
      },
      payload: {
        from: account.address,
        to: payTo,
        value: "10000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"11".repeat(32)}`,
        signature: `0x${"22".repeat(65)}`,
      },
    });
    mppx.Receipt.deserialize.mockReturnValue({
      method: "evm",
      reference: transaction,
      status: "success",
      timestamp: "2026-08-17T00:00:00.000Z",
    });
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async () => true),
      clear: jest.fn(async () => true),
    };
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      pendingPaymentStore: store,
      receiptVerifier: async () => false,
      fetch: async () =>
        new Response(null, {
          status: 200,
          headers: { "Payment-Receipt": "receipt" },
        }),
    });

    await expect(
      payFetch.fetch("https://merchant.example/weather", {
        headers: { Authorization: "Payment signed-payment" },
      }),
    ).rejects.toThrow("PAYMENT_RECEIPT_MISMATCH");
    expect(store.clear).not.toHaveBeenCalled();
    await expect(
      payFetch.fetch("https://merchant.example/weather"),
    ).rejects.toThrow("PAYMENT_RESUME_REQUIRED");
  });

  it("keeps the pending request when the receipt belongs to another payer", async () => {
    const mppx = jest.requireMock("mppx") as {
      x402: { Header: { decodePaymentResponse: jest.Mock } };
    };
    mppx.x402.Header.decodePaymentResponse.mockReturnValue({
      ...x402Receipt(),
      payer: "0x2222222222222222222222222222222222222222",
    });
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () =>
        new Response(null, {
          status: 200,
          headers: { "PAYMENT-RESPONSE": "receipt" },
        }),
    });

    await expect(
      payFetch.fetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      }),
    ).rejects.toThrow("PAYMENT_RECEIPT_MISMATCH");
    expect(await payFetch.pending()).toBeDefined();
  });

  it("rejects a restored request whose body was changed", async () => {
    let saved: PendingPaymentRecord | undefined;
    const first = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () => new Response(null, { status: 401 }),
      pendingPaymentStore: {
        protection: "aead",
        load: async () => undefined,
        saveIfAbsent: async (record) => {
          saved = record;
          return true;
        },
        clear: async () => true,
      },
    });
    await first.fetch("https://merchant.example/weather", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": "signed-payment",
      },
      body: JSON.stringify({ city: "Shanghai" }),
    });
    const rawFetch = jest.fn(
      async () => new Response(null, { status: 401 }),
    ) as typeof fetch;
    const restored = createPayClient(
      createClientOptions({
        fetch: rawFetch,
        recovery: {
          protection: "aead",
          load: async () => ({
            ...saved!,
            payment: { ...saved!.payment, bodyBase64: "dGFtcGVyZWQ=" },
          }),
          saveIfAbsent: async () => false,
          clear: async () => false,
        },
      }),
    );
    await expect(restored.resume()).rejects.toMatchObject({
      code: "PENDING_PAYMENT_CORRUPT",
    });
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("revalidates maxAmount before resuming a restored credential", async () => {
    let saved: PendingPaymentRecord | undefined;
    const first = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () => new Response(null, { status: 401 }),
      pendingPaymentStore: {
        protection: "aead",
        load: async () => undefined,
        saveIfAbsent: async (record) => {
          saved = record;
          return true;
        },
        clear: async () => true,
      },
    });
    await first.fetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });
    const rawFetch = jest.fn(
      async () => new Response(null, { status: 401 }),
    ) as typeof fetch;
    const restored = createPayClient(
      createClientOptions({
        policy: {
          allowHosts: ["merchant.example"],
          maxAmount: "$0.001",
        },
        recovery: {
          protection: "aead",
          load: async () => saved,
          saveIfAbsent: async () => false,
          clear: async () => false,
        },
        fetch: rawFetch,
      }),
    );

    await expect(restored.resume()).rejects.toThrow("PAYMENT_POLICY_DENIED");
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("rejects a restored credential from another configured network", async () => {
    let saved: PendingPaymentRecord | undefined;
    const first = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () => new Response(null, { status: 401 }),
      pendingPaymentStore: {
        protection: "aead",
        load: async () => undefined,
        saveIfAbsent: async (record) => {
          saved = record;
          return true;
        },
        clear: async () => true,
      },
    });
    await first.fetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });
    const restored = createPayClient(
      createClientOptions({
        network: "eip155:8453",
        recovery: {
          protection: "aead",
          load: async () => saved,
          saveIfAbsent: async () => false,
          clear: async () => false,
        },
      }),
    );

    await expect(restored.resume()).rejects.toMatchObject({
      code: "PENDING_PAYMENT_CONFLICT",
    });
  });

  it("stores bound v3 fields and returns only a redacted pending summary", async () => {
    let saved: PendingPaymentRecord | undefined;
    const recovery = {
      protection: "aead" as const,
      load: async () => undefined,
      saveIfAbsent: async (record: PendingPaymentRecord) => {
        saved = record;
        return true;
      },
      clear: async () => true,
    };
    const client = createPayClient(
      createClientOptions({
        recovery,
        fetch: async () => new Response(null, { status: 401 }),
      }),
    );

    await client.fetch("https://merchant.example/weather", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": "credential-must-stay-secret",
      },
      body: JSON.stringify({ city: "Shanghai" }),
    });

    const expectedUnsigned = {
      version: 3,
      network: "eip155:84532" as const,
      protocolId: "x402-exact-v2-eip3009",
      adapterRevision: "pay-client-v1",
      economicEffectDigest: expectedEconomicEffectDigest(),
      url: "https://merchant.example/weather",
      method: "POST",
      headers: [
        ["accept-payment", "evm/charge"],
        ["content-type", "application/json"],
        ["payment-signature", "credential-must-stay-secret"],
      ] as Array<[string, string]>,
      bodyBase64: "eyJjaXR5IjoiU2hhbmdoYWkifQ==",
    } as const;
    const requestDigest = expectedRequestDigest(expectedUnsigned);
    expect(saved).toEqual({
      digest: requestDigest,
      payment: { ...expectedUnsigned, requestDigest },
    });
    const summary = await client.pending();
    expect(summary).toEqual({
      requestDigest: saved!.payment.requestDigest,
      protocol: "x402",
      protocolId: "x402-exact-v2-eip3009",
      network: "eip155:84532",
      url: "https://merchant.example/weather",
      method: "POST",
    });
    expect(JSON.stringify(summary)).not.toContain(
      "credential-must-stay-secret",
    );
    expect(Object.keys(summary!).sort()).toEqual([
      "method",
      "network",
      "protocol",
      "protocolId",
      "requestDigest",
      "url",
    ]);
  });

  it("binds every serialized field into requestDigest and rejects each mutation", async () => {
    let saved: PendingPaymentRecord | undefined;
    const first = createPayClient(
      createClientOptions({
        recovery: {
          protection: "aead",
          load: async () => undefined,
          saveIfAbsent: async (record) => {
            saved = record;
            return true;
          },
          clear: async () => false,
        },
        fetch: async () => new Response(null, { status: 401 }),
      }),
    );
    await first.fetch("https://merchant.example/weather", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": "signed-payment",
      },
      body: '{"city":"Shanghai"}',
    });

    const mutations: Array<
      [string, (payment: PendingPaymentRecord["payment"]) => void]
    > = [
      ["version", (payment) => Object.assign(payment, { version: 2 })],
      [
        "network",
        (payment) => Object.assign(payment, { network: "eip155:8453" }),
      ],
      [
        "protocolId",
        (payment) =>
          Object.assign(payment, { protocolId: "mpp-evm-charge-v0" }),
      ],
      [
        "adapterRevision",
        (payment) =>
          Object.assign(payment, { adapterRevision: "pay-client-v2" }),
      ],
      [
        "economicEffectDigest",
        (payment) =>
          Object.assign(payment, {
            economicEffectDigest: `0x${"ff".repeat(32)}`,
          }),
      ],
      [
        "url",
        (payment) =>
          Object.assign(payment, { url: "https://merchant.example/other" }),
      ],
      ["method", (payment) => Object.assign(payment, { method: "PUT" })],
      [
        "headers",
        (payment) =>
          Object.assign(payment, {
            headers: [...payment.headers, ["x-mutated", "true"]],
          }),
      ],
      [
        "bodyBase64",
        (payment) => Object.assign(payment, { bodyBase64: "e30=" }),
      ],
    ];

    for (const [field, mutate] of mutations) {
      const payment = structuredClone(saved!.payment);
      mutate(payment);
      const { requestDigest: _requestDigest, ...unsigned } = payment;
      if (expectedRequestDigest(unsigned) === saved!.payment.requestDigest) {
        throw new Error(`${field} is not bound by requestDigest`);
      }
      const rawFetch = jest.fn(async () => new Response(null, { status: 401 }));
      const restored = createPayClient(
        createClientOptions({
          recovery: {
            protection: "aead",
            load: async () => ({ ...saved!, payment }),
            saveIfAbsent: async () => false,
            clear: async () => false,
          },
          fetch: rawFetch,
        }),
      );
      let caught: unknown;
      try {
        await restored.resume();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PayError);
      if (rawFetch.mock.calls.length !== 0) {
        throw new Error(`${field} mutation reached the transport`);
      }
    }
  });

  it("loads into a fresh client and resumes the exact authenticated request bytes", async () => {
    let saved: PendingPaymentRecord | undefined;
    const firstSent: Array<{
      body: Uint8Array;
      headers: Array<[string, string]>;
      method: string;
      url: string;
    }> = [];
    const first = createPayClient(
      createClientOptions({
        recovery: {
          protection: "aead",
          load: async () => undefined,
          saveIfAbsent: async (record) => {
            saved = record;
            return true;
          },
          clear: async () => false,
        },
        fetch: async (input, init) => {
          const request = new Request(input, init);
          firstSent.push({
            body: new Uint8Array(await request.clone().arrayBuffer()),
            headers: Array.from(request.headers.entries()),
            method: request.method,
            url: request.url,
          });
          return new Response(null, { status: 401 });
        },
      }),
    );

    await first.fetch("https://merchant.example/weather", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": "signed-payment",
        "X-Request-Id": "request-123",
      },
      body: '{"city":"Shanghai"}',
    });
    const secondSent: typeof firstSent = [];
    const forbiddenSigner = jest.fn(async () => {
      throw new Error("resume must never sign");
    });
    const second = createPayClient(
      createClientOptions({
        account: { address: account.address, signTypedData: forbiddenSigner },
        recovery: {
          protection: "aead",
          load: async () => saved,
          saveIfAbsent: async () => false,
          clear: async () => false,
        },
        fetch: async (input, init) => {
          const request = new Request(input, init);
          secondSent.push({
            body: new Uint8Array(await request.clone().arrayBuffer()),
            headers: Array.from(request.headers.entries()),
            method: request.method,
            url: request.url,
          });
          return new Response(null, { status: 401 });
        },
      }),
    );
    await second.resume();

    expect(firstSent).toHaveLength(1);
    expect(secondSent).toHaveLength(1);
    expect(secondSent[0]).toEqual(firstSent[0]);
    expect(forbiddenSigner).not.toHaveBeenCalled();
  });

  it("reports a signed 5xx as retryable unknown while keeping recovery state", async () => {
    const client = createPayClient(
      createClientOptions({
        fetch: async () =>
          Response.json(
            { errorCode: "PAYMENT_STATUS_UNKNOWN", paymentId: "pay_123" },
            { status: 503 },
          ),
      }),
    );

    await expect(
      client.fetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_STATUS_UNKNOWN",
      phase: "request",
      retryable: true,
      paymentId: "pay_123",
    });
    await expect(client.pending()).resolves.toBeDefined();
  });

  it("preserves an external failure only as cause and redacts its message", async () => {
    const credential = "credential-super-secret";
    const cause = new Error(`network failed with ${credential}`);
    const client = createPayClient(
      createClientOptions({
        fetch: async () => {
          throw cause;
        },
      }),
    );

    let caught: unknown;
    try {
      await client.fetch("https://merchant.example/weather");
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "PAYMENT_SERVICE_UNAVAILABLE",
      phase: "request",
      retryable: true,
      cause,
    });
    expect((caught as Error).message).not.toContain(credential);
  });

  it("classifies bare offers without treating transport prose as a challenge", async () => {
    const unsupported = createPayClient(
      createClientOptions({
        fetch: async () => new Response(null, { status: 402 }),
      }),
    );
    await expect(
      unsupported.fetch("https://merchant.example/weather"),
    ).rejects.toMatchObject({
      code: "PAYMENT_OFFER_UNSUPPORTED",
      phase: "challenge",
      retryable: false,
    });

    const malformed = createPayClient(
      createClientOptions({
        fetch: async () => {
          throw new Error("invalid payment challenge encoding");
        },
      }),
    );
    await expect(
      malformed.fetch("https://merchant.example/weather"),
    ).rejects.toMatchObject({
      code: "PAYMENT_SERVICE_UNAVAILABLE",
      phase: "request",
      retryable: true,
    });
  });

  it("rejects an rc.6-shaped v3 record before sending or signing", async () => {
    let saved: PendingPaymentRecord | undefined;
    const firstRecovery = {
      protection: "aead" as const,
      load: async () => undefined,
      saveIfAbsent: async (record: PendingPaymentRecord) => {
        saved = record;
        return true;
      },
      clear: async () => true,
    };
    const first = createPayClient(
      createClientOptions({
        recovery: firstRecovery,
        fetch: async () => new Response(null, { status: 401 }),
      }),
    );
    await first.fetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });

    const {
      protocolId: _protocolId,
      adapterRevision: _adapterRevision,
      economicEffectDigest: _economicEffectDigest,
      requestDigest: _requestDigest,
      ...rc6Unsigned
    } = saved!.payment;
    const rc6Payment = {
      ...rc6Unsigned,
      requestDigest: sha256(stringToBytes(JSON.stringify(rc6Unsigned))),
    };
    const rc6Record = {
      digest: rc6Payment.requestDigest,
      payment: rc6Payment,
    } as unknown as PendingPaymentRecord;
    const rawFetch = jest.fn(
      async () => new Response(null, { status: 401 }),
    ) as typeof globalThis.fetch;
    const signTypedData = jest.fn(account.signTypedData.bind(account));
    const restored = createPayClient(
      createClientOptions({
        account: { address: account.address, signTypedData },
        recovery: {
          protection: "aead",
          load: async () => rc6Record,
          saveIfAbsent: async () => false,
          clear: async () => false,
        },
        fetch: rawFetch,
      }),
    );

    await expect(restored.resume()).rejects.toMatchObject({
      code: "PENDING_PAYMENT_VERSION_UNSUPPORTED",
      phase: "recovery",
      retryable: false,
    });
    expect(rawFetch).not.toHaveBeenCalled();
    expect(signTypedData).not.toHaveBeenCalled();
  });

  it("rejects plain HTTP before any request is sent", async () => {
    const rawFetch = jest.fn(async () =>
      Response.json({ ok: true }),
    ) as typeof fetch;
    const payFetch = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
    });

    await expect(
      payFetch.fetch("http://merchant.example/weather"),
    ).rejects.toMatchObject({
      code: "PAY_INSECURE_TRANSPORT",
      phase: "request",
      retryable: false,
    });
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("allows HTTP only for an explicitly enabled exact loopback host", async () => {
    const rawFetch = jest.fn(async () =>
      Response.json({ ok: true }),
    ) as typeof fetch;
    const local = createTestClient({
      account,
      allowHosts: ["127.0.0.1:3000"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      allowInsecureLocalhost: true,
    });
    await expect(
      local.fetch("http://127.0.0.1:3000/weather"),
    ).resolves.toMatchObject({
      status: 200,
    });

    const remote = createTestClient({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      allowInsecureLocalhost: true,
    });
    await expect(
      remote.fetch("http://merchant.example/weather"),
    ).rejects.toThrow("PAY_INSECURE_TRANSPORT");
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });
});
