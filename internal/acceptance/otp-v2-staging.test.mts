import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createECDH,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
} from "node:crypto";
import {
  assessExpiredLogin,
  assessSuccessfulLogin,
  parseOptions,
  readHiddenOtp,
  runAcceptance,
  makeLiveDeps,
  type AcceptanceDeps,
  type HttpResult,
  type ExpiryEvidence,
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
const requestB = "11111111-1111-4111-8111-111111111111";
const fingerprintB = "a".repeat(64);
const candidateOptions = () =>
  parseOptions([
    "--evidence-cluster-endpoint",
    "https://example.test",
    "--evidence-auth-proxy-image-id",
    `docker-pullable://auth@sha256:${"a".repeat(64)}`,
    "--evidence-coordinator-image-id",
    `docker-pullable://coordinator@sha256:${"b".repeat(64)}`,
  ]);

function p256TestKey() {
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
  return {
    publicKey: ecdh.getPublicKey("hex", "compressed"),
    verifyingKey: createPublicKey(privateKey),
    sign: (message: string, raw = false) => {
      const signer = createSign("SHA256");
      signer.update(message);
      return signer
        .sign({ key: privateKey, dsaEncoding: raw ? "ieee-p1363" : "der" })
        .toString("hex");
    },
  };
}

function legalSignedLogin(
  body: Record<string, unknown>,
  token: string,
  verificationKey: ReturnType<typeof p256TestKey>,
  sessionKey: ReturnType<typeof p256TestKey>,
  tokenId: string,
): boolean {
  const signature = body.clientSignature as Record<string, unknown>;
  const expectedMessage = `{"login":{"publicKey":"${sessionKey.publicKey}"},"tokenId":"${tokenId}","type":"USAGE_TYPE_LOGIN"}`;
  if (
    body.verificationToken !== token ||
    body.publicKey !== sessionKey.publicKey ||
    signature.publicKey !== verificationKey.publicKey ||
    signature.scheme !== "CLIENT_SIGNATURE_SCHEME_API_P256" ||
    signature.message !== expectedMessage ||
    typeof signature.signature !== "string" ||
    !/^[0-9a-f]{128}$/i.test(signature.signature)
  )
    return false;
  const verifier = createVerify("SHA256");
  verifier.update(expectedMessage);
  return verifier.verify(
    { key: verificationKey.verifyingKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature.signature, "hex"),
  );
}

test("success needs HTTP 200, a nonempty Session, and matching JWT claims", () => {
  assert.equal(
    assessSuccessfulLogin(
      { status: 200, data: { session: session(validClaims) } },
      "org-1",
      "key-B",
      1_000,
      900,
    ),
    true,
  );
  assert.equal(
    assessSuccessfulLogin(
      { status: 500, data: { session: session(validClaims) } },
      "org-1",
      "key-B",
      1_000,
      900,
    ),
    false,
  );
  assert.equal(
    assessSuccessfulLogin(
      { status: 200, data: { session: "" } },
      "org-1",
      "key-B",
      1_000,
      900,
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
      900,
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
      900,
    ),
    false,
  );
  assert.equal(
    assessSuccessfulLogin(
      {
        status: 200,
        data: { session: session({ ...validClaims, exp: 1_600 }) },
      },
      "org-1",
      "key-B",
      1_000,
      600,
    ),
    true,
  );
});

test("unsupported OTP format is rejected before any challenge is sent", async () => {
  for (const [otpLength, otpAlphanumeric, ttl, reason] of [
    ["8", false, "600", "UNSUPPORTED_OTP_FORMAT"],
    ["6", true, "600", "UNSUPPORTED_OTP_FORMAT"],
    ["6", null, "600", "UNSUPPORTED_OTP_FORMAT"],
    ["6", "false", "600", "UNSUPPORTED_OTP_FORMAT"],
    ["6", 0, "600", "UNSUPPORTED_OTP_FORMAT"],
    ["6", false, "0", "INVALID_SESSION_TTL"],
  ] as const) {
    let inits = 0;
    const deps = {
      now: () => 1_000_000,
      ttyReady: () => true,
      evidencePreflight: async () => {},
      health: async () => ({
        status: 200,
        data: {
          enabledProviders: ["email"],
          otpLength,
          otpAlphanumeric,
          sessionExpirationSeconds: ttl,
        },
      }),
      init: async () => {
        inits++;
        throw Error("must not send OTP");
      },
    } as unknown as AcceptanceDeps;
    await assert.rejects(
      runAcceptance(parseOptions(["--live", "--send-otp"]), deps),
      new RegExp(reason),
    );
    assert.equal(inits, 0);
  }
});

test("omitted otpAlphanumeric accepts the numeric OTP configuration", async () => {
  let inits = 0;
  const deps = {
    now: () => 1_000_000,
    ttyReady: () => true,
    evidencePreflight: async () => {},
    health: async () => ({
      status: 200,
      data: {
        enabledProviders: ["email"],
        otpLength: "6",
        sessionExpirationSeconds: "1800",
      },
    }),
    init: async () => {
      inits++;
      throw Error("synthetic init sentinel");
    },
  } as unknown as AcceptanceDeps;
  await assert.rejects(
    runAcceptance(parseOptions(["--live", "--send-otp"]), deps),
    /synthetic init sentinel/,
  );
  assert.equal(inits, 1);
});

test("private TTY is required before the first challenge", async () => {
  let inits = 0;
  let healthChecks = 0;
  const deps = {
    now: () => 1_000_000,
    ttyReady: () => false,
    health: async () => {
      healthChecks++;
      return {
        status: 200,
        data: {
          enabledProviders: ["email"],
          otpLength: "6",
          otpAlphanumeric: false,
          sessionExpirationSeconds: "600",
        },
      };
    },
    init: async () => {
      inits++;
      throw Error("must not send OTP");
    },
  } as unknown as AcceptanceDeps;
  await assert.rejects(
    runAcceptance(parseOptions(["--live", "--send-otp"]), deps),
    /PRIVATE_TTY_REQUIRED/,
  );
  assert.equal(inits, 0);
  assert.equal(healthChecks, 0);
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
      headers: new Headers({ "x-request-id": requestB }),
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
    const deps = await makeLiveDeps(candidateOptions());
    const result = await deps.loginAttested(verificationToken, key, "org-1");
    assert.equal(stamped, true);
    assert.equal(result.status, 200);
    assert.equal(result.requestId, requestB);
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
    requestId: requestB,
    data: { message: "expired" },
  };
  const proof = {
    requestId: requestB,
    activityId: "activity-B",
    activityFingerprint: fingerprintB,
    decidedAtMs: 1_032_000,
    reason: "VERIFICATION_TOKEN_EXPIRED" as const,
    source: "activity" as const,
  };
  assert.equal(assessExpiredLogin(rejected, proof, 1_032_000), true);
  assert.equal(assessExpiredLogin(rejected, undefined), false);
  assert.equal(
    assessExpiredLogin(rejected, { ...proof, requestId: "other" }, 1_032_000),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, activityFingerprint: "not-a-fingerprint" },
      1_032_000,
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      {
        ...proof,
        reason: "TOKEN_ALREADY_CONSUMED",
      } as unknown as ExpiryEvidence,
      1_032_000,
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, reason: "WRONG_ORGANIZATION" } as unknown as ExpiryEvidence,
      1_032_000,
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, reason: "MISSING_SIGNATURE" } as unknown as ExpiryEvidence,
      1_032_000,
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(rejected, { ...proof, activityId: "" }, 1_032_000),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      rejected,
      { ...proof, decidedAtMs: 1_031_999 },
      1_032_000,
    ),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      { ...rejected, data: { nested: { session: "unexpected" } } },
      proof,
      1_032_000,
    ),
    false,
  );
  let deeplyNested: unknown = { session: "unexpected" };
  for (let i = 0; i < 15; i++) deeplyNested = { nested: deeplyNested };
  assert.equal(
    assessExpiredLogin({ ...rejected, data: deeplyNested }, proof, 1_032_000),
    false,
  );
  assert.equal(
    assessExpiredLogin(
      { ...rejected, data: { nested: { session: { token: "unexpected" } } } },
      proof,
      1_032_000,
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
  assert.throws(() => parseOptions(["--sdk-sha256", "a".repeat(64)]));
  assert.equal(
    parseOptions(["--sdk-artifacts-sha256", "a".repeat(64)]).sdkArtifactsSha256,
    "a".repeat(64),
  );
});

test("live dependency construction requires all reviewed cluster candidate pins", async () => {
  await assert.rejects(
    makeLiveDeps(parseOptions([])),
    /EVIDENCE_CANDIDATE_REQUIRED/,
  );
});

test("offline mode never calls transport or prompt", async () => {
  const forbidden = async (): Promise<never> => {
    throw Error("network or prompt called");
  };
  const events: Array<Record<string, string | number | boolean>> = [];
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
    evidencePreflight: forbidden,
    beginExpiryWindow: forbidden,
    now: () => 0,
    ttyReady: () => {
      throw Error("TTY probed during dry run");
    },
    emit: (event) => {
      events.push(event);
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "dry-run");
  assert.equal(events[0]?.phase, "transport-safety-smoke");
});

test("live uses three fresh challenges once and never retries a failing init", async () => {
  const options = parseOptions(["--live", "--send-otp"]);
  let inits = 0;
  const deps = {
    ttyReady: () => true,
    evidencePreflight: async () => {},
    health: async () => ({
      status: 200,
      data: {
        enabledProviders: ["email"],
        otpLength: "6",
        otpAlphanumeric: false,
        sessionExpirationSeconds: "600",
      },
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
  let loginCount = 0;
  const keyPairs: Array<ReturnType<typeof p256TestKey>> = [];
  const verificationTokens: string[] = [];
  const challenges: string[] = [];
  const waits: number[] = [];
  let attested = 0;
  const deps: AcceptanceDeps = {
    now: () => nowMs,
    ttyReady: () => true,
    evidencePreflight: async () => {},
    beginExpiryWindow: async () => {},
    health: async () => ({
      status: 200,
      data: {
        enabledProviders: ["email"],
        otpLength: "6",
        otpAlphanumeric: false,
        sessionExpirationSeconds: "600",
      },
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
      const key = p256TestKey();
      keyPairs.push(key);
      return key;
    },
    readOtp: async () => "123456",
    encrypt: async () => "encrypted",
    verify: async (_id, _encrypted, ttl) => {
      const token = session({
        id: `token-${issued}`,
        public_key: keyPairs.at(-1)!.publicKey,
        iat: nowMs / 1000,
        exp: nowMs / 1000 + ttl,
      });
      verificationTokens.push(token);
      return { status: 200, data: { verificationToken: token } };
    },
    account: async () => ({ status: 200, data: { organizationId: "org-1" } }),
    loginV2: async (body) => {
      loginCount++;
      const verificationKey = keyPairs[(loginCount - 1) * 2]!;
      const sessionKey = keyPairs[(loginCount - 1) * 2 + 1]!;
      const token = verificationTokens[loginCount - 1]!;
      assert.equal(
        legalSignedLogin(
          body,
          token,
          verificationKey,
          sessionKey,
          `token-${loginCount}`,
        ),
        true,
      );
      const stamp = body.clientSignature as Record<string, unknown>;
      assert.equal(
        legalSignedLogin(
          {
            ...body,
            clientSignature: {
              ...stamp,
              message: String(stamp.message).replace(
                `token-${loginCount}`,
                "wrong-token",
              ),
            },
          },
          token,
          verificationKey,
          sessionKey,
          `token-${loginCount}`,
        ),
        false,
      );
      assert.equal(
        legalSignedLogin(
          {
            ...body,
            clientSignature: { ...stamp, signature: "00".repeat(64) },
          },
          token,
          verificationKey,
          sessionKey,
          `token-${loginCount}`,
        ),
        false,
      );
      assert.equal(
        legalSignedLogin(
          { ...body, publicKey: verificationKey.publicKey },
          token,
          verificationKey,
          sessionKey,
          `token-${loginCount}`,
        ),
        false,
      );
      if (loginCount === 1)
        return {
          status: 200,
          data: {
            session: session({
              ...validClaims,
              exp: 1_600,
              public_key: sessionKey.publicKey,
            }),
          },
        };
      return { status: 401, requestId: requestB, data: { message: "generic" } };
    },
    sleep: async (ms) => {
      waits.push(ms);
      nowMs += ms;
    },
    expiryEvidence: async (requestId) => ({
      requestId,
      activityId: "activity-B",
      activityFingerprint: fingerprintB,
      decidedAtMs: nowMs,
      reason: "VERIFICATION_TOKEN_EXPIRED",
      source: "activity",
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
