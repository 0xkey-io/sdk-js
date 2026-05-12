import * as path from "path";
import * as dotenv from "dotenv";
import { base } from "viem/chains";
import {
  parseAbi,
  formatUnits,
  createWalletClient,
  http,
  createPublicClient,
  type Account,
} from "viem";
import { createAccount } from "@0xkey-io/viem";
import { ZeroXKey as ZeroXKeyServerSDK } from "@0xkey-io/sdk-server";
import { AaveV3Base } from "@bgd-labs/aave-address-book";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const zeroXKeyClient = new ZeroXKeyServerSDK({
    apiBaseUrl: process.env.ZEROXKEY_BASE_URL!,
    apiPrivateKey: process.env.ZEROXKEY_API_PRIVATE_KEY!,
    apiPublicKey: process.env.ZEROXKEY_API_PUBLIC_KEY!,
    defaultOrganizationId: process.env.ZEROXKEY_ORGANIZATION_ID!,
  });

  const zeroXKeyAccount = await createAccount({
    client: zeroXKeyClient.apiClient(),
    organizationId: process.env.ZEROXKEY_ORGANIZATION_ID!,
    signWith: process.env.SIGN_WITH!,
  });

  const walletClient = createWalletClient({
    account: zeroXKeyAccount as Account,
    chain: base,
    transport: http(
      `https://base-mainnet.infura.io/v3/${process.env.INFURA_API_KEY!}`,
    ),
  });

  const publicClient = createPublicClient({
    chain: base,
    transport: http(
      `https://base-mainnet.infura.io/v3/${process.env.INFURA_API_KEY!}`,
    ),
  });

  // Pull aUSDC address from Aave Address Book (Base)
  const aUSDC = AaveV3Base.ASSETS.USDC.A_TOKEN;

  // Read aUSDC balance which tracks your supplied principal + interest
  const erc20ReadAbi = parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ]);

  const [decimals, rawBal] = await Promise.all([
    publicClient.readContract({
      address: aUSDC as `0x${string}`,
      abi: erc20ReadAbi,
      functionName: "decimals",
    }),
    publicClient.readContract({
      address: aUSDC as `0x${string}`,
      abi: erc20ReadAbi,
      functionName: "balanceOf",
      args: [(walletClient.account as Account).address],
    }),
  ]);

  console.log("aUSDC balance:", formatUnits(rawBal, Number(decimals)));
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
