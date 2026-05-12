import type { ZeroXKey } from "@0xkey-io/sdk-server";
import { ZeroXKeyActivityError } from "@0xkey-io/ethers";
import { refineNonNull } from "./utils";

export default async function createUser(
  zeroXKeyClient: ZeroXKey,
  userName: string,
  userTags: string[],
  apiKeyName: string,
  publicKey: string,
): Promise<string> {
  try {
    const activity = await zeroXKeyClient.apiClient().createApiOnlyUsers({
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

    const userId = refineNonNull(activity?.userIds?.[0]);

    // Success!
    console.log(
      [
        `New user created!`,
        `- Name: ${userName}`,
        `- User ID: ${userId}`,
        ``,
      ].join("\n"),
    );

    return userId;
  } catch (error) {
    // If needed, you can read from `ZeroXKeyActivityError` to find out why the activity didn't succeed
    if (error instanceof ZeroXKeyActivityError) {
      throw error;
    }

    throw new ZeroXKeyActivityError({
      message: "Failed to create a new user",
      cause: error as Error,
    });
  }
}
