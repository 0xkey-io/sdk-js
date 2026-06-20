import type { Hex } from "viem";
import {
  USDC_BASE,
  USDC_BASE_SEPOLIA,
  NETWORK_BASE,
  NETWORK_BASE_SEPOLIA,
} from "./constants";

export interface X402PolicyOptions {
  maxPerTxAtomic: string;
  usdcAddress?: string;
  chainId?: string;
  allowedRecipients?: Hex[];
  primaryType?: string;
}

export interface X402PolicyBundle {
  allowAmount: string;
  allowRecipients?: string;
  denyRawHash: string;
}

/**
 * Build CEL policy condition strings for x402 TransferWithAuthorization signing.
 * Pass these to the 0xkey policy API (`createPolicy`).
 */
export function createX402Policy(opts: X402PolicyOptions): X402PolicyBundle {
  const usdc = opts.usdcAddress ?? USDC_BASE;
  const chainId = opts.chainId ?? "8453";
  const primaryType = opts.primaryType ?? "TransferWithAuthorization";

  const allowAmount =
    `activity.type == 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2' && ` +
    `eth.eip_712.primary_type == '${primaryType}' && ` +
    `eth.eip_712.domain.verifying_contract == '${usdc.toLowerCase()}' && ` +
    `eth.eip_712.domain.chain_id == '${chainId}' && ` +
    `uint(eth.eip_712.message.value) <= uint('${opts.maxPerTxAtomic}')`;

  let allowRecipients: string | undefined;
  if (opts.allowedRecipients?.length) {
    const list = opts.allowedRecipients
      .map((a) => `'${a.toLowerCase()}'`)
      .join(", ");
    allowRecipients = allowAmount + ` && eth.eip_712.message.to in [${list}]`;
  }

  const denyRawHash =
    `activity.type == 'ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2' && ` +
    `!(eth.has('eip_712'))`;

  return {
    allowAmount,
    ...(allowRecipients ? { allowRecipients } : {}),
    denyRawHash,
  };
}

export const DEFAULT_X402_POLICIES = {
  base: createX402Policy({
    maxPerTxAtomic: "5000000",
    usdcAddress: USDC_BASE,
    chainId: "8453",
  }),
  baseSepolia: createX402Policy({
    maxPerTxAtomic: "5000000",
    usdcAddress: USDC_BASE_SEPOLIA,
    chainId: "84532",
  }),
};

export { NETWORK_BASE, NETWORK_BASE_SEPOLIA, USDC_BASE, USDC_BASE_SEPOLIA };
