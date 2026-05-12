import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKey as ZeroXKeySDKServer } from "@0xkey-io/sdk-server";

import { refineNonNull } from "../utils";

async function main() {
  // Initialize a ZeroXKey client
  const zeroXKeyClient = new ZeroXKeySDKServer({
    apiBaseUrl: "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  const userName = "<user name>";
  const userTags = ["<your user tag>"];
  const apiKeyName = "<API key name>";
  const publicKey = "<API public key>";

  const { userIds } = await zeroXKeyClient.apiClient().createApiOnlyUsers({
    apiOnlyUsers: [
      {
        userName,
        userTags,
        apiKeys: [
          {
            apiKeyName,
            publicKey,
          },
        ],
      },
    ],
  });

  const userId = refineNonNull(userIds[0]);

  // Success!
  console.log(
    [
      `New user created!`,
      `- Name: ${userName}`,
      `- User ID: ${userId}`,
      ``,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
