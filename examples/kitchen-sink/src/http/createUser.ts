import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";

import { refineNonNull } from "../utils";

async function main() {
  // Initialize a ZeroXKey client
  const zeroXKeyClient = new ZeroXKeyClient(
    { baseUrl: process.env.BASE_URL! },
    new ApiKeyStamper({
      apiPublicKey: process.env.API_PUBLIC_KEY!,
      apiPrivateKey: process.env.API_PRIVATE_KEY!,
    }),
  );

  const userName = "<user name>";
  const userTags = ["<your user tag>"];
  const apiKeyName = "<API key name>";
  const publicKey = "<API public key>";

  const { activity } = await zeroXKeyClient.createApiOnlyUsers({
    type: "ACTIVITY_TYPE_CREATE_API_ONLY_USERS",
    organizationId: process.env.ORGANIZATION_ID!,
    parameters: {
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
    },
    timestampMs: String(Date.now()), // millisecond timestamp
  });

  const userId = refineNonNull(
    activity.result.createApiOnlyUsersResult?.userIds?.[0],
  );

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
