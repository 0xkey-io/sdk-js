import {
  decodeFunctionData,
  getAddress,
  keccak256,
  sha256,
  stringToBytes,
  stringToHex,
  type Hex,
} from "viem";

export interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface Eip3009EconomicEffect {
  network: string;
  asset: string;
  authorizationDomain: {
    name: string;
    version: string;
  };
  authorization: Eip3009Authorization;
  economicEffectId: string;
}

export interface PaymentReceiptVerificationInput extends Eip3009EconomicEffect {
  protocol: "x402" | "mpp";
  transaction: string;
}

export type PaymentReceiptVerifier = (
  input: PaymentReceiptVerificationInput,
) => Promise<boolean>;

export type BasePaymentNetwork = "eip155:8453" | "eip155:84532";

export function createEip3009EconomicEffect(input: {
  network: string;
  asset: string;
  assetName: string;
  assetVersion: string;
  authorization: Eip3009Authorization;
}): Eip3009EconomicEffect {
  const authorization = normalizeAuthorization(input.authorization);
  const effect = {
    network: input.network,
    asset: getAddress(input.asset),
    authorizationDomain: {
      name: input.assetName,
      version: input.assetVersion,
    },
    authorization,
  };
  return {
    ...effect,
    economicEffectId: economicEffectId(effect),
  };
}

export function createBaseReceiptVerifier(options: {
  network: BasePaymentNetwork;
  rpcUrl: string;
  fetch?: typeof globalThis.fetch;
}): PaymentReceiptVerifier {
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const network = baseNetwork(options.network, options.rpcUrl);
  return async (input) => {
    if (
      input.network !== options.network ||
      getAddress(input.asset) !== network.usdc
    ) {
      return false;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.transaction)) return false;

    const [chainId, receipt, transaction] = await Promise.all([
      rpc<string>(fetch, network.rpcUrl, "eth_chainId", []),
      rpc<RpcReceipt | null>(
        fetch,
        network.rpcUrl,
        "eth_getTransactionReceipt",
        [input.transaction],
      ),
      rpc<RpcTransaction | null>(
        fetch,
        network.rpcUrl,
        "eth_getTransactionByHash",
        [input.transaction],
      ),
    ]);
    if (!receipt || !transaction) {
      throw new Error("Base transaction is not visible yet");
    }
    if (chainId.toLowerCase() !== network.chainIdHex) return false;
    if (
      receipt.status !== "0x1" ||
      receipt.transactionHash.toLowerCase() !==
        input.transaction.toLowerCase() ||
      transaction.hash.toLowerCase() !== input.transaction.toLowerCase() ||
      !receipt.blockHash ||
      transaction.blockHash?.toLowerCase() !==
        receipt.blockHash.toLowerCase() ||
      !transaction.to ||
      getAddress(transaction.to) !== network.usdc
    ) {
      return false;
    }

    const block = await rpc<RpcBlock | null>(
      fetch,
      network.rpcUrl,
      "eth_getBlockByNumber",
      [receipt.blockNumber, false],
    );
    if (
      !block ||
      block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()
    ) {
      return false;
    }

    return (
      transactionAuthorizationMatches(transaction.input, input) &&
      transferLogMatches(receipt.logs, input) &&
      authorizationUsedLogMatches(receipt.logs, input)
    );
  };
}

const transferWithAuthorizationAbi = [
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const transferTopic = keccak256(
  stringToHex("Transfer(address,address,uint256)"),
);
const authorizationUsedTopic = keccak256(
  stringToHex("AuthorizationUsed(address,bytes32)"),
);

interface RpcReceipt {
  blockHash: string;
  blockNumber: string;
  logs: RpcLog[];
  status: string;
  transactionHash: string;
}

interface RpcTransaction {
  blockHash?: string | null;
  hash: string;
  input: Hex;
  to?: string | null;
}

interface RpcBlock {
  hash: string;
}

interface RpcLog {
  address: string;
  data: string;
  topics: string[];
}

function transactionAuthorizationMatches(
  input: Hex,
  expected: PaymentReceiptVerificationInput,
): boolean {
  try {
    const decoded = decodeFunctionData({
      abi: transferWithAuthorizationAbi,
      data: input,
    });
    if (decoded.functionName !== "transferWithAuthorization") return false;
    const [from, to, value, validAfter, validBefore, nonce] = decoded.args;
    return (
      getAddress(from) === getAddress(expected.authorization.from) &&
      getAddress(to) === getAddress(expected.authorization.to) &&
      value.toString() === expected.authorization.value &&
      validAfter.toString() === expected.authorization.validAfter &&
      validBefore.toString() === expected.authorization.validBefore &&
      nonce.toLowerCase() === expected.authorization.nonce.toLowerCase()
    );
  } catch {
    return false;
  }
}

function transferLogMatches(
  logs: RpcLog[],
  expected: PaymentReceiptVerificationInput,
): boolean {
  const from = addressTopic(expected.authorization.from);
  const to = addressTopic(expected.authorization.to);
  return logs.some(
    (log) =>
      sameAddress(log.address, expected.asset) &&
      log.topics[0]?.toLowerCase() === transferTopic.toLowerCase() &&
      log.topics[1]?.toLowerCase() === from &&
      log.topics[2]?.toLowerCase() === to &&
      uintHex(log.data) === BigInt(expected.authorization.value),
  );
}

function authorizationUsedLogMatches(
  logs: RpcLog[],
  expected: PaymentReceiptVerificationInput,
): boolean {
  const authorizer = addressTopic(expected.authorization.from);
  return logs.some(
    (log) =>
      sameAddress(log.address, expected.asset) &&
      log.topics[0]?.toLowerCase() === authorizationUsedTopic.toLowerCase() &&
      log.topics[1]?.toLowerCase() === authorizer &&
      log.topics[2]?.toLowerCase() ===
        expected.authorization.nonce.toLowerCase(),
  );
}

function economicEffectId(
  effect: Omit<Eip3009EconomicEffect, "economicEffectId">,
): string {
  // Keep keys in this order. It matches serde_json's sorted-map encoding in
  // the facilitator, so both sides derive the same economic_effect_id.
  const material = {
    from: effect.authorization.from.toLowerCase(),
    kind: "eip3009/transferWithAuthorization",
    name: effect.authorizationDomain.name,
    network: effect.network,
    nonce: effect.authorization.nonce.toLowerCase(),
    to: effect.authorization.to.toLowerCase(),
    validAfter: effect.authorization.validAfter,
    validBefore: effect.authorization.validBefore,
    value: effect.authorization.value,
    verifyingContract: effect.asset.toLowerCase(),
    version: effect.authorizationDomain.version,
  };
  return `eip3009:${sha256(stringToBytes(JSON.stringify(material))).slice(2)}`;
}

function normalizeAuthorization(
  authorization: Eip3009Authorization,
): Eip3009Authorization {
  if (!/^0x[0-9a-fA-F]{64}$/.test(authorization.nonce)) {
    throw new Error("EIP-3009 nonce must be 32 bytes");
  }
  return {
    from: getAddress(authorization.from),
    to: getAddress(authorization.to),
    value: uintString(authorization.value),
    validAfter: uintString(authorization.validAfter),
    validBefore: uintString(authorization.validBefore),
    nonce: authorization.nonce.toLowerCase(),
  };
}

function baseNetwork(
  network: BasePaymentNetwork,
  rpcUrl: string,
): { chainIdHex: string; rpcUrl: string; usdc: `0x${string}` } {
  if (network === "eip155:8453") {
    return {
      chainIdHex: "0x2105",
      rpcUrl,
      usdc: getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
    };
  }
  return {
    chainIdHex: "0x14a34",
    rpcUrl,
    usdc: getAddress("0x036cbd53842c5426634e7929541ec2318f3dcf7e"),
  };
}

async function rpc<Result>(
  fetch: typeof globalThis.fetch,
  url: string,
  method: string,
  params: unknown[],
): Promise<Result> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Base RPC returned ${response.status}`);
  const body = (await response.json()) as {
    error?: { message?: string };
    result?: Result;
  };
  if (body.error || !("result" in body)) {
    throw new Error(body.error?.message ?? "Base RPC response is invalid");
  }
  return body.result as Result;
}

function addressTopic(address: string): string {
  return `0x${getAddress(address).slice(2).toLowerCase().padStart(64, "0")}`;
}

function sameAddress(left: string, right: string): boolean {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function uintHex(value: string): bigint | undefined {
  try {
    if (!/^0x[0-9a-fA-F]+$/.test(value)) return undefined;
    return BigInt(value);
  } catch {
    return undefined;
  }
}

function uintString(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error("EIP-3009 uint must be decimal");
  return BigInt(value).toString();
}
