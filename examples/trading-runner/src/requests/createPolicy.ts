import {
  type ZeroXKeyServerClient,
  ZeroXKeyActivityError,
} from "@0xkey-io/sdk-server";

import { refineNonNull } from "./utils";

export default async function createPolicy(
  zeroXKeyClient: ZeroXKeyServerClient,
  policyName: string,
  effect: "EFFECT_ALLOW" | "EFFECT_DENY",
  consensus: string,
  condition: string,
): Promise<string> {
  try {
    const { policyId } = await zeroXKeyClient.createPolicy({
      policyName,
      condition,
      consensus,
      effect,
      notes: "",
    });

    const newPolicyId = refineNonNull(policyId);

    // Success!
    console.log(
      [
        `New policy created!`,
        `- Name: ${policyName}`,
        `- Policy ID: ${newPolicyId}`,
        `- Effect: ${effect}`,
        `- Consensus: ${consensus}`,
        `- Condition: ${condition}`,
        ``,
      ].join("\n"),
    );

    return newPolicyId;
  } catch (error) {
    // If needed, you can read from `ZeroXKeyActivityError` to find out why the activity didn't succeed
    if (error instanceof ZeroXKeyActivityError) {
      throw error;
    }

    throw new ZeroXKeyActivityError({
      message: "Failed to create a new policy",
      cause: error as Error,
    });
  }
}
