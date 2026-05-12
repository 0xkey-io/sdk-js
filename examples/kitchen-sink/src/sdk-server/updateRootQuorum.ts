import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKey as ZeroXKeyServerSDK } from "@0xkey-io/sdk-server";

async function main() {
  // Initialize a ZeroXKey client
  const zeroXKeyClient = new ZeroXKeyServerSDK({
    apiBaseUrl: process.env.BASE_URL!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  const usersResponse = await zeroXKeyClient.apiClient().getUsers();
  const whoamiResponse = await zeroXKeyClient.apiClient().getWhoami();
  const orgConfigsResponse = await zeroXKeyClient
    .apiClient()
    .getOrganizationConfigs({
      organizationId: process.env.ORGANIZATION_ID!,
    });

  await zeroXKeyClient.apiClient().updateRootQuorum({
    threshold: 1,
    userIds: [orgConfigsResponse.configs.quorum?.userIds[0]!], // retain the first root user
  });

  const updatedOrgConfigsResponse = await zeroXKeyClient
    .apiClient()
    .getOrganizationConfigs({
      organizationId: process.env.ORGANIZATION_ID!,
    });

  console.log({
    users: usersResponse.users,
    whoami: whoamiResponse,
    rootQuorum: orgConfigsResponse.configs.quorum,
    updatedRootQuorum: updatedOrgConfigsResponse.configs.quorum,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
