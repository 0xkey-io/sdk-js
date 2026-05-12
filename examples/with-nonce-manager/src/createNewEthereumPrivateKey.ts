import {
  ZeroXKey as ZeroXKeySDKServer,
  ZeroXKeyActivityError,
} from "@0xkey-io/sdk-server";
import * as crypto from "crypto";
import { refineNonNull } from "./util";

export async function createNewEthereumPrivateKey() {
  const zeroXKeyClient = new ZeroXKeySDKServer({
    apiBaseUrl: "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  const privateKeyName = `ETH Key ${crypto.randomBytes(2).toString("hex")}`;

  try {
    const { privateKeys } = await zeroXKeyClient.apiClient().createPrivateKeys({
      privateKeys: [
        {
          privateKeyName,
          curve: "CURVE_SECP256K1",
          addressFormats: ["ADDRESS_FORMAT_ETHEREUM"],
          privateKeyTags: [],
        },
      ],
    });

    const privateKeyId = refineNonNull(privateKeys?.[0]?.privateKeyId);
    const address = refineNonNull(privateKeys?.[0]?.addresses?.[0]?.address);

    // Success!
    console.log(
      [
        `New Ethereum private key created!`,
        `- Name: ${privateKeyName}`,
        `- Private key ID: ${privateKeyId}`,
        `- Address: ${address}`,
        ``,
        "Now you can take the private key ID, put it in `.env.local`, then re-run the script.",
      ].join("\n"),
    );
  } catch (error) {
    // If needed, you can read from `ZeroXKeyActivityError` to find out why the activity didn't succeed
    if (error instanceof ZeroXKeyActivityError) {
      throw error;
    }

    throw new ZeroXKeyActivityError({
      message: "Failed to create a new Ethereum private key",
      cause: error as Error,
    });
  }
}
