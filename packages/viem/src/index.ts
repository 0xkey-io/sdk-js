import {
  BaseError,
  hashMessage,
  isAddress,
  serializeTransaction,
  hexToBigInt,
  hexToBytes,
  parseTransaction,
  serializeTypedData,
} from "viem";
import {
  SignAuthorizationReturnType,
  toAccount,
  SignAuthorizationParameters,
} from "viem/accounts";
import type {
  Hex,
  LocalAccount,
  SerializeTransactionFn,
  SignableMessage,
  TransactionSerializable,
  TypedData,
} from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";

import {
  assertNonNull,
  assertActivityCompleted,
  isHttpClient,
  TActivityStatus,
  TActivityId,
  TSignature,
  ZeroXKeyActivityError as ZeroXKeyHttpActivityError,
  ZeroXKeyActivityConsensusNeededError as ZeroXKeyHttpActivityConsensusNeededError,
  ZeroXKeyClient,
  type ZeroXKeyApiTypes,
} from "@0xkey-io/http";
import { ApiKeyStamper } from "@0xkey-io/api-key-stamper";
import type { ZeroXKeyBrowserClient } from "@0xkey-io/sdk-browser";
import type { ZeroXKeySDKClientBase } from "@0xkey-io/core";
import type { ZeroXKeyServerClient } from "@0xkey-io/sdk-server";

export type TZeroXKeyConsensusNeededErrorType = ZeroXKeyConsensusNeededError & {
  name: "ZeroXKeyConsensusNeededError";
};

export type TZeroXKeyActivityErrorType = ZeroXKeyActivityError & {
  name: "ZeroXKeyActivityError";
};

type TSignAuthorizationParameters = Omit<
  SignAuthorizationParameters,
  "privateKey" // unnecessary as we are signing using ZeroXKey keys
>;

type TSignatureFormat = "object" | "bytes" | "hex";

type TPayloadEncoding = ZeroXKeyApiTypes["v1PayloadEncoding"];

type TTransactionType = ZeroXKeyApiTypes["v1TransactionType"];

type TEip712DomainType = { name: string; type: string };
type TSerializableTypedData = Parameters<typeof serializeTypedData>[0];

type TSignatureExtended = Omit<TSignature, "v"> & {
  v: string | BigInt;
};

type TSignMessageResult = Uint8Array | Hex | TSignatureExtended;

function domainTypeFor(domain: Record<string, unknown> | undefined): TEip712DomainType[] {
  if (!domain) return [];

  const fields: TEip712DomainType[] = [];
  if (domain.name !== undefined) fields.push({ name: "name", type: "string" });
  if (domain.version !== undefined) fields.push({ name: "version", type: "string" });
  if (domain.chainId !== undefined) fields.push({ name: "chainId", type: "uint256" });
  if (domain.verifyingContract !== undefined) {
    fields.push({ name: "verifyingContract", type: "address" });
  }
  if (domain.salt !== undefined) fields.push({ name: "salt", type: "bytes32" });
  return fields;
}

export function __serializeTypedDataForZeroXKey(
  data: TSerializableTypedData,
): string {
  const types = data.types as Record<string, unknown>;
  if (types.EIP712Domain !== undefined) {
    return serializeTypedData(data);
  }

  return serializeTypedData({
    ...data,
    types: {
      EIP712Domain: domainTypeFor(data.domain as Record<string, unknown> | undefined),
      ...types,
    },
  } as TSerializableTypedData);
}

/**
 * Detects the transaction type from a serialized transaction payload.
 * @param serializedTx - The hex-encoded transaction (without 0x prefix)
 * @returns The transaction type to use with ZeroXKey API
 */
function detectTransactionType(serializedTx: string): TTransactionType {
  // Check if the transaction starts with 0x76 (Tempo transaction)
  if (serializedTx.startsWith("76")) {
    return "TRANSACTION_TYPE_TEMPO" as TTransactionType;
  }

  // Default to Ethereum for all other transactions
  return "TRANSACTION_TYPE_ETHEREUM";
}

export class ZeroXKeyConsensusNeededError extends BaseError {
  override name = "ZeroXKeyConsensusNeededError";

  activityId: TActivityId | undefined;
  activityStatus: TActivityStatus | undefined;

  constructor({
    message = "ZeroXKey activity requires consensus.",
    activityId,
    activityStatus,
  }: {
    message?: string | undefined;
    activityId: TActivityId | undefined;
    activityStatus: TActivityStatus | undefined;
  }) {
    super(message);
    this.activityId = activityId;
    this.activityStatus = activityStatus;
  }
}

export class ZeroXKeyActivityError extends BaseError {
  override name = "ZeroXKeyActivityError";

  activityId: TActivityId | undefined;
  activityStatus: TActivityStatus | undefined;

  constructor({
    message = "Received unexpected ZeroXKey activity status.",
    activityId,
    activityStatus,
  }: {
    message?: string | undefined;
    activityId?: TActivityId | undefined;
    activityStatus?: TActivityStatus | undefined;
  }) {
    super(message);
    this.activityId = activityId;
    this.activityStatus = activityStatus;
  }
}

export function createAccountWithAddress(input: {
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase;
  organizationId: string;
  // This can be a wallet account address, private key address, or private key ID.
  signWith: string;
  // Ethereum address to use for this account, in the case that a private key ID is used to sign.
  // Can be left undefined if signWith is a wallet account address.
  ethereumAddress?: string;
}): LocalAccount {
  const { client, organizationId, signWith } = input;
  let { ethereumAddress } = input;

  if (!signWith) {
    throw new ZeroXKeyHttpActivityError({
      message: `Missing signWith parameter`,
    });
  }

  if (isAddress(signWith)) {
    // override provided `ethereumAddress`
    ethereumAddress = signWith;
  } else if (!ethereumAddress) {
    throw new ZeroXKeyActivityError({
      message: `Missing ethereumAddress parameter`,
    });
  }

  return toAccount({
    address: ethereumAddress as Hex,
    sign: function ({ hash }: { hash: Hex }): Promise<Hex> {
      return signMessage(client, hash, organizationId, signWith);
    },
    signMessage: function ({
      message,
    }: {
      message: SignableMessage;
    }): Promise<Hex> {
      const hashedMessage = hashMessage(message);
      return signMessage(client, hashedMessage, organizationId, signWith);
    },
    signTransaction: function <
      TTransactionSerializable extends TransactionSerializable,
    >(
      transaction: TTransactionSerializable,
      options?: {
        serializer?:
          | SerializeTransactionFn<TTransactionSerializable>
          | undefined;
      },
    ): Promise<Hex> {
      const serializer: SerializeTransactionFn<TTransactionSerializable> =
        options?.serializer ??
        (serializeTransaction as SerializeTransactionFn<TTransactionSerializable>);
      return signTransaction(
        client,
        transaction,
        serializer,
        organizationId,
        signWith,
      );
    },
    signTypedData: function (
      typedData: TypedData | { [key: string]: unknown },
    ): Promise<Hex> {
      return signTypedData(client, typedData, organizationId, signWith);
    },
    signAuthorization: function (
      parameters: TSignAuthorizationParameters,
    ): Promise<SignAuthorizationReturnType> {
      return signAuthorization(client, parameters, organizationId, signWith);
    },
  });
}

export async function createAccount(input: {
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase;
  organizationId: string;
  // This can be a wallet account address, private key address, or private key ID.
  signWith: string;
  // Ethereum address to use for this account, in the case that a private key ID is used to sign.
  // If left undefined, `createAccount` will fetch it from the ZeroXKey API.
  // We recommend setting this if you're using a passkey client, so that your users are not prompted for a passkey signature just to fetch their address.
  // You may leave this undefined if using an API key client.
  ethereumAddress?: string;
}): Promise<LocalAccount> {
  const { client, organizationId, signWith } = input;
  let { ethereumAddress } = input;

  if (!signWith) {
    throw new ZeroXKeyActivityError({
      message: `Missing signWith parameter`,
    });
  }

  if (isAddress(signWith)) {
    // override provided `ethereumAddress`
    ethereumAddress = signWith;
  } else if (!ethereumAddress) {
    // we have a private key ID, but not an ethereumAddress
    const data = await client.getPrivateKey({
      privateKeyId: signWith,
      organizationId: organizationId,
    });

    ethereumAddress = data.privateKey.addresses.find(
      (item: any) => item.format === "ADDRESS_FORMAT_ETHEREUM",
    )?.address;

    if (typeof ethereumAddress !== "string" || !ethereumAddress) {
      throw new ZeroXKeyActivityError({
        message: `Unable to find Ethereum address for key ${signWith} under organization ${organizationId}`,
      });
    }
  }

  return createAccountWithAddress({
    client,
    organizationId,
    signWith,
    ethereumAddress,
  });
}

/**
 * Type bundling configuration for an API Key Viem account creation
 * @deprecated this is used only with {@link createApiKeyAccount}, a deprecated API. See {@link createAccount}.
 */
type TApiKeyAccountConfig = {
  /**
   * ZeroXKey API public key
   */
  apiPublicKey: string;
  /**
   * ZeroXKey API private key
   */
  apiPrivateKey: string;
  /**
   * ZeroXKey API base URL
   */
  baseUrl: string;
  /**
   * ZeroXKey organization ID
   */
  organizationId: string;
  /**
   * ZeroXKey private key ID
   */
  privateKeyId: string;
};

/**
 * Creates a new Custom Account backed by a ZeroXKey API key.
 * @deprecated use {@link createAccount} instead.
 */
export async function createApiKeyAccount(
  config: TApiKeyAccountConfig,
): Promise<LocalAccount> {
  const { apiPublicKey, apiPrivateKey, baseUrl, organizationId, privateKeyId } =
    config;

  const stamper = new ApiKeyStamper({
    apiPublicKey: apiPublicKey,
    apiPrivateKey: apiPrivateKey,
  });

  const client = new ZeroXKeyClient(
    {
      baseUrl: baseUrl,
    },
    stamper,
  );

  const data = await client.getPrivateKey({
    privateKeyId: privateKeyId,
    organizationId: organizationId,
  });

  const ethereumAddress = data.privateKey.addresses.find(
    (item: any) => item.format === "ADDRESS_FORMAT_ETHEREUM",
  )?.address;

  if (typeof ethereumAddress !== "string" || !ethereumAddress) {
    throw new ZeroXKeyHttpActivityError({
      message: `Unable to find Ethereum address for key ${privateKeyId} under organization ${organizationId}`,
    });
  }

  return toAccount({
    address: ethereumAddress as Hex,
    sign: function ({ hash }: { hash: Hex }): Promise<Hex> {
      return signMessage(client, hash, organizationId, privateKeyId);
    },
    signMessage: function ({
      message,
    }: {
      message: SignableMessage;
    }): Promise<Hex> {
      const hashedMessage = hashMessage(message);
      return signMessage(client, hashedMessage, organizationId, privateKeyId);
    },
    signTransaction: function <
      TTransactionSerializable extends TransactionSerializable,
    >(
      transaction: TTransactionSerializable,
      options?: {
        serializer?:
          | SerializeTransactionFn<TTransactionSerializable>
          | undefined;
      },
    ): Promise<Hex> {
      const serializer: SerializeTransactionFn<TTransactionSerializable> =
        options?.serializer ??
        (serializeTransaction as SerializeTransactionFn<TTransactionSerializable>);
      return signTransaction(
        client,
        transaction,
        serializer,
        organizationId,
        privateKeyId,
      );
    },
    signTypedData: function (
      typedData: TypedData | { [key: string]: unknown },
    ): Promise<Hex> {
      return signTypedData(client, typedData, organizationId, privateKeyId);
    },
    signAuthorization: function (
      parameters: TSignAuthorizationParameters,
    ): Promise<SignAuthorizationReturnType> {
      return signAuthorization(
        client,
        parameters,
        organizationId,
        privateKeyId,
      );
    },
  });
}

export async function signAuthorization(
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase,
  parameters: TSignAuthorizationParameters,
  organizationId: string,
  signWith: string,
): Promise<SignAuthorizationReturnType> {
  const { chainId, nonce, to = "object" } = parameters;
  const address = parameters.contractAddress ?? parameters.address;

  if (!address) {
    throw new ZeroXKeyActivityError({
      message: "Unable to sign authorization: address is undefined.",
    });
  }

  const signature = await signMessageWithErrorWrapping(
    client,
    JSON.stringify({
      address,
      chainId,
      nonce,
    }),
    organizationId,
    signWith,
    "PAYLOAD_ENCODING_EIP7702_AUTHORIZATION",
    to,
  );

  if (to === "object")
    return {
      address,
      chainId,
      nonce,
      r: `${(signature as TSignature).r}`,
      s: `${(signature as TSignature).s}`,
      v: BigInt((signature as TSignature).v),
      yParity: Number((signature as TSignature).v),
    } as SignAuthorizationReturnType;

  return signature as SignAuthorizationReturnType;
}

export async function signMessage(
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase,
  message: SignableMessage,
  organizationId: string,
  signWith: string,
): Promise<Hex> {
  const signedMessage = await signMessageWithErrorWrapping(
    client,
    message as Hex,
    organizationId,
    signWith,
  );
  return `${signedMessage}` as Hex;
}

export async function signTransaction<
  TTransactionSerializable extends TransactionSerializable,
>(
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase,
  transaction: TTransactionSerializable,
  serializer: SerializeTransactionFn<TTransactionSerializable>,
  organizationId: string,
  signWith: string,
): Promise<Hex> {
  // Note: for Type 3 transactions, we are specifically handling parsing for payloads containing only the transaction payload body, without any wrappers around blobs, commitments, or proofs.
  // See more: https://github.com/wevm/viem/blob/3ef19eac4963014fb20124d1e46d1715bed5509f/src/accounts/utils/signTransaction.ts#L54-L55
  const signableTransaction =
    transaction.type === "eip4844"
      ? { ...transaction, sidecars: false }
      : transaction;

  const serializedTx = await serializer(signableTransaction);
  const nonHexPrefixedSerializedTx = serializedTx.replace(/^0x/, "");

  // Automatically detect transaction type from the serialized payload
  const transactionType = detectTransactionType(nonHexPrefixedSerializedTx);

  const signedTx = await signTransactionWithErrorWrapping(
    client,
    nonHexPrefixedSerializedTx,
    organizationId,
    signWith,
    transactionType,
  );

  if (transaction.type === "eip4844") {
    // Grab components of the signature
    const { r, s, v } = parseTransaction(signedTx);

    // Recombine with the original transaction
    return serializeTransaction(transaction, {
      r: r!,
      s: s!,
      v: v!,
    });
  }

  return signedTx;
}

export async function signTypedData(
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase,
  data: TypedData | { [key: string]: unknown },
  organizationId: string,
  signWith: string,
): Promise<Hex> {
  return (await signMessageWithErrorWrapping(
    client,
    __serializeTypedDataForZeroXKey(data as TSerializableTypedData),
    organizationId,
    signWith,
    "PAYLOAD_ENCODING_EIP712",
    "hex",
  )) as Hex;
}

async function signTransactionWithErrorWrapping(
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase,
  unsignedTransaction: string,
  organizationId: string,
  signWith: string,
  transactionType?: TTransactionType,
): Promise<Hex> {
  let signedTx: string;
  try {
    signedTx = await signTransactionImpl(
      client,
      unsignedTransaction,
      organizationId,
      signWith,
      transactionType,
    );
  } catch (error: any) {
    // Wrap ZeroXKey error in Viem-specific error
    if (error instanceof ZeroXKeyHttpActivityError) {
      throw new ZeroXKeyActivityError({
        message: error.message,
        activityId: error.activityId,
        activityStatus: error.activityStatus,
      });
    }

    if (error instanceof ZeroXKeyHttpActivityConsensusNeededError) {
      throw new ZeroXKeyConsensusNeededError({
        message: error.message,
        activityId: error.activityId,
        activityStatus: error.activityStatus,
      });
    }

    throw new ZeroXKeyActivityError({
      message: `Failed to sign: ${(error as Error).message}`,
    });
  }

  return `0x${signedTx}`;
}

async function signTransactionImpl(
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase,
  unsignedTransaction: string,
  organizationId: string,
  signWith: string,
  transactionType?: TTransactionType,
): Promise<string> {
  if (isHttpClient(client)) {
    const { activity } = await client.signTransaction({
      type: "ACTIVITY_TYPE_SIGN_TRANSACTION_V2",
      organizationId: organizationId,
      parameters: {
        signWith,
        type: transactionType ?? "TRANSACTION_TYPE_ETHEREUM",
        unsignedTransaction: unsignedTransaction,
      },
      timestampMs: String(Date.now()), // millisecond timestamp
    });

    assertActivityCompleted(activity);

    return assertNonNull(
      activity?.result?.signTransactionResult?.signedTransaction,
    );
  } else {
    const { activity, signedTransaction } = await client.signTransaction({
      organizationId,
      signWith,
      type: transactionType ?? "TRANSACTION_TYPE_ETHEREUM",
      unsignedTransaction: unsignedTransaction,
    });

    assertActivityCompleted(
      activity as any /* Type casting is ok here. The invalid types are both actually strings. TS is too strict here! */,
    );

    return assertNonNull(signedTransaction);
  }
}

async function signMessageWithErrorWrapping(
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase,
  message: string,
  organizationId: string,
  signWith: string,
  payloadEncoding: TPayloadEncoding = "PAYLOAD_ENCODING_HEXADECIMAL",
  to: TSignatureFormat = "hex",
): Promise<TSignMessageResult> {
  let signedMessage: TSignMessageResult;

  try {
    signedMessage = await signMessageImpl(
      client,
      message,
      organizationId,
      signWith,
      payloadEncoding,
      to,
    );
  } catch (error: any) {
    // Wrap ZeroXKey error in Viem-specific error
    if (error instanceof ZeroXKeyHttpActivityError) {
      throw new ZeroXKeyActivityError({
        message: error.message,
        activityId: error.activityId,
        activityStatus: error.activityStatus,
      });
    }

    if (error instanceof ZeroXKeyHttpActivityConsensusNeededError) {
      throw new ZeroXKeyConsensusNeededError({
        message: error.message,
        activityId: error.activityId,
        activityStatus: error.activityStatus,
      });
    }

    throw new ZeroXKeyActivityError({
      message: `Failed to sign: ${(error as Error).message}`,
    });
  }

  return signedMessage;
}

async function signMessageImpl(
  client:
    | ZeroXKeyClient
    | ZeroXKeyBrowserClient
    | ZeroXKeyServerClient
    | ZeroXKeySDKClientBase,
  message: string,
  organizationId: string,
  signWith: string,
  payloadEncoding: TPayloadEncoding,
  to: TSignatureFormat,
): Promise<TSignMessageResult> {
  let result: TSignature;

  if (isHttpClient(client)) {
    const { activity } = await client.signRawPayload({
      type: "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2",
      organizationId: organizationId,
      parameters: {
        signWith,
        payload: message,
        encoding: payloadEncoding,
        hashFunction: "HASH_FUNCTION_NO_OP",
      },
      timestampMs: String(Date.now()), // millisecond timestamp
    });

    assertActivityCompleted(activity);

    result = assertNonNull(activity?.result?.signRawPayloadResult);
  } else {
    const { activity, r, s, v } = await client.signRawPayload({
      organizationId,
      signWith,
      payload: message,
      encoding: payloadEncoding,
      hashFunction: "HASH_FUNCTION_NO_OP",
    });

    assertActivityCompleted(
      activity as any /* Type casting is ok here. The invalid types are both actually strings. TS is too strict here! */,
    );

    result = {
      r,
      s,
      v,
    };
  }

  if (to === "object") {
    return {
      r: `0x${result.r}`,
      s: `0x${result.s}`,
      v: BigInt(result.v),
    };
  }

  return assertNonNull(serializeSignature(result, to));
}

// Modified from Viem implementation:
// https://github.com/wevm/viem/blob/c8378d22f692f48edde100693159874702f36330/src/utils/signature/serializeSignature.ts#L38-L39
export function serializeSignature(
  sig: TSignature,
  to: TSignatureFormat = "hex",
) {
  const { r: rString, s: sString, v: vString } = sig;

  const r: `0x${string}` = `0x${rString}`;
  const s: `0x${string}` = `0x${sString}`;
  const v = BigInt(vString);

  // ZeroXKey's `v` returned can be used as a proxy for yParity
  const yParity_ = v;

  const signature = `0x${new secp256k1.Signature(
    hexToBigInt(r),
    hexToBigInt(s),
  ).toCompactHex()}${yParity_ === 0n ? "1b" : "1c"}` as const;

  if (to === "hex") return signature;
  return hexToBytes(signature);
}

export function isZeroXKeyActivityConsensusNeededError(error: any) {
  return (
    typeof error.walk === "function" &&
    error.walk((e: any) => {
      return e instanceof ZeroXKeyConsensusNeededError;
    })
  );
}

export function isZeroXKeyActivityError(error: any) {
  return (
    typeof error.walk === "function" &&
    error.walk((e: any) => {
      return e instanceof ZeroXKeyActivityError;
    })
  );
}
