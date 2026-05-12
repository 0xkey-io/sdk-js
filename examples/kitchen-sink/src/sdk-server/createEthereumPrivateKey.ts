import * as path from "path";
import * as dotenv from "dotenv";
import * as crypto from "crypto";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKey as ZeroXKeySDKServer } from "@0xkey-io/sdk-server";

import { refineNonNull } from "../utils";

async function main() {
  const zeroXKeyClient = new ZeroXKeySDKServer({
    apiBaseUrl: "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  const privateKeyName = `ETH Key ${crypto.randomBytes(2).toString("hex")}`;

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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
