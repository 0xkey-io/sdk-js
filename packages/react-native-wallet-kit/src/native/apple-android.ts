import { NATIVE_OAUTH_CANCELLED } from "../utils/oauth-native-flow";
import {
  nativeOAuthError,
  type NativeBinding,
} from "../utils/oauth-native-store";
import {
  checkedBinding,
  checkedEntropy,
  checkedNonce,
  type NativeEntropy,
  type PrivateNativeAdapter,
} from "./contract";
import { createAppleAndroidCallbackGate } from "./apple-android-callback";

/** The host bridge must substantiate nonce hashing and callback observation. */
export type AppleAndroidNativeBridge = Readonly<{
  nonceTransform: "sha256-raw-input";
  requestIdentity(
    request: {
      serviceId: string;
      returnUrl: string;
      nonceSource: string;
      state: string;
    },
    callback: ReturnType<typeof createAppleAndroidCallbackGate>,
  ): Promise<{ type: "cancel" } | { type: "success" }>;
}>;

export function createAppleAndroidNativeAdapter(input: {
  binding: NativeBinding;
  randomBytes: NativeEntropy;
  allowedOrigins: readonly string[];
  bridge: AppleAndroidNativeBridge;
}): PrivateNativeAdapter {
  const binding = checkedBinding(input.binding, "apple", "android");
  const returnUrl = binding.redirectUri;
  if (
    !returnUrl ||
    typeof input.randomBytes !== "function" ||
    !input.bridge ||
    input.bridge.nonceTransform !== "sha256-raw-input" ||
    typeof input.bridge.requestIdentity !== "function"
  ) {
    throw nativeOAuthError("config-invalid");
  }
  // Freeze the callback policy before key allocation. The host bridge must
  // deliver actual WebView navigation and form POST events to this gate.
  createAppleAndroidCallbackGate({
    returnUrl,
    expectedState: "preflight",
    allowedOrigins: input.allowedOrigins,
  });
  const allowedOrigins = Object.freeze([...input.allowedOrigins]);
  const bridge = input.bridge;
  return Object.freeze({
    binding,
    async authenticate(attempt) {
      checkedNonce(attempt);
      const state = checkedEntropy(input.randomBytes, 16);
      const callback = createAppleAndroidCallbackGate({
        returnUrl,
        expectedState: state,
        allowedOrigins,
      });
      const response = await bridge.requestIdentity(
        {
          serviceId: binding.clientId,
          returnUrl,
          nonceSource: attempt.publicKey,
          state,
        },
        callback,
      );
      if (response?.type === "cancel") throw NATIVE_OAUTH_CANCELLED;
      if (response?.type !== "success")
        throw nativeOAuthError("result-invalid");
      return callback.result();
    },
  });
}
