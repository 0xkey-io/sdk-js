/**
 * Captcha for the demo's protected Auth Proxy calls: OTP send/resend and
 * signup. The challenge runs on a 0xkey-controlled page in a patched WebView
 * (see components/captcha). The opaque token goes straight into one SDK call;
 * it is never stored, put in a URL, or logged.
 */

/** The only challenge pages the SDK's WebView bridge accepts. */
export const CAPTCHA_ORIGINS = [
  "https://captcha.staging.0xkey.io",
  "https://captcha.0xkey.io",
] as const;

export type CaptchaOrigin = (typeof CAPTCHA_ORIGINS)[number];

export type CaptchaSettings = {
  origin: CaptchaOrigin | undefined;
  authProxyUrl: string;
  authProxyConfigId: string;
};

export type CaptchaEnv = {
  origin?: string | undefined;
  authProxyUrl?: string | undefined;
  authProxyConfigId?: string | undefined;
};

export type ClientParams = { turnstileSiteKey?: string };

// The Auth Proxy's missing-token rejection (same wire as Turnkey's).
const MISSING_TOKEN_MESSAGE =
  "X-Captcha-Token header is required when captcha is enabled";

export class CaptchaCancelledError extends Error {
  constructor() {
    super("Captcha challenge stopped");
    this.name = "CaptchaCancelledError";
  }
}

export class CaptchaUnavailableError extends Error {
  constructor(message = "Captcha settings unavailable") {
    super(message);
    this.name = "CaptchaUnavailableError";
  }
}

/**
 * Returns null without an Auth Proxy: then no protected route exists. The
 * origin may be unset while Captcha is off; an enabled config then fails
 * closed instead of sending an unprotected request.
 */
export function buildCaptchaSettings(env: CaptchaEnv): CaptchaSettings | null {
  const authProxyUrl = env.authProxyUrl?.trim();
  const authProxyConfigId = env.authProxyConfigId?.trim();
  if (!authProxyUrl || !authProxyConfigId) return null;
  const origin = env.origin?.trim() || undefined;
  if (origin !== undefined && !isCaptchaOrigin(origin)) {
    throw new Error(
      `EXPO_PUBLIC_CAPTCHA_ORIGIN must be one of ${CAPTCHA_ORIGINS.join(", ")}`,
    );
  }
  return { origin, authProxyUrl, authProxyConfigId };
}

function isCaptchaOrigin(value: string): value is CaptchaOrigin {
  return (CAPTCHA_ORIGINS as readonly string[]).includes(value);
}

/**
 * Reads the config's current client params for this attempt. Resolves
 * undefined when Captcha is off; otherwise resolves the token of one challenge.
 */
export async function captchaTokenFor(
  readClientParams: () => Promise<ClientParams>,
  challenge: (siteKey: string) => Promise<string>,
): Promise<string | undefined> {
  let params: ClientParams;
  try {
    params = await readClientParams();
  } catch {
    throw new CaptchaUnavailableError("Client params unavailable");
  }
  return params.turnstileSiteKey
    ? challenge(params.turnstileSiteKey)
    : undefined;
}

export function isCaptchaRequiredError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const { status, body, cause } = current as {
      status?: unknown;
      body?: { message?: unknown } | null;
      cause?: unknown;
    };
    if (status === 400 && body?.message === MISSING_TOKEN_MESSAGE) return true;
    current = cause;
  }
  return false;
}

/**
 * OAuth completion first runs without a token, so an existing account logs
 * in unchallenged. Only a signup the Auth Proxy refuses for a missing token is
 * challenged and submitted once more with that token.
 */
export async function completeOauthWithSignupCaptcha<T>(
  complete: (captchaToken?: string) => Promise<T>,
  requireCaptchaToken: () => Promise<string | undefined>,
): Promise<T> {
  try {
    return await complete();
  } catch (error) {
    if (!isCaptchaRequiredError(error)) throw error;
    const captchaToken = await requireCaptchaToken();
    if (captchaToken === undefined) throw error;
    return complete(captchaToken);
  }
}

export function withCaptchaToken<T extends object>(
  params: T,
  captchaToken: string | undefined,
): T & { captchaToken?: string } {
  return captchaToken === undefined ? params : { ...params, captchaToken };
}
