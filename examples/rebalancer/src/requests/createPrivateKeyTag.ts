import type { ZeroXKey } from "@0xkey-io/sdk-server";
import { ZeroXKeyActivityError } from "@0xkey-io/ethers";
import { refineNonNull } from "./utils";

export default async function createPrivateKeyTag(
  zeroXKeyClient: ZeroXKey,
  privateKeyTagName: string,
  privateKeyIds: string[],
): Promise<string> {
  try {
    const activity = await zeroXKeyClient.apiClient().createPrivateKeyTag({
      privateKeyTagName,
      privateKeyIds,
    });

    const privateKeyTagId = refineNonNull(activity?.privateKeyTagId);

    // Success!
    console.log(
      [
        `New private key tag created!`,
        `- Name: ${privateKeyTagName}`,
        `- Private key tag ID: ${privateKeyTagId}`,
        ``,
      ].join("\n"),
    );

    return privateKeyTagId;
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
