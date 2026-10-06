import type {
  ZeroXKeyClient,
  ZeroXKeyClientMethods,
} from "../__clients__/core";
import { OtpType, type WalletProvider } from "../__types__";

// Typecheck-only consumer fixture: these calls are never made at runtime.
const consumeCaptchaInputs = (
  client: ZeroXKeyClient,
  walletProvider: WalletProvider,
) => {
  client.initOtp({
    otpType: OtpType.Email,
    contact: "a@example.test",
    captchaToken: "token",
  });
  client.signUpWithPasskey({ captchaToken: "token" });
  client.signUpWithOtp({
    verificationToken: "proof",
    contact: "a@example.test",
    otpType: OtpType.Email,
    captchaToken: "token",
  });
  client.signUpWithOauth({
    oidcToken: "oidc",
    publicKey: "key",
    captchaToken: "token",
  });
  client.signUpWithWallet({ walletProvider, captchaToken: "token" });
  client.completeOauth({
    oidcToken: "oidc",
    publicKey: "key",
    captchaToken: "token",
  });
  client.loginOrSignupWithWallet({ walletProvider, captchaToken: "token" });
  client.completeOtp({
    otpId: "otp",
    otpCode: "123456",
    otpEncryptionTargetBundle: "bundle",
    contact: "a@example.test",
    otpType: OtpType.Email,
    captchaToken: "token",
  });

  // @ts-expect-error Login APIs never accept a Captcha token.
  client.loginWithOtp({ verificationToken: "proof", captchaToken: "token" });
  client.loginWithOauth({
    oidcToken: "oidc",
    publicKey: "key",
    // @ts-expect-error Login APIs never accept a Captcha token.
    captchaToken: "token",
  });
};

void consumeCaptchaInputs;

const consumeConvenienceOauth = (client: ZeroXKeyClientMethods) => {
  const params = { oidcToken: "oidc", publicKey: "key" };
  const gate = async (submit: (token?: string) => Promise<unknown>) =>
    submit("token");
  client.completeOauth(params);
  // @ts-expect-error The deferred signup gate is Core-only, not in React's public context.
  client.completeOauth(params, gate);
};

void consumeConvenienceOauth;
