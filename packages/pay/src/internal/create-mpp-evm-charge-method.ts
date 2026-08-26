import { Transport } from "mppx/server";
import { Errors } from "mppx";
import { assets, charge } from "mppx/evm/server";
import { getAddress } from "viem";
import { PayError } from "../errors";
import { assertBasePaymentNetwork } from "../networks";
import type { BasePaymentNetwork } from "../receipt-verifier";
import type { PayApiKey, RequestStamper } from "../xstamp";
import { MppEvmChargeAdapter } from "./mpp-evm-charge-adapter";
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
}

export function createMppEvmChargeMethod(
  options: MppEvmChargeMethodOptions,
  onSettlement?: (result: ZeroXkeySettlementResult) => void,
  onFailure?: (error: PayError) => void,
): { method: ReturnType<typeof charge> } {
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
        throw new Errors.VerificationFailedError({ reason: "settlement unavailable" });
      }
      onSettlement?.(result);
      return {
        reference: result.reference,
        ...(result.timestamp ? { timestamp: result.timestamp } : {}),
      };
    },
  });

  Object.defineProperty(method, "transport", {
    configurable: false,
    enumerable: true,
    value: Transport.http(),
    writable: false,
  });
  return { method };
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
