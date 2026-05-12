import * as path from "path";
import * as dotenv from "dotenv";

import { createAccount } from "@0xkey-io/viem";
import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import {
  createWalletClient,
  http,
  recoverTypedDataAddress,
  type Account,
} from "viem";
import { sepolia } from "viem/chains";
import { print, assertEqual } from "../util";
import { createNewWallet } from "../createNewWallet";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  if (!process.env.SIGN_WITH) {
    // If you don't specify a `SIGN_WITH`, we'll create a new wallet for you via calling the ZeroXKey API.
    await createNewWallet();
    return;
  }

  const zeroXKeyClient = new ZeroXKeyClient(
    {
      baseUrl: process.env.BASE_URL!,
    },
    new ApiKeyStamper({
      apiPublicKey: process.env.API_PUBLIC_KEY!,
      apiPrivateKey: process.env.API_PRIVATE_KEY!,
    }),
  );

  const zeroXKeyAccount = await createAccount({
    client: zeroXKeyClient,
    organizationId: process.env.ORGANIZATION_ID!,
    signWith: process.env.SIGN_WITH!,
  });

  const client = createWalletClient({
    account: zeroXKeyAccount as Account,
    chain: sepolia,
    transport: http(
      `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY!}`,
    ),
  });

  const address = client.account.address;
  print("Address:", address);

  // 3. Sign typed data (EIP-712)
  const domain = {
    name: "HyperliquidSignTransaction",
    version: "1",
    chainId: 1,
    verifyingContract: "0x0000000000000000000000000000000000000000",
  } as const;

  // The named list of all type definitions
  const types = {
    "HyperliquidTransaction:ApproveAgent": [
      { name: "hyperliquidChain", type: "string" },
      { name: "agentAddress", type: "address" },
      { name: "agentName", type: "string" },
      { name: "nonce", type: "uint64" },
    ],
  } as const;

  const payload = {
    account: zeroXKeyAccount as Account,
    domain,
    types,
    primaryType: "HyperliquidTransaction:ApproveAgent",
    message: {
      hyperliquidChain: "Testnet",
      signatureChainId: "0x1",
      agentAddress: "0x279f28cbbf5bd83c568ff6b599420b473319c25f",
      agentName: "Mobile QR",
      nonce: 1751566432540n,
      type: "approveAgent",
    },
  } as const;

  let signature = await client.signTypedData(payload);
  let recoveredAddress = await recoverTypedDataAddress({
    ...payload,
    signature,
  });

  print("ZeroXKey-powered signature - typed data (EIP-712):", `${signature}`);
  assertEqual(address, recoveredAddress);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
