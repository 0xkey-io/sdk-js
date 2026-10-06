import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useZeroXKey } from "../../providers/client/Hook";
import type { ClientContextType } from "../../providers/client/Types";
import { ZeroXKeyProvider } from "../../providers/ZeroXKeyProvider";
import { ClientState, type ZeroXKeyCallbacks } from "../../types/base";

const openedPopups: Window[] = [];
(window as Window & { __oauthPopupProbe?: Window[] }).__oauthPopupProbe =
  openedPopups;
const nativeOpen = window.open.bind(window);
window.open = ((...args: Parameters<typeof window.open>) => {
  const child = nativeOpen(...args);
  if (child) openedPopups.push(child);
  return child;
}) as typeof window.open;

const pageUrl = new URL(window.location.href);

if (pageUrl.searchParams.get("plantDecoy") === "1") {
  for (const provider of ["discord", "x", "facebook"]) {
    window.localStorage.setItem(`${provider}_verifier`, "decoy-verifier");
  }
}

const organizationId = pageUrl.searchParams.get("org") ?? "org-oauth";
const redirectUri = `${window.location.origin}/return`;
const expectedTokens: Record<string, string> = {
  discord: "synthetic-oidc-token",
  x: "synthetic-oidc-token",
  facebook: "synthetic-facebook-token",
  google: "synthetic-google-token",
  apple: "synthetic-apple-token",
};

function remember(name: string, value: string): void {
  document.documentElement.dataset[name] = value;
}

const callbacks: ZeroXKeyCallbacks = {
  onOauthRedirect(response) {
    const provider = new URL(window.location.href).searchParams.get("provider");
    const seen = Number(
      document.documentElement.dataset.oauthCompletions || "0",
    );
    remember("oauthCompletions", String(seen + 1));
    remember("oauthResult", "popup");
    remember(
      "idTokenMatches",
      provider && response.idToken === expectedTokens[provider] ? "1" : "0",
    );
    remember(
      "hasPublicKey",
      typeof response.publicKey === "string" &&
        /^[0-9a-f]{64,}$/i.test(response.publicKey)
        ? "1"
        : "0",
    );
  },
  onError(error) {
    remember("oauthError", error.message || "oauth-error");
  },
};

function startHandler(
  client: ClientContextType,
  provider: string,
): (() => Promise<void>) | undefined {
  const handlers: Record<string, () => Promise<void>> = {
    discord: () => client.handleDiscordOauth(),
    x: () => client.handleXOauth(),
    facebook: () => client.handleFacebookOauth(),
    google: () => client.handleGoogleOauth(),
    apple: () => client.handleAppleOauth(),
  };
  return handlers[provider];
}

function Probe(): null {
  const client = useZeroXKey();

  useEffect(() => {
    remember("clientState", client.clientState ?? "");
  }, [client.clientState]);

  useEffect(() => {
    if (window.location.pathname !== "/start") return;
    if (client.clientState !== ClientState.Ready) return;
    if (document.documentElement.dataset.started === "1") return;
    remember("started", "1");
    const currentUrl = new URL(window.location.href);
    // The redirect sweep clears PKCE slots when the opener URL has a query.
    // Plant again after that sweep so the popup call can be checked against the decoy.
    if (currentUrl.searchParams.get("plantDecoy") === "1") {
      for (const name of ["discord", "x", "facebook"]) {
        window.localStorage.setItem(`${name}_verifier`, "decoy-verifier");
      }
    }
    const provider = currentUrl.searchParams.get("provider");
    const start = provider ? startHandler(client, provider) : undefined;
    if (!start) {
      remember("startError", "unknown-provider");
      return;
    }
    start().catch((error: unknown) => {
      remember(
        "startError",
        error instanceof Error ? error.message : "start-failed",
      );
    });
  }, [client.clientState]);

  return null;
}

const root = document.getElementById("root");
if (!root) {
  remember("windowError", "missing-root");
} else {
  createRoot(root).render(
    <ZeroXKeyProvider
      config={{
        organizationId,
        apiBaseUrl: "https://api.example.test",
        authProxyUrl: "https://auth.example.test",
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
            oauthRedirectUri: redirectUri,
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
      callbacks={callbacks}
    >
      <Probe />
    </ZeroXKeyProvider>,
  );
}

window.addEventListener("error", (event) => {
  remember("windowError", event.message || "window-error");
});
window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  remember(
    "unhandled",
    reason instanceof Error ? reason.message : "unhandled-rejection",
  );
});
