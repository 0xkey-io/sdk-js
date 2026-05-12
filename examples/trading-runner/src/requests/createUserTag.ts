import {
  type ZeroXKeyServerClient,
  ZeroXKeyActivityError,
} from "@0xkey-io/sdk-server";

import { refineNonNull } from "./utils";

export default async function createUserTag(
  zeroXKeyClient: ZeroXKeyServerClient,
  userTagName: string,
  userIds: string[],
): Promise<string> {
  try {
    const { userTagId } = await zeroXKeyClient.createUserTag({
      userTagName,
      userIds,
    });

    const newUserTagId = refineNonNull(userTagId);

    // Success!
    console.log(
      [
        `New user tag created!`,
        `- Name: ${userTagName}`,
        `- User tag ID: ${newUserTagId}`,
        ``,
      ].join("\n"),
    );

    return newUserTagId;
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
