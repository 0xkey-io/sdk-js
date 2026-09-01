import { PayError } from "../errors";
import type { BasePaymentNetwork } from "../receipt-verifier";

export interface PrivateSettlementBinding {
  amount: string;
  network: BasePaymentNetwork;
  payer: string;
}

export interface DecodedPrivateSettlement {
  paymentId: string;
  settlement: PrivateSettlement;
}

export interface PrivateSettlement {
  amount?: string;
  errorMessage?: string;
  errorReason?: string;
  extensions?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  network: BasePaymentNetwork;
  payer?: string;
  success: boolean;
  transaction: string;
}

const SETTLEMENT_KEYS = new Set([
  "amount",
  "errorMessage",
  "errorReason",
  "extensions",
  "extra",
  "network",
  "payer",
  "success",
  "transaction",
]);

const PRIVATE_ERROR_STATUS = {
  PAYMENT_REQUEST_INVALID: 400,
  PAYMENT_NETWORK_MISMATCH: 400,
  PAYMENT_REQUIREMENTS_UNSUPPORTED: 400,
  PAYMENT_AUTH_INVALID: 401,
  PAYMENT_AUTH_FORBIDDEN: 403,
  PAYMENT_INTENT_CONFLICT: 409,
  PAYMENT_PROTOCOL_MISMATCH: 409,
  PAYMENT_REVISION_MISMATCH: 409,
  PAYMENT_SERVICE_UNAVAILABLE: 502,
  PAYMENT_AUTH_UNAVAILABLE: 503,
  PAYMENT_STATUS_UNKNOWN: 503,
} as const;

type PrivateErrorCode = keyof typeof PRIVATE_ERROR_STATUS;

export function parsePrivateSettlementEnvelope(
  value: unknown,
  binding: PrivateSettlementBinding,
): DecodedPrivateSettlement {
  const outer = requireRecord(value);
  assertExactKeys(outer, ["paymentId", "settlement"]);
  if (!isUuid(outer.paymentId)) throw new Error("invalid private payment id");

  const settlement = requireRecord(outer.settlement);
  if (Object.keys(settlement).some((key) => !SETTLEMENT_KEYS.has(key))) {
    throw new Error("invalid private settlement extension");
  }
  if (
    typeof settlement.success !== "boolean" ||
    typeof settlement.transaction !== "string" ||
    settlement.network !== binding.network
  ) {
    throw new Error("invalid private settlement response");
  }
  if (settlement.payer !== undefined) {
    if (
      typeof settlement.payer !== "string" ||
      !/^0x[0-9a-f]{40}$/i.test(settlement.payer) ||
      settlement.payer.toLowerCase() !== binding.payer.toLowerCase()
    ) {
      throw new Error("private settlement payer mismatch");
    }
  }
  if (settlement.amount !== undefined) {
    if (
      typeof settlement.amount !== "string" ||
      !/^[1-9][0-9]*$/.test(settlement.amount) ||
      settlement.amount !== binding.amount
    ) {
      throw new Error("private settlement amount mismatch");
    }
  }
  for (const key of ["errorReason", "errorMessage"] as const) {
    if (settlement[key] !== undefined && typeof settlement[key] !== "string") {
      throw new Error(`invalid private settlement ${key}`);
    }
  }
  for (const key of ["extensions", "extra"] as const) {
    if (settlement[key] !== undefined) requireRecord(settlement[key]);
  }
  if (settlement.success) {
    if (
      typeof settlement.payer !== "string" ||
      !/^0x[0-9a-f]{64}$/i.test(settlement.transaction) ||
      /^0x0{64}$/i.test(settlement.transaction)
    ) {
      throw new Error("invalid private settlement transaction");
    }
  } else if (settlement.transaction !== "") {
    throw new Error("deterministic rejection must have an empty transaction");
  }

  return {
    paymentId: outer.paymentId,
    settlement: {
      success: settlement.success,
      transaction: settlement.transaction,
      network: settlement.network as BasePaymentNetwork,
      ...optionalString(settlement, "payer"),
      ...optionalString(settlement, "amount"),
      ...optionalString(settlement, "errorReason"),
      ...optionalString(settlement, "errorMessage"),
      ...optionalRecord(settlement, "extensions"),
      ...optionalRecord(settlement, "extra"),
    },
  };
}

export function parsePrivateSettlementError(
  value: unknown,
  status: number,
): PayError | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (
    keys.some((key) => !["errorCode", "paymentId", "retryable"].includes(key)) ||
    !keys.includes("errorCode") ||
    !keys.includes("retryable") ||
    typeof value.errorCode !== "string" ||
    !(value.errorCode in PRIVATE_ERROR_STATUS) ||
    typeof value.retryable !== "boolean"
  ) {
    return undefined;
  }
  const code = value.errorCode as PrivateErrorCode;
  if (
    PRIVATE_ERROR_STATUS[code] !== status ||
    value.retryable !== (status >= 500) ||
    (value.paymentId !== undefined && !isUuid(value.paymentId))
  ) {
    return undefined;
  }
  return new PayError(code, "payment settlement request was rejected", {
    phase: "request",
    retryable: value.retryable,
    ...(typeof value.paymentId === "string" ? { paymentId: value.paymentId } : {}),
  });
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  if (
    Object.keys(record).length !== keys.length ||
    keys.some((key) => !(key in record))
  ) {
    throw new Error("invalid private settlement envelope");
  }
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value = record[key];
  return typeof value === "string" ? { [key]: value } : {};
}

function optionalRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, Record<string, unknown>> {
  const value = record[key];
  return isRecord(value) ? { [key]: value } : {};
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("expected object");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
