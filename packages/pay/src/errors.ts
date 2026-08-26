export type PayErrorCode =
  | "PAY_PROFILE_INVALID"
  | "PAY_NETWORK_UNSUPPORTED"
  | "PAY_HOST_DENIED"
  | "PAY_INSECURE_TRANSPORT"
  | "PAYMENT_OFFER_UNSUPPORTED"
  | "PAYMENT_CHALLENGE_INVALID"
  | "PAYMENT_POLICY_DENIED"
  | "PAYMENT_SIGNING_FAILED"
  | "PAYMENT_IN_PROGRESS"
  | "PAYMENT_RESUME_REQUIRED"
  | "PAYMENT_RESUME_UNAVAILABLE"
  | "PENDING_PAYMENT_STORE_REQUIRED"
  | "PENDING_PAYMENT_STORE_PROTECTION_REQUIRED"
  | "PENDING_PAYMENT_CLAIMED"
  | "PENDING_PAYMENT_CLEAR_CONFLICT"
  | "PENDING_PAYMENT_CORRUPT"
  | "PENDING_PAYMENT_CONFLICT"
  | "PENDING_PAYMENT_VERSION_UNSUPPORTED"
  | "PAYMENT_STATUS_UNKNOWN"
  | "PAYMENT_RECEIPT_MISSING"
  | "PAYMENT_RECEIPT_MISMATCH"
  | "PAYMENT_RECEIPT_UNVERIFIED"
  | "PAYMENT_SERVICE_UNAVAILABLE";

export type PayErrorPhase =
  | "configuration"
  | "request"
  | "challenge"
  | "policy"
  | "signing"
  | "recovery"
  | "receipt";

export interface PayErrorOptions {
  phase: PayErrorPhase;
  retryable?: boolean;
  paymentId?: string;
  cause?: unknown;
}

export class PayError extends Error {
  constructor(
    readonly code: PayErrorCode,
    message: string,
    options: PayErrorOptions,
  ) {
    super(`${code}: ${message}`, { cause: options.cause });
    this.name = "PayError";
    this.phase = options.phase;
    this.retryable = options.retryable ?? false;
    if (options.paymentId !== undefined) this.paymentId = options.paymentId;
  }

  readonly phase: PayErrorPhase;
  readonly retryable: boolean;
  readonly paymentId?: string;
}
