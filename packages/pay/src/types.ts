import type { Hex } from "viem";

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource?: string;
  description?: string;
  mimeType?: string;
  extra?: Record<string, unknown>;
}

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  accepts: PaymentRequirements[];
}

export interface PaymentPayload {
  x402Version: 2;
  scheme: "exact";
  network: string;
  payload: {
    signature: Hex;
    authorization: {
      from: Hex;
      to: Hex;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
  accepted?: PaymentRequirements;
}

export interface PaymentReceipt {
  success: boolean;
  transaction?: Hex;
  network?: string;
  payer?: Hex;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: Hex;
}

export interface SettleResponse {
  success: boolean;
  transaction?: Hex;
  network?: string;
  payer?: Hex;
  errorReason?: string;
}

export interface PaymentRecord {
  paymentId: string;
  organizationId: string;
  direction: "inbound" | "outbound";
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payer: string;
  payTo: string;
  nonce: string;
  txHash?: string;
  status: string;
  resourceUrl?: string;
  resourceHost?: string;
  errorReason?: string;
  traceId?: string;
  createdAt: string;
  settledAt?: string;
}

export interface PaymentListResponse {
  payments: PaymentRecord[];
  /** Opaque cursor for the next page; pass back as `after`. Absent on the last page. */
  nextCursor?: string;
}

export interface PaymentListParams {
  organizationId: string;
  status?: "verified" | "settling" | "settled" | "failed";
  txHash?: string;
  network?: string;
  direction?: "inbound" | "outbound";
  /** Filter by either side of the transfer (payer or payTo), case-insensitive. */
  address?: string;
  /** ISO-8601; inclusive lower bound on createdAt. */
  createdAfter?: string;
  /** ISO-8601; exclusive upper bound on createdAt. */
  createdBefore?: string;
  limit?: number;
  /** Opaque pagination cursor from a prior response's `nextCursor`. */
  after?: string;
}

export interface PaymentGetParams {
  organizationId: string;
  paymentId: string;
}

export interface GasPayerBalanceParams {
  organizationId: string;
}

export interface GasPayerBalance {
  network: string;
  address: string;
  balanceAtomic?: string;
  feeToken: string;
  feeTokenDecimals: number;
  lowBalance?: boolean;
  error?: string;
}

export interface GasPayerBalanceResponse {
  /**
   * Settlement mode for this org: "shared" (platform relayer pays gas — balances
   * are intentionally empty and `managedByPlatform` is true) or "byo_wallet"
   * (the org's own gas wallet balances are returned).
   */
  mode?: "shared" | "byo_wallet";
  managedByPlatform?: boolean;
  balances: GasPayerBalance[];
  lowBalanceThresholdAtomic: string;
}
