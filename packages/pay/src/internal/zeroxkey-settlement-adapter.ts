import { PayError } from "../errors";
import { resolvePayBaseUrl } from "../networks";
import type { BasePaymentNetwork } from "../receipt-verifier";
import {
  createXStampV2Stamper,
  type PayApiKey,
  type RequestStamper,
  type WireProtocol,
} from "../xstamp";
import type { ChargeSettlementCommand } from "./charge-settlement-command";

export interface ZeroXkeySettlementAdapterOptions {
  network: BasePaymentNetwork;
  organizationId: string;
  apiKey?: PayApiKey;
  stamper?: RequestStamper;
  facilitatorUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface ZeroXkeySettlementResult {
  paymentId: string;
  reference: string;
  timestamp?: string;
}

export class ZeroXkeySettlementAdapter {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;
  private readonly stamper: RequestStamper;
  private readonly timeoutMs: number;

  constructor(private readonly options: ZeroXkeySettlementAdapterOptions) {
    this.baseUrl = resolvePayBaseUrl(options.network, options.facilitatorUrl).replace(/\/+$/, "");
    if (new URL(this.baseUrl).protocol !== "https:") {
      throw new PayError("PAY_INSECURE_TRANSPORT", "facilitatorUrl must use HTTPS", {
        phase: "configuration",
      });
    }
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.stamper = options.stamper ?? createXStampV2Stamper(options.apiKey!);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async settle(
    command: ChargeSettlementCommand,
  ): Promise<ZeroXkeySettlementResult> {
    const wireProtocol = wireProtocolFor(command);
    const url = `${this.baseUrl}/v1/settlements/charge`;
    const body = JSON.stringify({ organizationId: this.options.organizationId, command });
    let response: Response;
    let text: string;
    try {
      const stamped = await this.stamper.stampRequest({
        method: "POST",
        url,
        body,
        organizationId: this.options.organizationId,
        wireProtocol,
      });
      response = await this.fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          [stamped.stampHeaderName]: stamped.stampHeaderValue,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await response.text();
    } catch (cause) {
      throw unknownSettlement(cause);
    }

    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (cause) {
      throw unknownSettlement(cause);
    }
    if (!response.ok) {
      const classified = parsePrivateError(value, response.status);
      if (classified) throw classified;
      throw unknownSettlement();
    }
    try {
      return parseSettlement(value, command);
    } catch (cause) {
      if (cause instanceof PayError) throw cause;
      throw unknownSettlement(cause);
    }
  }
}

function parseSettlement(
  value: unknown,
  command: ChargeSettlementCommand,
): ZeroXkeySettlementResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid settlement response");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !("settlement" in record) || !("paymentId" in record)) {
    throw new Error("invalid settlement response");
  }
  const settlement = record.settlement;
  if (!settlement || typeof settlement !== "object" || Array.isArray(settlement)) {
    throw new Error("invalid settlement response");
  }
  const settlementRecord = settlement as Record<string, unknown>;
  const allowedSettlementKeys = new Set([
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
  if (
    Object.keys(settlementRecord).some((key) => !allowedSettlementKeys.has(key)) ||
    typeof settlementRecord.success !== "boolean" ||
    typeof settlementRecord.transaction !== "string" ||
    settlementRecord.network !== command.network ||
    (settlementRecord.payer !== undefined &&
      (typeof settlementRecord.payer !== "string" ||
        !/^0x[0-9a-f]{40}$/i.test(settlementRecord.payer) ||
        settlementRecord.payer.toLowerCase() !== command.payer.toLowerCase())) ||
    typeof record.paymentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      record.paymentId,
    )
  ) {
    throw new Error("invalid settlement response");
  }
  if (!settlementRecord.success) {
    if (settlementRecord.transaction !== "") throw new Error("invalid settlement response");
    throw new PayError(
      "PAYMENT_CHALLENGE_INVALID",
      "settlement was deterministically rejected",
      { phase: "request", paymentId: record.paymentId },
    );
  }
  if (
    !/^0x[0-9a-f]{64}$/i.test(settlementRecord.transaction) ||
    /^0x0{64}$/i.test(settlementRecord.transaction)
  ) {
    throw new Error("invalid settlement response");
  }
  return {
    paymentId: record.paymentId,
    reference: settlementRecord.transaction,
  };
}

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

function parsePrivateError(value: unknown, status: number): PayError | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some((key) => !["errorCode", "paymentId", "retryable"].includes(key)) ||
    !keys.includes("errorCode") ||
    !keys.includes("retryable") ||
    typeof record.errorCode !== "string" ||
    !(record.errorCode in PRIVATE_ERROR_STATUS) ||
    typeof record.retryable !== "boolean"
  ) {
    return undefined;
  }
  const code = record.errorCode as PrivateErrorCode;
  const expectedRetryable = status >= 500;
  if (PRIVATE_ERROR_STATUS[code] !== status || record.retryable !== expectedRetryable) {
    return undefined;
  }
  if (record.paymentId !== undefined && !isUuid(record.paymentId)) return undefined;
  return new PayError(code, "payment settlement request was rejected", {
    phase: "request",
    retryable: record.retryable,
    ...(typeof record.paymentId === "string" ? { paymentId: record.paymentId } : {}),
  });
}

function unknownSettlement(cause?: unknown): PayError {
  return new PayError(
    "PAYMENT_STATUS_UNKNOWN",
    "settlement outcome is indeterminate",
    { phase: "request", retryable: true, cause },
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function wireProtocolFor(
  command: ChargeSettlementCommand,
): Extract<WireProtocol, "x402" | "mpp"> {
  const exactKeys = [
    "adapterRevision",
    "amount",
    "asset",
    "authorization",
    "network",
    "payer",
    "payTo",
    "protocolId",
  ];
  if (Object.keys(command).some((key) => !exactKeys.includes(key))) throw invalidCommand();
  if (
    command.protocolId === "x402-exact-v2-eip3009" &&
    command.adapterRevision === "x402-exact-v2"
  ) {
    return "x402";
  }
  if (
    command.protocolId === "mpp-evm-charge-v0" &&
    command.adapterRevision === "mpp-evm-charge-v0"
  ) {
    return "mpp";
  }
  throw invalidCommand();
}

function invalidCommand(): PayError {
  return new PayError(
    "PAYMENT_CHALLENGE_INVALID",
    "settlement command protocol and revision do not match",
    { phase: "request" },
  );
}
