import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  publicModule,
  hash,
  payload,
  requirements,
  transaction,
} from "./x402-boundary-runtime.mjs";

// Actual public native owners; only merchant/store/verifier callbacks are doubles.
// A throwing callback is a signing attempt, never a cryptographic success.
const [app, condition, output] = process.argv.slice(2);
const inventory = [];
const { createPayClient, PayError } = await publicModule(
  app,
  "@0xkey-io/pay/client",
  condition,
  inventory,
);
const wire = await publicModule(app, "@x402/core/http", condition, inventory);
const { Challenge } = await publicModule(app, "mppx", condition, inventory);
const { privateKeyToAccount } = await publicModule(
  app,
  "viem/accounts",
  condition,
  inventory,
);
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
emit({
  type: "versions",
  versions: {
    node: process.versions.node,
    pay: inventory[0].version,
    x402: inventory[1].version,
    mppx: inventory[2].version,
  },
});
let start = "";
for await (const chunk of process.stdin) start += chunk;
assert.deepEqual(JSON.parse(start), { type: "start" });
emit({ type: "ready", port: 0 }); // No listener, not port-binding evidence.

const url = "https://merchant.example/paid";
const rows = [];
async function scenario(label, run) {
  const row = { label, passed: false };
  rows.push(row);
  try {
    await run(row);
    row.passed = true;
  } catch {
    /* No arbitrary error text. */
  }
}
async function caught(run) {
  try {
    await run();
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}
function fields(error, code, phase, retryable = false) {
  assert.equal(error instanceof PayError, true);
  assert.deepEqual(
    [error.code, error.phase, error.retryable, error.paymentId],
    [code, phase, retryable, undefined],
  );
}
function signing(error, cause) {
  fields(error, "PAYMENT_SIGNING_FAILED", "signing");
  assert.equal(
    error.message,
    "PAYMENT_SIGNING_FAILED: Payment credential signing failed",
  );
  assert.equal(error.cause, cause);
  assert.notEqual(error, cause); // Even local caller PayError is explicitly wrapped.
}
function fallback(error, cause, phase = "request") {
  fields(error, "PAYMENT_SERVICE_UNAVAILABLE", phase, true);
  assert.equal(
    error.message,
    "PAYMENT_SERVICE_UNAVAILABLE: Payment service unavailable",
  );
  assert.equal(error.cause, cause);
}
function observe(error, cause) {
  return {
    code: error.code,
    phase: error.phase,
    retryable: error.retryable,
    paymentIdAbsent: error.paymentId === undefined,
    directOriginalCause: error.cause === cause,
    messageSha256: hash(error.message),
  };
}
function challenge(protocol = "x402") {
  return new Response(null, {
    status: 402,
    headers:
      protocol === "x402"
        ? {
            "PAYMENT-REQUIRED": wire.encodePaymentRequiredHeader({
              x402Version: 2,
              resource: { url, description: "fixture", mimeType: "text/plain" },
              accepts: [requirements],
            }),
          }
        : {
            "WWW-Authenticate": Challenge.serialize(
              Challenge.from({
                id: "synthetic-signer-control",
                realm: "merchant.example",
                method: "evm",
                intent: "charge",
                expires: new Date(Date.now() + 300000).toISOString(),
                request: {
                  amount: "10000",
                  currency: requirements.asset,
                  recipient: requirements.payTo,
                  methodDetails: {
                    chainId: 84532,
                    credentialTypes: ["authorization"],
                    decimals: 6,
                  },
                },
              }),
            ),
          },
  });
}
function fixture({ protocol = "x402", signer, load } = {}) {
  const counts = {
    load: 0,
    signAttempt: 0,
    fetch: 0,
    credentialSend: 0,
    save: 0,
    clear: 0,
    verify: 0,
    onReceipt: 0,
  };
  const events = [];
  let stored;
  const state = {
    mode: "challenge",
    failure: undefined,
    sentCredential: undefined,
  };
  const account = signer ?? {
    address: payload.payload.authorization.from,
    async signTypedData() {
      throw new Error("unexpected signer");
    },
  };
  const client = createPayClient({
    account: {
      address: account.address,
      async signTypedData(...args) {
        counts.signAttempt++;
        events.push("sign");
        return account.signTypedData(...args);
      },
    },
    network: "eip155:84532",
    policy: {
      allowHosts: ["merchant.example"],
      maxAmount: "$0.10",
      preference: [protocol],
    },
    recovery: {
      protection: "aead", // Contract-shaped in-memory double, NOT durable storage.
      async load() {
        counts.load++;
        events.push("load");
        if (load) return load();
        return stored;
      },
      async saveIfAbsent(record) {
        counts.save++;
        events.push("save");
        assert.equal(stored, undefined);
        stored = record;
        return true;
      },
      async clear(digest) {
        counts.clear++;
        events.push("clear");
        assert.equal(digest, stored.digest);
        stored = undefined;
        return true;
      },
    },
    verification: {
      verifier: async (input) => {
        counts.verify++;
        events.push("verify");
        assert.equal(input.network, "eip155:84532");
        return true;
      },
    },
    onReceipt() {
      counts.onReceipt++;
      events.push("callback");
    },
    fetch: async (request) => {
      counts.fetch++;
      events.push("fetch");
      const credential =
        request.headers.get("PAYMENT-SIGNATURE") ??
        request.headers.get("Authorization");
      if (credential) {
        counts.credentialSend++;
        events.push("credential-send");
        assert.ok(stored);
        assert.equal(
          stored.payment.headers.some(([, value]) => value === credential),
          true,
        );
        if (state.sentCredential)
          assert.equal(credential, state.sentCredential);
        state.sentCredential = credential;
        if (state.mode === "unknown")
          return new Response(null, { status: 503 });
        if (state.mode === "signed-failure") throw state.failure;
        return new Response("paid", {
          headers: {
            "PAYMENT-RESPONSE": wire.encodePaymentResponseHeader({
              success: true,
              transaction,
              network: requirements.network,
              payer: account.address,
            }),
          },
        });
      }
      if (state.mode === "failure") throw state.failure;
      if (state.mode === "unsigned") return new Response("ordinary");
      return challenge(protocol);
    },
  });
  return { client, counts, state, events, stored: () => stored };
}
const noPayment = {
  load: 1,
  signAttempt: 1,
  fetch: 1,
  credentialSend: 0,
  save: 0,
  clear: 0,
  verify: 0,
  onReceipt: 0,
};
const causes = [
  ["ordinary", new Error("diagnostic PAY_HOST_DENIED PAYMENT_IN_PROGRESS")],
  [
    "local-typed",
    new PayError("PAY_HOST_DENIED", "caller verdict", { phase: "policy" }),
  ],
  ["string", "PAYMENT_SIGNING_FAILED"],
  ["null", null],
  ["undefined", undefined],
  [
    "forged",
    {
      name: "PayError",
      code: "PAY_HOST_DENIED",
      phase: "policy",
      retryable: false,
    },
  ],
  [
    "throwing-message",
    Object.defineProperty(new Error(), "message", {
      get() {
        throw new Error("must not read caller message");
      },
    }),
  ],
];
for (const protocol of ["x402", "mpp"])
  for (const [label, cause] of causes)
    await scenario(`${protocol}-signer-${label}`, async (row) => {
      const f = fixture({
        protocol,
        signer: {
          address: payload.payload.authorization.from,
          async signTypedData() {
            throw cause;
          },
        },
      });
      const error = await caught(() => f.client.fetch(url));
      row.observation = {
        error: observe(error, cause),
        counts: { ...f.counts },
        pendingAbsent: (await f.client.pending()) === undefined,
      };
      assert.deepEqual(f.counts, noPayment);
      assert.equal(f.stored(), undefined);
      assert.equal(row.observation.pendingAbsent, true);
      signing(error, cause);
    });

await scenario("same-client-no-stale-provenance", async (row) => {
  const cause = new Error("original signing cause");
  const f = fixture({
    signer: {
      address: payload.payload.authorization.from,
      async signTypedData() {
        throw cause;
      },
    },
  });
  await caught(() => f.client.fetch(url));
  assert.deepEqual(f.counts, noPayment);
  f.state.mode = "unsigned";
  assert.equal((await f.client.fetch(url)).status, 200);
  for (const failure of [
    new Error("PAYMENT_SIGNING_FAILED: Payment credential signing failed"),
    Object.assign(new Error("PAY_HOST_DENIED"), {
      code: "PAYMENT_SIGNING_FAILED",
      phase: "signing",
      retryable: false,
    }),
    "PAYMENT_IN_PROGRESS",
  ]) {
    f.state.mode = "failure";
    f.state.failure = failure;
    fallback(await caught(() => f.client.fetch(url)), failure);
  }
  assert.equal(await f.client.pending(), undefined);
  fields(
    await caught(() => f.client.resume()),
    "PAYMENT_RESUME_UNAVAILABLE",
    "recovery",
  );
  assert.deepEqual(f.counts, { ...noPayment, fetch: 5 });
  row.observation = { counts: f.counts, loadStayedCached: f.counts.load === 1 };
});

await scenario(
  "concurrent-single-flight-and-separate-client-load",
  async (row) => {
    const entered = Promise.withResolvers(),
      release = Promise.withResolvers();
    const cause = new Error("signing cause");
    const f = fixture({
      signer: {
        address: payload.payload.authorization.from,
        async signTypedData() {
          entered.resolve();
          await release.promise;
          throw cause;
        },
      },
    });
    const active = caught(() => f.client.fetch(url));
    await entered.promise;
    try {
      for (const operation of [
        () => f.client.fetch(url),
        () => f.client.resume(),
      ]) {
        const error = await caught(operation);
        fields(error, "PAYMENT_IN_PROGRESS", "request", true);
        assert.equal(error.cause, undefined);
      }
      const unrelated = new Error("PAYMENT_SIGNING_FAILED PAYMENT_IN_PROGRESS");
      for (const operation of ["fetch", "pending", "resume"]) {
        const other = fixture({
          load: async () => {
            throw unrelated;
          },
        });
        fallback(
          await caught(() =>
            operation === "fetch"
              ? other.client.fetch(url)
              : other.client[operation](),
          ),
          unrelated,
          operation === "fetch" ? "request" : "recovery",
        );
        assert.deepEqual(other.counts, {
          ...noPayment,
          signAttempt: 0,
          fetch: 0,
        });
      }
    } finally {
      release.resolve();
    }
    const error = await active;
    row.observation = { error: observe(error, cause), counts: f.counts };
    assert.deepEqual(f.counts, noPayment);
    signing(error, cause);
    f.state.mode = "unsigned";
    assert.equal((await f.client.fetch(url)).status, 200);
  },
);

// Public synthetic key only. Real local signing, no RPC, settlement or funds.
const account = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
for (const mode of ["success", "unknown", "signed-failure"])
  await scenario(`sign-after-failure-${mode}`, async (row) => {
    const cause = new Error("first signer rejected");
    let reject = true;
    const f = fixture({
      signer: {
        address: account.address,
        async signTypedData(...args) {
          if (reject) throw cause;
          return account.signTypedData(...args);
        },
      },
    });
    await caught(() => f.client.fetch(url));
    reject = false;
    f.events.length = 0;
    f.state.mode = mode;
    f.state.failure = new Error("PAYMENT_SIGNING_FAILED PAYMENT_IN_PROGRESS");
    if (mode === "success")
      assert.equal((await f.client.fetch(url)).status, 200);
    else {
      const error = await caught(() => f.client.fetch(url));
      if (mode === "unknown")
        fields(error, "PAYMENT_STATUS_UNKNOWN", "request", true);
      else fallback(error, f.state.failure);
      assert.ok(await f.client.pending());
      assert.ok(f.stored());
      assert.equal(f.counts.signAttempt, 2);
      fields(
        await caught(() => f.client.fetch(url)),
        "PAYMENT_RESUME_REQUIRED",
        "recovery",
      );
      f.state.mode = "success";
      assert.equal((await f.client.resume()).status, 200);
    }
    assert.equal(await f.client.pending(), undefined);
    assert.equal(f.stored(), undefined);
    assert.deepEqual(
      f.events,
      mode === "success"
        ? [
            "fetch",
            "sign",
            "save",
            "fetch",
            "credential-send",
            "verify",
            "clear",
            "callback",
          ]
        : [
            "fetch",
            "sign",
            "save",
            "fetch",
            "credential-send",
            "fetch",
            "credential-send",
            "verify",
            "clear",
            "callback",
          ],
    );
    assert.deepEqual(f.counts, {
      load: 1,
      signAttempt: 2,
      fetch: mode === "success" ? 3 : 4,
      credentialSend: mode === "success" ? 1 : 2,
      save: 1,
      clear: 1,
      verify: 1,
      onReceipt: 1,
    });
    row.observation = {
      counts: f.counts,
      pendingAbsent: true,
      identicalResumeCredential: mode !== "success",
    };
  });
const failed = rows.filter((row) => !row.passed).length;
writeFileSync(
  output,
  JSON.stringify(
    {
      kind: "native-owned-signer-provenance",
      condition,
      inventory,
      rows,
      failed,
      limits:
        "Synthetic callbacks and in-memory store; local public-fixture signing only in positive controls. No RPC, funds, settlement, authenticated storage or durable restart. MPP rows are separate native controls.",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx", mode: 0o600 },
);
emit({ type: "observation", counters: {} });
emit({ type: "result", assertions: rows.length });
if (failed) process.exitCode = 1;
