import {
  type ZeroXKeyServerClient,
  ZeroXKeyActivityError,
} from "@0xkey-io/sdk-server";

export default async function createUser(
  zeroXKeyClient: ZeroXKeyServerClient,
  userName: string,
  apiKeyName: string,
  publicKey: string,
): Promise<string> {
  let userTags: string[] = new Array();
  try {
    const { userIds } = await zeroXKeyClient.createApiOnlyUsers({
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

    const userId = userIds?.[0]!;

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
