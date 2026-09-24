/** Staging-only OTP V2 acceptance. Importing this module has no network side effects. */
import {
  createECDH,
  createPrivateKey,
  createSign,
  createHash,
} from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const AUTH_PROXY = "https://authproxy.staging.0xkey.io";
const API = "https://api.staging.0xkey.io";
const CONFIG_ID = "5cc1732a-b599-43c8-a61e-041d1821d0fd";
const EMAIL = "torbenmagne+0xkey-attested-20260923@gmail.com";
const OTP_TTL = 30;
const SESSION_TTL = 900;

export type HttpResult = { status: number; data: unknown; traceId?: string };
export type ExpiryEvidence = {
  traceId: string;
  activityId: string;
  tokenId: string;
  decidedAtMs: number;
  reason: "VERIFICATION_TOKEN_EXPIRED" | string;
  source: "activity" | "enclave";
};
export type Options = {
  live: boolean;
  authProxyUrl: string;
  apiUrl: string;
  configId: string;
  email: string;
  sdkSha256?: string;
};
type Key = {
  publicKey: string;
  sign: (message: string, raw?: boolean) => string;
};
export type AcceptanceDeps = {
  health: () => Promise<HttpResult>;
  init: () => Promise<HttpResult>;
  verify: (
    otpId: string,
    encrypted: string,
    ttl: number,
  ) => Promise<HttpResult>;
  account: (token: string) => Promise<HttpResult>;
  loginV2: (body: Record<string, unknown>) => Promise<HttpResult>;
  loginAttested: (
    token: string,
    key: Key,
    organizationId: string,
  ) => Promise<HttpResult>;
  readOtp: () => Promise<string>;
  ttyReady: () => boolean;
  encrypt: (bundle: string, otp: string, publicKey: string) => Promise<string>;
  keys: () => Promise<Key>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Must be backed by a trusted internal Activity/trace lookup, not operator prose. */
  expiryEvidence: (traceId: string) => Promise<ExpiryEvidence | undefined>;
  emit?: (event: Record<string, string | number | boolean>) => void;
};

function exactEndpoint(value: string, expected: string): string {
  const url = new URL(value);
  if (url.href !== `${expected}/` || url.username || url.password)
    throw Error("INVALID_STAGING_ENDPOINT");
  return expected;
}

export function parseOptions(args: string[]): Options {
  const options: Options = {
    live: false,
    authProxyUrl: AUTH_PROXY,
    apiUrl: API,
    configId: CONFIG_ID,
    email: EMAIL,
  };
  let live = false;
  let sendOtp = false;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--live") {
      live = true;
      continue;
    }
    if (arg === "--send-otp") {
      sendOtp = true;
      continue;
    }
    const property = (
      {
        "--auth-proxy-url": "authProxyUrl",
        "--api-url": "apiUrl",
        "--config-id": "configId",
        "--email": "email",
        "--sdk-sha256": "sdkSha256",
      } as const
    )[arg as "--email"];
    if (!property || !args[i + 1]) throw Error("INVALID_ARGUMENT");
    (options as unknown as Record<string, unknown>)[property] = args[++i];
  }
  if (live !== sendOtp) throw Error("LIVE_REQUIRES_SEND_OTP");
  if (dryRun && live) throw Error("CONFLICTING_MODES");
  options.live = live;
  options.authProxyUrl = exactEndpoint(options.authProxyUrl, AUTH_PROXY);
  options.apiUrl = exactEndpoint(options.apiUrl, API);
  if (options.configId !== CONFIG_ID || options.email !== EMAIL)
    throw Error("UNAPPROVED_IDENTITY");
  if (options.sdkSha256 && !/^[0-9a-f]{64}$/i.test(options.sdkSha256))
    throw Error("INVALID_BUILD_DIGEST");
  return options;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function claims(token: unknown): Record<string, unknown> {
  if (!nonempty(token)) return {};
  const segment = token.split(".")[1];
  try {
    return record(
      JSON.parse(Buffer.from(segment, "base64url").toString("utf8")),
    );
  } catch {
    return {};
  }
}
function hasSession(value: unknown): boolean {
  const pending = [value];
  const seen = new Set<object>();
  while (pending.length > 0) {
    // A response too large to inspect is inconclusive, never an expiry pass.
    if (seen.size > 10_000) return true;
    const next = pending.pop();
    if (next === null || typeof next !== "object" || seen.has(next)) continue;
    seen.add(next);
    if (Array.isArray(next)) {
      pending.push(...next);
      continue;
    }
    for (const [key, child] of Object.entries(next)) {
      if (
        key.toLowerCase() === "session" &&
        child !== null &&
        child !== undefined &&
        (typeof child !== "string" || nonempty(child))
      )
        return true;
      pending.push(child);
    }
  }
  return false;
}

export function assessSuccessfulLogin(
  result: HttpResult,
  org: string,
  key: string,
  issuedAt: number,
  expectedTtl: number,
): boolean {
  if (result.status !== 200) return false;
  const session = record(result.data).session;
  if (!nonempty(session)) return false;
  const c = claims(session);
  return (
    c.organization_id === org &&
    nonempty(c.user_id) &&
    c.public_key === key &&
    typeof c.iat === "number" &&
    typeof c.exp === "number" &&
    c.exp - c.iat === expectedTtl &&
    c.iat <= issuedAt + 5 &&
    c.exp > issuedAt
  );
}

export function assessExpiredLogin(
  result: HttpResult,
  evidence: ExpiryEvidence | undefined,
  notBeforeMs?: number,
  expectedTokenId?: string,
): boolean {
  return (
    (result.status < 200 || result.status >= 300) &&
    !hasSession(result.data) &&
    nonempty(result.traceId) &&
    evidence?.traceId === result.traceId &&
    nonempty(evidence.activityId) &&
    nonempty(expectedTokenId) &&
    evidence.tokenId === expectedTokenId &&
    typeof notBeforeMs === "number" &&
    Number.isFinite(evidence.decidedAtMs) &&
    evidence.decidedAtMs >= notBeforeMs &&
    evidence.reason === "VERIFICATION_TOKEN_EXPIRED" &&
    (evidence.source === "activity" || evidence.source === "enclave")
  );
}

function event(
  deps: AcceptanceDeps,
  control: string,
  phase: string,
  response?: HttpResult,
  checks?: Record<string, boolean>,
) {
  const safeTrace = response?.traceId?.match(/^[a-zA-Z0-9:._-]{1,128}$/)
    ? response.traceId
    : undefined;
  deps.emit?.({
    at: new Date(deps.now()).toISOString(),
    control,
    phase,
    version: "v2",
    ...(response && { status: response.status }),
    ...(safeTrace && { traceId: safeTrace }),
    ...checks,
  });
}
function requiredString(value: unknown, failure: string): string {
  if (!nonempty(value)) throw Error(failure);
  return value;
}
function verifiedToken(
  result: HttpResult,
  ttl: number,
  now: number,
  key: string,
): string {
  if (result.status !== 200) throw Error("VERIFY_FAILED");
  const token = requiredString(
    record(result.data).verificationToken,
    "VERIFY_MISSING_TOKEN",
  );
  const c = claims(token);
  if (
    typeof c.exp !== "number" ||
    typeof c.iat !== "number" ||
    c.exp - c.iat !== ttl ||
    c.exp <= now ||
    c.public_key !== key ||
    !nonempty(c.id)
  )
    throw Error("VERIFY_CLAIMS_INVALID");
  return token;
}
async function newChallenge(deps: AcceptanceDeps, control: string) {
  const health = await deps.health();
  const config = record(health.data);
  if (
    health.status !== 200 ||
    !Array.isArray(config.enabledProviders) ||
    !config.enabledProviders.includes("email")
  )
    throw Error("CONFIG_HEALTH_FAILED");
  if (config.otpLength !== "6" || config.otpAlphanumeric !== false)
    throw Error("UNSUPPORTED_OTP_FORMAT");
  if (
    typeof config.sessionExpirationSeconds !== "string" ||
    !/^[1-9]\d*$/.test(config.sessionExpirationSeconds) ||
    !Number.isSafeInteger(Number(config.sessionExpirationSeconds))
  )
    throw Error("INVALID_SESSION_TTL");
  const sessionTtl = Number(config.sessionExpirationSeconds);
  event(deps, control, "config", health, { healthy: true });
  const init = await deps.init(); // Exactly one request. A failed init is terminal.
  event(deps, control, "init", init, { accepted: init.status === 200 });
  if (init.status !== 200) throw Error("INIT_FAILED");
  const data = record(init.data);
  const otpId = requiredString(data.otpId, "INIT_MISSING_CHALLENGE");
  const bundle = requiredString(
    data.otpEncryptionTargetBundle,
    "INIT_MISSING_BUNDLE",
  );
  const key = await deps.keys();
  const otp = await deps.readOtp();
  if (!/^\d{6}$/.test(otp)) throw Error("INVALID_OTP_INPUT");
  return { otpId, bundle, key, otp, sessionTtl };
}
async function verify(
  deps: AcceptanceDeps,
  control: string,
  challenge: Awaited<ReturnType<typeof newChallenge>>,
  ttl: number,
) {
  const encrypted = await deps.encrypt(
    challenge.bundle,
    challenge.otp,
    challenge.key.publicKey,
  );
  const result = await deps.verify(challenge.otpId, encrypted, ttl);
  const token = verifiedToken(
    result,
    ttl,
    Math.floor(deps.now() / 1000),
    challenge.key.publicKey,
  );
  event(deps, control, "verify", result, {
    tokenClaimsValid: true,
    ttlValid: true,
  });
  return token;
}
async function organization(
  deps: AcceptanceDeps,
  control: string,
  token: string,
) {
  const response = await deps.account(token);
  const id = requiredString(
    record(response.data).organizationId,
    "ACCOUNT_MISSING_ORG",
  );
  if (response.status !== 200) throw Error("ACCOUNT_FAILED");
  event(deps, control, "account", response, { organizationFound: true });
  return id;
}
function signedLogin(
  token: string,
  verificationKey: Key,
  sessionPublicKey: string,
  organizationId: string,
) {
  const c = claims(token);
  if (!nonempty(c.id) || c.public_key !== verificationKey.publicKey)
    throw Error("TOKEN_KEY_MISMATCH");
  const message = JSON.stringify({
    login: { publicKey: sessionPublicKey },
    tokenId: c.id,
    type: "USAGE_TYPE_LOGIN",
  });
  return {
    verificationToken: token,
    publicKey: sessionPublicKey,
    organizationId,
    clientSignature: {
      message,
      publicKey: verificationKey.publicKey,
      scheme: "CLIENT_SIGNATURE_SCHEME_API_P256",
      signature: verificationKey.sign(message, true),
    },
  };
}

export async function runAcceptance(
  options: Options,
  deps: AcceptanceDeps,
): Promise<{ ok: boolean; mode: "dry-run" | "live" }> {
  if (!options.live) {
    event(deps, "synthetic", "transport-safety-smoke", undefined, {
      noNetwork: true,
    });
    return { ok: true, mode: "dry-run" };
  }
  if (deps.ttyReady?.() !== true) throw Error("PRIVATE_TTY_REQUIRED");
  const a = await newChallenge(deps, "A");
  const tokenA = await verify(deps, "A", a, OTP_TTL);
  const orgA = await organization(deps, "A", tokenA);
  const sessionA = await deps.keys();
  const responseA = await deps.loginV2(
    signedLogin(tokenA, a.key, sessionA.publicKey, orgA),
  );
  const goodA = assessSuccessfulLogin(
    responseA,
    orgA,
    sessionA.publicKey,
    Math.floor(deps.now() / 1000),
    a.sessionTtl,
  );
  event(deps, "A", "login", responseA, { sessionValid: goodA });
  if (!goodA) throw Error("CONTROL_A_FAILED");

  const b = await newChallenge(deps, "B");
  if (b.otpId === a.otpId) throw Error("CHALLENGE_REUSED");
  const tokenB = await verify(deps, "B", b, OTP_TTL);
  const orgB = await organization(deps, "B", tokenB); // Lookup does not consume Token.
  const exp = claims(tokenB).exp as number;
  await deps.sleep(Math.max(0, (exp + 2) * 1000 - deps.now()));
  const sessionB = await deps.keys();
  const responseB = await deps.loginV2(
    signedLogin(tokenB, b.key, sessionB.publicKey, orgB),
  );
  const evidence = responseB.traceId
    ? await deps.expiryEvidence(responseB.traceId)
    : undefined;
  const goodB = assessExpiredLogin(
    responseB,
    evidence,
    (exp + 2) * 1000,
    claims(tokenB).id as string,
  );
  event(deps, "B", "expired-login", responseB, {
    noSession: !hasSession(responseB.data),
    authoritativeExpiry: goodB,
  });
  if (!goodB) throw Error("CONTROL_B_INCONCLUSIVE_OR_FAILED");

  const c = await newChallenge(deps, "C");
  if (c.otpId === a.otpId || c.otpId === b.otpId)
    throw Error("CHALLENGE_REUSED");
  const tokenC = await verify(deps, "C", c, OTP_TTL);
  const orgC = await organization(deps, "C", tokenC);
  const responseC = await deps.loginAttested(tokenC, c.key, orgC);
  const goodC = assessSuccessfulLogin(
    responseC,
    orgC,
    c.key.publicKey,
    Math.floor(deps.now() / 1000),
    SESSION_TTL,
  );
  event(deps, "C", "attested-login", responseC, { sessionValid: goodC });
  if (!goodC) throw Error("CONTROL_C_FAILED");
  return { ok: true, mode: "live" };
}

export async function readHiddenOtp(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Promise<string> {
  if (!input.isTTY || typeof input.setRawMode !== "function")
    throw Error("PRIVATE_TTY_REQUIRED");
  output.write("Enter OTP (hidden): ");
  const wasRaw = input.isRaw;
  let onData: ((chunk: Buffer) => void) | undefined;
  let onClose: (() => void) | undefined;
  let onError: ((error: Error) => void) | undefined;
  try {
    input.setRawMode(true);
    input.resume();
    return await new Promise<string>((resolve, reject) => {
      let code = "";
      onData = (chunk) => {
        for (const char of chunk.toString("utf8")) {
          if (char === "\u0003" || char === "\u0004") {
            reject(Error("OTP_INPUT_CANCELED"));
            return;
          }
          if (char === "\r" || char === "\n") {
            resolve(code);
            return;
          }
          if (char === "\u007f") {
            code = code.slice(0, -1);
            continue;
          }
          if (/^[0-9]$/.test(char) && code.length < 6) code += char;
        }
      };
      onClose = () => reject(Error("OTP_INPUT_CANCELED"));
      onError = () => reject(Error("OTP_INPUT_CANCELED"));
      input.on("data", onData);
      input.on("close", onClose);
      input.on("end", onClose);
      input.on("error", onError);
    });
  } finally {
    if (onData) input.off("data", onData);
    if (onClose) {
      input.off("close", onClose);
      input.off("end", onClose);
    }
    if (onError) input.off("error", onError);
    input.setRawMode(wasRaw);
    input.pause();
    output.write("\n");
  }
}

async function frozenBuild(expected: string | undefined) {
  if (!expected) throw Error("SDK_BUILD_DIGEST_REQUIRED");
  const path = fileURLToPath(
    new URL("../../packages/core/dist/index.mjs", import.meta.url),
  );
  const bytes = await readFile(path);
  if (
    createHash("sha256").update(bytes).digest("hex") !== expected.toLowerCase()
  )
    throw Error("SDK_BUILD_DIGEST_MISMATCH");
  if (!(await stat(path)).isFile()) throw Error("SDK_BUILD_MISSING");
}
function keyPair(): Key {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const point = ecdh.getPublicKey(undefined, "uncompressed");
  const secret = createPrivateKey({
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
    sign: (message, raw = false) => {
      const signer = createSign("SHA256");
      signer.update(message);
      return signer
        .sign({ key: secret, dsaEncoding: raw ? "ieee-p1363" : "der" })
        .toString("hex");
    },
  };
}
function safeTrace(headers: Headers) {
  return (
    headers.get("x-request-id") ?? headers.get("x-activity-id") ?? undefined
  );
}
export async function makeLiveDeps(options: Options): Promise<AcceptanceDeps> {
  const crypto = await import("../../packages/crypto/dist/index.mjs");
  const core = await import("../../packages/core/dist/index.mjs");
  async function post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<HttpResult> {
    const response = await fetch(`${options.authProxyUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Proxy-Config-ID": options.configId,
      },
      body: JSON.stringify(body),
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    return {
      status: response.status,
      traceId: safeTrace(response.headers),
      data,
    };
  }
  return {
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    emit: (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
    health: () => post("/v1/wallet_kit_config", {}),
    init: () =>
      post("/v1/otp_init_v2", {
        otpType: "OTP_TYPE_EMAIL",
        contact: options.email,
      }),
    verify: (otpId, encryptedOtpBundle, expirationSeconds) =>
      post("/v1/otp_verify_v2", {
        otpId,
        encryptedOtpBundle,
        expirationSeconds: String(expirationSeconds),
      }),
    account: (verificationToken) =>
      post("/v1/account", {
        filterType: "EMAIL",
        filterValue: options.email,
        verificationToken,
      }),
    loginV2: (body) => post("/v1/otp_login_v2", body),
    readOtp: readHiddenOtp,
    ttyReady: () =>
      process.stdin.isTTY && typeof process.stdin.setRawMode === "function",
    keys: async () => keyPair(),
    encrypt: async (bundle, otp, publicKey) => {
      const envelope = record(JSON.parse(bundle));
      const target = record(
        JSON.parse(
          Buffer.from(
            requiredString(envelope.data, "INVALID_BUNDLE"),
            "hex",
          ).toString("utf8"),
        ),
      );
      const encrypted = crypto.hpkeEncrypt({
        plainTextBuf: new TextEncoder().encode(
          JSON.stringify({ otp_code: otp, public_key: publicKey }),
        ),
        targetKeyBuf: new Uint8Array(
          Buffer.from(
            requiredString(target.targetPublic, "INVALID_BUNDLE_KEY").replace(
              /^0x/,
              "",
            ),
            "hex",
          ),
        ),
        hpkeInfo: "0xkey_hpke",
      });
      return crypto.formatHpkeBuf(encrypted);
    },
    loginAttested: async (verificationToken, key, organizationId) => {
      // The public loginWithOtp path constructs and uses its own AttestedStamper.
      const signer = {
        listKeyPairs: async () => [key.publicKey],
        sign: async (message: string, format: string) =>
          key.sign(message, format === "raw"),
      };
      const stored: string[] = [];
      const storage = {
        storeSession: async (value: string) => {
          stored.push(value);
        },
        getActiveSession: async () => undefined,
        listSessionKeys: async () => [],
        getSession: async () => undefined,
      };
      const client = new core.ZeroXKeyClient(
        {
          apiBaseUrl: options.apiUrl,
          authProxyUrl: options.authProxyUrl,
          authProxyConfigId: options.configId,
          organizationId,
        },
        signer,
      );
      Object.assign(client, { storageManager: storage });
      const httpClient = client.createHttpClient();
      Object.assign(client, { httpClient });
      let seen: HttpResult | undefined;
      const originalFetch = globalThis.fetch;
      // Observe only status/trace around the real SDK request; preserve its transport.
      globalThis.fetch = async (url, init) => {
        const response = await originalFetch(url, init);
        if (String(url) === `${options.apiUrl}/public/v1/submit/stamp_login`)
          seen = {
            status: response.status,
            data: {},
            traceId: safeTrace(response.headers),
          };
        return response;
      };
      try {
        const result = await client.loginWithOtp({
          verificationToken,
          organizationId,
          expirationSeconds: String(SESSION_TTL),
        });
        return {
          status: seen?.status ?? 0,
          traceId: seen?.traceId,
          data: { session: result.sessionToken },
        };
      } finally {
        globalThis.fetch = originalFetch;
        stored.length = 0;
      }
    },
    // No user-provided reason switch: integration requires an authenticated,
    // correlated internal Activity/trace evidence provider to replace this seam.
    expiryEvidence: async () => undefined,
  };
}

async function main() {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.live) {
      await frozenBuild(options.sdkSha256);
      // No authenticated Activity/trace reason lookup exists in this checkout.
      // Stop before OTP init until the bounded evidence adapter is supplied.
      throw Error("EXPIRY_EVIDENCE_UNAVAILABLE");
    }
    const deps = options.live
      ? await makeLiveDeps(options)
      : ({
          now: Date.now,
          emit: (value: object) =>
            process.stdout.write(`${JSON.stringify(value)}\n`),
        } as unknown as AcceptanceDeps);
    await runAcceptance(options, deps);
  } catch (error) {
    // No exception text: SDK/HTTP errors may contain credentials or response bodies.
    const allowed = new Set([
      "INVALID_ARGUMENT",
      "INVALID_STAGING_ENDPOINT",
      "UNAPPROVED_IDENTITY",
      "LIVE_REQUIRES_SEND_OTP",
      "CONFLICTING_MODES",
      "INVALID_BUILD_DIGEST",
      "SDK_BUILD_DIGEST_REQUIRED",
      "SDK_BUILD_DIGEST_MISMATCH",
      "SDK_BUILD_MISSING",
      "EXPIRY_EVIDENCE_UNAVAILABLE",
      "CONTROL_A_FAILED",
      "CONTROL_B_INCONCLUSIVE_OR_FAILED",
      "CONTROL_C_FAILED",
      "CONFIG_HEALTH_FAILED",
      "UNSUPPORTED_OTP_FORMAT",
      "INVALID_SESSION_TTL",
      "INIT_FAILED",
      "INIT_MISSING_CHALLENGE",
      "INIT_MISSING_BUNDLE",
      "VERIFY_FAILED",
      "VERIFY_MISSING_TOKEN",
      "VERIFY_CLAIMS_INVALID",
      "ACCOUNT_FAILED",
      "ACCOUNT_MISSING_ORG",
      "CHALLENGE_REUSED",
      "PRIVATE_TTY_REQUIRED",
      "OTP_INPUT_CANCELED",
      "INVALID_OTP_INPUT",
    ]);
    const code =
      error instanceof Error && allowed.has(error.message)
        ? error.message
        : "ACCEPTANCE_FAILED";
    process.stderr.write(
      `${JSON.stringify({ at: new Date().toISOString(), phase: "failed", code })}\n`,
    );
    process.exitCode = 1;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
