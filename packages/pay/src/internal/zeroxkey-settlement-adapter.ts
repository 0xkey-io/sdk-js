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
import {
  parsePrivateSettlementEnvelope,
  parsePrivateSettlementError,
} from "./private-settlement-response";

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
      const classified = parsePrivateSettlementError(value, response.status);
      if (classified) throw classified;
      throw unknownSettlement();
    }
    try {
      const decoded = parsePrivateSettlementEnvelope(value, {
        amount: command.amount,
        network: command.network,
        payer: command.payer,
      });
      if (!decoded.settlement.success) {
        throw new PayError(
          "PAYMENT_CHALLENGE_INVALID",
          "settlement was deterministically rejected",
          { phase: "request", paymentId: decoded.paymentId },
        );
      }
      return {
        paymentId: decoded.paymentId,
        reference: decoded.settlement.transaction,
      };
    } catch (cause) {
      if (cause instanceof PayError) throw cause;
      throw unknownSettlement(cause);
    }
  }
}

function unknownSettlement(cause?: unknown): PayError {
  return new PayError(
    "PAYMENT_STATUS_UNKNOWN",
    "settlement outcome is indeterminate",
    { phase: "request", retryable: true, cause },
  );
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
