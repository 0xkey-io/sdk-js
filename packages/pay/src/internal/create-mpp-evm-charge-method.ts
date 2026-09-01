import { Transport } from "mppx/server";
import { Credential, Errors } from "mppx";
import { assets, charge } from "mppx/evm/server";
import { getAddress } from "viem";
import { PayError } from "../errors";
import { assertBasePaymentNetwork } from "../networks";
import type { BasePaymentNetwork } from "../receipt-verifier";
import type { PayApiKey, RequestStamper } from "../xstamp";
import { withoutMppReceipt } from "./mpp-response";
import {
  assertMppCredentialHasNoUnknownExtensions,
  MppEvmChargeAdapter,
} from "./mpp-evm-charge-adapter";
import {
  ZeroXkeySettlementAdapter,
  type ZeroXkeySettlementResult,
} from "./zeroxkey-settlement-adapter";

export interface MppEvmChargeMethodOptions {
  network: BasePaymentNetwork;
  organizationId: string;
  payTo: `0x${string}`;
  apiKey?: PayApiKey;
  stamper?: RequestStamper;
  facilitatorUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  paymentError?: typeof Errors.PaymentError;
}

export function createMppEvmChargeMethod(
  options: MppEvmChargeMethodOptions,
  onSettlement?: (result: ZeroXkeySettlementResult) => void,
  onFailure?: (error: PayError) => void,
): { method: ReturnType<typeof charge> } {
  const SettlementBoundaryError = captureSettlementError(options);
  validateOptions(options);
  const economicAdapter = new MppEvmChargeAdapter(options.network);
  const settlementAdapter = new ZeroXkeySettlementAdapter(options);
  const method = charge({
    currency: options.network === "eip155:8453" ? assets.base.USDC : assets.baseSepolia.USDC,
    recipient: getAddress(options.payTo),
    async settle(validated) {
      const command = economicAdapter.toCommand(validated);
      let result: ZeroXkeySettlementResult;
      try {
        result = await settlementAdapter.settle(command);
      } catch (cause) {
        const error = cause instanceof PayError
          ? cause
          : new PayError("PAYMENT_STATUS_UNKNOWN", "settlement outcome is indeterminate", {
              phase: "request", retryable: true, cause,
            });
        onFailure?.(error);
        throw new SettlementBoundaryError(error.code, error.retryable, statusFor(error));
      }
      onSettlement?.(result);
      return {
        reference: result.reference,
        ...(result.timestamp ? { timestamp: result.timestamp } : {}),
      };
    },
  });

  const upstreamTransport = Transport.http();
  Object.defineProperty(method, "transport", {
    configurable: false,
    enumerable: true,
    value: Transport.from({
      ...upstreamTransport,
      getCredential(input) {
        const header = input.headers.get("Authorization");
        if (header && Credential.extractPaymentScheme(header)) {
          assertMppCredentialHasNoUnknownExtensions(header);
        }
        return upstreamTransport.getCredential(input);
      },
      async respondChallenge(options) {
        const response = await upstreamTransport.respondChallenge(options);
        if (
          !(options.error instanceof SettlementBoundaryError) ||
          options.error.status === 402
        ) return response;
        const headers = new Headers(response.headers);
        headers.delete("WWW-Authenticate");
        if (response.status === 503) headers.set("Retry-After", "2");
        headers.set("Content-Type", "application/problem+json");
        return new Response(
          options.error ? JSON.stringify(options.error.toProblemDetails()) : null,
          {
            headers,
            status: response.status,
            statusText: response.statusText,
          },
        );
      },
      respondReceipt(options) {
        if (options.response.status >= 200 && options.response.status < 300) {
          return upstreamTransport.respondReceipt(options);
        }
        return withoutMppReceipt(options.response, true);
      },
    }),
    writable: false,
  });
  return { method };
}

function captureSettlementError(options: MppEvmChargeMethodOptions) {
  try {
    const configured = options.paymentError;
    const ErrorConstructor = configured === undefined ? Errors.PaymentError : configured;
    // Both the upstream nominal owner and our transport recognition belong to
    // this factory. Never give caller configuration a private PayError/cause.
    class SettlementBoundaryError extends ErrorConstructor {
      override readonly name = "SettlementBoundaryError";
      readonly title = "Settlement Boundary Failure";
      readonly type = "https://0xkey.io/pay/problems/settlement-boundary";
      override readonly status: number;

      constructor(errorCode: PayError["code"], retryable: boolean, status: number) {
        super(errorCode === "PAYMENT_STATUS_UNKNOWN"
          ? "settlement outcome is indeterminate"
          : "settlement request failed", { details: { errorCode, retryable } });
        this.status = status;
      }
    }
    // This tests the subclass contract with synthetic public values only. It
    // cannot attest ownership of a separately constructed consumer Mppx.
    for (const [code, retryable, status] of [
      ["PAYMENT_STATUS_UNKNOWN", true, 503],
      ["PAYMENT_AUTH_FORBIDDEN", false, 403],
    ] as const) {
      const probe = new SettlementBoundaryError(code, retryable, status);
      const detail = code === "PAYMENT_STATUS_UNKNOWN"
        ? "settlement outcome is indeterminate" : "settlement request failed";
      const expected = {
        type: "https://0xkey.io/pay/problems/settlement-boundary",
        title: "Settlement Boundary Failure", status, detail,
        details: { errorCode: code, retryable },
      };
      const problem = probe.toProblemDetails();
      if (!(probe instanceof Error) || probe.message !== detail ||
        probe.cause !== undefined || !safeProblemMatches(problem, expected)) {
        throw new Error();
      }
    }
    return SettlementBoundaryError;
  } catch {
    throw new PayError("PAY_PROFILE_INVALID", "invalid MPP payment error constructor", {
      phase: "configuration",
    });
  }
}

function safeProblemMatches(actual: unknown, expected: Record<string, unknown>): boolean {
  if (!actual || typeof actual !== "object" || Object.getPrototypeOf(actual) !== Object.prototype) return false;
  if (Reflect.ownKeys(actual).length !== Object.keys(expected).length) return false;
  return Object.entries(expected).every(([key, value]) => {
    const descriptor = Object.getOwnPropertyDescriptor(actual, key);
    if (!descriptor || !("value" in descriptor)) return false;
    return typeof value === "object" && value !== null
      ? safeProblemMatches(descriptor.value, value as Record<string, unknown>)
      : descriptor.value === value;
  });
}

function statusFor(error: PayError): number {
  switch (error.code) {
    case "PAYMENT_REQUEST_INVALID":
    case "PAYMENT_NETWORK_MISMATCH":
    case "PAYMENT_REQUIREMENTS_UNSUPPORTED":
      return 400;
    case "PAYMENT_AUTH_INVALID":
      return 401;
    case "PAYMENT_AUTH_FORBIDDEN":
      return 403;
    case "PAYMENT_INTENT_CONFLICT":
    case "PAYMENT_PROTOCOL_MISMATCH":
    case "PAYMENT_REVISION_MISMATCH":
      return 409;
    case "PAYMENT_SERVICE_UNAVAILABLE":
      return 502;
    case "PAYMENT_AUTH_UNAVAILABLE":
    case "PAYMENT_STATUS_UNKNOWN":
      return 503;
    default:
      return 402;
  }
}

function validateOptions(options: MppEvmChargeMethodOptions): void {
  assertBasePaymentNetwork(options.network);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      options.organizationId,
    )
  ) {
    throw new PayError("PAY_PROFILE_INVALID", "organizationId must be a UUID", {
      phase: "configuration",
    });
  }
  try {
    getAddress(options.payTo);
  } catch (cause) {
    throw new PayError("PAY_PROFILE_INVALID", "payTo must be an EVM address", {
      phase: "configuration",
      cause,
    });
  }
  if (Boolean(options.apiKey) === Boolean(options.stamper)) {
    throw new PayError(
      "PAY_PROFILE_INVALID",
      "configure exactly one of apiKey or stamper",
      { phase: "configuration" },
    );
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new PayError("PAY_PROFILE_INVALID", "timeoutMs is outside the supported range", {
      phase: "configuration",
    });
  }
}
