import { PublicKey, Transaction, Connection } from "@solana/web3.js";
import { createTransferCheckedInstruction } from "@solana/spl-token";
import type { ZeroXKeySigner } from "@0xkey-io/solana";

import { solanaNetwork } from ".";

// This method creates, signs and broadcasts an SPL token transfer using ZeroXKey's Sign Raw Payload endpoint for signing
export async function createTokenTransferAddSignature(
  zeroXKeySigner: ZeroXKeySigner,
  connection: Connection,
  solAddress: string,
  tokenAccountPubkey: PublicKey,
  mintAuthority: PublicKey,
  ataRecipient: PublicKey,
): Promise<any> {
  const fromKey = new PublicKey(solAddress);

  let transferTx = new Transaction().add(
    createTransferCheckedInstruction(
      tokenAccountPubkey, // from (should be a token account)
      mintAuthority, // mint
      ataRecipient, // to (should be a token account)
      fromKey, // from's owner
      1e4, // amount, if your decimals is 8, send 10^8 for 1 token
      8, // decimals
    ),
  );

  // Get a recent block hash
  transferTx.recentBlockhash = await solanaNetwork.recentBlockhash(connection);
  // Set the signer
  transferTx.feePayer = fromKey;

  await zeroXKeySigner.addSignature(transferTx, solAddress);

  console.log("Broadcasting token transfer transaction...");

  await solanaNetwork.broadcast(connection, transferTx);
}

// This method creates, signs and broadcasts an SPL token transfer using ZeroXKey's Sign Transaction endpoint for signing
// Note: Sign Transaction passes the transaction through the policy engine, allowing Solana related policies to apply!
export async function createTokenTransferSignTransaction(
  zeroXKeySigner: ZeroXKeySigner,
  connection: Connection,
  solAddress: string,
  tokenAccountPubkey: PublicKey,
  mintAuthority: PublicKey,
  ataRecipient: PublicKey,
): Promise<any> {
  const transferTx = await constructTokenTransfer(
    connection,
    tokenAccountPubkey,
    mintAuthority,
    ataRecipient,
    solAddress,
  );

  // Use ZeroXKey's sign transaction endpoint that passes the created transaction through the policy engine
  let signedTx = await zeroXKeySigner.signTransaction(transferTx, solAddress);

  console.log("Broadcasting token transfer transaction...");

  await solanaNetwork.broadcast(connection, signedTx);
}

async function constructTokenTransfer(
  connection: Connection,
  tokenAccountPubkey: PublicKey,
  mintAuthority: PublicKey,
  ataRecipient: PublicKey,
  solAddress: string,
): Promise<Transaction> {
  const fromKey = new PublicKey(solAddress);

  let transferTx = new Transaction().add(
    createTransferCheckedInstruction(
      tokenAccountPubkey, // from (should be a token account)
      mintAuthority, // mint
      ataRecipient, // to (should be a token account)
      fromKey, // from's owner
      1e4, // amount, if your decimals is 8, send 10^8 for 1 token
      8, // decimals
    ),
  );

  // Get a recent block hash
  transferTx.recentBlockhash = await solanaNetwork.recentBlockhash(connection);
  // Set the signer
  transferTx.feePayer = fromKey;

  return transferTx;
}
