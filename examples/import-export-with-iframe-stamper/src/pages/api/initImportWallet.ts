import type { NextApiRequest, NextApiResponse } from "next";
import { ZeroXKey } from "@0xkey-io/sdk-server";

type InitImportWalletRequest = {
  userId: string;
};

type InitImportWalletResponse = {
  importBundle: string;
};

type ErrorMessage = {
  message: string;
};

export default async function initImportWallet(
  req: NextApiRequest,
  res: NextApiResponse<InitImportWalletResponse | ErrorMessage>,
) {
  try {
    const request = req.body as InitImportWalletRequest;
    const zeroXKeyClient = new ZeroXKey({
      apiBaseUrl: process.env.NEXT_PUBLIC_BASE_URL || "https://api.0xkey.com",
      apiPublicKey: process.env.API_PUBLIC_KEY!,
      apiPrivateKey: process.env.API_PRIVATE_KEY!,
      defaultOrganizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
    });

    const initImportWalletResponse = await zeroXKeyClient
      .apiClient()
      .initImportWallet({
        userId: request.userId,
      });

    const { importBundle } = initImportWalletResponse;

    if (!importBundle) {
      throw new Error("Expected a non-null import bundle!");
    }

    res.status(200).json({
      importBundle,
    });
  } catch (e) {
    console.error(e);

    res.status(500).json({
      message: "Something went wrong.",
    });
  }
}
