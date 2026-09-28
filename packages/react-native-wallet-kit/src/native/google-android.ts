import { NATIVE_OAUTH_CANCELLED } from "../utils/oauth-native-flow";
import {
  nativeOAuthError,
  type NativeBinding,
} from "../utils/oauth-native-store";
import {
  checkedBinding,
  checkedNonce,
  checkedToken,
  type PrivateNativeAdapter,
} from "./contract";

/** A host-owned Credential Manager bridge with a required nonce parameter. */
export type GoogleAndroidNativeBridge = Readonly<{
  requestIdToken(request: {
    serverClientId: string;
    nonce: string;
  }): Promise<{ type: "cancel" } | { type: "success"; oidcToken: string }>;
}>;

export function createGoogleAndroidNativeAdapter(input: {
  binding: NativeBinding;
  bridge: GoogleAndroidNativeBridge;
}): PrivateNativeAdapter {
  const binding = checkedBinding(input.binding, "google", "android");
  if (!input.bridge || typeof input.bridge.requestIdToken !== "function")
    throw nativeOAuthError("config-invalid");
  const bridge = input.bridge;
  return Object.freeze({
    binding,
    async authenticate(attempt) {
      const nonce = checkedNonce(attempt);
      const response = await bridge.requestIdToken({
        serverClientId: binding.clientId,
        nonce,
      });
      if (response?.type === "cancel") throw NATIVE_OAUTH_CANCELLED;
      if (response?.type !== "success")
        throw nativeOAuthError("result-invalid");
      return checkedToken(response.oidcToken);
    },
  });
}
