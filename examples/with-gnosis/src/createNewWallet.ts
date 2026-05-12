import {
  ZeroXKey as ZeroXKeySDKServer,
  ZeroXKeyActivityError,
} from "@0xkey-io/sdk-server";
import * as crypto from "crypto";
import { refineNonNull } from "./util";

export async function createNewEthereumWallet() {
  const zeroXKeyClient = new ZeroXKeySDKServer({
    apiBaseUrl: "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  const walletName = `ETH Wallet ${crypto.randomBytes(2).toString("hex")}`;

  try {
    const { walletId, addresses } = await zeroXKeyClient
      .apiClient()
      .createWallet({
        walletName,
        accounts: [
          {
            curve: "CURVE_SECP256K1",
            pathFormat: "PATH_FORMAT_BIP32",
            path: "m/44'/60'/0'/0/0",
            addressFormat: "ADDRESS_FORMAT_ETHEREUM",
          },
        ],
      });

    const address = refineNonNull(addresses[0]);

    // Success!
    console.log(
      [
        `New Ethereum wallet created!`,
        `- Name: ${walletName}`,
        `- Wallet ID: ${walletId}`,
        `- Address: ${address}`,
        ``,
        "Now you can take the address, put it in `.env.local`, then re-run the script.",
      ].join("\n"),
    );
  } catch (error) {
    // If needed, you can read from `ZeroXKeyActivityError` to find out why the activity didn't succeed
    if (error instanceof ZeroXKeyActivityError) {
      throw error;
    }

    throw new ZeroXKeyActivityError({
      message: "Failed to create a new Ethereum wallet",
      cause: error as Error,
    });
  }
}
