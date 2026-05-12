import type { NextApiRequest, NextApiResponse } from "next";
import { ZeroXKey, ZeroXKeyApiTypes } from "@0xkey-io/sdk-server";

type TWalletAccount = ZeroXKeyApiTypes["v1WalletAccount"];

type GetWalletAccountsRequest = {
  organizationId: string;
  walletId: string;
};

type GetWalletAccountsResponse = {
  accounts: TWalletAccount[];
};

type ErrorMessage = {
  message: string;
};

export default async function getWalletAccounts(
  req: NextApiRequest,
  res: NextApiResponse<GetWalletAccountsResponse | ErrorMessage>,
) {
  const getWalletAccountsRequest = req.body as GetWalletAccountsRequest;
  const zeroXKeyClient = new ZeroXKey({
    apiBaseUrl: process.env.NEXT_PUBLIC_BASE_URL || "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
  });

  const { organizationId, walletId } = getWalletAccountsRequest;

  try {
    const walletAccountsResponse = await zeroXKeyClient
      .apiClient()
      .getWalletAccounts({
        organizationId,
        walletId,
      });

    res.status(200).json({
      accounts: walletAccountsResponse.accounts,
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      message: "Something went wrong.",
    });
  }
}
