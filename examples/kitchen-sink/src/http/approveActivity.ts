import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import { refineNonNull } from "../utils";

async function main() {
  const zeroXKeyClient = new ZeroXKeyClient(
    { baseUrl: process.env.BASE_URL! },
    new ApiKeyStamper({
      apiPublicKey: process.env.API_PUBLIC_KEY!,
      apiPrivateKey: process.env.API_PRIVATE_KEY!,
    }),
  );

  const fingerprint = "<your activity fingerprint from an activity response>";

  const { activity } = await zeroXKeyClient.approveActivity({
    type: "ACTIVITY_TYPE_APPROVE_ACTIVITY",
    organizationId: process.env.ORGANIZATION_ID!,
    parameters: {
      fingerprint,
    },
    timestampMs: String(Date.now()), // millisecond timestamp
  });

  // Note: you must specify the expected activity shape below.
  // For example, this is how you would fetch the result of a SignTransaction activity
  const signedTransaction = refineNonNull(
    activity.result?.signTransactionResult?.signedTransaction,
  );

  // Success!
  console.log("Successfully signed transaction:", signedTransaction);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
