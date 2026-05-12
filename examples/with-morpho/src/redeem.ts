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
} from "viem";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const MORPHO_VAULT_ADDRESS = "0xbeeF010f9cb27031ad51e3333f9aF9C6B1228183";

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

  // Fetch user shares balance
  const balanceAbi = parseAbi([
    "function balanceOf(address account) external view returns (uint256)",
  ]);

  const rawBalance = await publicClient.readContract({
    address: MORPHO_VAULT_ADDRESS as `0x${string}`,
    abi: balanceAbi,
    functionName: "balanceOf",
    args: [zeroXKeyAccount.address],
  });

  // Redeem all user shares
  const redeemAbi = parseAbi([
    "function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets)",
  ]);
  const { request: redeemReq } = await publicClient.simulateContract({
    abi: redeemAbi,
    address: MORPHO_VAULT_ADDRESS as `0x${string}`,
    functionName: "redeem",
    args: [
      rawBalance,
      (zeroXKeyAccount as Account).address,
      (zeroXKeyAccount as Account).address,
    ],
    account: zeroXKeyAccount as Account,
  });
  const redeemHash = await client.writeContract(redeemReq);

  console.log("redeem tx:", `https://basescan.org/tx/${redeemHash}`);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
