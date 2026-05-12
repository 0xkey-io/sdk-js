import type { ZeroXKey, ZeroXKeyApiTypes } from "@0xkey-io/sdk-server";
import { refineNonNull } from "./utils";

export default async function getActivities(
  zeroXKeyClient: ZeroXKey,
  limit: string,
): Promise<ZeroXKeyApiTypes["v1GetActivitiesResponse"]["activities"]> {
  const response = await zeroXKeyClient.apiClient().getActivities({
    organizationId: process.env.ORGANIZATION_ID!,
    paginationOptions: {
      limit: limit,
    },
  });

  return refineNonNull(response.activities);
}
