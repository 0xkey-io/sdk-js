import type { ZeroXKey } from "@0xkey-io/sdk-server";
import { ZeroXKeyActivityError } from "@0xkey-io/ethers";
import { refineNonNull } from "./utils";

export default async function createUserTag(
  zeroXKeyClient: ZeroXKey,
  userTagName: string,
  userIds: string[],
): Promise<string> {
  try {
    const activity = await zeroXKeyClient.apiClient().createUserTag({
      userTagName,
      userIds,
    });

    const userTagId = refineNonNull(activity?.userTagId);

    // Success!
    console.log(
      [
        `New user tag created!`,
        `- Name: ${userTagName}`,
        `- User tag ID: ${userTagId}`,
        ``,
      ].join("\n"),
    );

    return userTagId;
  } catch (error) {
    // If needed, you can read from `ZeroXKeyActivityError` to find out why the activity didn't succeed
    if (error instanceof ZeroXKeyActivityError) {
      throw error;
    }

    throw new ZeroXKeyActivityError({
      message: "Failed to create a new user tag",
      cause: error as Error,
    });
  }
}
