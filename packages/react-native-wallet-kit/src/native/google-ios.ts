import { sha256 } from "@noble/hashes/sha2";
import { stringToBase64urlString } from "@0xkey-io/encoding";
import { NATIVE_OAUTH_CANCELLED } from "../utils/oauth-native-flow";
import {
  nativeOAuthError,
  type NativeBinding,
} from "../utils/oauth-native-store";
import {
  checkedBinding,
  checkedEntropy,
  checkedNonce,
  checkedState,
  checkedToken,
  type NativeEntropy,
  type PrivateNativeAdapter,
} from "./contract";

type AuthorizationRequest = Readonly<{
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  nonce: string;
}>;

type CodeExchangeRequest = Readonly<{
  clientId: string;
  redirectUri: string;
  code: string;
  verifier: string;
}>;

/** A host-owned system session and code exchange; no native package is loaded here. */
export type GoogleIosNativeBridge = Readonly<{
  openAuthorization(
    request: AuthorizationRequest,
  ): Promise<{ type: "cancel" } | { type: "callback"; url: string }>;
  exchangeCode(request: CodeExchangeRequest): Promise<{ oidcToken: string }>;
}>;

function callbackCode(
  urlValue: unknown,
  redirectUri: string,
  state: string,
): string {
  if (typeof urlValue !== "string") throw nativeOAuthError("result-invalid");
  let callback: URL;
  try {
    callback = new URL(urlValue);
  } catch {
    throw nativeOAuthError("result-invalid");
  }
  const exactBase = callback.href.slice(
    0,
    callback.href.length - callback.search.length - callback.hash.length,
  );
  const states = callback.searchParams.getAll("state");
  const codes = callback.searchParams.getAll("code");
  if (
    exactBase !== redirectUri ||
    callback.hash ||
    callback.searchParams.has("error") ||
    states.length !== 1 ||
    codes.length !== 1 ||
    !codes[0]
  ) {
    throw nativeOAuthError("result-invalid");
  }
  checkedState(states[0], state);
  return codes[0];
}

export function createGoogleIosNativeAdapter(input: {
  binding: NativeBinding;
  randomBytes: NativeEntropy;
  bridge: GoogleIosNativeBridge;
}): PrivateNativeAdapter {
  const binding = checkedBinding(input.binding, "google", "ios");
  const redirectUri = binding.redirectUri;
  if (
    !redirectUri ||
    typeof input.randomBytes !== "function" ||
    !input.bridge ||
    typeof input.bridge.openAuthorization !== "function" ||
    typeof input.bridge.exchangeCode !== "function"
  ) {
    throw nativeOAuthError("config-invalid");
  }
  const bridge = input.bridge;
  return Object.freeze({
    binding,
    async authenticate(attempt) {
      const nonce = checkedNonce(attempt);
      const state = checkedEntropy(input.randomBytes, 16);
      const verifier = checkedEntropy(input.randomBytes, 32);
      const digest = sha256(verifier);
      const codeChallenge = stringToBase64urlString(
        String.fromCharCode(...digest),
      );
      const response = await bridge.openAuthorization({
        clientId: binding.clientId,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod: "S256",
        nonce,
      });
      if (response?.type === "cancel") throw NATIVE_OAUTH_CANCELLED;
      if (response?.type !== "callback")
        throw nativeOAuthError("result-invalid");
      const code = callbackCode(response.url, redirectUri, state);
      const exchanged = await bridge.exchangeCode({
        clientId: binding.clientId,
        redirectUri,
        code,
        verifier,
      });
      return checkedToken(exchanged?.oidcToken);
    },
  });
}
