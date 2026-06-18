export const X402_VERSION = 2 as const;

export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

/** Base mainnet USDC */
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
/** Base Sepolia USDC */
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const NETWORK_BASE = "eip155:8453";
export const NETWORK_BASE_SEPOLIA = "eip155:84532";

export const USDC_BY_NETWORK: Record<string, string> = {
  [NETWORK_BASE]: USDC_BASE,
  [NETWORK_BASE_SEPOLIA]: USDC_BASE_SEPOLIA,
};

/** Convert dollar string (e.g. "0.01") to USDC atomic units (6 decimals). */
export function dollarsToAtomic(dollars: string): string {
  const [whole = "0", frac = ""] = dollars.split(".");
  const padded = (frac + "000000").slice(0, 6);
  const combined = `${whole}${padded}`.replace(/^0+/, "") || "0";
  return combined;
}

/** Parse host from URL for telemetry (`resource_host`). */
export function resourceHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
