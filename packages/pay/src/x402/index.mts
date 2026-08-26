import {
  FacilitatorResponseError,
  type FacilitatorClient,
} from "@x402/core/server";
import { PayError } from "../errors.js";
import type { BasePaymentNetwork } from "../receipt-verifier.js";
import type { PayApiKey, RequestStamper } from "../xstamp.js";
import { createX402FacilitatorTransport } from "../internal/x402-facilitator.js";

export interface Create0xkeyFacilitatorClientOptions {
  network: BasePaymentNetwork;
  organizationId: string;
  apiKey?: PayApiKey;
  stamper?: RequestStamper;
  facilitatorUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export function create0xkeyFacilitatorClient(
  options: Create0xkeyFacilitatorClientOptions,
): FacilitatorClient {
  const client = createX402FacilitatorTransport(options).client;
  return {
    verify: (...args) => facilitatorBoundary(() => client.verify(...args)),
    settle: (...args) => facilitatorBoundary(() => client.settle(...args)),
    getSupported: (...args) => facilitatorBoundary(() => client.getSupported(...args)),
  };
}

async function facilitatorBoundary<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (!(cause instanceof PayError)) throw cause;
    const error = new FacilitatorResponseError(
      cause.code === "PAYMENT_STATUS_UNKNOWN"
        ? "settlement outcome is indeterminate"
        : "payment service is unavailable",
    );
    Object.defineProperty(error, "cause", {
      configurable: false,
      enumerable: false,
      value: cause,
      writable: false,
    });
    throw error;
  }
}

export type { PayApiKey, RequestStamper } from "../xstamp.js";
