import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables from `.env.local`
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import prompts from "prompts";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";

import { ZeroXKey } from "@0xkey-io/sdk-server";
import { ZeroXKeySigner } from "@0xkey-io/solana";

import {
  createMint,
  createNewSolanaWallet,
  createToken,
  createTokenAccount,
  createTokenTransferAddSignature,
  solanaNetwork,
  ZEROXKEY_EXAMPLE_RECIPIENT,
} from "./utils";

async function main() {
  const zeroXKeyExampleRecipient = new PublicKey(ZEROXKEY_EXAMPLE_RECIPIENT);
  const organizationId = process.env.ORGANIZATION_ID!;
  const connection = solanaNetwork.connect();

  const zeroXKeyClient = new ZeroXKey({
    apiBaseUrl: process.env.BASE_URL!,
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    defaultOrganizationId: organizationId,
  });

  const zeroXKeySigner = new ZeroXKeySigner({
    organizationId,
    client: zeroXKeyClient.apiClient(),
  });

  let solAddress = process.env.SOLANA_ADDRESS!;
  if (!solAddress) {
    solAddress = await createNewSolanaWallet(zeroXKeyClient.apiClient());
    console.log(`\nYour new Solana address: "${solAddress}"`);
  } else {
    console.log(`\nUsing existing Solana address from ENV: "${solAddress}"`);
  }

  const fromKey = new PublicKey(solAddress);

  let balance = await solanaNetwork.balance(connection, solAddress);
  while (balance === 0) {
    console.log(
      [
        `\n💸 Your onchain balance is at 0! To continue this demo you'll need devnet funds! You can use:`,
        `- The faucet in this example: \`pnpm run faucet\``,
        `- The official Solana CLI: \`solana airdrop 1 ${solAddress}\``,
        `- Any online faucet (e.g. https://faucet.solana.com/)`,
        `\nTo check your balance: https://explorer.solana.com/address/${solAddress}?cluster=devnet`,
        `\n--------`,
      ].join("\n"),
    );
    // Await user confirmation to continue
    await prompts([
      {
        type: "confirm",
        name: "ready",
        message: "Ready to Continue?",
      },
    ]);

    // refresh balance...
    balance = await solanaNetwork.balance(connection, solAddress);
  }

  // Create SPL token
  const { mintAuthority } = await createToken(
    zeroXKeySigner,
    connection,
    solAddress,
  );

  // Create token accounts
  const ataPrimary = await getAssociatedTokenAddress(
    mintAuthority.publicKey, // mint
    fromKey, // owner
  );

  const ataExampleRecipient = await getAssociatedTokenAddress(
    mintAuthority.publicKey, // mint
    zeroXKeyExampleRecipient, // owner
  );

  // For example recipient
  await createTokenAccount(
    zeroXKeySigner,
    connection,
    solAddress,
    ataExampleRecipient,
    zeroXKeyExampleRecipient,
    mintAuthority,
  );

  const tokenAccountExampleRecipient = await getAccount(
    connection,
    ataExampleRecipient,
  );

  // For self
  await createTokenAccount(
    zeroXKeySigner,
    connection,
    solAddress,
    ataPrimary,
    fromKey,
    mintAuthority,
  );

  const tokenAccount = await getAccount(connection, ataPrimary);

  // Mint token
  await createMint(
    zeroXKeySigner,
    connection,
    solAddress,
    tokenAccount.address,
    mintAuthority.publicKey,
  );

  // Transfer token from primary to example recipient
  await createTokenTransferAddSignature(
    zeroXKeySigner,
    connection,
    solAddress,
    tokenAccount.address,
    mintAuthority.publicKey,
    tokenAccountExampleRecipient.address,
  );

  const tokenBalance = await connection.getTokenAccountBalance(ataPrimary);
  console.log("Token balance for user:", tokenBalance.value.uiAmountString);

  const tokenBalanceExampleRecipient =
    await connection.getTokenAccountBalance(ataExampleRecipient);
  console.log(
    "Token balance for example recipient:",
    tokenBalanceExampleRecipient.value.uiAmountString,
  );

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
