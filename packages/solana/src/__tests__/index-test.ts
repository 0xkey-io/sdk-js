import { test, expect, describe } from "@jest/globals";
import { ZeroXKeySigner } from "../";
import { ZeroXKeyClient } from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import { ZeroXKey } from "@0xkey-io/sdk-server";
import {
  PublicKey,
  SIGNATURE_LENGTH_IN_BYTES,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { bs58 } from "@0xkey-io/encoding";

const DEFAULT_BLOCK_HASH = "GZSq3KvoFVhE22CQsaWSAxBoAvRiZSs7xVNa6yPecMUu";
const ZEROXKEY_EXAMPLE_RECIPIENT = "11111111111111111111111111111111";
const DEFAULT_SIGNATURE = new Uint8Array(SIGNATURE_LENGTH_IN_BYTES);

describe("ZeroXKeySigner", () => {
  if (!process.env.SOLANA_TEST_ORG_API_PRIVATE_KEY) {
    // These tests requires an env var to be set
    throw new Error(
      "These tests require SOLANA_TEST_ORG_API_PRIVATE_KEY to be set",
    );
  }

  const organizationId = "4456e4c2-e8b5-4b93-a0cf-1dfae265c12c";
  const apiPublicKey =
    "025d374c674fc389c761462f3c59c0acabdcb3a17c599d9e62e5fe78fe984cfbeb";
  const zeroXKeySolAddress = "D8P541wwnertZTgDT14kYJPoFT2eHUFqjTgPxMK5qatM";

  const zeroXKeyBaseClient = new ZeroXKeyClient(
    { baseUrl: "https://api.0xkey.com" },
    new ApiKeyStamper({
      apiPublicKey,
      apiPrivateKey: process.env.SOLANA_TEST_ORG_API_PRIVATE_KEY,
    }),
  );

  const zeroXKeyServerClient = new ZeroXKey({
    apiBaseUrl: "https://api.0xkey.com",
    apiPublicKey,
    apiPrivateKey: process.env.SOLANA_TEST_ORG_API_PRIVATE_KEY,
    defaultOrganizationId: organizationId,
  });

  [
    {
      configName: "Base HTTP ZeroXKey client",
      signer: new ZeroXKeySigner({
        organizationId,
        client: zeroXKeyBaseClient,
      }),
    },
    {
      configName: "@0xkey-io/sdk-server client",
      signer: new ZeroXKeySigner({
        organizationId,
        client: zeroXKeyServerClient.apiClient(),
      }),
    },
  ].forEach(async (signerConfig) => {
    describe(`using ${signerConfig.configName}`, () => {
      test("can sign a Solana transfer against production", async () => {
        const transferTransaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: new PublicKey(zeroXKeySolAddress),
            // Destination doesn't matter, we set it to the 0xkey example recipient!
            toPubkey: new PublicKey(ZEROXKEY_EXAMPLE_RECIPIENT),
            lamports: 10000,
          }),
        );

        // Doesn't really matter since we're not going to broadcast this transaction!
        // But if we don't set this the call to "serializeMessage fails."
        transferTransaction.recentBlockhash = DEFAULT_BLOCK_HASH;
        transferTransaction.feePayer = new PublicKey(zeroXKeySolAddress);

        expect(transferTransaction.signatures.length).toBe(0);
        await signerConfig.signer.addSignature(
          transferTransaction,
          zeroXKeySolAddress,
        );
        expect(transferTransaction.signatures.length).toBe(1);

        const isValidSignature = nacl.sign.detached.verify(
          transferTransaction.serializeMessage(),
          transferTransaction.signature as Uint8Array,
          bs58.decode(zeroXKeySolAddress),
        );
        expect(isValidSignature).toBeTruthy();
      });

      test("can sign a versioned Solana transfer against production", async () => {
        const fromKey = new PublicKey(zeroXKeySolAddress);

        const instructions = [
          SystemProgram.transfer({
            fromPubkey: fromKey,
            // Destination doesn't matter, we set it to the 0xkey example recipient!
            toPubkey: new PublicKey(ZEROXKEY_EXAMPLE_RECIPIENT),
            lamports: 10,
          }),
        ];

        // create v0 compatible message
        const messageV0 = new TransactionMessage({
          payerKey: fromKey,
          // Doesn't really matter since we're not going to broadcast this transaction!
          recentBlockhash: DEFAULT_BLOCK_HASH,
          instructions,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);

        // version transactions are initialized with a default signature
        expect(transaction.signatures.length).toBe(1);
        expect(transaction.signatures[0]).toEqual(DEFAULT_SIGNATURE);

        await signerConfig.signer.addSignature(transaction, zeroXKeySolAddress);

        // after signing the version transaction, the default signature is replaced with the new one
        expect(transaction.signatures.length).toBe(1);
        expect(transaction.signatures[0]).not.toEqual(DEFAULT_SIGNATURE);

        const isValidSignature = nacl.sign.detached.verify(
          transaction.message.serialize(),
          transaction.signatures[0] as Uint8Array,
          bs58.decode(zeroXKeySolAddress),
        );
        expect(isValidSignature).toBeTruthy();
      });

      test("can sign multiple Solana transfers against production", async () => {
        const numTxs = 3;
        const transactions = new Array<Transaction>();
        const amounts = new Array<number>();

        for (let i = 0; i < numTxs; i++) {
          const amount = Math.floor(Math.random() * 100); // random amount
          amounts.push(amount);

          const transferTransaction = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: new PublicKey(zeroXKeySolAddress),
              // Destination doesn't matter, we set it to the 0xkey example recipient!
              toPubkey: new PublicKey(ZEROXKEY_EXAMPLE_RECIPIENT),
              lamports: amount,
            }),
          );

          expect(transferTransaction.signatures.length).toBe(0);

          // Doesn't really matter since we're not going to broadcast this transaction!
          // But if we don't set this the call to "serializeMessage fails."
          transferTransaction.recentBlockhash = DEFAULT_BLOCK_HASH;
          transferTransaction.feePayer = new PublicKey(zeroXKeySolAddress);

          transactions.push(transferTransaction);
        }

        const signedTransactions =
          await signerConfig.signer.signAllTransactions(
            transactions,
            zeroXKeySolAddress,
          );
        expect(signedTransactions.length).toBe(numTxs);

        for (let i = 0; i < signedTransactions.length; i++) {
          const tx = signedTransactions[i] as Transaction;

          // Verify the signature itself
          const isValidSignature = nacl.sign.detached.verify(
            tx.serializeMessage(),
            tx.signature as Uint8Array,
            bs58.decode(zeroXKeySolAddress),
          );
          expect(isValidSignature).toBeTruthy();

          // Ensure it's a simple, native transfer
          expect(tx.instructions.length).toEqual(1);

          const programId = tx.instructions[0]!.programId!;
          const data = tx.instructions[0]!.data!;

          expect(programId).toEqual(SystemProgram.programId);
          expect(data[0]).toEqual(2);

          // Convert raw data to lamports, then to whole SOL units
          const amountLamportsBigInt = Buffer.from(data).readBigUInt64LE(4);
          const amountLamports = Number(amountLamportsBigInt);

          expect(amounts[i]).toEqual(amountLamports);
        }
      });

      test("can sign multiple versioned Solana transfers against production", async () => {
        const fromKey = new PublicKey(zeroXKeySolAddress);
        const numTxs = 3;
        const transactions = new Array<VersionedTransaction>();
        const amounts = new Array<number>();

        for (let i = 0; i < numTxs; i++) {
          const amount = Math.floor(Math.random() * 100); // random amount
          amounts.push(amount);

          const instructions = [
            SystemProgram.transfer({
              fromPubkey: fromKey,
              // Destination doesn't matter, we set it to the 0xkey example recipient!
              toPubkey: new PublicKey(ZEROXKEY_EXAMPLE_RECIPIENT),
              lamports: amount,
            }),
          ];

          // Create v0 compatible message
          const messageV0 = new TransactionMessage({
            payerKey: fromKey,
            // Doesn't really matter since we're not going to broadcast this transaction!
            recentBlockhash: DEFAULT_BLOCK_HASH,
            instructions,
          }).compileToV0Message();

          const transaction = new VersionedTransaction(messageV0);

          // version transactions are initialized with a default signature
          expect(transaction.signatures.length).toBe(1);
          expect(transaction.signatures[0]).toEqual(DEFAULT_SIGNATURE);

          transactions.push(transaction);
        }

        const signedTransactions =
          await signerConfig.signer.signAllTransactions(
            transactions,
            zeroXKeySolAddress,
          );
        expect(signedTransactions.length).toBe(numTxs);

        for (let i = 0; i < signedTransactions.length; i++) {
          const tx = signedTransactions[i] as VersionedTransaction;

          // After signing the version transaction, the default signature is replaced with the new one
          expect(tx.signatures.length).toBe(1);
          expect(tx.signatures[0]).not.toEqual(DEFAULT_SIGNATURE);

          // Verify the signature itself
          const isValidSignature = nacl.sign.detached.verify(
            tx.message.serialize(),
            tx.signatures[0] as Uint8Array,
            bs58.decode(zeroXKeySolAddress),
          );
          expect(isValidSignature).toBeTruthy();

          // Ensure it's a simple, native transfer
          expect(tx.message.compiledInstructions.length).toEqual(1);

          const programIdIndex =
            tx.message.compiledInstructions[0]!.programIdIndex!;
          const keys = tx.message.getAccountKeys();
          const programId = keys.staticAccountKeys[programIdIndex];
          const data = tx.message.compiledInstructions[0]!.data!;

          expect(programId).toEqual(SystemProgram.programId);
          expect(data[0]).toEqual(2);

          // Convert raw data to lamports, then to whole SOL units
          const amountLamportsBigInt = Buffer.from(data).readBigUInt64LE(4);
          const amountLamports = Number(amountLamportsBigInt);

          expect(amounts[i]).toEqual(amountLamports);
        }
      });

      test("can sign a message with a Solana account", async () => {
        const message = "Hello world!";
        const messageAsUint8Array = Buffer.from(message);

        const signature = await signerConfig.signer.signMessage(
          messageAsUint8Array,
          zeroXKeySolAddress,
        );

        const isValidSignature = nacl.sign.detached.verify(
          messageAsUint8Array,
          signature,
          bs58.decode(zeroXKeySolAddress),
        );
        expect(isValidSignature).toBeTruthy();
      });
    });
  });
});
