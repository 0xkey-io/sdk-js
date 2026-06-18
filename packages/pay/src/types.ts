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
}

export interface PaymentListParams {
  organizationId: string;
  status?: "verified" | "settling" | "settled" | "failed";
  txHash?: string;
  limit?: number;
}

export interface PaymentGetParams {
  organizationId: string;
  paymentId: string;
}
