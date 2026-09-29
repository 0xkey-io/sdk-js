import type * as SdkTypes from "@0xkey-io/sdk-types";
import type { ZeroXKeySDKClientBase } from "../__generated__/sdk-client-base";

// Typecheck-only consumer fixture: the methods are not called at runtime.
const compileProtectedCalls = (client: ZeroXKeySDKClientBase) => {
  client.proxyInitOtp({} as SdkTypes.ProxyTInitOtpBody, "opaque-token");
  client.proxyInitOtpV2({} as SdkTypes.ProxyTInitOtpV2Body, "opaque-token");
  client.proxySignup({} as SdkTypes.ProxyTSignupBody, "opaque-token");
  client.proxySignupV2({} as SdkTypes.ProxyTSignupV2Body, "opaque-token");

  // @ts-expect-error Nonprotected methods do not accept a Captcha token.
  client.proxyOtpLogin({} as SdkTypes.ProxyTOtpLoginBody, "opaque-token");
};

void compileProtectedCalls;
