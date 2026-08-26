import type { FacilitatorClient } from "@x402/core/server";
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
  return createX402FacilitatorTransport(options).client;
}

export type { PayApiKey, RequestStamper } from "../xstamp.js";
