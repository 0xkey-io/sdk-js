export type PayErrorCode =
  | "PAY_HOST_DENIED"
  | "PAY_AMOUNT_EXCEEDED"
  | "AMBIGUOUS_PAYMENT_CREDENTIAL"
  | "PAYMENT_STATUS_UNKNOWN"
  | "PAYMENT_VERIFICATION_REJECTED";

export class PayError extends Error {
  constructor(
    readonly code: PayErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "PayError";
  }
}
