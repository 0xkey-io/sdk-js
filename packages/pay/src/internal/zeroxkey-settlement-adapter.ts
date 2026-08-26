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
    try {
      const stamped = await this.stamper.stampRequest({
        method: "POST",
        url,
        body,
        organizationId: this.options.organizationId,
        wireProtocol,
      });
      const response = await this.fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          [stamped.stampHeaderName]: stamped.stampHeaderValue,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const text = await response.text();
      if (!response.ok) throw new Error("non-success settlement response");
      const value = JSON.parse(text) as unknown;
      return parseSettlement(value, command);
    } catch (cause) {
      throw new PayError(
        "PAYMENT_STATUS_UNKNOWN",
        "settlement outcome is indeterminate",
        { phase: "request", retryable: true, cause },
      );
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
    settlementRecord.success !== true ||
    typeof settlementRecord.transaction !== "string" ||
    !/^0x[0-9a-f]{64}$/i.test(settlementRecord.transaction) ||
    /^0x0{64}$/i.test(settlementRecord.transaction) ||
    settlementRecord.network !== command.network ||
    (settlementRecord.payer !== undefined && settlementRecord.payer !== command.payer) ||
    typeof record.paymentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      record.paymentId,
    )
  ) {
    throw new Error("invalid settlement response");
  }
  return {
    paymentId: record.paymentId,
    reference: settlementRecord.transaction,
  };
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
