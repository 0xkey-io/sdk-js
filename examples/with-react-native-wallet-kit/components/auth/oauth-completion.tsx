import { useEffect } from "react";
import { Alert } from "react-native";
import { useZeroXKey } from "@0xkey-io/react-native-wallet-kit";

import { useCaptcha } from "@/components/captcha/captcha-provider";
import {
  registerOauthCompletion,
  takeOauthProvider,
} from "@/constants/callbacks";
import {
  CaptchaCancelledError,
  completeOauthWithSignupCaptcha,
  withCaptchaToken,
} from "@/constants/captcha";

/**
 * Completes every OAuth sign-in handed over by `callbacks.onOauthRedirect`.
 * An existing account logs in without a challenge; a new account is
 * challenged only when the Auth Proxy requires a Captcha token for signup.
 */
export function OauthCompletion() {
  const { completeOauth } = useZeroXKey();
  const { requireCaptchaToken } = useCaptcha();

  useEffect(
    () =>
      registerOauthCompletion(({ idToken, publicKey, sessionKey }) => {
        const providerName = takeOauthProvider();
        completeOauthWithSignupCaptcha(
          (captchaToken) =>
            completeOauth(
              withCaptchaToken(
                {
                  oidcToken: idToken,
                  publicKey,
                  ...(providerName && { providerName }),
                  ...(sessionKey && { sessionKey }),
                },
                captchaToken,
              ),
            ),
          requireCaptchaToken,
        ).catch((error) => {
          if (error instanceof CaptchaCancelledError) return;
          console.error("Error completing OAuth sign-in", error);
          Alert.alert("Error", "Failed to complete sign-in");
        });
      }),
    [completeOauth, requireCaptchaToken],
  );

  return null;
}
