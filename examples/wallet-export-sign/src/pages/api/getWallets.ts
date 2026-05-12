import type { NextApiRequest, NextApiResponse } from "next";
import { ZeroXKey, ZeroXKeyApiTypes } from "@0xkey-io/sdk-server";

type TWallet = ZeroXKeyApiTypes["v1Wallet"];

type GetWalletsRequest = {
  organizationId: string;
};

type GetWalletsResponse = {
  wallets: TWallet[];
};

type ErrorMessage = {
  message: string;
};

export default async function getWallets(
  req: NextApiRequest,
  res: NextApiResponse<GetWalletsResponse | ErrorMessage>,
) {
  const getWalletsRequest = req.body as GetWalletsRequest;
  const zeroXKeyClient = new ZeroXKey({
    apiBaseUrl: process.env.NEXT_PUBLIC_BASE_URL || "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
  });

  const organizationId = getWalletsRequest.organizationId;

  try {
    const walletsResponse = await zeroXKeyClient.apiClient().getWallets({
      organizationId,
    });

    res.status(200).json({
      wallets: walletsResponse.wallets,
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      message: "Something went wrong.",
    });
  }

  res.json;
}
