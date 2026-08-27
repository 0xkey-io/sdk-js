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
  /** The official public core/server error constructor owned by the consumer. */
  facilitatorResponseError?: new (message: string) => Error;
}

export function create0xkeyFacilitatorClient(
  options: Create0xkeyFacilitatorClientOptions,
): FacilitatorClient {
  const ErrorConstructor = captureErrorConstructor(options);
  const client = createX402FacilitatorTransport(options).client;
  return {
    verify: (...args) => facilitatorBoundary(() => client.verify(...args), ErrorConstructor),
    settle: (...args) => facilitatorBoundary(() => client.settle(...args), ErrorConstructor),
    getSupported: (...args) => facilitatorBoundary(() => client.getSupported(...args), ErrorConstructor),
  };
}

function captureErrorConstructor(
  options: Create0xkeyFacilitatorClientOptions,
): new (message: string) => Error {
  try {
    const configured = options.facilitatorResponseError;
    const ErrorConstructor = configured === undefined ? FacilitatorResponseError : configured;
    const probe = new ErrorConstructor("payment service is unavailable");
    if (!(probe instanceof Error)) throw new Error();
    // Probe the exact descriptor used below without giving caller code a PayError.
    Object.defineProperty(probe, "cause", {
      configurable: false, enumerable: false, value: {}, writable: false,
    });
    return ErrorConstructor;
  } catch {
    throw new PayError("PAY_PROFILE_INVALID", "invalid facilitator response error constructor", {
      phase: "configuration",
    });
  }
}

async function facilitatorBoundary<T>(
  operation: () => Promise<T>,
  ErrorConstructor: new (message: string) => Error,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (!(cause instanceof PayError)) throw cause;
    const error = new ErrorConstructor(
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
