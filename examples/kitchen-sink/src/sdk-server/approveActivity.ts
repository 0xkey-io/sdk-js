import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKey as ZeroXKeySDKServer } from "@0xkey-io/sdk-server";

import { refineNonNull } from "../utils";

async function main() {
  // Initialize a ZeroXKey client
  const zeroXKeyClient = new ZeroXKeySDKServer({
    apiBaseUrl: "https://api.0xkey.com",
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  const fingerprint = "<your activity fingerprint from an activity response>";

  const approveResponse = await zeroXKeyClient.apiClient().approveActivity({
    fingerprint,
  });

  // Note: you must specify the expected activity shape below.
  // For example, this is how you would fetch the result of a SignTransaction activity
  const signedTransaction = refineNonNull(approveResponse);

  // Success!
  console.log("Successfully signed transaction:", signedTransaction);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
