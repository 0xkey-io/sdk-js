import type { ZeroXKey } from "@0xkey-io/sdk-server";
import { ZeroXKeyActivityError } from "@0xkey-io/ethers";
import { refineNonNull } from "./utils";

export default async function createPolicy(
  zeroXKeyClient: ZeroXKey,
  policyName: string,
  effect: "EFFECT_ALLOW" | "EFFECT_DENY",
  consensus: string,
  condition: string,
): Promise<string> {
  try {
    const activity = await zeroXKeyClient.apiClient().createPolicy({
      policyName,
      condition,
      consensus,
      effect,
      notes: "",
    });

    const policyId = refineNonNull(activity?.policyId);

    // Success!
    console.log(
      [
        `New policy created!`,
        `- Name: ${policyName}`,
        `- Policy ID: ${policyId}`,
        `- Effect: ${effect}`,
        `- Consensus: ${consensus}`,
        `- Condition: ${condition}`,
        ``,
      ].join("\n"),
    );

    return policyId;
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
