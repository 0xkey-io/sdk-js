import * as path from "path";
import * as dotenv from "dotenv";
import { base } from "viem/chains";
import { createAccount } from "@0xkey-io/viem";
import { ZeroXKey as ZeroXKeyServerSDK } from "@0xkey-io/sdk-server";
import {
  createWalletClient,
  http,
  type Account,
  createPublicClient,
  parseAbi,
  parseUnits,
} from "viem";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const MORPHO_VAULT_ADDRESS = process.env.MORPHO_VAULT_ADDRESS!;

async function main() {
  const zeroXKeyClient = new ZeroXKeyServerSDK({
    apiBaseUrl: process.env.ZEROXKEY_BASE_URL!,
    apiPrivateKey: process.env.NONROOT_API_PRIVATE_KEY!,
    apiPublicKey: process.env.NONROOT_API_PUBLIC_KEY!,
    defaultOrganizationId: process.env.ZEROXKEY_ORGANIZATION_ID!,
  });

  const zeroXKeyAccount = await createAccount({
    client: zeroXKeyClient.apiClient(),
    organizationId: process.env.ZEROXKEY_ORGANIZATION_ID!,
    signWith: process.env.SIGN_WITH!,
  });

  const client = createWalletClient({
    account: zeroXKeyAccount as Account,
    chain: base,
    transport: http(
      `https://base-mainnet.infura.io/v3/${process.env.INFURA_API_KEY!}`,
    ),
  });

  const publicClient = createPublicClient({
    transport: http(
      `https://base-mainnet.infura.io/v3/${process.env.INFURA_API_KEY!}`,
    ),
    chain: base,
  });

  // withdraw
  const withdrawAbi = parseAbi([
    "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares)",
  ]);
  const { request: withdrawReq } = await publicClient.simulateContract({
    abi: withdrawAbi,
    address: MORPHO_VAULT_ADDRESS as `0x${string}`,
    functionName: "withdraw",
    args: [
      parseUnits("0.1", 6),
      (zeroXKeyAccount as Account).address,
      (zeroXKeyAccount as Account).address,
    ],
    account: zeroXKeyAccount as Account,
  });
  const withdrawHash = await client.writeContract(withdrawReq);

  console.log(
    "Withdraw transaction:",
    `https://basescan.org/tx/${withdrawHash}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
