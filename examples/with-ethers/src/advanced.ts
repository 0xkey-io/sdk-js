import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKeySigner } from "@0xkey-io/ethers";
import { ethers } from "ethers";
import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import { createNewWallet } from "./createNewWallet";

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

  // Initialize a ZeroXKey Signer
  const zeroXKeySigner = new ZeroXKeySigner({
    client: zeroXKeyClient,
    organizationId: process.env.ORGANIZATION_ID!,
    signWith: process.env.SIGN_WITH!,
  });

  // Bring your own provider (such as Alchemy or Infura: https://docs.ethers.org/v6/api/providers/)
  const network = "goerli";
  const provider = new ethers.InfuraProvider(network);
  const connectedSigner = zeroXKeySigner.connect(provider);
  const address = await connectedSigner.getAddress();

  print("Address:", address);

  const baseMessage = "Hello ZeroXKey";

  // 1. Sign a raw hex message
  const hexMessage = ethers.hexlify(ethers.toUtf8Bytes(baseMessage));
  let signature = await connectedSigner.signMessage(hexMessage);
  let recoveredAddress = ethers.verifyMessage(hexMessage, signature);

  print("ZeroXKey-powered signature - raw hex message:", `${signature}`);
  assertEqual(recoveredAddress, address);

  // 2. Sign a raw bytes message
  const bytesMessage = ethers.toUtf8Bytes(baseMessage);
  signature = await connectedSigner.signMessage(bytesMessage);
  recoveredAddress = ethers.verifyMessage(bytesMessage, signature);

  print("ZeroXKey-powered signature - raw bytes message:", `${signature}`);
  assertEqual(recoveredAddress, address);

  // 3. Sign typed data (EIP-712)
  const typedData = {
    types: {
      // Note that we do not need to include `EIP712Domain` as a type here, as Ethers will automatically inject it for us
      Person: [
        { name: "name", type: "string" },
        { name: "wallet", type: "address" },
      ],
    },
    domain: {
      name: "EIP712 Test",
      version: "1",
    },
    primaryType: "Person",
    message: {
      name: "Alice",
      wallet: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
    },
  };

  signature = await connectedSigner.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.message,
  );

  recoveredAddress = ethers.verifyTypedData(
    typedData.domain,
    typedData.types,
    typedData.message,
    signature,
  );

  print("ZeroXKey-powered signature - typed data (EIP-712):", `${signature}`);
  assertEqual(recoveredAddress, address);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function print(header: string, body: string): void {
  console.log(`${header}\n\t${body}\n`);
}

function assertEqual<T>(left: T, right: T) {
  if (left !== right) {
    throw new Error(`${JSON.stringify(left)} !== ${JSON.stringify(right)}`);
  }
}
