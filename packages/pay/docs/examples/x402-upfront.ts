// Public composition for exact @x402/{core,evm} 2.22.0 and 2.23.0.
// Pay itself keeps its exact 2.23.0 peer. All consumer/framework imports must
// resolve the same core/server owner (including the module condition).
import {
  FacilitatorResponseError,
  x402HTTPResourceServer,
  x402ResourceServer,
  type FacilitatorClient,
} from "@x402/core/server";
import type { SchemeNetworkServer } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import {
  create0xkeyFacilitatorClient,
  type Create0xkeyFacilitatorClientOptions,
} from "@0xkey-io/pay/x402";

export function createUpfrontHTTPServer(
  options: Create0xkeyFacilitatorClientOptions,
  payTo: string,
) {
  const facilitator: FacilitatorClient = create0xkeyFacilitatorClient({
    ...options,
    facilitatorResponseError: FacilitatorResponseError,
  });
  const exact = new ExactEvmScheme();
  const upfront = {
    scheme: exact.scheme,
    defaultAssetTransferMethod: exact.defaultAssetTransferMethod,
    paymentFlows: { eip3009: { supported: ["upfront"], default: "upfront" } },
    parsePrice: exact.parsePrice.bind(exact),
    enhancePaymentRequirements: exact.enhancePaymentRequirements.bind(exact),
    getAssetDecimals: exact.getAssetDecimals.bind(exact),
  } satisfies SchemeNetworkServer;
  const resource = new x402ResourceServer(facilitator).register(options.network, upfront);
  return new x402HTTPResourceServer(resource, {
    "GET /paid": {
      accepts: {
        scheme: "exact", network: options.network, payTo, price: "$0.01",
        extra: { assetTransferMethod: "eip3009", paymentFlow: "upfront" },
      },
    },
  });
}

// Pass this server to the official framework's *FromHTTPServer factory.
// Natural upfront processing settles before the handler; do not add a verify
// hook. Framework after-handler processing echoes beforeHandlerSettlement.
