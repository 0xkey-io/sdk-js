import assert from "node:assert/strict";
import { test } from "node:test";
import { createECDH, createPrivateKey, createSign } from "node:crypto";
import {
  assessExpiredLogin,
  assessSuccessfulLogin,
  parseOptions,
  readHiddenOtp,
  runAcceptance,
  makeLiveDeps,
  type AcceptanceDeps,
  type HttpResult,
} from "./otp-v2-staging.mts";

const session = (claims: Record<string, unknown>) =>
  `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const validClaims = {
  organization_id: "org-1",
  user_id: "user-1",
  public_key: "key-B",
  iat: 1_000,
  exp: 1_900,
};

test("success needs HTTP 200, a nonempty Session, and matching JWT claims", () => {
  assert.equal(
    assessSuccessfulLogin(
      { status: 200, data: { session: session(validClaims) } },
      "org-1",
      "key-B",
      1_000,
    ),
    true,
  );
  assert.equal(
    assessSuccessfulLogin(
      { status: 500, data: { session: session(validClaims) } },
      "org-1",
      "key-B",
      1_000,
    ),
    false,
  );
  assert.equal(
    assessSuccessfulLogin(
      { status: 200, data: { session: "" } },
      "org-1",
      "key-B",
      1_000,
    ),
    false,
  );
  assert.equal(
    assessSuccessfulLogin(
      {
        status: 200,
        data: {
          session: session({ ...validClaims, organization_id: "wrong" }),
        },
      },
      "org-1",
      "key-B",
      1_000,
    ),
    false,
  );
  assert.equal(
    assessSuccessfulLogin(
      {
        status: 200,
        data: { session: session({ ...validClaims, public_key: "wrong" }) },
      },
      "org-1",
      "key-B",
      1_000,
    ),
    false,
  );
});

test("control C uses the built SDK public loginWithOtp Attested request", async () => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const point = ecdh.getPublicKey(undefined, "uncompressed");
  const privateKey = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33).toString("base64url"),
      d: ecdh.getPrivateKey().toString("base64url"),
    },
    format: "jwk",
  });
  const publicKey = ecdh.getPublicKey("hex", "compressed");
  const key = {
    publicKey,
    sign: (message: string, raw = false) => {
      const signer = createSign("SHA256");
      signer.update(message);
      return signer
        .sign({ key: privateKey, dsaEncoding: raw ? "ieee-p1363" : "der" })
        .toString("hex");
    },
  };
  const verificationToken = session({
    id: "token-C",
    public_key: publicKey,
    contact: "person@example.test",
    verification_type: "OTP_TYPE_EMAIL",
    exp: 2_000_000_000,
  });
  const sessionToken = session({ ...validClaims, public_key: publicKey });
  const originalFetch = globalThis.fetch;
  let stamped = false;
  globalThis.fetch = (async (url, init) => {
    assert.equal(
      String(url),
      "https://api.staging.0xkey.io/public/v1/submit/stamp_login",
    );
    const headers = init?.headers as Record<string, string>;
    assert.ok(headers["X-Stamp-Attested"]);
    stamped = true;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "x-request-id": "trace-C" }),
      json: async () => ({
        activity: {
          id: "activity-C",
          organizationId: "org-1",
          type: "ACTIVITY_TYPE_STAMP_LOGIN",
          status: "ACTIVITY_STATUS_COMPLETED",
          result: { stampLoginResult: { session: sessionToken } },
        },
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const deps = await makeLiveDeps(parseOptions([]));
    const result = await deps.loginAttested(verificationToken, key, "org-1");
    assert.equal(stamped, true);
    assert.equal(result.status, 200);
    assert.equal(result.traceId, "trace-C");
    assert.equal(
      (result.data as Record<string, unknown>).session,
      sessionToken,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("expiry needs correlated authoritative evidence, not HTTP failure or prose", () => {
  const rejected: HttpResult = {
    status: 500,
    traceId: "trace-B",
    data: { message: "expired" },
  };
  const proof = {
    traceId: "trace-B",
    activityId: "activity-B",
    tokenId: "token-B",
    decidedAtMs: 1_032_000,
    reason: "VERIFICATION_TOKEN_EXPIRED",
    source: "activity" as const,
  };
  assert.equal(assessExpiredLogin(rejected, proof, 1_032_000, "token-B"), true);
  assert.equal(assessExpiredLogin(rejected, undefined), false);
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, traceId: "other" },
      1_032_000,
      "token-B",
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, tokenId: "other" },
      1_032_000,
      "token-B",
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, reason: "TOKEN_ALREADY_CONSUMED" },
      1_032_000,
      "token-B",
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, reason: "WRONG_ORGANIZATION" },
      1_032_000,
      "token-B",
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, reason: "MISSING_SIGNATURE" },
      1_032_000,
      "token-B",
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, activityId: "" },
      1_032_000,
      "token-B",
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, decidedAtMs: 1_031_999 },
      1_032_000,
      "token-B",
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      { ...rejected, data: { nested: { session: "unexpected" } } },
      proof,
      1_032_000,
      "token-B",
    ),
    false,
  );
  let deeplyNested: unknown = { session: "unexpected" };
  for (let i = 0; i < 15; i++) deeplyNested = { nested: deeplyNested };
  assert.equal(
    assessExpiredLogin(
      { ...rejected, data: deeplyNested },
      proof,
      1_032_000,
      "token-B",
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      { ...rejected, data: { nested: { session: { token: "unexpected" } } } },
      proof,
      1_032_000,
      "token-B",
    ),
    false,
  );
});

test("option parser defaults to offline and rejects unsafe targets and partial live flags", () => {
  assert.equal(parseOptions([]).live, false);
  assert.throws(() => parseOptions(["--live"]));
  assert.throws(() => parseOptions(["--send-otp"]));
  assert.throws(() => parseOptions(["--dry-run", "--live", "--send-otp"]));
  assert.throws(() =>
    parseOptions([
      "--live",
      "--send-otp",
      "--auth-proxy-url",
      "https://evil.test",
    ]),
  );
  assert.throws(() =>
    parseOptions([
      "--live",
      "--send-otp",
      "--api-url",
      "https://api.staging.0xkey.io.evil.test",
    ]),
  );
  assert.throws(() =>
    parseOptions(["--live", "--send-otp", "--email", "other@example.com"]),
  );
  assert.throws(() => parseOptions(["--live", "--send-otp", "--expired"]));
});

test("offline mode never calls transport or prompt", async () => {
  const forbidden = async (): Promise<never> => {
    throw Error("network or prompt called");
  };
  const result = await runAcceptance(parseOptions([]), {
    health: forbidden,
    init: forbidden,
    verify: forbidden,
    account: forbidden,
    loginV2: forbidden,
    loginAttested: forbidden,
    readOtp: forbidden,
    encrypt: forbidden,
    keys: forbidden,
    sleep: forbidden,
    expiryEvidence: forbidden,
    now: () => 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "dry-run");
});

test("live uses three fresh challenges once and never retries a failing init", async () => {
  const options = parseOptions(["--live", "--send-otp"]);
  let inits = 0;
  const deps = {
    health: async () => ({
      status: 200,
      data: { enabledProviders: ["email"] },
    }),
    init: async () => {
      inits++;
      throw Error("offline failure");
    },
  } as unknown as AcceptanceDeps;
  await assert.rejects(runAcceptance(options, deps));
  assert.equal(inits, 1);
});

test("live A, B, and C use distinct challenges and only B waits for expiry", async () => {
  let nowMs = 1_000_000;
  let issued = 0;
  let keyCount = 0;
  let loginCount = 0;
  const challenges: string[] = [];
  const waits: number[] = [];
  let attested = 0;
  const deps: AcceptanceDeps = {
    now: () => nowMs,
    health: async () => ({
      status: 200,
      data: { enabledProviders: ["email"] },
    }),
    init: async () => {
      issued++;
      challenges.push(`otp-${issued}`);
      return {
        status: 200,
        data: { otpId: `otp-${issued}`, otpEncryptionTargetBundle: "bundle" },
      };
    },
    keys: async () => {
      keyCount++;
      return { publicKey: `key-${keyCount}`, sign: () => "signature" };
    },
    readOtp: async () => "123456",
    encrypt: async () => "encrypted",
    verify: async (_id, _encrypted, ttl) => ({
      status: 200,
      data: {
        verificationToken: session({
          id: `token-${issued}`,
          public_key: `key-${keyCount}`,
          iat: nowMs / 1000,
          exp: nowMs / 1000 + ttl,
        }),
      },
    }),
    account: async () => ({ status: 200, data: { organizationId: "org-1" } }),
    loginV2: async (body) => {
      loginCount++;
      assert.ok((body.clientSignature as Record<string, unknown>).signature);
      if (loginCount === 1)
        return {
          status: 200,
          data: {
            session: session({ ...validClaims, public_key: body.publicKey }),
          },
        };
      return { status: 401, traceId: "trace-B", data: { message: "generic" } };
    },
    sleep: async (ms) => {
      waits.push(ms);
      nowMs += ms;
    },
    expiryEvidence: async (traceId) => ({
      traceId,
      activityId: "activity-B",
      tokenId: "token-2",
      decidedAtMs: nowMs,
      reason: "VERIFICATION_TOKEN_EXPIRED",
      source: "enclave",
    }),
    loginAttested: async (_token, key) => {
      attested++;
      return {
        status: 200,
        data: {
          session: session({
            ...validClaims,
            iat: nowMs / 1000,
            exp: nowMs / 1000 + 900,
            public_key: key.publicKey,
          }),
        },
      };
    },
  };
  const result = await runAcceptance(
    parseOptions(["--live", "--send-otp"]),
    deps,
  );
  assert.deepEqual(result, { ok: true, mode: "live" });
  assert.deepEqual(challenges, ["otp-1", "otp-2", "otp-3"]);
  assert.deepEqual(waits, [32_000]);
  assert.equal(loginCount, 2);
  assert.equal(attested, 1);
});

test("hidden OTP reader restores terminal on success and cancellation", async () => {
  const { EventEmitter } = await import("node:events");
  for (const input of ["123456\r", "\u0003"]) {
    const stream = new EventEmitter() as InstanceType<typeof EventEmitter> & {
      isTTY: boolean;
      isRaw: boolean;
      pause: () => void;
      resume: () => void;
      setRawMode: (x: boolean) => void;
    };
    stream.isTTY = true;
    stream.isRaw = false;
    let paused = 0;
    stream.pause = () => {
      paused++;
    };
    stream.resume = () => {};
    stream.setRawMode = (x) => {
      stream.isRaw = x;
    };
    const pending = readHiddenOtp(
      stream as never,
      { write: () => true } as never,
    );
    stream.emit("data", Buffer.from(input));
    if (input.startsWith("1")) assert.equal(await pending, "123456");
    else await assert.rejects(pending);
    assert.equal(stream.isRaw, false);
    assert.equal(stream.listenerCount("data"), 0);
    assert.equal(paused, 1);
  }
});

test("hidden OTP reader rejects stream closure and removes every listener", async () => {
  const { EventEmitter } = await import("node:events");
  const stream = new EventEmitter() as InstanceType<typeof EventEmitter> & {
    isTTY: boolean;
    isRaw: boolean;
    pause: () => void;
    resume: () => void;
    setRawMode: (x: boolean) => void;
  };
  stream.isTTY = true;
  stream.isRaw = false;
  let paused = 0;
  stream.pause = () => {
    paused++;
  };
  stream.resume = () => {};
  stream.setRawMode = (x) => {
    stream.isRaw = x;
  };
  const pending = readHiddenOtp(
    stream as never,
    { write: () => true } as never,
  );
  stream.emit("close");
  await assert.rejects(pending);
  assert.equal(stream.isRaw, false);
  assert.equal(paused, 1);
  for (const name of ["data", "close", "end", "error"])
    assert.equal(stream.listenerCount(name), 0);
});
