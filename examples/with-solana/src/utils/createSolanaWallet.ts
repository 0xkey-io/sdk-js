import {
  type ZeroXKeyApiClient,
  ZeroXKeyActivityError,
} from "@0xkey-io/sdk-server";
import * as crypto from "crypto";

export async function createNewSolanaWallet(client: ZeroXKeyApiClient) {
  console.log(
    "creating a new Solana wallet in your ZeroXKey organization...\n",
  );

  const walletName = `Solana Wallet ${crypto.randomBytes(2).toString("hex")}`;

  try {
    const response = await client.createWallet({
      walletName,
      accounts: [
        {
          pathFormat: "PATH_FORMAT_BIP32",
          // https://github.com/satoshilabs/slips/blob/master/slip-0044.md
          path: "m/44'/501'/0'/0'",
          curve: "CURVE_ED25519",
          addressFormat: "ADDRESS_FORMAT_SOLANA",
        },
      ],
    });

    const walletId = response.walletId;
    if (!walletId) {
      console.error("response doesn't contain a valid wallet ID");
      process.exit(1);
    }

    const address = response.addresses[0];
    if (!address) {
      console.error("response doesn't contain a valid address");
      process.exit(1);
    }

    console.log(
      [
        `New Solana wallet created!`,
        `- Name: ${walletName}`,
        `- Wallet ID: ${walletId}`,
        `- Solana address: ${address}`,
      ].join("\n"),
    );
    return address;
  } catch (error) {
    // If needed, you can read from `ZeroXKeyActivityError` to find out why the activity didn't succeed
    if (error instanceof ZeroXKeyActivityError) {
      throw error;
    }

    throw new ZeroXKeyActivityError({
      message: `Failed to create a new Solana wallet: ${
        (error as Error).message
      }`,
      cause: error as Error,
    });
  }
}
