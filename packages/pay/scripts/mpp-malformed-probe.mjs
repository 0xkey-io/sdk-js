// Local 0xkey regression corpus, not an upstream conformance suite. Public
// package inputs are explicitly supplied; no reference checkout is consumed.
// Usage: node scripts/mpp-malformed-probe.mjs PACKED_CONSUMER NATIVE_CONSUMER
//        0.8.17|0.8.19 require|import
// The packed consumer retains Pay's exact 0.8.19 peer; the separate native
// consumer supplies wire codecs and a direct Mppx server, not a peer override.
import assert from "node:assert/strict";
import { publicModule } from "./x402-boundary-runtime.mjs";

const [app, nativeApp, version, condition = "require"] = process.argv.slice(2);
assert.ok(app && nativeApp && ["0.8.17", "0.8.19"].includes(version));
const inventory = [];
const load = (root, name) => publicModule(root, name, condition, inventory);
const { createPayServer } = await load(app, "@0xkey-io/pay/server");
const { create0xkeyEvmChargeMethod } = await load(app, "@0xkey-io/pay/mpp");
const { createPayClient } = await load(app, "@0xkey-io/pay/client");
const { ApiKeyStamper } = await load(app, "@0xkey-io/api-key-stamper");
const { Challenge, Credential, Receipt } = await load(nativeApp, "mppx");
const { Mppx } = await load(nativeApp, "mppx/server");
const { authorizationDomain, authorizationTypes, challengeHash } = await load(
  nativeApp,
  "mppx/evm",
);
const { privateKeyToAccount } = await load(app, "viem/accounts");
assert.equal(inventory.find((x) => x.name === "mppx").version, version);
const organizationId = "11111111-1111-4111-8111-111111111111";
const payTo = "0x1111111111111111111111111111111111111111";
const paymentId = "22222222-2222-4222-8222-222222222222";
const transaction = `0x${"ab".repeat(32)}`;
const url = "https://merchant.example/paid";
const secretKey = "01234567890123456789012345678901";
const apiKey = {
  publicKey:
    "036b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296",
  privateKey: "0".repeat(63) + "1",
};
const counts = {
  signing: 0,
  stamp: 0,
  fetch: 0,
  settle: 0,
  handler: 0,
  fulfillment: 0,
};
const snapshot = () => ({ ...counts });
const difference = (before) =>
  Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [key, value - before[key]]),
  );
const zero = {
  signing: 0,
  stamp: 0,
  fetch: 0,
  settle: 0,
  handler: 0,
  fulfillment: 0,
};
const rows = [];
const signStamp = ApiKeyStamper.prototype.sign;
ApiKeyStamper.prototype.sign = function (...args) {
  counts.stamp++;
  return signStamp.apply(this, args);
};
const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const signTypedData = account.signTypedData.bind(account);
account.signTypedData = (...args) => {
  counts.signing++;
  return signTypedData(...args);
};
let mode = "success";
async function privateFetch(input, init) {
  counts.fetch++;
  const path = new URL(String(input)).pathname;
  assert.equal(init.redirect, "error");
  if (path.endsWith("/supported"))
    return Response.json({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:84532" }],
      extensions: [],
      signers: {},
    });
  if (path.endsWith("/v1/settlements/charge")) {
    counts.settle++;
    if (mode === "unknown")
      return Response.json(
        { errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true },
        { status: 503 },
      );
    if (mode === "dependency")
      return Response.json(
        { errorCode: "PAYMENT_SERVICE_UNAVAILABLE", retryable: true },
        { status: 502 },
      );
    const body = JSON.parse(init.body);
    assert.equal(body.command.protocolId, "mpp-evm-charge-v0");
    assert.equal(body.command.amount, "10000");
    return Response.json({
      settlement: {
        success: true,
        transaction,
        network: "eip155:84532",
        payer: body.command.payer,
      },
      paymentId,
    });
  }
  if (path.endsWith(`/v1/payments/${paymentId}/fulfillment`)) {
    counts.fulfillment++;
    return new Response(null, { status: 200 });
  }
  throw new Error("unexpected private path");
}
const options = {
  network: "eip155:84532",
  organizationId,
  payTo,
  apiKey,
  facilitatorUrl: "https://private.example",
  fetch: privateFetch,
};
const handler = () => {
  counts.handler++;
  return new Response("paid");
};
const encode = (value) =>
  `Payment ${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
const decode = (value) =>
  JSON.parse(Buffer.from(value.slice("Payment ".length), "base64url"));
async function signed(challenge) {
  const nonce = challengeHash(challenge),
    validBefore = String(Math.floor(Date.now() / 1000) + 300);
  const payload = {
    from: account.address,
    nonce,
    to: challenge.request.recipient,
    type: "authorization",
    validAfter: "0",
    validBefore,
    value: challenge.request.amount,
  };
  payload.signature = await account.signTypedData({
    domain: authorizationDomain({
      authorization: { name: "USDC", version: "2" },
      chainId: 84532,
      currency: challenge.request.currency,
    }),
    message: {
      from: payload.from,
      nonce,
      to: payload.to,
      validAfter: 0n,
      validBefore: BigInt(validBefore),
      value: BigInt(payload.value),
    },
    primaryType: "TransferWithAuthorization",
    types: authorizationTypes,
  });
  return Credential.serialize({ challenge, payload });
}
function corpus(credential) {
  const wire = decode(credential);
  const cases = [
    ["invalid-base64url", "Payment %%%raw-input-sentinel%%%"],
    ["non-json", "Payment dGhpcyBpcyBnYXJiYWdl"],
  ];
  for (const layer of [
    "outer",
    "challenge",
    "payload",
    "request",
    "methodDetails",
  ]) {
    for (const [shape, value] of [
      ["null", null],
      ["array", []],
      ["string", "raw-input-sentinel"],
      ["missing-fields", {}],
    ]) {
      const copy = structuredClone(wire);
      if (layer === "outer") cases.push([`${layer}-${shape}`, encode(value)]);
      else if (layer === "challenge" || layer === "payload") {
        copy[layer] = value;
        cases.push([`${layer}-${shape}`, encode(copy)]);
      } else {
        const request = JSON.parse(
          Buffer.from(copy.challenge.request, "base64url"),
        );
        if (layer === "request")
          copy.challenge.request = Buffer.from(JSON.stringify(value)).toString(
            "base64url",
          );
        else {
          request.methodDetails = value;
          copy.challenge.request = Buffer.from(
            JSON.stringify(request),
          ).toString("base64url");
        }
        cases.push([`${layer}-${shape}`, encode(copy)]);
      }
    }
    const copy = structuredClone(wire);
    if (layer === "outer") copy.rawInputSentinel = "forbidden";
    else if (layer === "challenge" || layer === "payload")
      copy[layer].rawInputSentinel = "forbidden";
    else {
      const request = JSON.parse(
        Buffer.from(copy.challenge.request, "base64url"),
      );
      if (layer === "request") request.rawInputSentinel = "forbidden";
      else request.methodDetails.rawInputSentinel = "forbidden";
      copy.challenge.request = Buffer.from(JSON.stringify(request)).toString(
        "base64url",
      );
    }
    cases.push([`${layer}-unknown-key`, encode(copy)]);
  }
  for (const [label, request] of [
    ["request-not-serialized", {}],
    ["request-invalid-base64url", "%%%"],
    ["request-non-json", "dGhpcyBpcyBnYXJiYWdl"],
  ]) {
    const copy = structuredClone(wire);
    copy.challenge.request = request;
    cases.push([label, encode(copy)]);
  }
  return cases;
}
async function capture(response) {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  };
}
async function malformed(route, credential, label, profile) {
  const before = snapshot();
  const response = await route(
    new Request(url, { headers: { Authorization: credential } }),
  );
  const observed = await capture(response.clone());
  const counters = difference(before);
  rows.push({ profile, label, ...observed, counters });
  console.log(JSON.stringify(rows.at(-1)));
  assert.deepEqual(
    counters,
    zero,
    `${profile}/${label}: no payment side effects`,
  );
  assert.equal(response.status, 402, `${profile}/${label}`);
  assert.match(
    response.headers.get("Content-Type"),
    /^application\/problem\+json/,
  );
  for (const header of [
    "Payment-Receipt",
    "PAYMENT-REQUIRED",
    "PAYMENT-RESPONSE",
  ])
    assert.equal(response.headers.has(header), false);
  const fresh = Challenge.fromResponse(response);
  assert.equal(fresh.method, "evm");
  assert.equal(fresh.intent, "charge");
  assert.ok(Date.parse(fresh.expires) > Date.now());
  const body = JSON.parse(observed.body);
  // Empty typed payload reaches native method validation (not raw decoding).
  // Preserve mppx's InvalidPayloadError instead of duplicating its schema.
  // Empty methodDetails alters the echoed challenge and fails its HMAC check;
  // this is not evidence of rejection by the methodDetails schema itself.
  const problemType =
    label === "payload-missing-fields"
      ? "invalid-payload"
      : label === "methodDetails-missing-fields"
        ? "invalid-challenge"
        : "malformed-credential";
  assert.equal(
    body.type,
    `https://paymentauth.org/problems/${problemType}`,
    `${profile}/${label}`,
  );
  assert.equal(body.status, 402);
  assert.equal(body.challengeId, fresh.id);
  assert.equal(observed.body.includes(credential), false);
  assert.doesNotMatch(
    observed.body,
    /raw-input-sentinel|rawInputSentinel|dGhpcyBpcyBnYXJiYWdl/,
  );
}
try {
  for (const protocols of [["mpp"], ["x402", "mpp"]]) {
    const profile = protocols.join("+");
    const route = createPayServer({
      ...options,
      protocols,
      mppSecretKey: secretKey,
    }).protect({ price: "$0.01" }, handler);
    const offer = await route(new Request(url));
    const credential = await signed(Challenge.fromResponse(offer));
    for (const [label, header] of corpus(credential))
      await malformed(route, header, label, profile);
    await malformed(
      route,
      "Bearer app-token, pAyMeNt dGhpcyBpcyBnYXJiYWdl",
      "case-normalized-carrier",
      profile,
    );
    for (const failure of ["unknown", "dependency"]) {
      mode = failure;
      const before = snapshot();
      const response = await route(
        new Request(url, { headers: { Authorization: credential } }),
      );
      assert.equal(response.status, failure === "unknown" ? 503 : 502);
      for (const header of [
        "WWW-Authenticate",
        "Payment-Receipt",
        "PAYMENT-REQUIRED",
        "PAYMENT-RESPONSE",
      ])
        assert.equal(response.headers.has(header), false);
      assert.deepEqual(difference(before), {
        signing: 0,
        stamp: 1,
        fetch: 1,
        settle: 1,
        handler: 0,
        fulfillment: 0,
      });
      rows.push({
        profile,
        label: failure,
        ...(await capture(response)),
        counters: difference(before),
      });
    }
    mode = "success";
    const before = snapshot();
    const response = await route(
      new Request(url, {
        headers: {
          Authorization: `Bearer app-token, pAyMeNt ${credential.slice(8)}`,
        },
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(Receipt.fromResponse(response).reference, transaction);
    assert.deepEqual(difference(before), {
      signing: 0,
      stamp: 2,
      fetch: 2,
      settle: 1,
      handler: 1,
      fulfillment: 1,
    });
    rows.push({
      profile,
      label: "same-credential-success",
      ...(await capture(response)),
      counters: difference(before),
    });
    const ambiguousBefore = snapshot();
    const ambiguous = await route(
      new Request(url, {
        headers: { Authorization: "Payment %%%", "PAYMENT-SIGNATURE": "x402" },
      }),
    );
    assert.equal(ambiguous.status, 400);
    assert.deepEqual(await ambiguous.clone().json(), {
      errorCode: "AMBIGUOUS_PAYMENT_CREDENTIAL",
      retryable: false,
    });
    assert.deepEqual(difference(ambiguousBefore), zero);
    rows.push({
      profile,
      label: "ambiguous",
      ...(await capture(ambiguous)),
      counters: difference(ambiguousBefore),
    });
  }
  for (const [protocols, headers] of [
    [["x402"], { Authorization: "Payment %%%" }],
    [["mpp"], { "PAYMENT-SIGNATURE": "x402" }],
  ]) {
    const before = snapshot();
    const response = await createPayServer({
      ...options,
      protocols,
      mppSecretKey: secretKey,
    }).protect(
      { price: "$0.01" },
      handler,
    )(new Request(url, { headers }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.clone().json(), {
      errorCode: "PAYMENT_PROTOCOL_NOT_ALLOWED",
      retryable: false,
    });
    assert.deepEqual(difference(before), zero);
    rows.push({
      profile: protocols.join("+"),
      label: "disabled",
      ...(await capture(response)),
      counters: difference(before),
    });
  }
  const direct = Mppx.create({
    methods: [create0xkeyEvmChargeMethod(options)],
    secretKey,
  }).evm.charge({ amount: "0.01" });
  const route = async (request) => {
    const result = await direct(request);
    return result.status === 402
      ? result.challenge
      : result.withReceipt(handler());
  };
  const credential = await signed(
    Challenge.fromResponse(await route(new Request(url))),
  );
  for (const [label, header] of corpus(credential))
    await malformed(route, header, label, "direct-native");
  const before = snapshot(),
    response = await route(
      new Request(url, { headers: { Authorization: credential } }),
    );
  assert.equal(response.status, 200);
  assert.equal(Receipt.fromResponse(response).reference, transaction);
  assert.deepEqual(difference(before), {
    signing: 0,
    stamp: 1,
    fetch: 1,
    settle: 1,
    handler: 1,
    fulfillment: 0,
  });
  rows.push({
    profile: "direct-native",
    label: "success",
    ...(await capture(response)),
    counters: difference(before),
  });
  let record,
    saves = 0,
    clears = 0;
  const sent = [];
  const recoveryRoute = createPayServer({
    ...options,
    protocols: ["mpp"],
    mppSecretKey: secretKey,
  }).protect({ price: "$0.01" }, handler);
  const recovery = {
    protection: "aead",
    async load() {
      return record;
    },
    async saveIfAbsent(value) {
      saves++;
      if (record) return false;
      record = value;
      return true;
    },
    async clear() {
      clears++;
      return false;
    },
  };
  const client = createPayClient({
    account,
    network: "eip155:84532",
    policy: {
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      preference: ["mpp", "x402"],
    },
    recovery,
    verification: {
      verifier: async () => {
        throw new Error("no receipt to verify");
      },
    },
    async fetch(input, init) {
      const request = new Request(input, init);
      assert.equal(request.url, url);
      assert.equal(request.headers.has("PAYMENT-SIGNATURE"), false);
      const credential = request.headers.get("Authorization");
      if (!credential) return recoveryRoute(request);
      sent.push(credential);
      const wire = decode(credential);
      wire.payload.rawInputSentinel = "forbidden";
      const headers = new Headers(request.headers);
      headers.set("Authorization", encode(wire));
      return recoveryRoute(new Request(request, { headers }));
    },
  });
  const recoveryBefore = snapshot();
  const first = await client.fetch(url);
  assert.equal(first.status, 402);
  assert.ok(first.headers.has("WWW-Authenticate"));
  const saved = structuredClone(record);
  assert.ok(saved);
  const resumed = await client.resume();
  assert.equal(resumed.status, 402);
  assert.ok(resumed.headers.has("WWW-Authenticate"));
  assert.deepEqual(record, saved);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
  await assert.rejects(
    client.fetch(url),
    (error) => error.code === "PAYMENT_RESUME_REQUIRED",
  );
  assert.equal(saves, 1);
  assert.equal(clears, 0);
  assert.deepEqual(difference(recoveryBefore), {
    signing: 1,
    stamp: 0,
    fetch: 0,
    settle: 0,
    handler: 0,
    fulfillment: 0,
  });
  rows.push({
    profile: "pay-client",
    label: "malformed-402-zero-resign",
    first: await capture(first),
    resumed: await capture(resumed),
    counters: difference(recoveryBefore),
    saves,
    clears,
    sends: sent.length,
    sameCredential: sent[0] === sent[1],
    pendingUnchanged: true,
  });
  console.log(
    JSON.stringify(
      { version, condition, inventory, rows, counts, passed: rows.length },
      null,
      2,
    ),
  );
} finally {
  ApiKeyStamper.prototype.sign = signStamp;
}
