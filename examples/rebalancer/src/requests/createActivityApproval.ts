import type { ZeroXKey } from "@0xkey-io/sdk-server";
import { ZeroXKeyActivityError } from "@0xkey-io/ethers";
import { refineNonNull } from "./utils";

export default async function approveActivity(
  zeroXKeyClient: ZeroXKey,
  activityId: string,
  activityFingerprint: string,
): Promise<string> {
  try {
    const response = await zeroXKeyClient.apiClient().approveActivity({
      fingerprint: activityFingerprint,
    });

    const result = refineNonNull(response);

    // Success!
    console.log(
      [
        `✅ Approved activity!`,
        `- Activity ID: ${result.activity.id}`,
        ``,
      ].join("\n"),
    );

    return activityId;
  } catch (error) {
    // If needed, you can read from `ZeroXKeyActivityError` to find out why the activity didn't succeed
    if (error instanceof ZeroXKeyActivityError) {
      throw error;
    }

    throw new ZeroXKeyActivityError({
      message: "Failed to approve activity",
      cause: error as Error,
    });
  }
}
