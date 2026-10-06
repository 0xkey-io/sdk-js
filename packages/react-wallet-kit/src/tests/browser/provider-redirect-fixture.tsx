import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useZeroXKey } from "../../providers/client/Hook";
import type { ClientContextType } from "../../providers/client/Types";
import { ZeroXKeyProvider } from "../../providers/ZeroXKeyProvider";
import { ClientState, type ZeroXKeyCallbacks } from "../../types/base";

const pageUrl = new URL(window.location.href);

if (pageUrl.searchParams.get("plantDecoy") === "1") {
  for (const provider of ["discord", "x", "facebook"]) {
    window.localStorage.setItem(`${provider}_verifier`, "decoy-verifier");
  }
}

const organizationId = pageUrl.searchParams.get("org") ?? "org-oauth";
const redirectUri = `${window.location.origin}/return`;

function remember(name: string, value: string): void {
  document.documentElement.dataset[name] = value;
}

const callbacks: ZeroXKeyCallbacks = {
  onOauthRedirect(response) {
    remember("oauthResult", "redirect");
    remember("oauthIdToken", response.idToken);
    remember("oauthPublicKey", response.publicKey);
  },
  onError(error) {
    remember("oauthResult", "error");
    remember("oauthError", error.message || "oauth-error");
  },
};

function startHandler(
  client: ClientContextType,
  provider: string,
): ((params: { openInPage: true }) => Promise<void>) | undefined {
  const handlers: Record<
    string,
    (params: { openInPage: true }) => Promise<void>
  > = {
    discord: client.handleDiscordOauth,
    x: client.handleXOauth,
    facebook: client.handleFacebookOauth,
    google: client.handleGoogleOauth,
    apple: client.handleAppleOauth,
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
    const provider = new URL(window.location.href).searchParams.get("provider");
    const start = provider ? startHandler(client, provider) : undefined;
    if (!start) {
      remember("startError", "unknown-provider");
      return;
    }
    start({ openInPage: true }).catch((error: unknown) => {
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
