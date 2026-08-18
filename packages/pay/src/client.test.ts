import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData, keccak256, stringToHex, type Hex } from "viem";
import {
  createPayFetch as createPayFetchBase,
  type BasePaymentNetwork,
  type CreatePayFetchOptions,
  type PaymentReceiptVerificationInput,
  type PendingPaymentRecord,
} from "./client";

function createPayFetch(
  options: Omit<CreatePayFetchOptions, "network"> & {
    network?: BasePaymentNetwork;
  },
) {
  return createPayFetchBase({
    ...options,
    network: options.network ?? "eip155:84532",
  });
}

jest.mock("mppx", () => ({
  Credential: {
    deserialize: jest.fn(),
    extractPaymentScheme: jest.fn((header: string) =>
      header.startsWith("Payment ") ? header : null,
    ),
  },
  Receipt: { deserialize: jest.fn() },
  x402: {
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
const baseSepoliaUsdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const transaction = `0x${"ab".repeat(32)}`;
const economicEffectId =
  "eip3009:7297f6a4b95314051ed7022053212e243f42dab0269b3ed6ebad7dd0ae6942d6";

describe("network selection", () => {
  it("requires an explicit supported Base network at runtime", () => {
    expect(() =>
      createPayFetchBase({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        allowInMemoryPendingPayment: true,
        receiptVerifier: async () => true,
      } as unknown as CreatePayFetchOptions),
    ).toThrow("PAY_NETWORK_REQUIRED");
  });

  it("rejects networks outside the two supported Base channels", () => {
    expect(() =>
      createPayFetchBase({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        network: "eip155:1" as BasePaymentNetwork,
        allowInMemoryPendingPayment: true,
        receiptVerifier: async () => true,
      }),
    ).toThrow("PAY_NETWORK_UNSUPPORTED");
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

describe("createPayFetch", () => {
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

  it("requires a production receipt RPC before any signature can be made", () => {
    const store = {
      protection: "aead" as const,
      load: async () => undefined,
      saveIfAbsent: async () => true,
      clear: async () => true,
    };
    expect(() =>
      createPayFetchBase({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        network: "eip155:8453",
        pendingPaymentStore: store,
      }),
    ).toThrow("PAY_RECEIPT_RPC_REQUIRED");
    expect(() =>
      createPayFetchBase({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        network: "eip155:8453",
        pendingPaymentStore: store,
        rpcUrls: { "eip155:8453": "https://mainnet.base.org" },
      }),
    ).toThrow("Base public RPC is not for production use");
  });

  it("requires durable pending-payment storage by default", () => {
    expect(() =>
      createPayFetch({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        fetch: async () => Response.json({ ok: true }),
      }),
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
    const payFetch = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      allowInMemoryPendingPayment: true,
    });

    const first = payFetch("https://merchant.example/weather");
    await entered.promise;
    const second = payFetch("https://merchant.example/weather");
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
      return new Response(null, { status: 503 });
    }) as typeof globalThis.fetch;
    const payFetch = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      allowInMemoryPendingPayment: true,
    });

    await payFetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });
    const first = payFetch.resume();
    await entered.promise;
    const second = payFetch.resume();
    release.resolve();

    await expect(second).rejects.toThrow("PAYMENT_IN_PROGRESS");
    await expect(first).resolves.toMatchObject({ status: 503 });
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
      async () => new Response(null, { status: 503 }),
    ) as typeof fetch;
    const payFetch = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      pendingPaymentStore: store,
    });

    const result = payFetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });
    await saveEntered.promise;

    expect(store.load).toHaveBeenCalledTimes(1);
    expect(store.saveIfAbsent).toHaveBeenCalledTimes(1);
    expect(rawFetch).not.toHaveBeenCalled();

    releaseSave.resolve();
    await expect(result).resolves.toMatchObject({ status: 503 });
    expect(rawFetch).toHaveBeenCalledTimes(1);

    await expect(payFetch.resume()).resolves.toMatchObject({ status: 503 });
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
      async () => new Response(null, { status: 503 }),
    ) as typeof fetch;
    const payFetch = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      pendingPaymentStore: store,
    });

    await expect(
      payFetch("https://merchant.example/weather", {
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
      async () => new Response(null, { status: 503 }),
    ) as typeof fetch;
    const payFetch = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      pendingPaymentStore: store,
    });

    await expect(
      payFetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      }),
    ).rejects.toThrow("store unavailable");
    expect(rawFetch).not.toHaveBeenCalled();
    expect(payFetch.hasPendingPayment()).toBe(true);
  });

  it("keeps the signed request after any response without a receipt", async () => {
    const store = {
      protection: "aead" as const,
      load: jest.fn(async () => undefined),
      saveIfAbsent: jest.fn(async () => true),
      clear: jest.fn(async () => true),
    };
    const payFetch = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () => new Response(null, { status: 401 }),
      pendingPaymentStore: store,
    });

    const response = await payFetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });

    expect(response.status).toBe(401);
    expect(payFetch.hasPendingPayment()).toBe(true);
    expect(store.clear).not.toHaveBeenCalled();
    await expect(payFetch("https://merchant.example/weather")).rejects.toThrow(
      "PAYMENT_RESUME_REQUIRED",
    );
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
    const payFetch = createPayFetch({
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
      payFetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      }),
    ).rejects.toThrow("PAYMENT_RECEIPT_MISMATCH");
    expect(store.clear).not.toHaveBeenCalled();
    expect(payFetch.hasPendingPayment()).toBe(true);
    await expect(payFetch("https://merchant.example/weather")).rejects.toThrow(
      "PAYMENT_RESUME_REQUIRED",
    );
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
    const payFetch = createPayFetch({
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
      allowInMemoryPendingPayment: true,
    });

    await payFetch("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });

    expect(savedRecord).toBeDefined();
    expect(store.clear).toHaveBeenCalledWith(savedRecord!.digest);
    expect(payFetch.hasPendingPayment()).toBe(false);
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
      const payFetch = createPayFetch({
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

      await payFetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      });

      expect(store.clear).toHaveBeenCalledTimes(1);
      expect(payFetch.hasPendingPayment()).toBe(false);
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
        const payFetch = createPayFetch({
          account,
          allowHosts: ["merchant.example"],
          maxAmount: "$0.10",
          fetch: async () =>
            new Response(null, {
              status: 200,
              headers: { "PAYMENT-RESPONSE": "receipt" },
            }),
          allowInMemoryPendingPayment: true,
        });

        await expect(
          payFetch("https://merchant.example/weather", {
            headers: { "PAYMENT-SIGNATURE": "signed-payment" },
          }),
        ).rejects.toThrow("PAYMENT_RECEIPT_MISMATCH");
        expect(payFetch.hasPendingPayment()).toBe(true);
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
      const payFetch = createPayFetch({
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
        payFetch("https://merchant.example/weather", {
          headers: { "PAYMENT-SIGNATURE": "signed-payment" },
        }),
      ).rejects.toThrow("PAYMENT_RECEIPT_UNVERIFIED");
      expect(store.clear).not.toHaveBeenCalled();
      expect(payFetch.hasPendingPayment()).toBe(true);
      await expect(
        payFetch("https://merchant.example/weather"),
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
          methodDetails: { chainId: 84532 },
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
      const payFetch = createPayFetch({
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

      await payFetch("https://merchant.example/weather", {
        headers: { Authorization: "Payment signed-payment" },
      });

      expect(store.clear).toHaveBeenCalledWith(savedRecord!.digest);
      expect(payFetch.hasPendingPayment()).toBe(false);
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
          methodDetails: { chainId: 84532 },
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
    const payFetch = createPayFetch({
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
      payFetch("https://merchant.example/weather", {
        headers: { Authorization: "Payment signed-payment" },
      }),
    ).rejects.toThrow("PAYMENT_RECEIPT_MISMATCH");
    expect(store.clear).not.toHaveBeenCalled();
    await expect(payFetch("https://merchant.example/weather")).rejects.toThrow(
      "PAYMENT_RESUME_REQUIRED",
    );
  });

  it("keeps the pending request when the receipt belongs to another payer", async () => {
    const mppx = jest.requireMock("mppx") as {
      x402: { Header: { decodePaymentResponse: jest.Mock } };
    };
    mppx.x402.Header.decodePaymentResponse.mockReturnValue({
      ...x402Receipt(),
      payer: "0x2222222222222222222222222222222222222222",
    });
    const payFetch = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () =>
        new Response(null, {
          status: 200,
          headers: { "PAYMENT-RESPONSE": "receipt" },
        }),
      allowInMemoryPendingPayment: true,
    });

    await expect(
      payFetch("https://merchant.example/weather", {
        headers: { "PAYMENT-SIGNATURE": "signed-payment" },
      }),
    ).rejects.toThrow("PAYMENT_RECEIPT_MISMATCH");
    expect(payFetch.hasPendingPayment()).toBe(true);
  });

  it("rejects a restored request whose body was changed", async () => {
    const first = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () => new Response(null, { status: 503 }),
      allowInMemoryPendingPayment: true,
    });
    await first("https://merchant.example/weather", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": "signed-payment",
      },
      body: JSON.stringify({ city: "Shanghai" }),
    });
    const pending = await first.exportPendingPayment();
    expect(pending).toBeDefined();
    const rawFetch = jest.fn(
      async () => new Response(null, { status: 503 }),
    ) as typeof fetch;
    expect(() =>
      createPayFetch({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        fetch: rawFetch,
        pendingPayment: {
          ...pending!,
          bodyBase64: "dGFtcGVyZWQ=",
        },
        allowInMemoryPendingPayment: true,
      }),
    ).toThrow("PENDING_PAYMENT_CHECKSUM_MISMATCH");
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("revalidates maxAmount before resuming a restored credential", async () => {
    const first = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () => new Response(null, { status: 503 }),
      allowInMemoryPendingPayment: true,
    });
    await first("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });
    const pending = await first.exportPendingPayment();
    const rawFetch = jest.fn(
      async () => new Response(null, { status: 503 }),
    ) as typeof fetch;
    const restored = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.001",
      fetch: rawFetch,
      pendingPayment: pending!,
      allowInMemoryPendingPayment: true,
    });

    await expect(restored.resume()).rejects.toThrow(
      "PENDING_PAYMENT_POLICY_DENIED",
    );
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("rejects a restored credential from another configured network", async () => {
    const first = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: async () => new Response(null, { status: 503 }),
      allowInMemoryPendingPayment: true,
    });
    await first("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": "signed-payment" },
    });
    const pending = await first.exportPendingPayment();

    expect(() =>
      createPayFetchBase({
        account,
        allowHosts: ["merchant.example"],
        maxAmount: "$0.10",
        network: "eip155:8453",
        pendingPayment: pending!,
        receiptVerifier: async () => true,
        allowInMemoryPendingPayment: true,
      }),
    ).toThrow("PENDING_PAYMENT_NETWORK_MISMATCH");
  });

  it("rejects plain HTTP before any request is sent", async () => {
    const rawFetch = jest.fn(async () =>
      Response.json({ ok: true }),
    ) as typeof fetch;
    const payFetch = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      allowInMemoryPendingPayment: true,
    });

    await expect(payFetch("http://merchant.example/weather")).rejects.toThrow(
      "PAY_INSECURE_TRANSPORT",
    );
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it("allows HTTP only for an explicitly enabled exact loopback host", async () => {
    const rawFetch = jest.fn(async () =>
      Response.json({ ok: true }),
    ) as typeof fetch;
    const local = createPayFetch({
      account,
      allowHosts: ["127.0.0.1:3000"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      allowInMemoryPendingPayment: true,
      allowInsecureLocalhost: true,
    });
    await expect(local("http://127.0.0.1:3000/weather")).resolves.toMatchObject(
      {
        status: 200,
      },
    );

    const remote = createPayFetch({
      account,
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      fetch: rawFetch,
      allowInMemoryPendingPayment: true,
      allowInsecureLocalhost: true,
    });
    await expect(remote("http://merchant.example/weather")).rejects.toThrow(
      "PAY_INSECURE_TRANSPORT",
    );
    expect(rawFetch).toHaveBeenCalledTimes(1);
  });
});
