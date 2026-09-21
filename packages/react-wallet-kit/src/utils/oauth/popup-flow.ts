import type { OAuthProviders } from "@0xkey-io/sdk-types";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { OAUTH_PROVIDER_CONFIGS } from "./config";
import {
  OAuthPopupBindingError,
  type OAuthPopupBinding,
} from "./popup-binding";
import { inspectOAuthPopupResponse } from "./popup-response";
import { buildOAuthUrl } from "./url";

const POPUP_POLL_INTERVAL_MS = 500;
const POPUP_DEADLINE_MS = 300_000;
const TRANSACTION_ID_BYTES = 16;
const RESERVED_ADDITIONAL_STATE = new Set([
  "transactionId",
  "provider",
  "flow",
  "publicKey",
  "nonce",
  "state",
  "code",
  "id_token",
  "error",
  "error_description",
  "error_uri",
]);

export type OAuthPopupInput = {
  binding: OAuthPopupBinding;
  provider: OAuthProviders;
  clientId: string;
  redirectUri: string;
  additionalState?: Readonly<Record<string, string>> | undefined;
  exchange?:
    | ((input: {
        authCode: string;
        codeVerifier: string;
        publicKey: string;
        nonce: string;
      }) => Promise<string>)
    | undefined;
  complete(input: {
    provider: OAuthProviders;
    publicKey: string;
    oidcToken: string;
    sessionKey?: string;
  }): Promise<void>;
};

export type OAuthPopupDependencies = {
  createApiKeyPair(): Promise<string>;
  discardUncommittedApiKeyPair(publicKey: string): Promise<void>;
  generatePkce(): Promise<{ verifier: string; codeChallenge: string }>;
  randomBytes(length: number): Uint8Array;
  now(): number;
  openPopup(): Window | null;
};

export async function runOAuthPopup(
  input: OAuthPopupInput,
  dependencies: OAuthPopupDependencies,
): Promise<void> {
  const binding = input.binding;
  const provider = input.provider;
  const clientId = input.clientId;
  const redirectUri = input.redirectUri;
  const additionalState = input.additionalState
    ? Object.fromEntries(Object.entries(input.additionalState))
    : undefined;
  const exchange = input.exchange;
  const complete = input.complete;
  const {
    createApiKeyPair,
    discardUncommittedApiKeyPair,
    generatePkce,
    randomBytes,
    now,
    openPopup,
  } = dependencies;
  const openerOrigin = window.location.origin;

  const assertCurrent = () => {
    try {
      binding.assertCurrent();
    } catch (error) {
      if (error instanceof OAuthPopupBindingError) throw error;
      throw new OAuthPopupBindingError("context-unavailable");
    }
  };

  assertCurrent();
  if (!clientId || !redirectUri) {
    throw new Error("OAuth popup configuration is incomplete.");
  }
  for (const [key, value] of Object.entries(additionalState ?? {})) {
    if (typeof value !== "string" || RESERVED_ADDITIONAL_STATE.has(key)) {
      throw new Error("OAuth popup additional state is invalid.");
    }
  }

  const providerConfig = OAUTH_PROVIDER_CONFIGS[provider];
  if (providerConfig.usesPKCE && !exchange) {
    throw new Error("OAuth popup exchange is required for this provider.");
  }

  const transactionBytes = randomBytes(TRANSACTION_ID_BYTES);
  if (
    !(transactionBytes instanceof Uint8Array) ||
    transactionBytes.length < 16
  ) {
    throw new Error("OAuth popup transaction randomness is invalid.");
  }
  const transactionId = Array.from(transactionBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  let verifier: string | undefined;
  let codeChallenge: string | undefined;
  if (providerConfig.usesPKCE) {
    const preparedPkce = await generatePkce();
    if (!preparedPkce.verifier || !preparedPkce.codeChallenge) {
      throw new Error("OAuth popup PKCE preparation failed.");
    }
    verifier = preparedPkce.verifier;
    codeChallenge = preparedPkce.codeChallenge;
    assertCurrent();
  }

  const publicKey = await createApiKeyPair();
  if (!publicKey) {
    throw new Error("Failed to create public key for OAuth.");
  }

  let popup: Window | null = null;
  const disposePreservingFailure = async (
    error: unknown,
    stage: string,
  ): Promise<never> => {
    try {
      await discardUncommittedApiKeyPair(publicKey);
    } catch {
      console.warn("OAuth popup cleanup failed", {
        error: "discard-failed",
        stage,
      });
    }
    throw error;
  };

  try {
    assertCurrent();
  } catch (error) {
    return disposePreservingFailure(error, "context");
  }

  let nonce: string;
  let expectedState: string;
  let authorizationUrl: string;
  let expiresAt: number;
  try {
    nonce = bytesToHex(sha256(publicKey));
    authorizationUrl = buildOAuthUrl({
      provider,
      clientId,
      redirectUri,
      publicKey,
      nonce,
      flow: "popup",
      transactionId,
      ...(codeChallenge ? { codeChallenge } : {}),
      ...(additionalState ? { additionalState } : {}),
    });
    codeChallenge = undefined;
    expectedState = new URL(authorizationUrl).searchParams.get("state") ?? "";
    if (!expectedState) throw new Error("OAuth popup state was not created.");
    expiresAt = now() + POPUP_DEADLINE_MS;
  } catch (error) {
    codeChallenge = undefined;
    verifier = undefined;
    return disposePreservingFailure(error, "build");
  }

  try {
    popup = openPopup();
    if (!popup) throw new Error("Failed to open OAuth login window.");
    popup.location.href = authorizationUrl;
  } catch (error) {
    verifier = undefined;
    try {
      popup?.close();
    } catch {
      // The exact key cleanup below remains authoritative.
    }
    return disposePreservingFailure(error, "launch");
  }

  return new Promise<void>((resolve, reject) => {
    type Phase = "waiting" | "processing" | "handedOff" | "settled";
    let phase: Phase = "waiting";
    let interval: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    const stopBrowserStage = () => {
      if (interval !== undefined) clearInterval(interval);
      if (deadline !== undefined) clearTimeout(deadline);
      interval = undefined;
      deadline = undefined;
      try {
        popup?.close();
      } catch {
        // Closing is best effort; key ownership is handled independently.
      }
    };

    const rejectBeforeHandoff = async (error: unknown, stage: string) => {
      if (phase !== "waiting" && phase !== "processing") return;
      phase = "settled";
      stopBrowserStage();
      verifier = undefined;
      expectedState = "";
      try {
        await discardUncommittedApiKeyPair(publicKey);
      } catch {
        console.warn("OAuth popup cleanup failed", {
          error: "discard-failed",
          stage,
        });
      }
      reject(error);
    };

    const processAccepted = async (
      response: Extract<
        ReturnType<typeof inspectOAuthPopupResponse>,
        { kind: "accepted" }
      >,
    ) => {
      if (phase !== "waiting") return;
      phase = "processing";
      stopBrowserStage();
      expectedState = "";
      try {
        assertCurrent();
        const oidcToken = providerConfig.usesPKCE
          ? await (async () => {
              const exchangeVerifier = verifier!;
              verifier = undefined;
              const exchangePromise = exchange!({
                authCode: response.authCode!,
                codeVerifier: exchangeVerifier,
                publicKey,
                nonce,
              });
              return exchangePromise;
            })()
          : response.oidcToken!;
        if (!oidcToken)
          throw new Error("OAuth popup exchange returned no token.");

        assertCurrent();
        phase = "handedOff";
        await complete({
          provider,
          publicKey,
          oidcToken,
          ...(additionalState?.sessionKey
            ? { sessionKey: additionalState.sessionKey }
            : {}),
        });
        phase = "settled";
        resolve();
      } catch (error) {
        if (phase === "processing") {
          await rejectBeforeHandoff(error, "exchange");
          return;
        }
        phase = "settled";
        reject(error);
      }
    };

    const tick = () => {
      try {
        if (phase !== "waiting") return;
        if (now() >= expiresAt) {
          void rejectBeforeHandoff(
            new Error("OAuth popup authentication timed out."),
            "expiry",
          );
          return;
        }
        if (popup!.closed) {
          void rejectBeforeHandoff(
            new Error("Authentication window was closed."),
            "closed",
          );
          return;
        }

        let url: string;
        try {
          url = popup!.location.href || "";
        } catch {
          return;
        }

        const response = inspectOAuthPopupResponse({
          url,
          expectedProvider: provider,
          expectedState,
          openerOrigin,
          expectedRoute: binding.route,
        });
        if (response.kind === "pending") return;
        if (response.kind === "rejected") {
          void rejectBeforeHandoff(
            response.reason === "callback-route-mismatch"
              ? new OAuthPopupBindingError("callback-route-mismatch")
              : new Error("OAuth popup response was rejected."),
            "response",
          );
          return;
        }
        void processAccepted(response);
      } catch (error) {
        void rejectBeforeHandoff(
          error instanceof OAuthPopupBindingError
            ? error
            : new OAuthPopupBindingError("context-unavailable"),
          "response",
        );
      }
    };

    try {
      interval = setInterval(tick, POPUP_POLL_INTERVAL_MS);
      deadline = setTimeout(() => {
        if (phase !== "waiting") return;
        void rejectBeforeHandoff(
          new Error("OAuth popup authentication timed out."),
          "expiry",
        );
      }, POPUP_DEADLINE_MS);
      tick();
    } catch (error) {
      void rejectBeforeHandoff(error, "launch");
    }
  });
}
