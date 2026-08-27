import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { Credential } from "mppx";
import { createPayServer } from "./server.ts";
import { createPayClient, type PendingPaymentRecord } from "./client.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PAY_TO = "0x1111111111111111111111111111111111111111";
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
  const invalidCredentials = [
    "not-a-credential",
    Credential.serialize({
      ...submitted,
      payload: { ...submitted.payload, value: "9999" },
    }),
    Credential.serialize({
      ...submitted,
      payload: { ...submitted.payload, to: "0x2222222222222222222222222222222222222222" },
    }),
    Credential.serialize({
      ...submitted,
      payload: { ...submitted.payload, validBefore: "1" },
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
