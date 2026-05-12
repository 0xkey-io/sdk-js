"use server";

import { ZeroXKey, ZeroXKeyApiClient } from "@0xkey-io/sdk-server";

type CompleteAuthParams = {
  otpId: string;
  otpCode: string;
  publicKey: string;
};

export async function completeAuth({
  otpId,
  otpCode,
  publicKey,
}: CompleteAuthParams) {
  const zeroXKeyClient = new ZeroXKey({
    apiBaseUrl: "https://api.0xkey.com",
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    defaultOrganizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
  }).apiClient();

  // we cerify the OTP code to get a verification token
  const { verificationToken } = await zeroXKeyClient.verifyOtp({
    otpId,
    otpCode,
  });
  if (!verificationToken) {
    throw new Error("Verification token not found after OTP verification.");
  }

  // we extract the email from the verificationToken
  const email = extractEmailFromVerificationToken(verificationToken);

  // we either get or create the sub-organization for this email
  const subOrgId = await getOrCreateSuborgForEmail(zeroXKeyClient, email);

  // create a session
  const { session } = await zeroXKeyClient.otpLogin({
    organizationId: subOrgId,
    verificationToken,
    publicKey,
  });

  if (!session) {
    throw new Error("Failed to create session from OTP login.");
  }

  return session;
}

// helper to decode the verification token and extract the email
function extractEmailFromVerificationToken(token: string): string {
  try {
    const [, payloadBase64] = token.split(".");
    const payloadJson = Buffer.from(payloadBase64, "base64url").toString();
    const payload = JSON.parse(payloadJson);

    const email = payload.contact;
    if (!email)
      throw new Error("Email not found in verification token payload.");

    return email;
  } catch (error) {
    console.error("Failed to decode verification token:", error);
    throw new Error("Invalid verification token format.");
  }
}

// helper to get or create a sub-organization for the given email
async function getOrCreateSuborgForEmail(
  zeroXKeyClient: ZeroXKeyApiClient,
  email: string,
): Promise<string> {
  // we try to find an existing sub-org
  const { organizationIds } = await zeroXKeyClient.getVerifiedSubOrgIds({
    filterType: "EMAIL",
    filterValue: email,
  });

  const existingSubOrgId = organizationIds?.[0];
  if (existingSubOrgId) return existingSubOrgId;

  // no subOrg exists, so we create one
  const { subOrganizationId } = await zeroXKeyClient.createSubOrganization({
    subOrganizationName: `suborg-${Date.now()}`,
    rootQuorumThreshold: 1,
    rootUsers: [
      {
        userName: "Magic Link User",
        userEmail: email,
        apiKeys: [],
        authenticators: [],
        oauthProviders: [],
      },
    ],
  });

  if (!subOrganizationId) {
    throw new Error("Expected a non-null subOrganizationId after creation.");
  }

  return subOrganizationId;
}
