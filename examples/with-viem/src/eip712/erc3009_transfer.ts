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
    name: "USD Coin", // ERC-20 token name
    version: "2", // USDC v2 implements EIP-3009 & EIP-2612
    chainId: 1, // Ethereum Mainnet
    verifyingContract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  } as const;

  // The named list of all type definitions
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } as const;

  const payload = {
    account: zeroXKeyAccount as Account,
    domain,
    types,
    primaryType: "TransferWithAuthorization",
    message: {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: 5000n, // amount of tokens
      validAfter: 0n, // immediately valid
      validBefore: 1992689033n, // expires at this UNIX timestamp
      nonce:
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
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
