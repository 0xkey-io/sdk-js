"use server";

import { ZeroXKey } from "@0xkey-io/sdk-server";

/**
 * Validate policy by attempting to sign the provided unsigned txs.
 * @param subOrgId             sub-organization ID to scope requests
 * @param signWithAddress      suborg Ethereum wallet address (the signer)
 * @param cases                array of { label, unsignedTx } (hex strings)
 */
export async function validatePolicyAction(
  subOrgId: string,
  signWithAddress: string,
  cases: { label: string; unsignedTx: string }[],
) {
  const zeroXKeyClient = new ZeroXKey({
    apiBaseUrl: "https://api.0xkey.com",
    apiPrivateKey: process.env.ZEROXKEY_DA_PRIVATE_KEY!,
    apiPublicKey: process.env.ZEROXKEY_DA_PUBLIC_KEY!,
    defaultOrganizationId: subOrgId,
  }).apiClient();

  const results: {
    label: string;
    ok: boolean;
    signedTransaction?: string | null;
    error?: string | null;
  }[] = [];

  for (const c of cases) {
    try {
      const { signedTransaction } = await zeroXKeyClient.signTransaction({
        signWith: signWithAddress,
        type: "TRANSACTION_TYPE_ETHEREUM",
        unsignedTransaction: c.unsignedTx,
      });

      results.push({
        label: c.label,
        ok: true,
        signedTransaction: signedTransaction ?? null,
        error: null,
      });
    } catch (e: any) {
      results.push({
        label: c.label,
        ok: false,
        signedTransaction: null,
        error: e?.message ?? "Unknown error",
      });
    }
  }

  const ok = results.every((r) => r.ok);
  return { results };
}
