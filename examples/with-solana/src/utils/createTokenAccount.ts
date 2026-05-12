import { PublicKey, Transaction, Keypair, Connection } from "@solana/web3.js";
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import type { ZeroXKeySigner } from "@0xkey-io/solana";

import { solanaNetwork } from ".";

export async function createTokenAccount(
  zeroXKeySigner: ZeroXKeySigner,
  connection: Connection,
  solAddress: string,
  ata: PublicKey,
  owner: PublicKey,
  mintAuthority: Keypair,
): Promise<any> {
  const fromKey = new PublicKey(solAddress);

  // For example recipient
  const createTokenAccountTx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      fromKey, // payer
      ata, // ata
      owner, // owner
      mintAuthority.publicKey, // mint
    ),
  );

  // Get a recent block hash
  createTokenAccountTx.recentBlockhash =
    await solanaNetwork.recentBlockhash(connection);
  // Set the signer
  createTokenAccountTx.feePayer = fromKey;

  await zeroXKeySigner.addSignature(createTokenAccountTx, solAddress);

  console.log("Broadcasting token account creation transaction...");

  await solanaNetwork.broadcast(connection, createTokenAccountTx);
}
