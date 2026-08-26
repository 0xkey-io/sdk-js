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
    wireProtocol: Extract<WireProtocol, "x402" | "mpp">,
  ): Promise<ZeroXkeySettlementResult> {
    const url = `${this.baseUrl}/settle`;
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
      return parseSettlement(value);
    } catch (cause) {
      throw new PayError(
        "PAYMENT_STATUS_UNKNOWN",
        "settlement outcome is indeterminate",
        { phase: "request", retryable: true, cause },
      );
    }
  }
}

function parseSettlement(value: unknown): ZeroXkeySettlementResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid settlement response");
  }
  const record = value as Record<string, unknown>;
  const settlement =
    record.settlement && typeof record.settlement === "object" && !Array.isArray(record.settlement)
      ? (record.settlement as Record<string, unknown>)
      : record;
  if (
    settlement.success !== true ||
    typeof settlement.transaction !== "string" ||
    typeof record.paymentId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      record.paymentId,
    )
  ) {
    throw new Error("invalid settlement response");
  }
  return {
    paymentId: record.paymentId,
    reference: settlement.transaction,
    ...(typeof settlement.timestamp === "string" ? { timestamp: settlement.timestamp } : {}),
  };
}
