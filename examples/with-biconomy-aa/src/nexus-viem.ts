import * as path from "path";
import * as dotenv from "dotenv";
import prompts, { PromptType } from "prompts";
import {
  createWalletClient,
  createPublicClient,
  http,
  type Account,
  formatEther,
} from "viem";
import { baseSepolia } from "viem/chains";
import { createNexusClient, createBicoPaymasterClient } from "@biconomy/sdk";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { createAccount } from "@0xkey-io/viem";
import { ZeroXKey as ZeroXKeyServerSDK } from "@0xkey-io/sdk-server";
import { createNewWallet } from "./createNewWallet";
import { print } from "./util";

async function main() {
  if (!process.env.SIGN_WITH) {
    // If you don't specify a `SIGN_WITH`, we'll create a new wallet for you via calling the ZeroXKey API.
    await createNewWallet();
    return;
  }

  const zeroXKeyClient = new ZeroXKeyServerSDK({
    apiBaseUrl: process.env.BASE_URL!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
  });

  // Initialize a ZeroXKey-powered Viem Account
  const zeroXKeyAccount = await createAccount({
    client: zeroXKeyClient.apiClient(),
    organizationId: process.env.ORGANIZATION_ID!,
    signWith: process.env.SIGN_WITH!,
  });

  // Network must be base-sepolia at the moment
  const network = "base-sepolia";
  const bundlerUrl = process.env.BICONOMY_BUNDLER_URL!;
  const paymasterUrl = process.env.BICONOMY_PAYMASTER_URL!;
  const providerUrl = `https://${network}.infura.io/v3/${process.env
    .INFURA_KEY!}`;

  // Bring your own provider
  const client = createWalletClient({
    account: zeroXKeyAccount as Account,
    chain: baseSepolia,
    transport: http(providerUrl),
  });

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(providerUrl),
  });

  const nexusClient = await createNexusClient({
    signer: zeroXKeyAccount,
    chain: baseSepolia,
    transport: http(),
    bundlerTransport: http(bundlerUrl),
    paymaster: createBicoPaymasterClient({
      paymasterUrl,
    }),
  });

  const smartAccount = nexusClient.account;
  const smartAccountAddress = nexusClient.account.address;
  const signerAddress = client.account.address; // signer
  const chainId = client.chain.id;
  const transactionCount = await publicClient.getTransactionCount({
    address: smartAccountAddress,
  });
  const nonce = await smartAccount.getNonce();
  let balance =
    (await publicClient.getBalance({ address: smartAccountAddress })) ?? 0;

  print("Network:", `${network} (chain ID ${chainId})`);
  print("Signer address:", signerAddress);
  print("Smart wallet address:", smartAccountAddress);
  print("Balance:", `${formatEther(balance)} Ether`);
  print("Transaction count:", `${transactionCount}`);
  print("Nonce:", `${nonce}`);

  while (balance === 0n) {
    console.log(
      [
        `\n💸 Your onchain balance is at 0! To continue this demo you'll need testnet funds! You can use:`,
        `- Any online faucet (e.g. https://www.alchemy.com/faucets/)`,
        `\nTo check your balance: https://${network}.etherscan.io/address/${smartAccountAddress}`,
        `\n--------`,
      ].join("\n"),
    );

    const { continue: _ } = await prompts([
      {
        type: "text" as PromptType,
        name: "continue",
        message: "Ready to continue? y/n",
        initial: "y",
      },
    ]);

    balance = await publicClient.getBalance({
      address: smartAccountAddress,
    })!;
  }

  const { amount, destination } = await prompts([
    {
      type: "number" as PromptType,
      name: "amount",
      message: "Amount to send (wei). Default to 0.0000001 ETH",
      initial: 100000000000,
    },
    {
      type: "text" as PromptType,
      name: "destination",
      message: "Destination address (default to 0xkey example recipient)",
      initial: "0x08d2b0a37F869FF76BACB5Bab3278E26ab7067B7",
    },
  ]);
  const transactionRequest = {
    to: destination,
    value: amount,
    type: 2,
  };

  const hash = await nexusClient.sendTransaction({
    calls: [
      {
        to: destination,
        value: amount,
      },
    ],
  });
  const { transactionHash } = await nexusClient.waitForTransactionReceipt({
    hash,
  });

  print(
    `Sent ${formatEther(transactionRequest.value)} Ether to ${
      transactionRequest.to
    }:`,
    `https://sepolia.basescan.org/tx/${transactionHash}`,
  );

  print(
    `User Ops can be found here:`,
    `https://v2.jiffyscan.xyz/tx/${transactionHash}?network=${network}&pageNo=0&pageSize=10`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
