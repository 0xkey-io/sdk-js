import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { createRoot } from "react-dom/client";
import { getClientParams, OtpType, ZeroXKeyClient } from "@0xkey-io/core";
import { useZeroXKey } from "../../providers/client/Hook";
import { ZeroXKeyProvider } from "../../providers/ZeroXKeyProvider";
import { ClientState } from "../../types/base";
import { createCaptchaAttemptGate } from "../../utils/captcha-attempt-gate";
import { createTurnstileChallengeRenderer } from "../../utils/captcha-turnstile-renderer";

const CONTACT = "browser-otp@example.test";
const SIGNUP_BODY = {
  apiKeys: [],
  authenticators: [],
  oauthProviders: [],
};

const STEPS = ["otp-init-v2", "otp-init", "signup", "signup-v2"] as const;

const CLASS_KEY: Record<(typeof STEPS)[number], string> = {
  "otp-init-v2": "classOtpInitV2",
  "otp-init": "classOtpInit",
  signup: "classSignup",
  "signup-v2": "classSignupV2",
};

const pageUrl = new URL(window.location.href);

function remember(name: string, value: string): void {
  document.documentElement.dataset[name] = value;
}

function readProxy(): string | null {
  const raw = pageUrl.searchParams.get("proxy");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      raw !== url.origin
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function collectMessages(error: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 6 && current && typeof current === "object" && !seen.has(current);
    depth += 1
  ) {
    seen.add(current);
    const record = current as { message?: unknown; cause?: unknown };
    if (typeof record.message === "string") messages.push(record.message);
    current = record.cause;
  }
  return messages;
}

function classify(error: unknown): string {
  const messages = collectMessages(error);
  const has = (fragment: string) =>
    messages.some((message) => message.includes(fragment));
  if (
    has("Client params unavailable") ||
    has("Invalid client params response") ||
    has("Invalid client params selection") ||
    has("Invalid Auth Proxy URL")
  ) {
    return "client-params-unavailable";
  }
  if (
    has("Turnstile script unavailable") ||
    has("Turnstile challenge unavailable") ||
    has("Turnstile requires a browser")
  ) {
    return "turnstile-unavailable";
  }
  if (has("Captcha") || has("Turnstile")) return "captcha-failed";
  if (has("Permission denied") || has("ZeroXKey error 7"))
    return "otp-rejected";
  if (
    has("ZeroXKey error") ||
    messages.some((message) => /^\d{3}\s/.test(message))
  ) {
    return "response-read";
  }
  return "unclassified";
}

function waitForAck(step: string): Promise<void> {
  return new Promise((resolve) => {
    const tick = () => {
      if (document.documentElement.dataset.ack === step) resolve();
      else window.setTimeout(tick, 20);
    };
    tick();
  });
}

const proxy = readProxy();

function Probe(): JSX.Element {
  const wallet = useZeroXKey();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    remember("clientState", wallet.clientState ?? "");
  }, [wallet.clientState]);

  useEffect(() => {
    if (!proxy) return;
    if (wallet.clientState !== ClientState.Ready) return;
    if (document.documentElement.dataset.started === "1") return;
    const host = hostRef.current;
    if (!host) return;
    remember("started", "1");

    const core = new ZeroXKeyClient({
      organizationId: "org-oauth",
      apiBaseUrl: "https://api.example.test",
      authProxyUrl: proxy,
      authProxyConfigId: "configA",
    });
    const renderer = createTurnstileChallengeRenderer(host);
    const gate = createCaptchaAttemptGate({
      getClientParams,
      challenge: (siteKey, signal) => renderer.challenge(siteKey, signal),
    });
    gate.setTarget({ authProxyConfigId: "configA", authProxyUrl: proxy });

    // OTP init v2 is the public Provider method. OTP init v1 has no Provider
    // method. Public OTP signup returns before signup v2 unless a local
    // verification key already exists, so those three calls use this gate and
    // the generated proxy methods after the gate decides.
    void (async () => {
      try {
        await core.init();
      } catch {
        remember("boot", "unclassified");
        remember("done", "1");
        return;
      }
      const http = core.createHttpClient();
      const actions: Record<(typeof STEPS)[number], () => Promise<unknown>> = {
        "otp-init-v2": () =>
          wallet.initOtp({ otpType: OtpType.Email, contact: CONTACT }),
        "otp-init": () =>
          gate.run((captchaToken) =>
            http.proxyInitOtp(
              { otpType: OtpType.Email, contact: CONTACT },
              captchaToken,
            ),
          ),
        signup: () =>
          gate.run((captchaToken) =>
            http.proxySignup(SIGNUP_BODY, captchaToken),
          ),
        "signup-v2": () =>
          gate.run((captchaToken) =>
            http.proxySignupV2(SIGNUP_BODY, captchaToken),
          ),
      };
      for (const step of STEPS) {
        remember("step", step);
        let outcome = "accepted";
        try {
          await actions[step]();
        } catch (error: unknown) {
          outcome = classify(error);
        }
        remember(CLASS_KEY[step], outcome);
        remember("settle", step);
        await waitForAck(step);
      }
      remember("done", "1");
    })();
  }, [wallet, wallet.clientState]);

  return <div ref={hostRef} />;
}

const root = document.getElementById("root");
if (!root || !proxy) {
  remember("boot", "unclassified");
  remember("done", "1");
} else {
  createRoot(root).render(
    <ZeroXKeyProvider
      config={{
        organizationId: "org-oauth",
        apiBaseUrl: "https://api.example.test",
        authProxyUrl: proxy,
        authProxyConfigId: "configA",
        autoFetchWalletKitConfig: false,
        autoRefreshManagedState: false,
        auth: {
          methods: { walletAuthEnabled: false },
          autoRefreshSession: false,
          oauthConfig: {
            discordClientId: "discord-A",
            xClientId: "x-A",
            facebookClientId: "facebook-A",
            googleClientId: "google-A",
            appleClientId: "apple-A",
            oauthRedirectUri: `${window.location.origin}/return`,
          },
        },
        walletConfig: {
          features: { auth: false, connecting: false },
          chains: {
            ethereum: { native: false },
            solana: { native: false },
          },
        },
      }}
    >
      <Probe />
    </ZeroXKeyProvider>,
  );
}

window.addEventListener("error", () => {
  if (!document.documentElement.dataset.done) remember("done", "1");
});
window.addEventListener("unhandledrejection", () => {
  if (!document.documentElement.dataset.done) remember("done", "1");
});
