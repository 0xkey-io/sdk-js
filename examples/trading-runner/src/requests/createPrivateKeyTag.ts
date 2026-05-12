import {
  type ZeroXKeyServerClient,
  ZeroXKeyActivityError,
} from "@0xkey-io/sdk-server";
import { refineNonNull } from "./utils";

export default async function createPrivateKeyTag(
  zeroXKeyClient: ZeroXKeyServerClient,
  privateKeyTagName: string,
  privateKeyIds: string[],
): Promise<string> {
  try {
    const { privateKeyTagId } = await zeroXKeyClient.createPrivateKeyTag({
      privateKeyTagName,
      privateKeyIds,
    });

    const newPrivateKeyTagId = refineNonNull(privateKeyTagId);

    // Success!
    console.log(
      [
        `New private key tag created!`,
        `- Name: ${privateKeyTagName}`,
        `- Private key tag ID: ${newPrivateKeyTagId}`,
        ``,
      ].join("\n"),
    );

    return newPrivateKeyTagId;
  } catch (error) {
    // If needed, you can read from `ZeroXKeyActivityError` to find out why the activity didn't succeed
    if (error instanceof ZeroXKeyActivityError) {
      throw error;
    }

    throw new ZeroXKeyActivityError({
      message: "Failed to create a new private key tag",
      cause: error as Error,
    });
  }
}
