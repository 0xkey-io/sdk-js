import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

type ClientParams = Readonly<{ turnstileSiteKey?: string }>;

export type CaptchaTarget = Readonly<{
  authProxyConfigId: string;
  authProxyUrl?: string;
}>;

export type CaptchaChallenge = Readonly<{
  token: string;
  reset(): void;
}>;

type Attempt = {
  controller: AbortController;
  canceled: Promise<never>;
  rejectCancellation(error: Error): void;
};

const INTERACTION_TIMEOUT_MS = 120_000;
const TOKEN_VALIDITY_MS = 300_000;
const MAX_RECENT_TOKEN_DIGESTS = 512;

/**
 * Per-provider protected-activity gate. A caller supplies the widget renderer
 * and submits only after a fresh C3 capability read and a single challenge.
 * It is intentionally independent of wallet-kit method/UI config fetching.
 */
export function createCaptchaAttemptGate(dependencies: {
  getClientParams(
    authProxyConfigId: string,
    authProxyUrl?: string,
  ): Promise<ClientParams>;
  challenge(siteKey: string, signal: AbortSignal): Promise<CaptchaChallenge>;
}) {
  let target: CaptchaTarget | undefined;
  let active: Attempt | undefined;
  // Keep only digests for the provider token validity window, never tokens.
  const recentTokenDigests = new Map<string, number>();

  function cancel() {
    if (!active) return;
    const attempt = active;
    active = undefined;
    attempt.controller.abort();
    attempt.rejectCancellation(new Error("Captcha attempt canceled"));
  }

  function setTarget(next: CaptchaTarget | undefined) {
    if (
      target?.authProxyConfigId === next?.authProxyConfigId &&
      target?.authProxyUrl === next?.authProxyUrl
    ) {
      return;
    }
    cancel();
    target = next;
  }

  async function run<T>(
    submit: (captchaToken?: string) => Promise<T>,
  ): Promise<T> {
    if (active) throw new Error("Captcha attempt already in progress");

    let rejectCancellation!: (error: Error) => void;
    const canceled = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    // An already-started submission does not await this signal.
    // Keep a rejection observer attached even when no race is currently active.
    void canceled.catch(() => undefined);
    const attempt: Attempt = {
      controller: new AbortController(),
      canceled,
      rejectCancellation,
    };
    active = attempt;
    let challengeResult: CaptchaChallenge | undefined;
    let challengeReset = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const submitCurrent = async (token?: string): Promise<T> => {
      if (active !== attempt) throw new Error("Captcha attempt canceled");
      const result = await submit(token);
      if (active !== attempt) throw new Error("Captcha attempt canceled");
      return result;
    };
    try {
      const selected = target;
      if (!selected?.authProxyConfigId) {
        throw new Error("Captcha target is required");
      }

      const expired = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          attempt.controller.abort();
          reject(new Error("Captcha attempt timed out"));
        }, INTERACTION_TIMEOUT_MS);
      });

      const params = await Promise.race([
        dependencies.getClientParams(
          selected.authProxyConfigId,
          selected.authProxyUrl,
        ),
        canceled,
        expired,
      ]);
      if (active !== attempt) throw new Error("Captcha attempt canceled");

      if (params.turnstileSiteKey === undefined) {
        clearTimeout(timeout);
        timeout = undefined;
        return await submitCurrent();
      }
      const siteKey = params.turnstileSiteKey;
      if (typeof siteKey !== "string" || !siteKey.trim()) {
        throw new Error("Invalid Captcha capability");
      }

      const challenge = dependencies
        .challenge(siteKey, attempt.controller.signal)
        .then((result) => {
          if (attempt.controller.signal.aborted) {
            try {
              result.reset();
            } catch {
              // A late widget cleanup must not submit or expose its token.
            }
          }
          return result;
        });
      challengeResult = await Promise.race([challenge, canceled, expired]);
      if (active !== attempt || attempt.controller.signal.aborted) {
        throw new Error("Captcha attempt canceled");
      }
      if (
        typeof challengeResult.token !== "string" ||
        !challengeResult.token.trim()
      ) {
        throw new Error("Captcha challenge returned no token");
      }
      // The token exists only in this call frame and is never cached or retried.
      const token = challengeResult.token;
      const now = Date.now();
      for (const [digest, usedAt] of recentTokenDigests) {
        if (now - usedAt >= TOKEN_VALIDITY_MS)
          recentTokenDigests.delete(digest);
      }
      const digest = bytesToHex(sha256(utf8ToBytes(token)));
      if (recentTokenDigests.has(digest)) {
        throw new Error("Captcha token was already used");
      }
      if (recentTokenDigests.size >= MAX_RECENT_TOKEN_DIGESTS) {
        throw new Error("Captcha token history is full");
      }
      recentTokenDigests.set(digest, now);
      challengeResult.reset();
      challengeReset = true;
      clearTimeout(timeout);
      timeout = undefined;
      return await submitCurrent(token);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      if (challengeResult && !challengeReset) {
        try {
          challengeResult.reset();
        } catch {
          // Preserve the request outcome while clearing widget state best effort.
        }
      }
      if (active === attempt) active = undefined;
    }
  }

  return { setTarget, run, cancel };
}
