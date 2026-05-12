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

  const privateKeyTagName = "<your desired private key tag name>";
  const privateKeyIds = ["<relevant private key ID>"];

  const { activity } = await zeroXKeyClient.createPrivateKeyTag({
    type: "ACTIVITY_TYPE_CREATE_PRIVATE_KEY_TAG",
    organizationId: process.env.ORGANIZATION_ID!,
    parameters: {
      privateKeyTagName,
      privateKeyIds,
    },
    timestampMs: String(Date.now()), // millisecond timestamp
  });

  const privateKeyTagId = refineNonNull(
    activity.result.createPrivateKeyTagResult?.privateKeyTagId,
  );

  // Success!
  console.log(
    [
      `New private key tag created!`,
      `- Name: ${privateKeyTagName}`,
      `- Private key tag ID: ${privateKeyTagId}`,
      ``,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
