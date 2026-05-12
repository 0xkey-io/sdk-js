import * as path from "path";
import * as dotenv from "dotenv";

import { createAccount } from "@0xkey-io/viem";
import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import {
  createWalletClient,
  http,
  recoverMessageAddress,
  recoverTypedDataAddress,
  stringToHex,
  hexToBytes,
  type Account,
} from "viem";
import { sepolia } from "viem/chains";
import { print, assertEqual } from "./util";
import { createNewWallet } from "./createNewWallet";

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

  const baseMessage = "Hello ZeroXKey";

  // 1. Sign a raw hex message
  const hexMessage = { raw: stringToHex(baseMessage) };
  let signature = await client.signMessage({
    message: hexMessage,
  });
  let recoveredAddress = await recoverMessageAddress({
    message: hexMessage,
    signature,
  });

  print("ZeroXKey-powered signature - raw hex message:", `${signature}`);
  assertEqual(address, recoveredAddress);

  // 2. Sign a raw bytes message
  const bytesMessage = { raw: hexToBytes(stringToHex(baseMessage)) };
  signature = await client.signMessage({
    message: bytesMessage,
  });
  recoveredAddress = await recoverMessageAddress({
    message: bytesMessage,
    signature,
  });

  print("ZeroXKey-powered signature - raw bytes message:", `${signature}`);
  assertEqual(address, recoveredAddress);

  // 3. Sign typed data (EIP-712)
  const domain = {
    name: "Ether Mail",
    version: "1",
    chainId: 1,
    verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
  } as const;

  // The named list of all type definitions
  const types = {
    Person: [
      { name: "name", type: "string" },
      { name: "wallet", type: "address" },
    ],
    Mail: [
      { name: "from", type: "Person" },
      { name: "to", type: "Person" },
      { name: "contents", type: "string" },
    ],
  } as const;

  const typedData = {
    account: zeroXKeyAccount as Account,
    domain,
    types,
    primaryType: "Mail",
    message: {
      from: {
        name: "Cow",
        wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826",
      },
      to: {
        name: "Bob",
        wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
      },
      contents: "Hello, Bob!",
    },
  } as const;

  signature = await client.signTypedData(typedData);
  recoveredAddress = await recoverTypedDataAddress({
    ...typedData,
    signature,
  });

  print("ZeroXKey-powered signature - typed data (EIP-712):", `${signature}`);
  assertEqual(address, recoveredAddress);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
