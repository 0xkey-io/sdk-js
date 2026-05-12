import { ZeroXKey as ZeroXKeySDKServer } from "@0xkey-io/sdk-server";

export function getZeroXKeyClient() {
  return new ZeroXKeySDKServer({
    apiBaseUrl: process.env.BASE_URL ?? "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });
}
