import type { ZeroXKey, ZeroXKeyApiTypes } from "@0xkey-io/sdk-server";
import { refineNonNull } from "./utils";

export default async function getActivity(
  zeroXKeyClient: ZeroXKey,
  activityId: string,
): Promise<ZeroXKeyApiTypes["v1ActivityResponse"]["activity"]> {
  const response = await zeroXKeyClient.apiClient().getActivity({
    organizationId: process.env.ORGANIZATION_ID!,
    activityId,
  });

  return refineNonNull(response.activity);
}
