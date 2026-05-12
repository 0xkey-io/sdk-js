import { ZeroXKey as ZeroXKeySDKServer } from "@0xkey-io/sdk-server";

import * as crypto from "crypto";
import { refineNonNull } from "./util";

export async function createNewWallet() {
  console.log("creating a new wallet on ZeroXKey...\n");

  const walletName = `ETH Wallet ${crypto.randomBytes(2).toString("hex")}`;

  try {
    const zeroXKeyClient = new ZeroXKeySDKServer({
      apiBaseUrl: "https://api.0xkey.com",
      apiPublicKey: process.env.API_PUBLIC_KEY!,
      apiPrivateKey: process.env.API_PRIVATE_KEY!,
      defaultOrganizationId: process.env.ORGANIZATION_ID!,
    });

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

    const newWalletId = refineNonNull(walletId);
    const address = refineNonNull(addresses[0]);

    // Success!
    console.log(
      [
        `New Ethereum wallet created!`,
        `- Name: ${walletName}`,
        `- Wallet ID: ${newWalletId}`,
        `- Address: ${address}`,
        ``,
        "Now you can take the address, put it in `.env.local` (`SIGN_WITH=<address>`), then re-run the script.",
      ].join("\n"),
    );
  } catch (error) {
    throw new Error("Failed to create a new Ethereum wallet: " + error);
  }
}
