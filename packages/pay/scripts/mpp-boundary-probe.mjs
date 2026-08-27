// Bounded packed MPP regression, not a durable-buyer or GA conformance driver.
// Reuses the audited public resolver, strict HTTPS transport and 7A supervisor.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { createECDH, randomBytes } from "node:crypto";
import https from "node:https";
import { publicModule, tlsFetch, hash } from "./x402-boundary-runtime.mjs";

const [app, nativeApp, version, condition, composition, output, certificates] =
  process.argv.slice(2);
assert.ok(["require", "import"].includes(condition));
assert.ok(["default", "explicit", "wrong"].includes(composition));
const inventory = [];
const load = (root, name) => publicModule(root, name, condition, inventory);
const { create0xkeyEvmChargeMethod } = await load(app, "@0xkey-io/pay/mpp");
const { createPayServer } = await load(app, "@0xkey-io/pay/server");
const { Errors: localErrors } = await load(app, "mppx");
const localServer = await load(app, "mppx/server");
const native = await load(nativeApp, "mppx");
const { Mppx } = await load(nativeApp, "mppx/server");
const { authorizationDomain, authorizationTypes, challengeHash } = await load(
  nativeApp,
  "mppx/evm",
);
const { privateKeyToAccount, generatePrivateKey } = await load(
  nativeApp,
  "viem/accounts",
);
assert.equal(inventory.findLast((x) => x.name === "mppx").version, version);
const payVersion = inventory.find((x) => x.name === "@0xkey-io/pay/mpp").version;
const viemVersion = inventory.find((x) => x.name === "viem/accounts").version;
assert.equal(payVersion, "1.0.0-rc.1");
assert.equal(viemVersion, "2.54.0");
const emit = (value) => process.stdout.write(JSON.stringify(value) + "\n");
emit({
  type: "versions",
  versions: {
    node: process.versions.node,
    pay: payVersion,
    mppx: version,
    viem: viemVersion,
  },
});
let control = "";
for await (const chunk of process.stdin) control += chunk;
assert.deepEqual(JSON.parse(control), { type: "start" });

const allowed = new Set(),
  ports = [],
  servers = [],
  sensitive = [],
  checks = [],
  failures = [],
  tls = [];
const ca = readFileSync(join(certificates, "ca.pem"));
const wrongCa = readFileSync(join(certificates, "wrong-ca.pem"));
const transport = tlsFetch(ca, allowed);
const organizationId = "11111111-1111-4111-8111-111111111111";
const payTo = "0x1111111111111111111111111111111111111111";
const network = "eip155:84532";
const transaction = "0x" + "ab".repeat(32);
const stderr = [];
const originalWrite = process.stderr.write;
process.stderr.write = function (chunk, ...args) {
  stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return originalWrite.call(this, chunk, ...args);
};
const check = (label, actual, expected) => {
  const passed = JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ label, passed, actual, expected });
  if (!passed) failures.push(label);
};
const rows = [];
function add(profile, mode, owner = "selected", mutate = false) {
  const index = rows.length;
  const paymentId = `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`;
  sensitive.push(paymentId);
  rows.push({
    index,
    profile,
    mode,
    owner,
    mutate,
    paymentId,
    counters: {
      sign: 0,
      signedSend: 0,
      settle: 0,
      handler: 0,
      fulfillment: 0,
      challenge: 0,
    },
    events: [],
    reports: [],
  });
}
for (const mode of ["success", "unknown", "rejected"]) add("direct", mode);
if (composition !== "wrong") {
  add("direct", "unknown", "selected", true);
  // These run concurrently with the selected physical owner and carry distinct
  // private payment identities and independent error outcomes.
  add("direct", "unknown", "local");
  add("direct", "rejected", "local");
}
if (composition === "default") {
  for (const profile of ["direct", "facade"])
    for (const mode of [200, 201, 204, 299, 302, 400, 404, 500])
      add(profile, mode);
  add("facade", "throw");
  add("facade", "persistence");
  add("facade", "persistence-500");
}
async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    assert.ok(size <= 65536);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function listen(handle) {
  const server = https.createServer(
    {
      key: readFileSync(join(certificates, "server.key")),
      cert: readFileSync(join(certificates, "server.pem")),
    },
    async (request, response) => {
      try {
        if (request.url === "/health") {
          response.writeHead(200);
          response.end("owned-loopback");
          return;
        }
        if (request.url === "/null-body") {
          response.writeHead(204, "No Fixture Body", {
            "X-Fixture": "preserved",
          });
          response.end();
          return;
        }
        await handle(request, response);
      } catch {
        failures.push("LISTENER_ASSERTION");
        if (!response.headersSent) response.writeHead(500);
        response.end("fixture failure");
      }
    },
  );
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.on("tlsClientError", () => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  ports.push(server.address().port);
  const origin = `https://127.0.0.1:${server.address().port}`;
  allowed.add(origin);
  return origin;
}
async function trustControl(origin) {
  const good = await transport(origin + "/health");
  check("trusted-ca", good.status, 200);
  let rejected = "NOT_REJECTED";
  try {
    await tlsFetch(wrongCa, allowed)(origin + "/health");
  } catch (error) {
    rejected = error.code;
  }
  check(
    "unrelated-ca",
    [
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "CERT_SIGNATURE_FAILURE",
    ].includes(rejected),
    true,
  );
  tls.push({ port: Number(new URL(origin).port), good: good.status, rejected });
}
async function capture(response) {
  const raw = await response.clone().text(),
    receipt = response.headers.get("Payment-Receipt");
  const result = {
    status: response.status,
    statusText: response.statusText,
    receipt: !!receipt,
    challenge: response.headers.has("WWW-Authenticate"),
    retryAfter: response.headers.get("Retry-After"),
    cache: response.headers.get("Cache-Control"),
    location: response.headers.get("Location"),
    merchant: response.headers.get("X-Merchant"),
    bodySha256: hash(raw),
    privateDataLeak: sensitive.some((value) => raw.includes(value)),
  };
  if (receipt) {
    sensitive.push(receipt);
    result.receiptSha256 = hash(receipt);
    try {
      const decoded = native.Receipt.fromResponse(response);
      result.receiptValid =
        decoded.status === "success" && decoded.reference === transaction;
      result.receiptPrivateLeak = sensitive.some((value) =>
        JSON.stringify(decoded).includes(value),
      );
    } catch {
      result.receiptValid = false;
    }
  }
  if (response.headers.get("Content-Type") === "application/problem+json") {
    const value = JSON.parse(raw);
    result.problemSafe =
      JSON.stringify(value) ===
      JSON.stringify({
        type: "https://0xkey.io/pay/problems/settlement-boundary",
        title: "Settlement Boundary Failure",
        status: response.status,
        detail:
          response.status === 503
            ? "settlement outcome is indeterminate"
            : "settlement request failed",
        details: {
          errorCode:
            response.status === 503
              ? "PAYMENT_STATUS_UNKNOWN"
              : "PAYMENT_AUTH_FORBIDDEN",
          retryable: response.status === 503,
        },
      });
  }
  return result;
}
let setupFailure = null;
try {
  const facilitator = await listen(async (request, response) => {
    const row = rows[Number(request.url.split("/")[1])];
    assert.ok(row);
    const wire = JSON.parse(await readBody(request));
    assert.equal(wire.organizationId, organizationId);
    assert.equal(typeof request.headers["x-stamp"], "string");
    sensitive.push(request.headers["x-stamp"]);
    if (request.url.endsWith("/v1/settlements/charge")) {
      row.counters.settle++;
      row.events.push("settle");
      assert.equal(request.method, "POST");
      assert.equal(wire.command.protocolId, "mpp-evm-charge-v0");
      assert.equal(wire.command.amount, "10000");
      const credential = native.Credential.deserialize(row.credential);
      assert.equal(
        wire.command.authorization.signature,
        credential.payload.signature,
      );
      assert.equal(
        wire.command.payer.toLowerCase(),
        credential.payload.from.toLowerCase(),
      );
      if (["unknown", "rejected"].includes(row.mode)) {
        response.writeHead(row.mode === "unknown" ? 503 : 403, {
          "Content-Type": "application/json",
        });
        response.end(
          JSON.stringify({
            errorCode:
              row.mode === "unknown"
                ? "PAYMENT_STATUS_UNKNOWN"
                : "PAYMENT_AUTH_FORBIDDEN",
            retryable: row.mode === "unknown",
            paymentId: row.paymentId,
          }),
        );
      } else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            settlement: {
              success: true,
              transaction,
              network,
              payer: wire.command.payer,
            },
            paymentId: row.paymentId,
          }),
        );
      }
      return;
    }
    assert.equal(
      request.url,
      `/${row.index}/v1/payments/${row.paymentId}/fulfillment`,
    );
    assert.equal(request.method, "PUT");
    row.events.push("fulfillment");
    row.counters.fulfillment++;
    const failed =
      row.mode === 500 ||
      row.mode === "throw" ||
      row.mode === "persistence-500";
    assert.deepEqual(wire, {
      organizationId,
      state: failed ? "FAILED" : "FULFILLED",
      ...(failed ? { failureCode: "HANDLER_ERROR" } : {}),
    });
    row.reports.push({
      state: wire.state,
      failureCode: wire.failureCode ?? null,
      privateIdentityMatches: true,
    });
    response.writeHead(String(row.mode).startsWith("persistence") ? 503 : 200);
    response.end();
  });
  const ec = createECDH("prime256v1");
  ec.generateKeys();
  const apiKey = {
    publicKey: ec.getPublicKey("hex", "compressed"),
    privateKey: ec.getPrivateKey("hex").padStart(64, "0"),
  };
  const secretKey = randomBytes(32).toString("hex");
  sensitive.push(apiKey.privateKey, secretKey, organizationId);
  const base = {
    network,
    organizationId,
    payTo,
    apiKey,
    facilitatorUrl: facilitator,
    fetch: transport,
  };
  let invalidIo = 0;
  for (const [label, configured] of [
    ["null", null],
    ["arrow", () => undefined],
    ["plain-error", Error],
    [
      "throws",
      class {
        constructor() {
          throw new Error("private-constructor-sentinel");
        }
      },
    ],
  ]) {
    let error;
    try {
      create0xkeyEvmChargeMethod({
        ...base,
        paymentError: configured,
        fetch: async () => {
          invalidIo++;
          throw new Error("unexpected");
        },
      });
    } catch (cause) {
      error = cause;
    }
    check(
      `invalid-${label}`,
      error?.code === "PAY_PROFILE_INVALID" &&
        error.phase === "configuration" &&
        error.retryable === false &&
        !error.paymentId &&
        !error.cause,
      true,
    );
  }
  check("invalid-before-network", invalidIo, 0);
  for (const row of rows) {
    const owner = row.owner === "local" ? localErrors : native.Errors;
    const serverOwner = row.owner === "local" ? localServer.Mppx : Mppx;
    const options = { ...base, facilitatorUrl: `${facilitator}/${row.index}` };
    if (composition !== "default" || row.owner === "local")
      options.paymentError =
        composition === "wrong" ? localErrors.PaymentError : owner.PaymentError;
    const handlerStatus =
      typeof row.mode === "number"
        ? row.mode
        : row.mode === "persistence-500"
          ? 500
          : 200;
    row.handlerStatus = handlerStatus;
    const handler = () => {
      assert.deepEqual(row.events, ["settle"]);
      row.events.push("handler");
      row.counters.handler++;
      if (row.mode === "throw") throw new Error("private-handler-sentinel");
      return new Response(handlerStatus === 204 ? null : "preserved bytes", {
        status: handlerStatus,
        statusText: "Merchant Status",
        headers: {
          "Payment-Receipt": "injected",
          "Cache-Control": "no-store",
          Location: "/redirect-target",
          "X-Merchant": "preserved",
        },
      });
    };
    if (row.profile === "facade")
      row.route = createPayServer({
        ...base,
        facilitatorUrl: options.facilitatorUrl,
        protocols: ["mpp"],
        mppSecretKey: secretKey,
      }).protect({ price: "$0.01" }, (context) => {
        assert.equal(context.paymentId, row.paymentId);
        return handler();
      });
    else {
      const method = create0xkeyEvmChargeMethod(options);
      if (row.mutate) options.paymentError = Error;
      const route = serverOwner
        .create({ methods: [method], secretKey })
        .evm.charge({ amount: "0.01" });
      row.route = async (request) => {
        const result = await route(request);
        row.discriminant = result.status;
        if (result.status === 402) return result.challenge;
        const original = handler();
        const wrapped = result.withReceipt(original);
        check(
          `sync-stream-${row.index}`,
          wrapped instanceof Response && wrapped.body === original.body,
          true,
        );
        return wrapped;
      };
    }
  }
  const merchant = await listen(async (request, response) => {
    const row = rows[Number(request.url.split("/")[1])];
    assert.ok(row);
    assert.equal(request.url, `/${row.index}/paid`);
    assert.equal(request.method, "GET");
    assert.equal((await readBody(request)).length, 0);
    const result = await row.route(
      new Request(`${merchant}/${row.index}/paid`, {
        headers: request.headers,
      }),
    );
    if (request.headers.authorization) row.observed = await capture(result);
    else {
      row.counters.challenge++;
      assert.equal(result.status, 402);
    }
    response.writeHead(
      result.status,
      result.statusText,
      Object.fromEntries(result.headers),
    );
    response.end(Buffer.from(await result.arrayBuffer()));
  });
  emit({ type: "ready", port: ports[0] });
  writeFileSync(output + ".ports.json", JSON.stringify(ports), {
    flag: "wx",
    mode: 0o600,
  });
  await trustControl(facilitator);
  await trustControl(merchant);
  // Separate fixture contract: this must stay null, not an empty byte body.
  if (composition === "default") {
    const noBody = await transport(merchant + "/null-body");
    check(
      "fixture-204",
      [noBody.status, noBody.body, noBody.headers.get("X-Fixture")],
      [204, null, "preserved"],
    );
  }
  await Promise.all(
    rows.map(async (row) => {
      const url = `${merchant}/${row.index}/paid`;
      const challenge = native.Challenge.fromResponse(await transport(url));
      const key = generatePrivateKey();
      sensitive.push(key);
      const account = privateKeyToAccount(key);
      const nonce = challengeHash(challenge),
        validBefore = String(Math.floor(Date.now() / 1000) + 300);
      row.counters.sign++;
      const signature = await account.signTypedData({
        domain: authorizationDomain({
          authorization: { name: "USDC", version: "2" },
          chainId: 84532,
          currency: challenge.request.currency,
        }),
        message: {
          from: account.address,
          nonce,
          to: challenge.request.recipient,
          validAfter: 0n,
          validBefore: BigInt(validBefore),
          value: BigInt(challenge.request.amount),
        },
        primaryType: "TransferWithAuthorization",
        types: authorizationTypes,
      });
      row.credential = native.Credential.serialize({
        challenge,
        payload: {
          from: account.address,
          nonce,
          signature,
          to: challenge.request.recipient,
          type: "authorization",
          validAfter: "0",
          validBefore,
          value: challenge.request.amount,
        },
      });
      sensitive.push(signature, row.credential);
      row.credentialSha256 = hash(row.credential);
      row.counters.signedSend++;
      try {
        row.client = await capture(
          await transport(url, { headers: { Authorization: row.credential } }),
        );
      } catch (error) {
        check(
          `redirect-${row.index}`,
          [row.handlerStatus, error.message],
          [302, "redirect-forbidden"],
        );
        row.client = { redirectRejected: true };
      }
    }),
  );
  for (const row of rows) {
    const fault = ["unknown", "rejected"].includes(row.mode),
      wrong = fault && composition === "wrong";
    const expectedStatus = wrong
      ? 402
      : row.mode === "unknown"
        ? 503
        : row.mode === "rejected"
          ? 403
          : String(row.mode).startsWith("persistence")
            ? 503
            : row.mode === "throw"
              ? 500
              : row.handlerStatus;
    check(`status-${row.index}`, row.observed?.status, expectedStatus);
    check(`challenge-${row.index}`, row.observed?.challenge, wrong);
    check(
      `receipt-${row.index}`,
      row.observed?.receipt,
      !fault && expectedStatus < 300,
    );
    check(`private-${row.index}`, row.observed?.privateDataLeak, false);
    check(`counts-${row.index}`, row.counters, {
      sign: 1,
      signedSend: 1,
      settle: 1,
      handler: fault ? 0 : 1,
      fulfillment: row.profile === "facade" ? 1 : 0,
      challenge: 1,
    });
    check(
      `order-${row.index}`,
      row.events,
      fault
        ? ["settle"]
        : row.profile === "facade"
          ? ["settle", "handler", "fulfillment"]
          : ["settle", "handler"],
    );
    if (fault) {
      check(`discriminant-${row.index}`, row.discriminant, 402);
      check(
        `retry-${row.index}`,
        row.observed?.retryAfter,
        !wrong && row.mode === "unknown" ? "2" : null,
      );
      if (!wrong)
        check(`safe-problem-${row.index}`, row.observed?.problemSafe, true);
    } else if (typeof row.mode === "number" || row.mode === "success") {
      check(
        `preserve-${row.index}`,
        [
          row.observed?.statusText,
          row.observed?.location,
          row.observed?.merchant,
          row.observed?.bodySha256,
        ],
        [
          "Merchant Status",
          "/redirect-target",
          "preserved",
          hash(row.handlerStatus === 204 ? "" : "preserved bytes"),
        ],
      );
      check(
        `cache-${row.index}`,
        row.observed?.cache,
        row.profile === "facade" && row.handlerStatus >= 500
          ? "no-store"
          : "no-store, private",
      );
      if (expectedStatus < 300)
        check(
          `native-receipt-${row.index}`,
          [row.observed?.receiptValid, row.observed?.receiptPrivateLeak],
          [true, false],
        );
    } else check(`error-cache-${row.index}`, row.observed?.cache, null);
  }
} catch (error) {
  setupFailure = {
    name: error?.name,
    messageSha256: hash(String(error?.message)),
    code: typeof error?.code === "string" ? error.code : null,
  };
  failures.push("EXECUTION_FAILURE");
} finally {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  process.stderr.write = originalWrite;
  const diagnosticBytes = Buffer.concat(stderr);
  check(
    "stderr-private-data",
    sensitive.some((value) => diagnosticBytes.includes(value)),
    false,
  );
  check("stderr-contract", diagnosticBytes.length > 0, composition === "wrong");
  const safeRows = rows.map(
    ({
      index,
      profile,
      mode,
      owner,
      mutate,
      counters,
      events,
      reports,
      observed,
      client,
      discriminant,
      credentialSha256,
    }) => ({
      index,
      profile,
      mode,
      owner,
      mutate,
      counters,
      events,
      reports,
      observed,
      client,
      discriminant,
      credentialSha256,
    }),
  );
  const diagnostic = {
    kind: "bounded-mpp-boundary-not-7b",
    version,
    condition,
    composition,
    inventory,
    samePaymentErrorOwner:
      native.Errors.PaymentError === localErrors.PaymentError,
    rows: safeRows,
    checks,
    failures,
    setupFailure,
    ports,
    tls,
    stderr: { bytes: diagnosticBytes.length, sha256: hash(diagnosticBytes) },
  };
  const bytes = JSON.stringify(diagnostic, null, 2) + "\n";
  assert.equal(
    sensitive.some((value) => bytes.includes(value)),
    false,
    "sensitive diagnostic rejected",
  );
  writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
  emit({
    type: "observation",
    counters: {
      settle: rows.reduce((sum, row) => sum + row.counters.settle, 0),
    },
  });
  emit({ type: "result", assertions: checks.length });
  if (failures.length) process.exitCode = 1;
}
