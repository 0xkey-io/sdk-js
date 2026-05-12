import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { ZeroXKeySigner } from "@0xkey-io/ethers";
import { ethers } from "ethers";
import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import { createNewWallet } from "../createNewWallet";
import { print, assertEqual } from "../util";

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
  const network = "sepolia";
  const provider = new ethers.InfuraProvider(network);
  const connectedSigner = zeroXKeySigner.connect(provider);
  const address = await connectedSigner.getAddress();

  print("Address:", address);

  // Sign an EIP-712 Payload for a Hyperliquid `ApproveAgent` operation
  const approveAgentPayload = {
    types: {
      "HyperliquidTransaction:ApproveAgent": [
        { name: "hyperliquidChain", type: "string" },
        { name: "agentAddress", type: "address" },
        { name: "agentName", type: "string" },
        { name: "nonce", type: "uint64" },
      ],
    },
    domain: {
      name: "HyperliquidSignTransaction",
      version: "1",
      chainId: 1,
      verifyingContract: "0x0000000000000000000000000000000000000000",
    },
    primaryType: "HyperliquidTransaction:ApproveAgent",
    message: {
      hyperliquidChain: "Testnet",
      signatureChainId: "0x1",
      agentAddress: "0x279f28cbbf5bd83c568ff6b599420b473319c25f",
      agentName: "Mobile QR",
      nonce: 1751566432540,
      type: "approveAgent",
    },
  };

  let signature = await connectedSigner.signTypedData(
    approveAgentPayload.domain,
    approveAgentPayload.types,
    approveAgentPayload.message,
  );

  let recoveredAddress = ethers.verifyTypedData(
    approveAgentPayload.domain,
    approveAgentPayload.types,
    approveAgentPayload.message,
    signature,
  );

  assertEqual(recoveredAddress, address);

  print(
    "ZeroXKey-powered signature - Hyperliquid Sign Transaction Payload:",
    `${signature}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
