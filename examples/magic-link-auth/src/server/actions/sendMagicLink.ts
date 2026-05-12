"use server";

import { OtpType } from "@0xkey-io/react-wallet-kit";
import { ZeroXKey } from "@0xkey-io/sdk-server";

type SendMagicLinkParams = {
  email: string;
};

export async function sendMagicLink({ email }: SendMagicLinkParams) {
  const zeroXKeyClient = new ZeroXKey({
    apiBaseUrl: "https://api.0xkey.com",
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    defaultOrganizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
  }).apiClient();

  // we send a magic link to the user’s email
  const { otpId } = await zeroXKeyClient.initOtp({
    contact: email,
    otpType: OtpType.Email,
    emailCustomization: {
      // %s will be replaced with the otpCode when sending the email
      magicLinkTemplate: "http://localhost:3000?otpCode=%s",
    },
  });

  if (!otpId) {
    throw new Error("Failed to initialize OTP: missing otpId in response.");
  }

  return otpId;
}
