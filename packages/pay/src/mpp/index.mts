import type { BasePaymentNetwork } from "../receipt-verifier.js";
import type { PayApiKey, RequestStamper } from "../xstamp.js";
import { createMppEvmChargeMethod } from "../internal/create-mpp-evm-charge-method.js";

export interface Create0xkeyEvmChargeMethodOptions {
  network: BasePaymentNetwork;
  organizationId: string;
  payTo: `0x${string}`;
  apiKey?: PayApiKey;
  stamper?: RequestStamper;
  facilitatorUrl?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Native PaymentError from the same physical mppx used by the consumer's Mppx.create. */
  paymentError?: typeof import("mppx").Errors.PaymentError;
}

export function create0xkeyEvmChargeMethod(
  options: Create0xkeyEvmChargeMethodOptions,
): ReturnType<typeof import("mppx/evm/server").charge> {
  return createMppEvmChargeMethod(options).method;
}

export type { PayApiKey, RequestStamper } from "../xstamp.js";
