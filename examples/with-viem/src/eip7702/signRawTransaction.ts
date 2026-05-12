import { resolve } from "path";
import * as dotenv from "dotenv";

import {
  SignedAuthorization,
  createWalletClient,
  http,
  serializeTransaction,
} from "viem";
import {
  KERNEL_V3_3,
  KernelVersionToAddressesMap,
} from "@zerodev/sdk/constants";
import { sepolia } from "viem/chains";

import { createAccount } from "@0xkey-io/viem";
import { ZeroXKey as ZeroXKeyServerSDK } from "@0xkey-io/sdk-server";

import { print } from "../util";

// Load environment variables from `.env.local`
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

const kernelVersion = KERNEL_V3_3;

// We use the Sepolia testnet here, but you can use any network that
// supports EIP-7702.
const chain = sepolia;

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

const main = async () => {
  const zeroXKeyAccount = await createAccount({
    client: zeroXKeyClient.apiClient(),
    organizationId: process.env.ORGANIZATION_ID!,
    signWith: process.env.SIGN_WITH!,
  });

  const walletClient = createWalletClient({
    account: zeroXKeyAccount,
    chain,
    transport: http(),
  });

  const authorization = await walletClient.signAuthorization({
    contractAddress:
      KernelVersionToAddressesMap[kernelVersion].accountImplementationAddress,
    account: zeroXKeyAccount,
  });

  // Prepare the transaction first
  const request = (await walletClient.prepareTransactionRequest({
    from: "0x0000000000000000000000000000000000000000",
    gas: BigInt(200000),
    authorizationList: [authorization as SignedAuthorization],
    to: "0x0000000000000000000000000000000000000000",
    type: "eip7702",
    account: zeroXKeyAccount,
  })) as any;

  // Get the serialized unsigned transaction
  const serializedUnsignedTx = serializeTransaction(request);

  const { r, s, v } = await zeroXKeyClient.apiClient().signRawPayload({
    signWith: process.env.SIGN_WITH!,
    payload: serializedUnsignedTx,
    encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
    hashFunction: "HASH_FUNCTION_KECCAK256",
  });

  const serializedTx = serializeTransaction(request, {
    r: r as `0x${string}`,
    s: s as `0x${string}`,
    v: BigInt(v),
  });

  const txHash = await walletClient.sendRawTransaction({
    serializedTransaction: serializedTx,
  });

  print("Transaction sent", `https://sepolia.etherscan.io/tx/${txHash}`);
};

main();
