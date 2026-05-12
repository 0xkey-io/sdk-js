import * as path from "path";
import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { ZeroXKeySigner } from "@0xkey-io/ethers";
import { ZeroXKey as ZeroXKeyServerSDK } from "@0xkey-io/sdk-server";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  // Initialize the ZeroXKey client
  const zeroXKeyClient = new ZeroXKeyServerSDK({
    apiBaseUrl: "https://api.0xkey.com",
    apiPublicKey: process.env.NONROOT_API_PUBLIC_KEY!,
    apiPrivateKey: process.env.NONROOT_API_PRIVATE_KEY!,
    defaultOrganizationId: process.env.ZEROXKEY_ORGANIZATION_ID!,
  });

  // Initialize the ZeroXKey Signer
  const zeroXKeySigner = new ZeroXKeySigner({
    client: zeroXKeyClient.apiClient(),
    organizationId: process.env.ZEROXKEY_ORGANIZATION_ID!,
    signWith: process.env.SIGN_WITH!,
  });

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL!);
  const connectedSigner = zeroXKeySigner.connect(provider);
  const exitPayload = {
    yieldId: process.env.YIELD_ID,
    address: process.env.SIGN_WITH!,
    arguments: { amount: "0.1" },
  };
  // Prepare withdrawal via Yield.xyz
  const exitRes = await fetch("https://api.yield.xyz/v1/actions/exit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.YIELD_API_KEY!,
    },
    body: JSON.stringify(exitPayload),
  });
  const exitAction = await exitRes.json();
  console.log("Yield API response:", JSON.stringify(exitAction, null, 2));

  for (const tx of exitAction.transactions) {
    const unsignedTx = JSON.parse(tx.unsignedTransaction);
    const sent = await connectedSigner.sendTransaction({
      to: unsignedTx.to,
      data: unsignedTx.data,
      value: unsignedTx.value ?? "0x0",
      chainId: unsignedTx.chainId,
    });
    console.log("Withdraw tx:", sent.hash);
  }
}

main().catch((err) => {
  console.error("Error running Yield withdraw example:", err);
  process.exit(1);
});
