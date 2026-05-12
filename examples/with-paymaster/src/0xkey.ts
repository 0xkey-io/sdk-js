import { ZeroXKey as ZeroXKeySDKServer } from "@0xkey-io/sdk-server";

export function getZeroXKeyClient() {
  return new ZeroXKeySDKServer({
    apiBaseUrl: process.env.BASE_URL ?? "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });
}

export async function pollTransactionStatus({
  apiClient,
  organizationId,
  sendTransactionStatusId,
  intervalMs = 200,
  timeoutMs = 60_000,
}: {
  apiClient: any;
  organizationId: string;
  sendTransactionStatusId: string;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<{ eth?: { txHash?: string }; txStatus: string }> {
  console.log(`Polling transaction status for ${sendTransactionStatusId}...`);
  return apiClient.pollTransactionStatus({
    organizationId,
    sendTransactionStatusId,
    pollingIntervalMs: intervalMs,
    timeoutMs,
  });
}
