import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import {
  ZeroXKey as ZeroXKeySDKServer,
  DEFAULT_ETHEREUM_ACCOUNTS,
} from "@0xkey-io/sdk-server";

import { refineNonNull } from "../utils";

async function main() {
  const zeroXKeyClient = new ZeroXKeySDKServer({
    apiBaseUrl: "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  const apiKeyName = "<API key name>";
  const publicKey = "<API public key>";
  const curveType = "API_KEY_CURVE_P256";

  const subOrg = await zeroXKeyClient.apiClient().createSubOrganization({
    subOrganizationName: `Test Sub-Organization`,
    rootUsers: [
      {
        userName: "API Key User",
        apiKeys: [
          {
            apiKeyName,
            publicKey,
            curveType,
          },
        ],
        authenticators: [],
        oauthProviders: [],
      },
    ],
    rootQuorumThreshold: 1,
    wallet: {
      walletName: "Default ETH Wallet",
      accounts: DEFAULT_ETHEREUM_ACCOUNTS,
    },
  });

  const subOrgId = refineNonNull(subOrg.subOrganizationId);

  // Success!
  console.log("Sub-organization id:", subOrgId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
