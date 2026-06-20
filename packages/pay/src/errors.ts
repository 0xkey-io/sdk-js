import type { PaymentRequired, PaymentRequirements } from "./types";

export type X402ErrorCode =
  | "POLICY_DENIED"
  | "NO_ACCEPTED_REQUIREMENT"
  | "INVALID_PAYMENT_REQUIRED"
  | "SIGN_FAILED"
  | "SETTLE_FAILED";

export class X402Error extends Error {
  readonly code: X402ErrorCode;
  readonly paymentRequired?: PaymentRequired;
  readonly policyDecision?: string;
  readonly traceId?: string;

  constructor(
    code: X402ErrorCode,
    message: string,
    opts?: {
      paymentRequired?: PaymentRequired;
      policyDecision?: string;
      traceId?: string;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "X402Error";
    this.code = code;
    if (opts?.paymentRequired) this.paymentRequired = opts.paymentRequired;
    if (opts?.policyDecision) this.policyDecision = opts.policyDecision;
    if (opts?.traceId) this.traceId = opts.traceId;
  }
}

type BufferConstructor = {
  from(
    input: string | Uint8Array,
    encoding?: string,
  ): { toString(encoding?: string): string } & ArrayLike<number>;
};

function getBuffer(): BufferConstructor | undefined {
  return (globalThis as unknown as { Buffer?: BufferConstructor }).Buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      const chunk = bytes.subarray(i, i + 0x8000);
      const chars = Array.from(chunk, (byte) => String.fromCharCode(byte));
      binary += chars.join("");
    }
    return btoa(binary);
  }

  const buffer = getBuffer();
  if (buffer) return buffer.from(bytes).toString("base64");
  throw new Error("No base64 encoder available in this runtime");
}

function base64ToBytes(input: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  const buffer = getBuffer();
  if (buffer) {
    const decoded = buffer.from(input, "base64");
    return new Uint8Array(decoded);
  }
  throw new Error("No base64 decoder available in this runtime");
}

export function encodeBase64Json(value: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)));
}

export function decodeBase64Json<T = unknown>(input: string): T {
  const json = new TextDecoder().decode(base64ToBytes(input));
  return JSON.parse(json) as T;
}

export function decodePaymentRequiredHeader(
  header: string | null,
): PaymentRequired {
  if (!header) {
    throw new X402Error("INVALID_PAYMENT_REQUIRED", "Missing PAYMENT-REQUIRED");
  }
  try {
    const parsed = decodeBase64Json<PaymentRequired>(header);
    if (parsed.x402Version !== 2) {
      throw new Error(`unsupported x402Version ${parsed.x402Version}`);
    }
    return parsed;
  } catch (e) {
    throw new X402Error(
      "INVALID_PAYMENT_REQUIRED",
      e instanceof Error ? e.message : "Invalid PAYMENT-REQUIRED header",
    );
  }
}

export function encodePaymentRequired(required: PaymentRequired): string {
  return encodeBase64Json(required);
}

export function encodePaymentPayload(payload: unknown): string {
  return encodeBase64Json(payload);
}

export function decodePaymentPayloadHeader<T = unknown>(header: string): T {
  return decodeBase64Json<T>(header);
}

export function selectRequirement(
  required: PaymentRequired,
  allowedNetworks?: string[],
): PaymentRequirements {
  const accepts = required.accepts ?? [];
  const match = accepts.find(
    (a) =>
      a.scheme === "exact" &&
      (!allowedNetworks || allowedNetworks.includes(a.network)),
  );
  if (!match) {
    throw new X402Error("NO_ACCEPTED_REQUIREMENT", "No matching accept entry", {
      paymentRequired: required,
    });
  }
  return match;
}
