import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKey as ZeroXKeySDKServer } from "@0xkey-io/sdk-server";

async function main() {
  const zeroXKeyClient = new ZeroXKeySDKServer({
    apiBaseUrl: process.env.BASE_URL || "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  const { walletIds } = await zeroXKeyClient.apiClient().deleteWallets({
    deleteWithoutExport: true, // this is an optional field. If this flag is not set, and the wallet has not yet been exported, this will error
    walletIds: ["<wallet ID to delete>"],
  });

  // Success!
  console.log([`Wallets deleted!`, `- Wallet IDs: ${walletIds}`].join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
