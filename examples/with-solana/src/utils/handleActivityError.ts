import prompts from "prompts";
import {
  ZeroXKeyActivityConsensusNeededError,
  TERMINAL_ACTIVITY_STATUSES,
  type TActivity,
} from "@0xkey-io/http";
import type { ZeroXKey } from "@0xkey-io/sdk-server";

export async function handleActivityError(
  zeroXKeyClient: ZeroXKey,
  error: any,
) {
  if (error instanceof ZeroXKeyActivityConsensusNeededError) {
    const activityId = error["activityId"]!;
    let activityStatus = error["activityStatus"]!;
    let activity: TActivity | undefined;

    while (!TERMINAL_ACTIVITY_STATUSES.includes(activityStatus)) {
      console.log("\nWaiting for consensus...\n");

      const { retry } = await prompts([
        {
          type: "text",
          name: "retry",
          message: "Consensus reached? y/n",
          initial: "y",
        },
      ]);

      if (retry === "n") {
        continue;
      }

      // Refresh activity
      activity = (
        await zeroXKeyClient.apiClient().getActivity({
          activityId,
          organizationId: process.env.ORGANIZATION_ID!,
        })
      ).activity;

      activityStatus = activity.status;
    }

    console.log("\nConsensus reached! Moving on...\n");

    return activity;
  }

  // Rethrow error
  throw error;
}
