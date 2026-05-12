import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";

import { refineNonNull } from "../utils";

async function main() {
  // Initialize a ZeroXKey client
  const zeroXKeyClient = new ZeroXKeyClient(
    { baseUrl: process.env.BASE_URL! },
    new ApiKeyStamper({
      apiPublicKey: process.env.API_PUBLIC_KEY!,
      apiPrivateKey: process.env.API_PRIVATE_KEY!,
    }),
  );

  const { activity } = await zeroXKeyClient.deleteWallets({
    type: "ACTIVITY_TYPE_DELETE_WALLETS",
    organizationId: process.env.ORGANIZATION_ID!,
    parameters: {
      deleteWithoutExport: true, // this is an optional field. If this flag is not set, and the wallet has not yet been exported, this will error
      walletIds: ["<wallet ID to delete>"],
    },
    timestampMs: String(Date.now()), // millisecond timestamp
  });

  const walletIds = refineNonNull(
    activity.result.deleteWalletsResult?.walletIds,
  );

  // Success!
  console.log([`Wallets deleted!`, `- Wallet IDs: ${walletIds}`].join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
