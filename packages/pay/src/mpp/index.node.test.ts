import assert from "node:assert/strict";
import test from "node:test";
import { Challenge, Credential, Errors } from "mppx";
import { Mppx, Transport } from "mppx/server";
import { authorizationDomain, authorizationTypes, challengeHash } from "mppx/evm";
import { assets, charge } from "mppx/evm/server";
import { privateKeyToAccount } from "viem/accounts";
import { create0xkeyEvmChargeMethod } from "./index.mts";
import { createPayServer } from "../server.ts";

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

test("transport preserves ordinary non-boundary mppx error responses", async () => {
  const method = create0xkeyEvmChargeMethod({
    network: "eip155:84532", organizationId: ORG,
    payTo: "0x1111111111111111111111111111111111111111",
    stamper: { async stampRequest() { return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" }; } },
  });
  const server = Mppx.create({ methods: [method], secretKey: "01234567890123456789012345678901" });
  const request = new Request("https://merchant.example/weather");
  const result = await server.evm.charge({ amount: "0.01" })(request);

  assert.equal(result.status, 402);
  if (result.status !== 402) throw new Error("expected transport response");
  const challenge = Challenge.fromResponse(result.challenge.clone());
  const transport = method.transport as unknown as Transport.Http | undefined;
  assert.ok(transport);
  const response = await transport.respondChallenge({
    challenge,
    error: new Errors.BadRequestError({ reason: "ordinary bad request" }),
    input: request,
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.has("WWW-Authenticate"), true);
  assert.equal((await response.json()).challengeId, challenge.id);
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

test("raw Mppx.create surfaces UNKNOWN as a real 503 without a retry challenge", async () => {
  let settlementCalls = 0;
  const method = create0xkeyEvmChargeMethod({
    network: "eip155:84532",
    organizationId: ORG,
    payTo: "0x1111111111111111111111111111111111111111",
    stamper: {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
      },
    },
    async fetch() {
      settlementCalls += 1;
      return Response.json({
        errorCode: "PAYMENT_STATUS_UNKNOWN",
        retryable: true,
        paymentId: "22222222-2222-4222-8222-222222222222",
      }, { status: 503 });
    },
  });
  const server = Mppx.create({
    methods: [method],
    secretKey: "01234567890123456789012345678901",
  });
  const route = server.evm.charge({ amount: "0.01" });
  const offered = await route(new Request("https://merchant.example/weather"));
  assert.equal(offered.status, 402);
  if (offered.status !== 402) throw new Error("expected challenge");
  const challenge = Challenge.fromResponse(offered.challenge.clone());
  const credential = Credential.serialize({
    challenge,
    payload: await validPayload(challenge),
  });
  const paid = await route(new Request("https://merchant.example/weather", {
    headers: { Authorization: credential },
  }));
  let handlerCalls = 0;
  const response = paid.status === 402
    ? paid.challenge
    : paid.withReceipt((handlerCalls += 1, new Response("paid")));

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "2");
  assert.equal(response.headers.has("WWW-Authenticate"), false);
  assert.equal(response.headers.has("Payment-Receipt"), false);
  assert.equal(handlerCalls, 0);
  assert.equal(settlementCalls, 1);
  assert.deepEqual(await response.json(), {
    type: "https://0xkey.io/pay/problems/settlement-boundary",
    title: "Settlement Boundary Failure",
    status: 503,
    detail: "settlement outcome is indeterminate",
    details: {
      errorCode: "PAYMENT_STATUS_UNKNOWN",
      paymentId: "22222222-2222-4222-8222-222222222222",
      retryable: true,
    },
  });
});

test("raw Mppx.create rejects unknown signed payload keys before settlement transport", async () => {
  let settlementCalls = 0;
  const method = create0xkeyEvmChargeMethod({
    network: "eip155:84532",
    organizationId: ORG,
    payTo: "0x1111111111111111111111111111111111111111",
    stamper: {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" };
      },
    },
    async fetch() {
      settlementCalls += 1;
      throw new Error("must not settle");
    },
  });
  const server = Mppx.create({
    methods: [method],
    secretKey: "01234567890123456789012345678901",
  });
  const route = server.evm.charge({ amount: "0.01" });
  const offered = await route(new Request("https://merchant.example/weather"));
  assert.equal(offered.status, 402);
  if (offered.status !== 402) throw new Error("expected challenge");
  const challenge = Challenge.fromResponse(offered.challenge.clone());
  const credential = Credential.serialize({
    challenge,
    payload: {
      ...await validPayload(challenge),
      providerPrivate: "forbidden",
    },
  });
  const rejected = await route(new Request("https://merchant.example/weather", {
    headers: { Authorization: credential },
  }));

  assert.equal(rejected.status, 402);
  if (rejected.status !== 402) throw new Error("expected payment rejection");
  assert.equal(rejected.challenge.status, 402);
  assert.equal(settlementCalls, 0);
});

test("method construction never mutates the upstream singleton credential schema", () => {
  const unrelated = charge({
    currency: assets.baseSepolia.USDC,
    recipient: "0x1111111111111111111111111111111111111111",
    async settle() { return { reference: `0x${"ab".repeat(32)}` }; },
  });
  const originalParse = unrelated.schema.credential.payload.parse;
  const options = {
    network: "eip155:84532" as const,
    organizationId: ORG,
    payTo: "0x1111111111111111111111111111111111111111" as const,
    stamper: {
      async stampRequest() {
        return { stampHeaderName: "X-Stamp" as const, stampHeaderValue: "signed" };
      },
    },
  };
  create0xkeyEvmChargeMethod(options);
  create0xkeyEvmChargeMethod(options);
  assert.equal(unrelated.schema.credential.payload.parse, originalParse);
});

test("repeated createPayServer challenge construction leaves upstream schema unchanged", async () => {
  const unrelated = charge({
    currency: assets.baseSepolia.USDC,
    recipient: "0x1111111111111111111111111111111111111111",
    async settle() { return { reference: `0x${"ab".repeat(32)}` }; },
  });
  const originalParse = unrelated.schema.credential.payload.parse;
  for (let index = 0; index < 2; index += 1) {
    const seller = createPayServer({
      network: "eip155:84532", organizationId: ORG,
      payTo: "0x1111111111111111111111111111111111111111",
      protocols: ["mpp"], mppSecretKey: "01234567890123456789012345678901",
      apiKey: { publicKey: "unused", privateKey: "unused" },
    });
    const response = await seller.protect({ price: "$0.01" }, () => new Response("paid"))(
      new Request(`https://merchant.example/weather?i=${index}`),
    );
    assert.equal(response.status, 402);
  }
  assert.equal(unrelated.schema.credential.payload.parse, originalParse);
});

for (const target of ["outer", "challenge", "request", "methodDetails"] as const) {
  test(`raw Mppx.create rejects unknown signed ${target} keys before settlement`, async () => {
    let settlementCalls = 0;
    const method = create0xkeyEvmChargeMethod({
      network: "eip155:84532", organizationId: ORG,
      payTo: "0x1111111111111111111111111111111111111111",
      stamper: { async stampRequest() { return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" }; } },
      async fetch() {
        settlementCalls += 1;
        return Response.json({
          settlement: {
            success: true, transaction: `0x${"ab".repeat(32)}`,
            network: "eip155:84532",
          },
          paymentId: "22222222-2222-4222-8222-222222222222",
        });
      },
    });
    const server = Mppx.create({
      methods: [method], secretKey: "01234567890123456789012345678901",
    });
    const route = server.evm.charge({ amount: "0.01" });
    const offered = await route(new Request("https://merchant.example/weather"));
    assert.equal(offered.status, 402);
    if (offered.status !== 402) throw new Error("expected challenge");
    const challenge = Challenge.fromResponse(offered.challenge.clone());
    const wire = decodeCredential(Credential.serialize({
      challenge, payload: await validPayload(challenge),
    }));
    if (target === "outer") wire.providerPrivate = "forbidden";
    else if (target === "challenge") {
      (wire.challenge as Record<string, unknown>).providerPrivate = "forbidden";
    } else {
      const challengeWire = wire.challenge as Record<string, unknown>;
      const requestWire = JSON.parse(Buffer.from(
        challengeWire.request as string,
        "base64url",
      ).toString("utf8")) as Record<string, unknown>;
      if (target === "request") requestWire.providerPrivate = "forbidden";
      else (requestWire.methodDetails as Record<string, unknown>).providerPrivate = "forbidden";
      challengeWire.request = Buffer.from(JSON.stringify(requestWire)).toString("base64url");
    }
    const result = await route(new Request("https://merchant.example/weather", {
      headers: { Authorization: encodeCredential(wire) },
    }));
    assert.equal(result.status, 402);
    assert.equal(settlementCalls, 0);
  });
}

test("raw credential guard accepts every pinned standard challenge field", async () => {
  const method = create0xkeyEvmChargeMethod({
    network: "eip155:84532", organizationId: ORG,
    payTo: "0x1111111111111111111111111111111111111111",
    stamper: { async stampRequest() { return { stampHeaderName: "X-Stamp", stampHeaderValue: "signed" }; } },
  });
  const server = Mppx.create({
    methods: [method], secretKey: "01234567890123456789012345678901",
  });
  const route = server.evm.charge({ amount: "0.01" });
  const offered = await route(new Request("https://merchant.example/weather"));
  assert.equal(offered.status, 402);
  if (offered.status !== 402) throw new Error("expected challenge");
  const challenge = Challenge.fromResponse(offered.challenge.clone());
  const wire = decodeCredential(Credential.serialize({
    challenge, payload: await validPayload(challenge),
  }));
  Object.assign(wire.challenge as Record<string, unknown>, {
    description: "weather",
    digest: "sha-256=YWJj",
    header: "Authorization",
    meta: { tenant: "merchant" },
  });
  const transport = method.transport as unknown as Transport.Http | undefined;
  assert.ok(transport);
  assert.doesNotThrow(() => transport.getCredential(new Request(
    "https://merchant.example/weather",
    { headers: { Authorization: encodeCredential(wire) } },
  )));
});

async function validPayload(challenge: ReturnType<typeof Challenge.fromResponse>) {
  const account = privateKeyToAccount(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  const nonce = challengeHash(challenge);
  const validBefore = (Math.floor(Date.now() / 1000) + 300).toString();
  const { amount, currency, methodDetails, recipient } = challenge.request;
  if (typeof amount !== "string") throw new Error("expected amount string");
  if (typeof currency !== "string") throw new Error("expected currency string");
  assert.match(currency, /^0x[0-9a-fA-F]{40}$/);
  if (typeof recipient !== "string") throw new Error("expected recipient string");
  assert.match(recipient, /^0x[0-9a-fA-F]{40}$/);
  if (!methodDetails || typeof methodDetails !== "object") {
    throw new Error("expected method details object");
  }
  const chainId = (methodDetails as Record<string, unknown>).chainId;
  if (typeof chainId !== "number") throw new Error("expected chain id number");
  const signature = await account.signTypedData({
    domain: authorizationDomain({
      authorization: { name: "USDC", version: "2" },
      chainId,
      currency: currency as `0x${string}`,
    }),
    message: {
      from: account.address,
      nonce,
      to: recipient as `0x${string}`,
      validAfter: 0n,
      validBefore: BigInt(validBefore),
      value: BigInt(amount),
    },
    primaryType: "TransferWithAuthorization",
    types: authorizationTypes,
  });
  return {
    from: account.address,
    nonce,
    signature,
    to: recipient,
    type: "authorization" as const,
    validAfter: "0",
    validBefore,
    value: amount,
  };
}

function decodeCredential(value: string): Record<string, unknown> {
  const encoded = value.replace(/^Payment\s+/i, "");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function encodeCredential(value: Record<string, unknown>): string {
  return `Payment ${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}
