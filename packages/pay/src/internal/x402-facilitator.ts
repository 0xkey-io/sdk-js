import type {
  FacilitatorClient,
} from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { PayError } from "../errors";
import { assertBasePaymentNetwork, resolvePayBaseUrl } from "../networks";
import type { BasePaymentNetwork } from "../receipt-verifier";
import {
  createXStampV2Stamper,
  type PayApiKey,
  type RequestStamper,
} from "../xstamp";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const SUPPORTED_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 30_000;

export interface X402FacilitatorTransportOptions {
  network: BasePaymentNetwork;
  organizationId: string;
  apiKey?: PayApiKey;
  stamper?: RequestStamper;
  facilitatorUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface PrivateSettlementResult {
  settlement: SettleResponse;
  paymentId: string;
}

export interface X402FacilitatorTransport {
  client: FacilitatorClient;
  settlePrivate(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<PrivateSettlementResult>;
}

export function createX402FacilitatorTransport(
  options: X402FacilitatorTransportOptions,
): X402FacilitatorTransport {
  validateOptions(options);
  const facilitatorUrl = normalizeHttpsUrl(
    resolvePayBaseUrl(options.network, options.facilitatorUrl),
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const stamper = options.stamper ?? createXStampV2Stamper(options.apiKey!);

  async function request(
    operation: "verify" | "settle" | "supported",
    method: "GET" | "POST",
    body: string | undefined,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> {
    const url = `${facilitatorUrl}/${operation}`;
    try {
      const stamped = await stamper.stampRequest({
        method,
        url,
        ...(body === undefined ? {} : { body }),
        organizationId: options.organizationId,
        wireProtocol: "x402",
      });
      const signal = AbortSignal.timeout(timeoutMs);
      const response = await fetch(url, {
        method,
        redirect: "error",
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          [stamped.stampHeaderName]: stamped.stampHeaderValue,
        },
        ...(body === undefined ? {} : { body }),
        signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw dependencyError(
          operation,
          response.status,
          undefined,
          response.headers.get("Retry-After"),
        );
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch (cause) {
        throw dependencyError(operation, response.status, cause);
      }
      try {
        return parse(decoded);
      } catch (cause) {
        if (cause instanceof PayError) throw cause;
        throw dependencyError(operation, response.status, cause);
      }
    } catch (cause) {
      if (cause instanceof PayError) throw cause;
      throw dependencyError(operation, undefined, cause);
    }
  }

  async function verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return request(
      "verify",
      "POST",
      envelope(options.organizationId, paymentPayload, paymentRequirements),
      parseVerifyResponse,
    ) as Promise<VerifyResponse>;
  }

  async function settlePrivate(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<PrivateSettlementResult> {
    return request(
      "settle",
      "POST",
      envelope(options.organizationId, paymentPayload, paymentRequirements),
      parsePrivateSettlement,
    ) as Promise<PrivateSettlementResult>;
  }

  async function settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const result = await settlePrivate(paymentPayload, paymentRequirements);
    return { ...result.settlement };
  }

  async function getSupported(): Promise<SupportedResponse> {
    let lastError: PayError | undefined;
    for (let attempt = 0; attempt < SUPPORTED_ATTEMPTS; attempt += 1) {
      try {
        return (await request(
          "supported",
          "GET",
          undefined,
          parseSupportedResponse,
        )) as SupportedResponse;
      } catch (error) {
        lastError = error as PayError;
        const status = errorStatus(error);
        if (status !== 429 || attempt === SUPPORTED_ATTEMPTS - 1) throw error;
        await delay(retryDelayMs(errorRetryAfter(error), attempt));
      }
    }
    throw lastError!;
  }

  return {
    client: { verify, settle, getSupported },
    settlePrivate,
  };
}

function envelope(
  organizationId: string,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): string {
  return JSON.stringify({
    organizationId,
    x402Version: paymentPayload.x402Version,
    paymentPayload,
    paymentRequirements,
  });
}

function validateOptions(options: X402FacilitatorTransportOptions): void {
  assertBasePaymentNetwork(options.network);
  if (!isUuid(options.organizationId)) {
    throw new PayError("PAY_PROFILE_INVALID", "organizationId must be a UUID", {
      phase: "configuration",
    });
  }
  if (Boolean(options.apiKey) === Boolean(options.stamper)) {
    throw new PayError(
      "PAY_PROFILE_INVALID",
      "configure exactly one of apiKey or stamper",
      { phase: "configuration" },
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new PayError("PAY_PROFILE_INVALID", "timeoutMs is outside the supported range", {
      phase: "configuration",
    });
  }
}

function normalizeHttpsUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new PayError("PAY_INSECURE_TRANSPORT", "facilitatorUrl must use HTTPS", {
      phase: "configuration",
    });
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new PayError("PAY_PROFILE_INVALID", "facilitatorUrl contains unsupported components", {
      phase: "configuration",
    });
  }
  return value.replace(/\/+$/, "");
}

function dependencyError(
  operation: "verify" | "settle" | "supported",
  status?: number,
  cause?: unknown,
  retryAfter?: string | null,
): PayError {
  const error = new PayError(
    operation === "settle" ? "PAYMENT_STATUS_UNKNOWN" : "PAYMENT_SERVICE_UNAVAILABLE",
    operation === "settle"
      ? "settlement outcome is indeterminate"
      : "payment service is unavailable",
    { phase: "request", retryable: true, cause },
  );
  Object.defineProperties(error, {
    httpStatus: { value: status, enumerable: false },
    retryAfter: {
      value: retryAfter ?? undefined,
      enumerable: false,
    },
  });
  return error;
}

function parseVerifyResponse(value: unknown): VerifyResponse {
  const record = requireRecord(value);
  if (typeof record.isValid !== "boolean") throw new Error("invalid verify response");
  return {
    isValid: record.isValid,
    ...optionalString(record, "invalidReason"),
    ...optionalString(record, "invalidMessage"),
    ...optionalString(record, "payer"),
    ...optionalRecord(record, "extensions"),
    ...optionalRecord(record, "extra"),
  };
}

function parsePrivateSettlement(value: unknown): PrivateSettlementResult {
  const record = requireRecord(value);
  if (!isUuid(record.paymentId)) throw new Error("invalid private payment id");
  return {
    settlement: parseSettleResponse(record.settlement),
    paymentId: record.paymentId,
  };
}

function parseSettleResponse(value: unknown): SettleResponse {
  const record = requireRecord(value);
  if (
    typeof record.success !== "boolean" ||
    typeof record.transaction !== "string" ||
    typeof record.network !== "string"
  ) {
    throw new Error("invalid settle response");
  }
  return {
    success: record.success,
    transaction: record.transaction,
    network: record.network,
    ...optionalString(record, "errorReason"),
    ...optionalString(record, "errorMessage"),
    ...optionalString(record, "payer"),
    ...optionalString(record, "amount"),
    ...optionalRecord(record, "extensions"),
    ...optionalRecord(record, "extra"),
  } as SettleResponse;
}

function parseSupportedResponse(value: unknown): SupportedResponse {
  const record = requireRecord(value);
  if (!Array.isArray(record.kinds)) throw new Error("invalid supported response");
  const kinds = record.kinds.map((candidate) => {
    const kind = requireRecord(candidate);
    if (
      typeof kind.x402Version !== "number" ||
      typeof kind.scheme !== "string" ||
      typeof kind.network !== "string"
    ) {
      throw new Error("invalid supported kind");
    }
    return {
      x402Version: kind.x402Version,
      scheme: kind.scheme,
      network: kind.network,
      ...optionalRecord(kind, "extra"),
    };
  });
  const extensions = record.extensions ?? [];
  const signers = record.signers ?? {};
  if (
    !Array.isArray(extensions) ||
    !extensions.every((entry) => typeof entry === "string") ||
    !isStringArrayRecord(signers)
  ) {
    throw new Error("invalid supported response");
  }
  return { kinds, extensions, signers } as SupportedResponse;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected object");
  }
  return value as Record<string, unknown>;
}

function optionalString(record: Record<string, unknown>, key: string): Record<string, string> {
  const value = record[key];
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") throw new Error(`invalid ${key}`);
  return { [key]: value };
}

function optionalRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, Record<string, unknown>> {
  const value = record[key];
  if (value === undefined || value === null) return {};
  return { [key]: requireRecord(value) };
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (entry) => Array.isArray(entry) && entry.every((item) => typeof item === "string"),
    )
  );
}

function errorStatus(error: unknown): number | undefined {
  return (error as { httpStatus?: number }).httpStatus;
}

function errorRetryAfter(error: unknown): string | null {
  return (error as { retryAfter?: string }).retryAfter ?? null;
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  let delay: number | undefined;
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    delay = Number(retryAfter) * 1000;
  } else if (retryAfter) {
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) delay = Math.max(0, timestamp - Date.now());
  }
  delay ??= 1000 * 2 ** attempt;
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
