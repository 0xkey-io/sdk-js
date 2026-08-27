import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspect } from "node:util";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { Challenge, Credential } from "mppx";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import { createPayServer, type PayApiKey } from "./server/index.ts";
import { PayError } from "./index.ts";
import { create0xkeyFacilitatorClient } from "./x402/index.mts";
import { create0xkeyEvmChargeMethod } from "./mpp/index.mts";
import { createPayClient, type PendingPaymentRecord } from "./client.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PAY_TO = "0x1111111111111111111111111111111111111111" as const;
const TEST_PAYER = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
).address;
const fixtureRoot = new URL(
  "../../api-key-stamper/src/__fixtures__/",
  import.meta.url,
);
const apiKey = {
  publicKey: readFileSync(new URL("api-key.public", fixtureRoot), "utf8").trim(),
  privateKey: readFileSync(new URL("api-key.private", fixtureRoot), "utf8").trim(),
};

// Public deterministic test vector: P-256 generator, private scalar 1.
const syntheticApiKey = Object.freeze({
  publicKey: "036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
  privateKey: "0000000000000000000000000000000000000000000000000000000000000001",
});

const invalidApiKeys: ReadonlyArray<readonly [string, unknown]> = [
  ["malformed synthetic key", { publicKey: "synthetic-public-key", privateKey: "synthetic-private-key" }],
  ["missing key", undefined],
  ["null key", null],
  ["non-object key", "synthetic-api-key"],
  ["missing public key", { privateKey: syntheticApiKey.privateKey }],
  ["missing private key", { publicKey: syntheticApiKey.publicKey }],
  ["non-string public key", { ...syntheticApiKey, publicKey: 123 }],
  ["non-string private key", { ...syntheticApiKey, privateKey: 123 }],
  ["empty public key", { ...syntheticApiKey, publicKey: "" }],
  ["empty private key", { ...syntheticApiKey, privateKey: "" }],
  ["short public key", { ...syntheticApiKey, publicKey: syntheticApiKey.publicKey.slice(2) }],
  ["long public key", { ...syntheticApiKey, publicKey: `${syntheticApiKey.publicKey}00` }],
  ["short private key", { ...syntheticApiKey, privateKey: "01" }],
  ["long private key", { ...syntheticApiKey, privateKey: `00${syntheticApiKey.privateKey}` }],
  ["odd private key", { ...syntheticApiKey, privateKey: syntheticApiKey.privateKey.slice(1) }],
  ["non-hex public key", { ...syntheticApiKey, publicKey: `03${"gg".repeat(32)}` }],
  ["non-hex private key", { ...syntheticApiKey, privateKey: "gg".repeat(32) }],
  ["prefixed public key", { ...syntheticApiKey, publicKey: `0x${syntheticApiKey.publicKey}` }],
  ["prefixed private key", { ...syntheticApiKey, privateKey: `0x${syntheticApiKey.privateKey}` }],
  ["public key with trailing newline", { ...syntheticApiKey, publicKey: `${syntheticApiKey.publicKey}\n` }],
  ["private key with trailing newline", { ...syntheticApiKey, privateKey: `${syntheticApiKey.privateKey}\n` }],
  ["uncompressed public key", { ...syntheticApiKey, publicKey: `04${syntheticApiKey.publicKey.slice(2)}4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5` }],
  ["invalid public prefix", { ...syntheticApiKey, publicKey: `05${syntheticApiKey.publicKey.slice(2)}` }],
  ["off-curve public key", { ...syntheticApiKey, publicKey: `03${"ff".repeat(32)}` }],
  ["zero scalar", { ...syntheticApiKey, privateKey: "00".repeat(32) }],
  ["scalar at group order", { ...syntheticApiKey, privateKey: "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551" }],
  ["scalar above group order", { ...syntheticApiKey, privateKey: "ff".repeat(32) }],
  ["mismatched pair", { ...syntheticApiKey, privateKey: "0000000000000000000000000000000000000000000000000000000000000002" }],
  ["opposite public parity", { ...syntheticApiKey, publicKey: `02${syntheticApiKey.publicKey.slice(2)}` }],
];

function assertRedactedKeyError(error: unknown, key: unknown): boolean {
  assert.ok(error instanceof PayError);
  assert.equal(error.code, "PAY_PROFILE_INVALID");
  assert.equal(error.phase, "configuration");
  assert.equal(error.retryable, false);
  assert.equal(Object.hasOwn(error, "paymentId"), false);
  assert.equal(error.cause, undefined);
  const diagnostics = `${String(error)}\n${JSON.stringify(error)}\n${inspect(error, { showHidden: true })}`;
  const values = typeof key === "object" && key !== null ? Object.values(key) : [key];
  for (const value of [...values, syntheticApiKey.publicKey, syntheticApiKey.privateKey]) {
    if (typeof value === "string" && value.length >= 4) {
      assert.equal(diagnostics.includes(value), false, "key material must be redacted");
    }
  }
  return true;
}

for (const protocols of [["x402"], ["mpp"], ["x402", "mpp"]] as const) {
  test(`server rejects invalid API keys synchronously before ${protocols.join("+")} offers`, () => {
    let networkCalls = 0;
    for (const [label, key] of invalidApiKeys) {
      assert.throws(() => {
        createPayServer({
          network: "eip155:84532", organizationId: ORG, payTo: PAY_TO,
          protocols, mppSecretKey: "01234567890123456789012345678901",
          apiKey: key as PayApiKey,
          async fetch() { networkCalls += 1; throw new Error("unexpected transport"); },
        });
      }, (error) => assertRedactedKeyError(error, key), label);
    }
    assert.equal(networkCalls, 0);
  });

  test(`valid frozen API keys still offer ${protocols.join("+")} without invoking the handler`, async () => {
    // n - 1 is valid and its public point is the generator with opposite parity.
    const key = Object.freeze({
      publicKey: `02${syntheticApiKey.publicKey.slice(2)}`.toUpperCase(),
      privateKey: "FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632550",
    });
    let handlerCalls = 0;
    const server = createPayServer({
      network: "eip155:84532", organizationId: ORG, payTo: PAY_TO, apiKey: key,
      protocols, mppSecretKey: "01234567890123456789012345678901",
      async fetch() {
        return Response.json({
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
          extensions: [], signers: {},
        });
      },
    });
    const response = await server.protect({ price: "$0.01" }, () => {
      handlerCalls += 1;
      return new Response("must not run");
    })(new Request("https://merchant.example/weather"));
    assert.equal(response.status, 402);
    assert.equal(response.headers.has("PAYMENT-REQUIRED"), protocols.some((protocol) => protocol === "x402"));
    assert.equal(response.headers.has("WWW-Authenticate"), protocols.some((protocol) => protocol === "mpp"));
    assert.equal(handlerCalls, 0);
  });
}

for (const [label, create] of [
  ["x402", create0xkeyFacilitatorClient],
  ["mpp", create0xkeyEvmChargeMethod],
] as const) {
  test(`${label} adapter rejects invalid API keys synchronously with redacted configuration errors`, () => {
    let networkCalls = 0;
    for (const [caseName, key] of invalidApiKeys) {
      assert.throws(() => create({
        network: "eip155:84532", organizationId: ORG, payTo: PAY_TO,
        apiKey: key as PayApiKey,
        async fetch() { networkCalls += 1; throw new Error("unexpected transport"); },
      }), (error) => assertRedactedKeyError(error, key), caseName);
    }
    assert.equal(networkCalls, 0);
  });

  test(`${label} adapter preserves custom stamper injection and exactly-one authentication`, () => {
    let stampCalls = 0;
    const options = {
      network: "eip155:84532" as const, organizationId: ORG, payTo: PAY_TO,
    };
    const stamper = {
      async stampRequest() {
        stampCalls += 1;
        return { stampHeaderName: "X-Stamp" as const, stampHeaderValue: "external-stamper" };
      },
    };
    assert.doesNotThrow(() => create({ ...options, stamper }));
    assert.doesNotThrow(() => create({ ...options, apiKey: syntheticApiKey }));
    assert.equal(stampCalls, 0);
    assert.throws(() => create(options), (error) => assertRedactedKeyError(error, undefined));
    assert.throws(() => create({ ...options, stamper, apiKey: syntheticApiKey }),
      (error) => assertRedactedKeyError(error, syntheticApiKey));
  });
}

function settlementEnvelope(transaction: string, paymentId: string, payer = TEST_PAYER) {
  return {
    settlement: {
      success: true,
      transaction,
      network: "eip155:84532",
      payer,
    },
    paymentId,
  };
}

test("protect emits independent standard offers and rejects ambiguous credentials", async () => {
  const calls: string[] = [];
  const server = createPayServer({
    network: "eip155:84532",
    organizationId: ORG,
    payTo: PAY_TO,
    apiKey,
    mppSecretKey: "01234567890123456789012345678901",
    async fetch(url) {
      calls.push(String(url));
      return Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
        extensions: [],
        signers: {},
      });
    },
  });
  let handlerCalls = 0;
  const protectedRoute = server.protect({ price: "$0.01", description: "weather" }, () => {
    handlerCalls += 1;
    return Response.json({ weather: "sunny" });
  });

  const challenge = await protectedRoute(new Request("https://merchant.example/weather"));
  assert.equal(challenge.status, 402);
  assert.equal(challenge.headers.has("PAYMENT-REQUIRED"), true);
  assert.equal(challenge.headers.has("WWW-Authenticate"), true);
  const x402 = decodePaymentRequiredHeader(challenge.headers.get("PAYMENT-REQUIRED")!);
  assert.deepEqual(x402.accepts[0]?.extra, {
    assetTransferMethod: "eip3009",
    name: "USDC",
    paymentFlow: "upfront",
    version: "2",
  });
  assert.equal(handlerCalls, 0);
  assert.deepEqual(calls, ["https://api-pay.0xkey.io/base-sepolia/supported"]);

  const ambiguous = await protectedRoute(
    new Request("https://merchant.example/weather", {
      headers: {
        Authorization: "Bearer app-token, pAyMeNt native",
        "PAYMENT-SIGNATURE": "x402",
      },
    }),
  );
  assert.equal(ambiguous.status, 400);
  assert.deepEqual(await ambiguous.json(), {
    errorCode: "AMBIGUOUS_PAYMENT_CREDENTIAL",
    retryable: false,
  });
  assert.equal(handlerCalls, 0);
});

test("route capability discovery clears rejected initialization and recovers on the next request", async () => {
  let supportedCalls = 0;
  const server = createPayServer({
    network: "eip155:84532", organizationId: ORG, payTo: PAY_TO, apiKey,
    protocols: ["x402"],
    async fetch() {
      supportedCalls += 1;
      if (supportedCalls === 1) return new Response(null, { status: 503 });
      return Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
        extensions: [], signers: {},
      });
    },
  });
  const route = server.protect({ price: "$0.01" }, () => new Response("must not run"));
  const failed = await route(new Request("https://merchant.example/weather?i=0"));
  assert.equal(failed.status, 502);
  const recovered = await route(new Request("https://merchant.example/weather?i=1"));
  assert.equal(recovered.status, 402);
  assert.equal(supportedCalls, 2);
});

test("route capability initialization is single-flight for concurrent first requests", async () => {
  let supportedCalls = 0;
  let releaseSupported!: () => void;
  let supportedStarted!: () => void;
  const supportedGate = new Promise<void>((resolve) => {
    releaseSupported = resolve;
  });
  const supportedEntered = new Promise<void>((resolve) => {
    supportedStarted = resolve;
  });
  const server = createPayServer({
    network: "eip155:84532", organizationId: ORG, payTo: PAY_TO, apiKey,
    protocols: ["x402"],
    async fetch() {
      supportedCalls += 1;
      supportedStarted();
      await supportedGate;
      return Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
        extensions: [], signers: {},
      });
    },
  });
  const route = server.protect({ price: "$0.01" }, () => new Response("must not run"));
  const first = route(new Request("https://merchant.example/weather?i=0"));
  const second = route(new Request("https://merchant.example/weather?i=1"));
  await supportedEntered;
  assert.equal(supportedCalls, 1);
  releaseSupported();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map(({ status }) => status), [402, 402]);
  assert.equal(supportedCalls, 1);
});

test("route capability success has bounded freshness and observes later admission changes", async () => {
  const originalNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    let supportedCalls = 0;
    const server = createPayServer({
      network: "eip155:84532", organizationId: ORG, payTo: PAY_TO, apiKey,
      protocols: ["x402"],
      async fetch() {
        supportedCalls += 1;
        return Response.json({
          kinds: supportedCalls === 1
            ? []
            : [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
          extensions: [], signers: {},
        });
      },
    });
    const route = server.protect({ price: "$0.01" }, () => new Response("must not run"));
    const unavailable = await route(new Request("https://merchant.example/weather?i=0"));
    assert.equal(unavailable.status, 502);
    const recovered = await route(new Request("https://merchant.example/weather?i=1"));
    assert.equal(recovered.status, 402);
    assert.equal(supportedCalls, 2);
  } finally {
    Date.now = originalNow;
  }
});

test("x402 protect verifies and settles before the handler, strips paymentId, and persists fulfillment", async () => {
  const events: string[] = [];
  const transaction = `0x${"ab".repeat(32)}`;
  const paymentId = "22222222-2222-4222-8222-222222222222";
  let supportedCalls = 0;
  const server = createPayServer({
    network: "eip155:84532",
    organizationId: ORG,
    payTo: PAY_TO,
    apiKey,
    protocols: ["x402"],
    async fetch(url, init) {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/supported")) {
        supportedCalls += 1;
        return Response.json({
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
          extensions: [],
          signers: {},
        });
      }
      if (path.endsWith("/verify")) {
        events.push("verify");
        assert.equal(init?.redirect, "error");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.organizationId, ORG);
        assert.equal(body.paymentRequirements.extra.paymentFlow, "upfront");
        assert.equal("paymentId" in body.paymentPayload, false);
        return Response.json({
          isValid: true,
          payer: body.paymentPayload.payload.authorization.from,
        });
      }
      if (path.endsWith("/v1/settlements/charge")) {
        events.push("settle");
        assert.equal(init?.redirect, "error");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.organizationId, ORG);
        assert.equal(body.command.protocolId, "x402-exact-v2-eip3009");
        assert.equal(body.command.adapterRevision, "x402-exact-v2");
        assert.equal(body.command.network, "eip155:84532");
        assert.equal(body.command.payTo, PAY_TO);
        assert.equal("paymentPayload" in body, false);
        return Response.json(settlementEnvelope(transaction, paymentId, body.command.payer));
      }
      if (path.endsWith(`/v1/payments/${paymentId}/fulfillment`)) {
        events.push("fulfillment");
        assert.equal(init?.method, "PUT");
        assert.equal(init?.redirect, "error");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          organizationId: ORG,
          state: "FULFILLED",
          handlerRevision: "weather-v1",
        });
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    },
    handlerRevision: "weather-v1",
  });
  const route = server.protect({ price: "$0.01" }, ({ paymentId: contextId, protocol }) => {
    events.push("handler");
    assert.equal(contextId, paymentId);
    assert.equal(protocol, "x402");
    return Response.json({ weather: "sunny" });
  });
  let paymentSignature = "";
  const merchantFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    paymentSignature = request.headers.get("PAYMENT-SIGNATURE") ?? paymentSignature;
    return route(request);
  };
  const account = privateKeyToAccount(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  const buyer = new x402Client().register(
    "eip155:84532",
    new ExactEvmScheme(toClientEvmSigner(account)),
  );

  const response = await wrapFetchWithPayment(merchantFetch, buyer)(
    "https://merchant.example/weather",
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { weather: "sunny" });
  assert.deepEqual(events, ["verify", "settle", "handler", "fulfillment"]);
  assert.equal(supportedCalls, 1, "route capability discovery must be cached for signed requests");
  const receipt = JSON.parse(
    Buffer.from(response.headers.get("PAYMENT-RESPONSE")!, "base64url").toString("utf8"),
  );
  assert.equal(receipt.transaction, transaction);
  assert.equal("paymentId" in receipt, false);

  const failureUpdates: unknown[] = [];
  const failureServer = createPayServer({
    network: "eip155:84532",
    organizationId: ORG,
    payTo: PAY_TO,
    apiKey,
    protocols: ["x402"],
    async fetch(url, init) {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/supported")) {
        return Response.json({
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
          extensions: [],
          signers: {},
        });
      }
      if (path.endsWith("/verify")) {
        const body = JSON.parse(String(init?.body));
        return Response.json({
          isValid: true,
          payer: body.paymentPayload.payload.authorization.from,
        });
      }
      if (path.endsWith("/v1/settlements/charge")) {
        return Response.json(settlementEnvelope(transaction, paymentId));
      }
      if (path.endsWith(`/v1/payments/${paymentId}/fulfillment`)) {
        failureUpdates.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const signedRequest = () =>
    new Request("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": paymentSignature },
    });
  const fiveHundred = await failureServer.protect({ price: "$0.01" }, () =>
    new Response("merchant failed", { status: 500 }),
  )(signedRequest());
  assert.equal(fiveHundred.status, 500);
  assert.ok(fiveHundred.headers.has("PAYMENT-RESPONSE"));
  const thrown = await failureServer.protect({ price: "$0.01" }, () => {
    throw new Error("sensitive handler exception");
  })(signedRequest());
  assert.equal(thrown.status, 500);
  assert.ok(thrown.headers.has("PAYMENT-RESPONSE"));
  assert.doesNotMatch(await thrown.text(), /sensitive/);
  assert.deepEqual(failureUpdates, [
    { organizationId: ORG, state: "FAILED", failureCode: "HANDLER_ERROR" },
    { organizationId: ORG, state: "FAILED", failureCode: "HANDLER_ERROR" },
  ]);
});

test("x402 valid credentials surface fail-closed verify and indeterminate settle outcomes without a new challenge", async () => {
  let paymentSignature = "";
  const account = privateKeyToAccount(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  const buyer = new x402Client().register(
    "eip155:84532",
    new ExactEvmScheme(toClientEvmSigner(account)),
  );
  const captureServer = createPayServer({
    network: "eip155:84532", organizationId: ORG, payTo: PAY_TO, apiKey,
    protocols: ["x402"],
    async fetch() {
      return Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
        extensions: [], signers: {},
      });
    },
  });
  const captureRoute = captureServer.protect({ price: "$0.01" }, () => new Response());
  await wrapFetchWithPayment((input, init) => {
    const request = new Request(input, init);
    paymentSignature = request.headers.get("PAYMENT-SIGNATURE") ?? paymentSignature;
    return captureRoute(request);
  }, buyer)("https://merchant.example/weather");
  assert.ok(paymentSignature);

  const run = async (failure: "verify" | "settle" | "settle-redirect" | "settle-conflict" | "settle-rejected") => {
    let handlerCalls = 0;
    let settleCalls = 0;
    const server = createPayServer({
      network: "eip155:84532", organizationId: ORG, payTo: PAY_TO, apiKey,
      protocols: ["x402"],
      async fetch(url, init) {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/supported")) return Response.json({
          kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
          extensions: [], signers: {},
        });
        if (path.endsWith("/verify")) {
          if (failure === "verify") return new Response(null, { status: 503 });
          const body = JSON.parse(String(init?.body));
          return Response.json({ isValid: true, payer: body.paymentPayload.payload.authorization.from });
        }
        if (path.endsWith("/v1/settlements/charge")) {
          settleCalls += 1;
          assert.equal(init?.redirect, "error");
          if (failure === "settle-conflict") {
            return Response.json({
              errorCode: "PAYMENT_INTENT_CONFLICT",
              retryable: false,
              paymentId: "22222222-2222-4222-8222-222222222222",
            }, { status: 409 });
          }
          if (failure === "settle-rejected") {
            return Response.json({
              settlement: {
                success: false,
                transaction: "",
                network: "eip155:84532",
              },
              paymentId: "22222222-2222-4222-8222-222222222222",
            });
          }
          return failure === "settle-redirect"
            ? Response.redirect("https://redirect-target.example/credential", 302)
            : new Response(null, { status: 503 });
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });
    const response = await server.protect({ price: "$0.01" }, () => {
      handlerCalls += 1;
      return new Response("must not run");
    })(new Request("https://merchant.example/weather", {
      headers: { "PAYMENT-SIGNATURE": paymentSignature },
    }));
    assert.equal(handlerCalls, 0);
    assert.equal(settleCalls, failure === "verify" ? 0 : 1);
    assert.equal(
      response.status,
      failure === "verify" ? 502
        : failure === "settle-conflict" ? 409
        : failure === "settle-rejected" ? 402
        : 503,
    );
    assert.equal(response.headers.has("PAYMENT-REQUIRED"), false);
    assert.equal(
      response.headers.has("PAYMENT-RESPONSE"),
      failure === "settle-rejected",
    );
    if (failure !== "settle-rejected") {
      assert.deepEqual(await response.json(), failure === "settle-conflict"
        ? { errorCode: "PAYMENT_INTENT_CONFLICT", retryable: false }
        : {
            errorCode: failure === "verify" ? "PAYMENT_SERVICE_UNAVAILABLE" : "PAYMENT_STATUS_UNKNOWN",
            retryable: true,
          });
    }
  };
  await run("verify");
  await run("settle");
  await run("settle-redirect");
  await run("settle-conflict");
  await run("settle-rejected");

  const decoded = JSON.parse(Buffer.from(paymentSignature, "base64url").toString("utf8"));
  decoded.accepted.extra.organizationId = "private";
  const invalid = Buffer.from(JSON.stringify(decoded)).toString("base64url");
  let invalidSettleCalls = 0;
  let invalidHandlerCalls = 0;
  const invalidServer = createPayServer({
    network: "eip155:84532", organizationId: ORG, payTo: PAY_TO, apiKey,
    protocols: ["x402"],
    async fetch(url) {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/supported")) return Response.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
        extensions: [], signers: {},
      });
      if (path.endsWith("/v1/settlements/charge")) invalidSettleCalls += 1;
      throw new Error("must not call dependency");
    },
  });
  const invalidResponse = await invalidServer.protect({ price: "$0.01" }, () => {
    invalidHandlerCalls += 1;
    return new Response();
  })(new Request("https://merchant.example/weather", {
    headers: { "PAYMENT-SIGNATURE": invalid },
  }));
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    errorCode: "PAYMENT_CREDENTIAL_INVALID", retryable: false,
  });
  assert.equal(invalidSettleCalls, 0);
  assert.equal(invalidHandlerCalls, 0);
});

test("server validates protocol configuration and conditional MPP secret", () => {
  const base = {
    network: "eip155:84532" as const,
    organizationId: ORG,
    payTo: PAY_TO,
    apiKey,
  };
  assert.throws(() => createPayServer({ ...base, protocols: [] }), /PAY_PROFILE_INVALID/);
  assert.throws(() => createPayServer({ ...base, protocols: ["mpp"] }), /PAY_PROFILE_INVALID/);
  assert.doesNotThrow(() => createPayServer({ ...base, protocols: ["x402"] }));
});

for (const protocols of [["mpp"], ["x402", "mpp"]] as const) {
  for (const [label, encoded] of [
    ["invalid base64url", "%%%not-base64url%%%"],
    ["non-JSON", "dGhpcyBpcyBnYXJiYWdl"],
  ]) {
    test(`selected MPP ${label} keeps native malformed-credential response (${protocols.join("+")})`, async (t) => {
      // A seller preflight that returns custom 400 breaks this native contract.
      let fetchCalls = 0;
      let handlerCalls = 0;
      const stamp = t.mock.method(ApiKeyStamper.prototype, "sign");
      const route = createPayServer({
        network: "eip155:84532", organizationId: ORG, payTo: PAY_TO,
        apiKey: syntheticApiKey, protocols,
        mppSecretKey: "01234567890123456789012345678901",
        async fetch() { fetchCalls += 1; throw new Error("unexpected private transport"); },
      }).protect({ price: "$0.01" }, () => {
        handlerCalls += 1;
        return new Response("must not run");
      });
      const response = await route(new Request("https://merchant.example/weather", {
        headers: { Authorization: `Bearer application-token, pAyMeNt ${encoded}` },
      }));
      assert.equal(response.status, 402);
      assert.match(response.headers.get("Content-Type")!, /^application\/problem\+json/);
      assert.equal(response.headers.has("Payment-Receipt"), false);
      assert.equal(response.headers.has("PAYMENT-REQUIRED"), false);
      const challenge = Challenge.fromResponse(response.clone());
      assert.equal(challenge.method, "evm");
      assert.equal(challenge.intent, "charge");
      const body = await response.text();
      const problem = JSON.parse(body);
      assert.equal(problem.type, "https://paymentauth.org/problems/malformed-credential");
      assert.equal(problem.status, 402);
      assert.equal(problem.challengeId, challenge.id);
      assert.equal(body.includes(encoded!), false);
      assert.equal(fetchCalls, 0);
      assert.equal(handlerCalls, 0);
      assert.equal(stamp.mock.callCount(), 0);
    });
  }
}

test("native malformed MPP 402 keeps one signed credential pending across resume", async () => {
  const account = privateKeyToAccount(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  let signingCalls = 0;
  let privateCalls = 0;
  let handlerCalls = 0;
  let clearCalls = 0;
  let saveCalls = 0;
  let record: PendingPaymentRecord | undefined;
  const sent: string[] = [];
  const route = createPayServer({
    network: "eip155:84532", organizationId: ORG, payTo: PAY_TO,
    apiKey: syntheticApiKey, protocols: ["mpp"],
    mppSecretKey: "01234567890123456789012345678901",
    async fetch() { privateCalls += 1; throw new Error("must not settle"); },
  }).protect({ price: "$0.01" }, () => { handlerCalls += 1; return new Response("paid"); });
  const client = createPayClient({
    account: { address: account.address, signTypedData: async (parameters) => {
      signingCalls += 1;
      return account.signTypedData(parameters);
    } },
    network: "eip155:84532",
    policy: { allowHosts: ["merchant.example"], maxAmount: "$0.10", preference: ["mpp", "x402"] },
    recovery: {
      protection: "aead",
      async load() { return record; },
      async saveIfAbsent(value) { saveCalls += 1; if (record) return false; record = value; return true; },
      async clear() { clearCalls += 1; return false; },
    },
    verification: { verifier: async () => { throw new Error("no receipt to verify"); } },
    async fetch(input, init) {
      const request = new Request(input, init);
      assert.equal(request.url, "https://merchant.example/weather");
      assert.equal(request.headers.has("PAYMENT-SIGNATURE"), false);
      const authorization = request.headers.get("Authorization");
      if (!authorization) return route(request);
      sent.push(authorization);
      // Fault injection after save/send: corrupt only the wire copy received
      // by the seller, never the original authenticated pending record.
      const wire = JSON.parse(Buffer.from(authorization.slice(8), "base64url").toString());
      wire.payload.unknownExtension = "rejected";
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Payment ${Buffer.from(JSON.stringify(wire)).toString("base64url")}`);
      return route(new Request(request, { headers }));
    },
  });
  const response = await client.fetch("https://merchant.example/weather");
  assert.equal(response.status, 402);
  assert.equal((await response.json()).type, "https://paymentauth.org/problems/malformed-credential");
  assert.equal(response.headers.has("WWW-Authenticate"), true);
  assert.ok(record);
  const saved = structuredClone(record);
  const resumed = await client.resume();
  assert.equal(resumed.status, 402);
  assert.equal(resumed.headers.has("WWW-Authenticate"), true);
  assert.deepEqual(record, saved);
  await assert.rejects(client.fetch("https://merchant.example/weather"),
    (error: unknown) => error instanceof PayError && error.code === "PAYMENT_RESUME_REQUIRED");
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
  assert.equal(signingCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(clearCalls, 0);
  assert.equal(privateCalls, 0);
  assert.equal(handlerCalls, 0);
});

test("MPP real credential is validated before command settlement and returns a standard receipt", async () => {
  const events: string[] = [];
  const transaction = `0x${"cd".repeat(32)}`;
  const paymentId = "33333333-3333-4333-8333-333333333333";
  let settlementCalls = 0;
  const server = createPayServer({
    network: "eip155:84532",
    organizationId: ORG,
    payTo: PAY_TO,
    apiKey,
    protocols: ["mpp"],
    mppSecretKey: "01234567890123456789012345678901",
    async fetch(url, init) {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/v1/settlements/charge")) {
        settlementCalls += 1;
        events.push("settle");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.organizationId, ORG);
        assert.equal(body.command.protocolId, "mpp-evm-charge-v0");
        assert.equal(body.command.adapterRevision, "mpp-evm-charge-v0");
        assert.equal(body.command.network, "eip155:84532");
        assert.equal(body.command.asset, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
        assert.equal(body.command.amount, "10000");
        assert.equal(body.command.payTo, PAY_TO);
        assert.equal("paymentPayload" in body, false);
        return Response.json(settlementEnvelope(transaction, paymentId, body.command.payer));
      }
      if (path.endsWith(`/v1/payments/${paymentId}/fulfillment`)) {
        events.push("fulfillment");
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const protectedRoute = server.protect({ price: "$0.01" }, ({ protocol, paymentId: id }) => {
    events.push("handler");
    assert.equal(protocol, "mpp");
    assert.equal(id, paymentId);
    return Response.json({ weather: "sunny" });
  });
  const account = privateKeyToAccount(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  let record: PendingPaymentRecord | undefined;
  const recovery = {
    protection: "aead" as const,
    async load() {
      return record;
    },
    async saveIfAbsent(value: PendingPaymentRecord) {
      if (record) return false;
      record = value;
      return true;
    },
    async clear(digest: `0x${string}`) {
      if (record?.digest !== digest) return false;
      record = undefined;
      return true;
    },
  };
  const client = createPayClient({
    account,
    network: "eip155:84532",
    policy: { allowHosts: ["merchant.example"], maxAmount: "$0.10", preference: ["mpp"] },
    recovery,
    verification: { verifier: async () => true },
    fetch: (input, init) => {
      const request = new Request(input, init);
      authorizationHeader = request.headers.get("Authorization") ?? authorizationHeader;
      if (!request.headers.has("Authorization")) return protectedRoute(request);
      const encoded = authorizationHeader.replace(/^Payment\s+/i, "");
      const headers = new Headers(request.headers);
      headers.set("Authorization", `Bearer application-token, pAyMeNt ${encoded}`);
      return protectedRoute(new Request(request, { headers }));
    },
  });

  let authorizationHeader = "";

  const response = await client.fetch("https://merchant.example/weather");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { weather: "sunny" });
  assert.deepEqual(events, ["settle", "handler", "fulfillment"]);
  const receiptHeader = response.headers.get("Payment-Receipt");
  assert.ok(receiptHeader);
  const receiptText = receiptHeader.startsWith("Payment ")
    ? receiptHeader.slice("Payment ".length)
    : receiptHeader;
  const receipt = JSON.parse(Buffer.from(receiptText, "base64url").toString("utf8"));
  assert.equal(receipt.reference, transaction);
  assert.equal("paymentId" in receipt, false);
  assert.equal(record, undefined);

  assert.match(authorizationHeader, /^Payment /);
  const submitted = Credential.deserialize(authorizationHeader);
  assert.ok(submitted.payload && typeof submitted.payload === "object");
  const submittedPayload = submitted.payload as Record<string, unknown>;
  const invalidCredentials = [
    "not-a-credential",
    Credential.serialize({
      ...submitted,
      payload: { ...submittedPayload, value: "9999" },
    }),
    Credential.serialize({
      ...submitted,
      payload: { ...submittedPayload, to: "0x2222222222222222222222222222222222222222" },
    }),
    Credential.serialize({
      ...submitted,
      payload: { ...submittedPayload, validBefore: "1" },
    }),
    Credential.serialize({
      ...submitted,
      challenge: {
        ...submitted.challenge,
        request: {
          ...submitted.challenge.request,
          currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        },
      },
    }),
    Credential.serialize({
      ...submitted,
      challenge: {
        ...submitted.challenge,
        request: {
          ...submitted.challenge.request,
          methodDetails: {
            ...(submitted.challenge.request.methodDetails as object),
            chainId: 8453,
          },
        },
      },
    }),
    Credential.serialize({
      ...submitted,
      challenge: {
        ...submitted.challenge,
        request: {
          ...submitted.challenge.request,
          methodDetails: {
            ...(submitted.challenge.request.methodDetails as object),
            credentialTypes: ["permit2"],
          },
        },
      },
    }),
    (() => {
      const encoded = authorizationHeader.slice("Payment ".length);
      const wire = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      wire.challenge.unknownExtension = { provider: "forbidden" };
      return Buffer.from(JSON.stringify(wire)).toString("base64url");
    })(),
    (() => {
      const encoded = authorizationHeader.slice("Payment ".length);
      const wire = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      wire.payload.provider = "forbidden";
      return Buffer.from(JSON.stringify(wire)).toString("base64url");
    })(),
  ];
  for (const [index, credential] of invalidCredentials.entries()) {
    const response = await protectedRoute(
      new Request("https://merchant.example/weather", {
        headers: { Authorization: credential.startsWith("Payment ") ? credential : `Payment ${credential}` },
      }),
    );
    assert.ok(
      response.status >= 400,
      `invalid credential ${index} unexpectedly returned ${response.status}`,
    );
  }
  assert.equal(settlementCalls, 1, "invalid MPP inputs must fail before settlement transport");

  const secret = "secret-fetch-cause-must-not-be-logged";
  const logged: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => logged.push(values);
  try {
    for (const mode of ["5xx", "timeout", "conflict", "rejected"] as const) {
      let indeterminateHandlerCalls = 0;
      const indeterminateServer = createPayServer({
        network: "eip155:84532", organizationId: ORG, payTo: PAY_TO, apiKey,
        protocols: ["mpp"], mppSecretKey: "01234567890123456789012345678901",
        async fetch() {
          if (mode === "5xx") return new Response(null, { status: 503 });
          if (mode === "conflict") return Response.json({
            errorCode: "PAYMENT_INTENT_CONFLICT", retryable: false,
          }, { status: 409 });
          if (mode === "rejected") return Response.json({
            settlement: { success: false, transaction: "", network: "eip155:84532" },
            paymentId: "22222222-2222-4222-8222-222222222222",
          });
          throw new Error(secret);
        },
      });
      const indeterminate = await indeterminateServer.protect({ price: "$0.01" }, () => {
        indeterminateHandlerCalls += 1;
        return new Response("must not run");
      })(new Request("https://merchant.example/weather", {
        headers: { Authorization: authorizationHeader },
      }));
      assert.equal(indeterminate.status, mode === "conflict" ? 409 : mode === "rejected" ? 402 : 503);
      assert.equal(indeterminate.headers.has("Payment-Receipt"), false);
      if (mode !== "rejected") {
        assert.deepEqual(await indeterminate.json(), mode === "conflict"
          ? { errorCode: "PAYMENT_INTENT_CONFLICT", retryable: false }
          : { errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true });
      }
      assert.equal(indeterminateHandlerCalls, 0);
    }
    assert.doesNotMatch(JSON.stringify(logged), /secret-fetch-cause/);
  } finally {
    console.error = originalConsoleError;
  }

  let fulfillmentSecondHostCalls = 0;
  const redirectFulfillmentServer = createPayServer({
    network: "eip155:84532", organizationId: ORG, payTo: PAY_TO, apiKey,
    protocols: ["mpp"], mppSecretKey: "01234567890123456789012345678901",
    async fetch(url, init) {
      if (String(url).startsWith("https://redirect-target.example")) {
        fulfillmentSecondHostCalls += 1;
      }
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/v1/settlements/charge")) {
        return Response.json(settlementEnvelope(transaction, paymentId));
      }
      if (path.endsWith("/fulfillment")) {
        assert.equal(init?.redirect, "error");
        return Response.redirect("https://redirect-target.example/private-fulfillment", 307);
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const fulfillmentRedirect = await redirectFulfillmentServer.protect(
    { price: "$0.01" },
    () => new Response("paid"),
  )(new Request("https://merchant.example/weather", {
    headers: { Authorization: authorizationHeader },
  }));
  assert.equal(fulfillmentRedirect.status, 503);
  assert.deepEqual(await fulfillmentRedirect.json(), {
    errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true,
  });
  assert.equal(fulfillmentSecondHostCalls, 0);

  let failureUpdate: unknown;
  const failureServer = createPayServer({
    network: "eip155:84532",
    organizationId: ORG,
    payTo: PAY_TO,
    apiKey,
    protocols: ["mpp"],
    mppSecretKey: "01234567890123456789012345678901",
    async fetch(url, init) {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/v1/settlements/charge")) {
        return Response.json(settlementEnvelope(transaction, paymentId));
      }
      if (path.endsWith(`/v1/payments/${paymentId}/fulfillment`)) {
        failureUpdate = JSON.parse(String(init?.body));
        return new Response(null, { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const failureRoute = failureServer.protect({ price: "$0.01" }, () =>
    new Response("merchant failed", { status: 500 }),
  );
  const failed = await failureRoute(
    new Request("https://merchant.example/weather", {
      headers: { Authorization: authorizationHeader },
    }),
  );
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.has("Payment-Receipt"), false);
  assert.deepEqual(failureUpdate, {
    organizationId: ORG,
    state: "FAILED",
    failureCode: "HANDLER_ERROR",
  });

  const replayIds: string[] = [];
  const createRestartRoute = (fulfillmentStatus: number) => {
    const restartServer = createPayServer({
      network: "eip155:84532",
      organizationId: ORG,
      payTo: PAY_TO,
      apiKey,
      protocols: ["mpp"],
      mppSecretKey: "01234567890123456789012345678901",
      async fetch(url) {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/v1/settlements/charge")) {
          return Response.json(settlementEnvelope(transaction, paymentId));
        }
        if (path.endsWith(`/v1/payments/${paymentId}/fulfillment`)) {
          return new Response(null, { status: fulfillmentStatus });
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });
    return restartServer.protect({ price: "$0.01" }, ({ paymentId: id }) => {
      replayIds.push(id);
      return Response.json({ replay: true });
    });
  };
  const unresolved = await createRestartRoute(503)(
    new Request("https://merchant.example/weather", {
      headers: { Authorization: authorizationHeader },
    }),
  );
  assert.equal(unresolved.status, 503);
  assert.equal(unresolved.headers.get("Retry-After"), "2");
  const recovered = await createRestartRoute(200)(
    new Request("https://merchant.example/weather", {
      headers: { Authorization: authorizationHeader },
    }),
  );
  assert.equal(recovered.status, 200);
  assert.ok(recovered.headers.has("Payment-Receipt"));
  assert.deepEqual(replayIds, [paymentId, paymentId]);

  let concurrentSettlement = 0;
  const concurrentHandlerIds: string[] = [];
  const concurrentServer = createPayServer({
    network: "eip155:84532",
    organizationId: ORG,
    payTo: PAY_TO,
    apiKey,
    protocols: ["mpp"],
    mppSecretKey: "01234567890123456789012345678901",
    async fetch(url) {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/v1/settlements/charge")) {
        concurrentSettlement += 1;
        const id = `77777777-7777-4777-8777-77777777777${concurrentSettlement}`;
        if (concurrentSettlement === 1) await new Promise((resolve) => setTimeout(resolve, 5));
        return Response.json(settlementEnvelope(transaction, id));
      }
      if (path.includes("/fulfillment")) return new Response(null, { status: 200 });
      throw new Error(`unexpected URL ${url}`);
    },
  });
  const concurrentRoute = concurrentServer.protect(
    { price: "$0.01" },
    ({ paymentId: id }) => {
      concurrentHandlerIds.push(id);
      return Response.json({ ok: true });
    },
  );
  const concurrentResponses = await Promise.all([
    concurrentRoute(new Request("https://merchant.example/weather", {
      headers: { Authorization: authorizationHeader },
    })),
    concurrentRoute(new Request("https://merchant.example/weather", {
      headers: { Authorization: authorizationHeader },
    })),
  ]);
  assert.deepEqual(concurrentResponses.map(({ status }) => status), [200, 200]);
  assert.deepEqual(concurrentHandlerIds.sort(), [
    "77777777-7777-4777-8777-777777777771",
    "77777777-7777-4777-8777-777777777772",
  ]);
});
