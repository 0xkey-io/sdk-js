import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  publicModule,
  payload,
  requirements,
  transaction,
} from "./x402-boundary-runtime.mjs";

// Native public-entry callback tests. No sockets, chain, database or live keys.
// Pre-encoded signature-shaped inputs exercise SDK storage/order, not signing.
const [app, condition, output, foreignApp] = process.argv.slice(2);
const inventory = [];
const { createPayClient, PayError } = await publicModule(
  app,
  "@0xkey-io/pay/client",
  condition,
  inventory,
);
const root = await publicModule(app, "@0xkey-io/pay", condition, inventory);
const foreign = await publicModule(
  foreignApp,
  "@0xkey-io/pay/client",
  condition,
  inventory,
);
const wire = await publicModule(app, "@x402/core/http", condition, inventory);
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
emit({
  type: "versions",
  versions: {
    node: process.versions.node,
    pay: inventory[0].version,
    x402: inventory[3].version,
  },
});
let start = "";
for await (const chunk of process.stdin) start += chunk;
assert.deepEqual(JSON.parse(start), { type: "start" });
emit({ type: "ready", port: 0 }); // Explicit no-listener metadata, not a bound port.
const rows = [];
async function scenario(label, run) {
  try {
    const observation = await run();
    rows.push({ label, passed: true, ...(observation ? { observation } : {}) });
  } catch {
    rows.push({ label, passed: false });
  } // Never retain callback text or receipt/error objects.
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
    [error.code, error.phase, error.retryable],
    [code, phase, retryable],
  );
  assert.equal(error.paymentId, undefined);
}
function fallback(
  error,
  cause,
  phase = "request",
  code = "PAYMENT_SERVICE_UNAVAILABLE",
) {
  fields(error, code, phase, code === "PAYMENT_SERVICE_UNAVAILABLE");
  assert.equal(
    error.message,
    code === "PAY_PROFILE_INVALID"
      ? "PAY_PROFILE_INVALID: Pay profile invalid"
      : "PAYMENT_SERVICE_UNAVAILABLE: Payment service unavailable",
  );
  assert.equal(error.cause, cause);
}
function options(overrides = {}) {
  return {
    account: {
      address: payload.payload.authorization.from,
      async signTypedData() {
        throw new Error("unexpected signing");
      },
    },
    network: "eip155:84532",
    policy: { allowHosts: ["merchant.example"], maxAmount: "$0.10" },
    recovery: {
      protection: "aead",
      async load() {},
      async saveIfAbsent() {
        throw new Error("unexpected save");
      },
      async clear() {
        throw new Error("unexpected clear");
      },
    },
    verification: {
      verifier: async () => {
        throw new Error("unexpected verification");
      },
    },
    fetch: async () => new Response("ordinary content"),
    ...overrides,
  };
}
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
const causes = markers.flatMap((marker) => [
  [`${marker}-exact`, new Error(marker)],
  [`${marker}-prefix`, new Error(`${marker}: diagnostic`)],
  [`${marker}-embedded`, new Error(`diagnostic ${marker} detail`)],
]);
causes.push(
  ["ordinary", new Error("ordinary dependency failure")],
  ["multiple", new Error(markers.join(" "))],
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
        throw new Error("message read");
      },
    }),
  ],
  [
    "foreign-owner",
    new foreign.PayError("PAY_HOST_DENIED", "foreign owned message", {
      phase: "policy",
    }),
  ],
);
await scenario("public-local-owner", async () => {
  assert.equal(root.PayError, PayError);
  assert.notEqual(foreign.PayError, PayError);
});
for (const operation of ["fetch", "pending", "resume"]) {
  for (const [label, cause] of causes)
    await scenario(`${operation}-${label}`, async () => {
      const counts = {
        load: 0,
        send: 0,
        save: 0,
        clear: 0,
        sign: 0,
        verify: 0,
      };
      const client = createPayClient(
        options({
          account: {
            address: payload.payload.authorization.from,
            async signTypedData() {
              counts.sign++;
              throw cause;
            },
          },
          recovery: {
            protection: "aead",
            async load() {
              counts.load++;
              if (operation !== "fetch") throw cause;
            },
            async saveIfAbsent() {
              counts.save++;
              return false;
            },
            async clear() {
              counts.clear++;
              return false;
            },
          },
          verification: {
            verifier: async () => {
              counts.verify++;
              return false;
            },
          },
          fetch: async () => {
            counts.send++;
            throw cause;
          },
        }),
      );
      const error = await caught(() =>
        operation === "fetch"
          ? client.fetch("https://merchant.example/paid")
          : client[operation](),
      );
      assert.deepEqual(counts, {
        load: 1,
        send: operation === "fetch" ? 1 : 0,
        save: 0,
        clear: 0,
        sign: 0,
        verify: 0,
      });
      fallback(error, cause, operation === "fetch" ? "request" : "recovery");
    });
  await scenario(`${operation}-local-identity`, async () => {
    const cause = new PayError("PAYMENT_AUTH_FORBIDDEN", "owned error", {
      phase: "policy",
    });
    const config = options({
      fetch: async () => {
        throw cause;
      },
    });
    if (operation !== "fetch")
      config.recovery.load = async () => {
        throw cause;
      };
    const client = createPayClient(config);
    const error = await caught(() =>
      operation === "fetch"
        ? client.fetch("https://merchant.example/paid")
        : client[operation](),
    );
    assert.equal(error, cause);
  });
}
await scenario("configuration-unknown", async () => {
  const cause = new Error("PAYMENT_IN_PROGRESS");
  const config = options();
  Object.defineProperty(config.policy, "allowHosts", {
    get() {
      throw cause;
    },
  });
  fallback(
    await caught(() => createPayClient(config)),
    cause,
    "configuration",
    "PAY_PROFILE_INVALID",
  );
});
await scenario("configuration-local-identity", async () => {
  const cause = new PayError("PAY_PROFILE_INVALID", "owned error", {
    phase: "configuration",
  });
  const config = options();
  Object.defineProperty(config.policy, "allowHosts", {
    get() {
      throw cause;
    },
  });
  assert.equal(await caught(() => createPayClient(config)), cause);
});
for (const [label, url, response, code, phase] of [
  ["host", "https://denied.example/", undefined, "PAY_HOST_DENIED", "policy"],
  [
    "transport",
    "http://merchant.example/",
    undefined,
    "PAY_INSECURE_TRANSPORT",
    "request",
  ],
  [
    "redirect",
    "https://merchant.example/",
    new Response(null, {
      status: 302,
      headers: { Location: "https://merchant.example/next" },
    }),
    "PAYMENT_POLICY_DENIED",
    "policy",
  ],
])
  await scenario(`owned-${label}`, async () => {
    let sent = 0;
    const client = createPayClient(
      options({
        fetch: async () => {
          sent++;
          return response;
        },
      }),
    );
    fields(await caught(() => client.fetch(url)), code, phase);
    assert.equal(sent, response ? 1 : 0);
  });
await scenario("owned-resume-unavailable", async () =>
  fields(
    await caught(() => createPayClient(options()).resume()),
    "PAYMENT_RESUME_UNAVAILABLE",
    "recovery",
  ),
);
await scenario("owned-mainnet-rpc-profile", async () =>
  fields(
    await caught(() =>
      createPayClient(
        options({
          network: "eip155:8453",
          verification: { rpcUrl: "https://mainnet.base.org" },
        }),
      ),
    ),
    "PAY_PROFILE_INVALID",
    "configuration",
  ),
);
await scenario("owned-missing-signer", async () =>
  fields(
    await caught(() =>
      createPayClient(
        options({ account: { address: payload.payload.authorization.from } }),
      ),
    ),
    "PAY_PROFILE_INVALID",
    "configuration",
  ),
);

const credential = wire.encodePaymentSignatureHeader(payload);
const receipt = wire.encodePaymentResponseHeader({
  success: true,
  transaction,
  network: requirements.network,
  payer: payload.payload.authorization.from,
});
// SDK-owned state transitions run with real native decoding and synthetic
// input. The memory store does not implement encryption or durable restart.
for (const operation of ["fetch", "resume"])
  for (const boundary of [
    "send",
    "save",
    "clear",
    "callback",
    "claim",
    "clear-conflict",
    "missing",
    "mismatch",
    "verifier",
    "typed-verifier",
    "success",
  ]) {
    if (operation === "resume" && ["save", "claim"].includes(boundary))
      continue;
    await scenario(`${operation}-lifecycle-${boundary}`, async () => {
      const cause =
        boundary === "typed-verifier"
          ? new PayError("PAY_HOST_DENIED", "owned outside verifier", {
              phase: "policy",
            })
          : new Error("diagnostic PAY_HOST_DENIED PAYMENT_IN_PROGRESS");
      const events = [];
      let stored,
        candidate,
        priming = operation === "resume";
      const recovery = {
        protection: "aead",
        async load() {
          events.push("load");
          return stored;
        },
        async saveIfAbsent(record) {
          events.push("save");
          candidate = record;
          if (boundary === "save") throw cause;
          stored = record;
          return boundary !== "claim";
        },
        async clear(digest) {
          events.push("clear");
          assert.equal(digest, stored.digest);
          if (boundary === "clear") throw cause;
          if (boundary === "clear-conflict") return false;
          stored = undefined;
          return true;
        },
      };
      const client = createPayClient(
        options({
          recovery,
          fetch: async (request) => {
            events.push("send");
            assert.equal(request.headers.get("PAYMENT-SIGNATURE"), credential);
            if (priming) return new Response(null, { status: 401 });
            if (boundary === "send") throw cause;
            return new Response(null, {
              headers:
                boundary === "missing" ? {} : { "PAYMENT-RESPONSE": receipt },
            });
          },
          verification: {
            verifier: async () => {
              events.push("verify");
              if (["verifier", "typed-verifier"].includes(boundary))
                throw cause;
              return boundary !== "mismatch";
            },
          },
          onReceipt() {
            events.push("callback");
            if (boundary === "callback") throw cause;
          },
        }),
      );
      const fetchPaid = () =>
        client.fetch("https://merchant.example/paid", {
          headers: { "PAYMENT-SIGNATURE": credential },
        });
      if (priming) {
        assert.equal((await fetchPaid()).status, 401);
        events.length = 0;
        priming = false;
      }
      let error;
      try {
        assert.equal(
          (await (operation === "fetch" ? fetchPaid() : client.resume()))
            .status,
          200,
        );
      } catch (value) {
        error = value;
      }
      const prefix = operation === "fetch" ? ["load", "save"] : [];
      const expected =
        boundary === "save"
          ? prefix
          : boundary === "claim"
            ? [...prefix, "load"]
            : ["send", "missing"].includes(boundary)
              ? [...prefix, "send"]
              : ["mismatch", "verifier", "typed-verifier"].includes(boundary)
                ? [...prefix, "send", "verify"]
                : ["clear", "clear-conflict"].includes(boundary)
                  ? [...prefix, "send", "verify", "clear"]
                  : [...prefix, "send", "verify", "clear", "callback"];
      assert.deepEqual(events, expected);
      assert.equal(
        Boolean(stored),
        !["save", "callback", "success"].includes(boundary),
      );
      assert.equal(
        Boolean(await client.pending()),
        !["callback", "success"].includes(boundary),
      );
      if (!["callback", "success"].includes(boundary))
        fields(
          await caught(() => client.fetch("https://merchant.example/paid")),
          "PAYMENT_RESUME_REQUIRED",
          "recovery",
        );
      if (["send", "save", "clear", "callback"].includes(boundary))
        fallback(error, cause, operation === "fetch" ? "request" : "recovery");
      else if (boundary === "success") assert.equal(error, undefined);
      else if (["verifier", "typed-verifier"].includes(boundary)) {
        fields(error, "PAYMENT_RECEIPT_UNVERIFIED", "receipt", true);
        assert.equal(error.cause, cause);
      } else
        fields(
          error,
          {
            claim: "PENDING_PAYMENT_CLAIMED",
            "clear-conflict": "PENDING_PAYMENT_CLEAR_CONFLICT",
            missing: "PAYMENT_RECEIPT_MISSING",
            mismatch: "PAYMENT_RECEIPT_MISMATCH",
          }[boundary],
          ["claim", "clear-conflict"].includes(boundary)
            ? "recovery"
            : "receipt",
          boundary === "claim",
        );
      assert.equal(
        candidate.payment.headers.some(
          ([name, value]) =>
            name === "payment-signature" && value === credential,
        ),
        true,
      );
    });
  }
await scenario("x402-upstream-rewrapped-signer", async () => {
  const cause = new PayError("PAY_HOST_DENIED", "signer cause", {
    phase: "policy",
  });
  let signs = 0,
    sends = 0,
    saves = 0;
  const config = options({
    account: {
      address: payload.payload.authorization.from,
      async signTypedData() {
        signs++;
        throw cause;
      },
    },
    fetch: async () => {
      sends++;
      return new Response(null, {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": wire.encodePaymentRequiredHeader({
            x402Version: 2,
            resource: {
              url: "https://merchant.example/paid",
              description: "fixture",
              mimeType: "text/plain",
            },
            accepts: [requirements],
          }),
        },
      });
    },
  });
  config.recovery.saveIfAbsent = async () => {
    saves++;
    return false;
  };
  const client = createPayClient(config);
  const error = await caught(() =>
    client.fetch("https://merchant.example/paid"),
  );
  // @x402/fetch 2.23 replaces the typed signer error with an ordinary Error.
  // Its text cannot reestablish ownership, nor does upstream retain a cause.
  fields(error, "PAYMENT_SERVICE_UNAVAILABLE", "request", true);
  assert.equal(
    error.message,
    "PAYMENT_SERVICE_UNAVAILABLE: Payment service unavailable",
  );
  assert.equal(error.cause instanceof Error, true);
  assert.equal(error.cause instanceof PayError, false);
  assert.equal(error.cause.cause, undefined);
  assert.deepEqual(
    [signs, sends, saves, await client.pending()],
    [1, 1, 0, undefined],
  );
  return {
    error: { code: error.code, phase: error.phase, retryable: error.retryable },
    counters: { signs, sends, saves },
    causeType: "upstream-ordinary-error-without-cause",
  };
});
const failed = rows.filter((row) => !row.passed).length;
writeFileSync(
  output,
  JSON.stringify(
    {
      kind: "synthetic-buyer-error-provenance",
      condition,
      inventory,
      rows,
      failed,
      limits:
        "No listeners, real signing success, chain, database, AEAD or durable restart proof. Callback/verifier doubles and pre-encoded synthetic credentials exercise classification and SDK ordering only.",
    },
    null,
    2,
  ) + "\n",
  { flag: "wx", mode: 0o600 },
);
emit({ type: "observation", counters: {} });
emit({ type: "result", assertions: rows.length });
if (failed) process.exitCode = 1;
