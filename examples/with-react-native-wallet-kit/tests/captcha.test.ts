import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CaptchaCancelledError,
  CaptchaUnavailableError,
  buildCaptchaSettings,
  captchaTokenFor,
  completeOauthWithSignupCaptcha,
  isCaptchaRequiredError,
  withCaptchaToken,
} from "../constants/captcha.ts";

const CONFIG_ID = "00000000-0000-4000-8000-000000000001";
const MISSING = "X-Captcha-Token header is required when captcha is enabled";

// Shape of the SDK error chain: ZeroXKeyError -> ZeroXKeyRequestError(body).
function proxyRejection(status: number, code: number, message: string) {
  const request = Object.assign(
    new Error(`ZeroXKey error ${code}: ${message}`),
    {
      status,
      code,
      body: { code, message },
    },
  );
  return Object.assign(new Error("Failed to complete OAuth process"), {
    cause: Object.assign(new Error("Failed to sign up with OAuth"), {
      cause: request,
    }),
  });
}

test("Captcha settings need an Auth Proxy and accept only the controlled pages", () => {
  const base = {
    authProxyUrl: "https://authproxy.staging.0xkey.io",
    authProxyConfigId: CONFIG_ID,
  };
  assert.equal(
    buildCaptchaSettings({ origin: "https://captcha.staging.0xkey.io" }),
    null,
  );
  assert.deepEqual(
    buildCaptchaSettings({
      ...base,
      origin: " https://captcha.staging.0xkey.io ",
    }),
    { ...base, origin: "https://captcha.staging.0xkey.io" },
  );
  assert.equal(
    buildCaptchaSettings({ ...base, origin: "https://captcha.0xkey.io" })
      ?.origin,
    "https://captcha.0xkey.io",
  );
  assert.equal(buildCaptchaSettings({ ...base })?.origin, undefined);
  for (const origin of [
    "https://captcha.staging.0xkey.io/",
    "https://evil.example",
    "http://captcha.staging.0xkey.io",
  ]) {
    assert.throws(
      () => buildCaptchaSettings({ ...base, origin }),
      (error: Error) =>
        error.message.includes("EXPO_PUBLIC_CAPTCHA_ORIGIN") &&
        !error.message.includes(origin),
    );
  }
});

test("Captcha off reads client params and never challenges", async () => {
  let challenges = 0;
  const token = await captchaTokenFor(
    async () => ({}),
    async () => {
      challenges += 1;
      return "never";
    },
  );
  assert.equal(token, undefined);
  assert.equal(challenges, 0);
});

test("Captcha on challenges with the current site key", async () => {
  const seen: string[] = [];
  const token = await captchaTokenFor(
    async () => ({ turnstileSiteKey: "PUBLIC_TEST_SITE_KEY" }),
    async (siteKey) => {
      seen.push(siteKey);
      return "opaque-token";
    },
  );
  assert.equal(token, "opaque-token");
  assert.deepEqual(seen, ["PUBLIC_TEST_SITE_KEY"]);
});

test("unreadable client params stop the attempt before any challenge", async () => {
  let challenges = 0;
  await assert.rejects(
    captchaTokenFor(
      async () => {
        throw new Error("Client params unavailable");
      },
      async () => {
        challenges += 1;
        return "never";
      },
    ),
    CaptchaUnavailableError,
  );
  assert.equal(challenges, 0);
});

test("recognizes only the missing-token rejection anywhere in the cause chain", () => {
  assert.equal(isCaptchaRequiredError(proxyRejection(400, 3, MISSING)), true);
  assert.equal(
    isCaptchaRequiredError(
      proxyRejection(403, 7, "captcha verification failed"),
    ),
    false,
  );
  assert.equal(
    isCaptchaRequiredError(proxyRejection(400, 3, "Invalid request")),
    false,
  );
  assert.equal(isCaptchaRequiredError(proxyRejection(503, 3, MISSING)), false);
  assert.equal(isCaptchaRequiredError(new Error(MISSING)), false);
  assert.equal(isCaptchaRequiredError(undefined), false);
  const loop: { cause?: unknown } = {};
  loop.cause = loop;
  assert.equal(isCaptchaRequiredError(loop), false);
});

test("an existing OAuth account logs in without a challenge", async () => {
  const calls: (string | undefined)[] = [];
  let challenges = 0;
  const result = await completeOauthWithSignupCaptcha(
    async (captchaToken) => {
      calls.push(captchaToken);
      return "login";
    },
    async () => {
      challenges += 1;
      return "never";
    },
  );
  assert.equal(result, "login");
  assert.deepEqual(calls, [undefined]);
  assert.equal(challenges, 0);
});

test("a new OAuth account is challenged once, then signs up with the token", async () => {
  const calls: (string | undefined)[] = [];
  const result = await completeOauthWithSignupCaptcha(
    async (captchaToken) => {
      calls.push(captchaToken);
      if (captchaToken === undefined) throw proxyRejection(400, 3, MISSING);
      return "signup";
    },
    async () => "opaque-token",
  );
  assert.equal(result, "signup");
  assert.deepEqual(calls, [undefined, "opaque-token"]);
});

test("a cancelled challenge ends the OAuth attempt without a second submission", async () => {
  const calls: (string | undefined)[] = [];
  await assert.rejects(
    completeOauthWithSignupCaptcha(
      async (captchaToken) => {
        calls.push(captchaToken);
        throw proxyRejection(400, 3, MISSING);
      },
      async () => {
        throw new CaptchaCancelledError();
      },
    ),
    CaptchaCancelledError,
  );
  assert.deepEqual(calls, [undefined]);
});

test("other OAuth failures and a Captcha-off race are not retried", async () => {
  const failure = proxyRejection(403, 7, "captcha verification failed");
  let challenges = 0;
  await assert.rejects(
    completeOauthWithSignupCaptcha(
      async () => {
        throw failure;
      },
      async () => {
        challenges += 1;
        return "never";
      },
    ),
    (error) => error === failure,
  );
  assert.equal(challenges, 0);

  const missing = proxyRejection(400, 3, MISSING);
  const calls: (string | undefined)[] = [];
  await assert.rejects(
    completeOauthWithSignupCaptcha(
      async (captchaToken) => {
        calls.push(captchaToken);
        throw missing;
      },
      async () => undefined,
    ),
    (error) => error === missing,
  );
  assert.deepEqual(calls, [undefined]);
});

test("adds captchaToken only when a challenge produced one", () => {
  const params = { otpType: "OTP_TYPE_EMAIL" };
  assert.equal(withCaptchaToken(params, undefined), params);
  assert.equal("captchaToken" in withCaptchaToken(params, undefined), false);
  assert.deepEqual(withCaptchaToken(params, "opaque-token"), {
    otpType: "OTP_TYPE_EMAIL",
    captchaToken: "opaque-token",
  });
});
