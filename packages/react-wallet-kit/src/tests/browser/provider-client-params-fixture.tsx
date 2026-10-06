import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { OtpType } from "@0xkey-io/core";
import { useZeroXKey } from "../../providers/client/Hook";
import { ZeroXKeyProvider } from "../../providers/ZeroXKeyProvider";
import { ClientState } from "../../types/base";

const CONTACT = "browser-otp@example.test";

const pageUrl = new URL(window.location.href);

function remember(name: "clientState" | "started" | "otpClass", value: string): void {
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
  if (has("Permission denied") || has("ZeroXKey error 7")) return "otp-rejected";
  return "unclassified";
}

const proxy = readProxy();

function Probe(): null {
  const client = useZeroXKey();

  useEffect(() => {
    remember("clientState", client.clientState ?? "");
  }, [client.clientState]);

  useEffect(() => {
    if (!proxy) return;
    if (client.clientState !== ClientState.Ready) return;
    if (document.documentElement.dataset.started === "1") return;
    remember("started", "1");
    void client
      .initOtp({ otpType: OtpType.Email, contact: CONTACT })
      .then(
        () => remember("otpClass", "otp-accepted"),
        (error: unknown) => remember("otpClass", classify(error)),
      );
  }, [client, client.clientState]);

  return null;
}

const root = document.getElementById("root");
if (!root || !proxy) {
  remember("otpClass", "unclassified");
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
  if (!document.documentElement.dataset.otpClass) remember("otpClass", "unclassified");
});
window.addEventListener("unhandledrejection", () => {
  if (!document.documentElement.dataset.otpClass) remember("otpClass", "unclassified");
});
