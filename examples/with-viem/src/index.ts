import * as path from "path";
import * as dotenv from "dotenv";
import prompts, { PromptType } from "prompts";
import {
  createWalletClient,
  http,
  recoverMessageAddress,
  type Account,
} from "viem";
import { sepolia } from "viem/chains";

import {
  TERMINAL_ACTIVITY_STATUSES,
  getSignatureFromActivity,
  getSignedTransactionFromActivity,
  type TActivity,
} from "@0xkey-io/http";
import {
  createAccount,
  isZeroXKeyActivityConsensusNeededError,
  serializeSignature,
} from "@0xkey-io/viem";
import { ZeroXKey as ZeroXKeyServerSDK } from "@0xkey-io/sdk-server";
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

  const zeroXKeyClient = new ZeroXKeyServerSDK({
    apiBaseUrl: process.env.BASE_URL!,
    apiPrivateKey: process.env.API_PRIVATE_KEY!,
    apiPublicKey: process.env.API_PUBLIC_KEY!,
    defaultOrganizationId: process.env.ORGANIZATION_ID!,
    // The following config is useful in contexts where an activity requires consensus.
    // By default, if the activity is not initially successful, it will poll a maximum
    // of 3 times with an interval of 10000 milliseconds.
    //
    // -----
    //
    // activityPoller: {
    //   intervalMs: 10_000,
    //   numRetries: 5,
    // },
  });

  const zeroXKeyAccount = await createAccount({
    client: zeroXKeyClient.apiClient(),
    organizationId: process.env.ORGANIZATION_ID!,
    signWith: process.env.SIGN_WITH!,
  });

  // If you would like to create a Viem account synchronously,
  // import `createAccountWithAddress` and provide an Ethereum address as well
  //
  // -----
  //
  // const 0xkeyAccount = createAccountWithAddress({
  //   client: 0xkeyClient.apiClient(),
  //   organizationId: process.env.ORGANIZATION_ID!,
  //   signWith: process.env.SIGN_WITH!,
  //   ethereumAddress: process.env.ETHEREUM_ADDRESS!,
  // });

  const client = createWalletClient({
    account: zeroXKeyAccount as Account,
    chain: sepolia,
    transport: http(
      `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY!}`,
    ),
  });

  // 1. Sign a simple message
  const { message } = await prompts([
    {
      type: "text" as PromptType,
      name: "message",
      message: "Message to sign",
      initial: "Hello ZeroXKey",
    },
  ]);
  const address = client.account.address;

  let signature;
  try {
    signature = await client.signMessage({
      message,
    });
  } catch (error: any) {
    signature = await handleActivityError(error).then(
      async (activity?: TActivity) => {
        if (!activity) {
          throw error;
        }

        return serializeSignature(getSignatureFromActivity(activity));
      },
    );
  }

  const recoveredAddress = await recoverMessageAddress({
    message,
    signature,
  });

  print("ZeroXKey-powered signature:", `${signature}`);
  print("Recovered address:", `${recoveredAddress}`);
  assertEqual(address, recoveredAddress);

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

  // 2. Simple send tx
  const transactionRequest = {
    to: destination as `0x${string}`,
    value: amount,
  };

  let txHash;
  try {
    txHash = await client.sendTransaction(transactionRequest);
  } catch (error: any) {
    txHash = await handleActivityError(error).then(
      async (activity?: TActivity) => {
        if (!activity) {
          throw error;
        }

        return await client.sendRawTransaction({
          serializedTransaction: getSignedTransactionFromActivity(
            activity,
          ) as `0x${string}`,
        });
      },
    );
  }

  print("Source address", client.account.address);
  print("Transaction sent", `https://sepolia.etherscan.io/tx/${txHash}`);

  async function handleActivityError(error: any) {
    if (isZeroXKeyActivityConsensusNeededError(error)) {
      // ZeroXKey-specific error details may be wrapped by higher level errors
      const activityId = error["activityId"] || error["cause"]["activityId"];
      let activityStatus =
        error["activityStatus"] || error["cause"]["activityId"];
      let activity: TActivity | undefined;

      while (!TERMINAL_ACTIVITY_STATUSES.includes(activityStatus)) {
        console.log("\nWaiting for consensus...\n");

        const { retry } = await prompts([
          {
            type: "text" as PromptType,
            name: "retry",
            message: "Consensus reached? y/n",
            initial: "y",
          },
        ]);

        if (retry === "n") {
          continue;
        }

        // Refresh activity status
        activity = (
          await zeroXKeyClient.apiClient().getActivity({
            activityId,
            organizationId: process.env.ORGANIZATION_ID!,
          })
        ).activity;
        activityStatus = activity.status;
      }

      console.log("\nConsensus reached! Moving on...\n");

      return activity;
    }

    // Rethrow error
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
