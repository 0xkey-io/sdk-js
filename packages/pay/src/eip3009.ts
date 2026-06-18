import type { Hex } from "viem";

export interface TransferWithAuthorizationMessage {
  from: Hex;
  to: Hex;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface Eip3009TypedData {
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Hex;
  };
  types: {
    TransferWithAuthorization: readonly {
      name: string;
      type: string;
    }[];
  };
  primaryType: "TransferWithAuthorization";
  message: TransferWithAuthorizationMessage;
}

const TRANSFER_TYPES = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

export function chainIdFromNetwork(network: string): number {
  const m = network.match(/^eip155:(\d+)$/);
  if (!m) throw new Error(`Unsupported network ${network}`);
  return Number(m[1]);
}

export function buildTransferWithAuthorizationTypedData(opts: {
  from: Hex;
  to: Hex;
  valueAtomic: string;
  assetName?: string;
  assetVersion?: string;
  verifyingContract: Hex;
  network: string;
  maxTimeoutSeconds: number;
  nowSec?: number;
}): Eip3009TypedData {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const nonceBytes = new Uint8Array(32);
  crypto.getRandomValues(nonceBytes);
  const nonce = `0x${Array.from(nonceBytes, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("")}` as Hex;
  return {
    domain: {
      name: opts.assetName ?? "USDC",
      version: opts.assetVersion ?? "2",
      chainId: chainIdFromNetwork(opts.network),
      verifyingContract: opts.verifyingContract,
    },
    types: { TransferWithAuthorization: TRANSFER_TYPES },
    primaryType: "TransferWithAuthorization",
    message: {
      from: opts.from,
      to: opts.to,
      value: opts.valueAtomic,
      validAfter: String(now - 60),
      validBefore: String(now + opts.maxTimeoutSeconds),
      nonce,
    },
  };
}

export function splitTypedDataSignature(signature: Hex): {
  v: number;
  r: Hex;
  s: Hex;
} {
  const r = signature.slice(0, 66) as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  let v = parseInt(signature.slice(130, 132), 16);
  if (v < 27) v += 27;
  return { v, r, s };
}
