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

/** The host bridge must substantiate this transform against its pinned native SDK. */
export type AppleIosNativeBridge = Readonly<{
  nonceTransform: "sha256-raw-input";
  requestIdentity(request: {
    bundleId: string;
    nonceSource: string;
    state: string;
  }): Promise<
    { type: "cancel" } | { type: "success"; state: string; oidcToken: string }
  >;
}>;

export function createAppleIosNativeAdapter(input: {
  binding: NativeBinding;
  randomBytes: NativeEntropy;
  bridge: AppleIosNativeBridge;
}): PrivateNativeAdapter {
  const binding = checkedBinding(input.binding, "apple", "ios");
  if (
    typeof input.randomBytes !== "function" ||
    !input.bridge ||
    input.bridge.nonceTransform !== "sha256-raw-input" ||
    typeof input.bridge.requestIdentity !== "function"
  ) {
    throw nativeOAuthError("config-invalid");
  }
  const bridge = input.bridge;
  return Object.freeze({
    binding,
    async authenticate(attempt) {
      checkedNonce(attempt);
      const state = checkedEntropy(input.randomBytes, 16);
      const response = await bridge.requestIdentity({
        bundleId: binding.clientId,
        nonceSource: attempt.publicKey,
        state,
      });
      if (response?.type === "cancel") throw NATIVE_OAUTH_CANCELLED;
      if (response?.type !== "success")
        throw nativeOAuthError("result-invalid");
      checkedState(response.state, state);
      return checkedToken(response.oidcToken);
    },
  });
}
