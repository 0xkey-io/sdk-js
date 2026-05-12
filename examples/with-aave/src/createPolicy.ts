import { ZeroXKey } from "@0xkey-io/sdk-server";
import { AaveV3Base } from "@bgd-labs/aave-address-book";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const zeroXKeyClient = new ZeroXKey({
    apiBaseUrl: "https://api.0xkey.com",
    apiPrivateKey: process.env.ZEROXKEY_API_PRIVATE_KEY!,
    apiPublicKey: process.env.ZEROXKEY_API_PUBLIC_KEY!,
    defaultOrganizationId: process.env.ZEROXKEY_ORGANIZATION_ID!,
  }).apiClient();

  // The id of the non-root user that you'll be using to sign the Aave related transactions
  const userId = process.env.NONROOT_USER_ID!;

  // Pull addresses from Aave Address Book (Base)
  const USDC_ADDRESS = AaveV3Base.ASSETS.USDC.UNDERLYING;
  const AAVE_POOL = AaveV3Base.POOL;

  const policyName =
    "Allow API key user to only sign txs to Aave Pool and USDC";
  const effect = "EFFECT_ALLOW";
  const consensus = `approvers.any(user, user.id == '${userId}')`;
  const condition = `eth.tx.to in ['${USDC_ADDRESS}', '${AAVE_POOL}']`;
  const notes = "";

  const { policyId } = await zeroXKeyClient.createPolicy({
    policyName,
    condition,
    consensus,
    effect,
    notes,
  });

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
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
