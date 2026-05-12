// src/server/actions/0xkey.ts
"use server";

import {
  ZeroXKey as ZeroXKeyServerSDK,
  DEFAULT_ETHEREUM_ACCOUNTS,
  DEFAULT_SOLANA_ACCOUNTS,
} from "@0xkey-io/sdk-server";

const zeroXKey = new ZeroXKeyServerSDK({
  apiBaseUrl: process.env.NEXT_PUBLIC_BASE_URL!, // or BASE_URL (non-public) if you prefer
  apiPublicKey: process.env.API_PUBLIC_KEY!,
  apiPrivateKey: process.env.API_PRIVATE_KEY!,
  defaultOrganizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
});

export async function getSuborgsAction(params: { publicKey: string }) {
  return await zeroXKey.apiClient().getSubOrgIds({
    organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
    filterType: "PUBLIC_KEY",
    filterValue: params.publicKey,
  });
}

export async function createSuborgAction(params: {
  publicKey: string;
  curveType: "API_KEY_CURVE_ED25519" | "API_KEY_CURVE_SECP256K1";
}) {
  const { publicKey, curveType } = params;

  return await zeroXKey.apiClient().createSubOrganization({
    subOrganizationName: `wallet-suborg-${Date.now()}`,
    rootQuorumThreshold: 1,
    rootUsers: [
      {
        userName: `wallet-user-${Date.now()}`,
        userEmail: "wallet@domain.com",
        apiKeys: [
          {
            apiKeyName: `Wallet Auth - ${publicKey}`,
            // The public key of the wallet that will be added as an API key and used to stamp future requests
            publicKey,
            // We set the curve type to 'API_KEY_CURVE_ED25519' for solana wallets
            // If using an Ethereum wallet, set the curve type to 'API_KEY_CURVE_SECP256K1'
            curveType,
          },
        ],
        authenticators: [],
        oauthProviders: [],
      },
    ],
    wallet: {
      walletName: "Default Wallet",
      accounts: [...DEFAULT_ETHEREUM_ACCOUNTS, ...DEFAULT_SOLANA_ACCOUNTS],
    },
  });
}
