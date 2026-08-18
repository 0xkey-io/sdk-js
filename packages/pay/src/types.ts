export type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "mppx/x402";

export type PaymentStatus =
  | "PREPARED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FINALIZED"
  | "REJECTED"
  | "UNKNOWN";

export interface PaymentRecord {
  paymentId: string;
  organizationId: string;
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payer: string;
  payTo: string;
  nonce: string;
  txHash: string | null;
  status: PaymentStatus;
  protocol: "x402" | "mpp";
  protocolVersion: string | null;
  intent: "charge";
  method: "evm";
  requirementsDigest: string;
  wireDigest: string;
  resourceDigest: string | null;
  economicEffectId: string;
  adapterRevision: string;
  provider: string;
  providerConfigRevision: string;
  resourceUrl: string | null;
  resourceHost: string | null;
  errorReason: string | null;
  traceId: string | null;
  networkFeeAtomic: string | null;
  feeToken: string | null;
  feeTokenDecimals: number | null;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  finalizedAt: string | null;
  unknownSince: string | null;
  lastObservedAt: string | null;
}

export interface PaymentListResponse {
  payments: PaymentRecord[];
  /** Opaque cursor for the next page; pass back as `after`. Absent on the last page. */
  nextCursor?: string;
}

export interface PaymentListParams {
  status?: PaymentStatus;
  txHash?: string;
  protocol?: "x402" | "mpp";
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
  paymentId: string;
}
