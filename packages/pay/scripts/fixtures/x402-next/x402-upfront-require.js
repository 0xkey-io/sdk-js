// CommonJS-condition counterpart of the public typed upfront recipe, used
// only to prove a condition-consistent Next production build.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { FacilitatorResponseError, x402HTTPResourceServer, x402ResourceServer } = require("@x402/core/server");
const { ExactEvmScheme } = require("@x402/evm/exact/server");
const { create0xkeyFacilitatorClient } = require("@0xkey-io/pay/x402");

export function createUpfrontHTTPServer(options, payTo) {
  const facilitator = create0xkeyFacilitatorClient({ ...options, facilitatorResponseError: FacilitatorResponseError });
  const exact = new ExactEvmScheme();
  const upfront = {
    scheme: exact.scheme,
    defaultAssetTransferMethod: exact.defaultAssetTransferMethod,
    paymentFlows: { eip3009: { supported: ["upfront"], default: "upfront" } },
    parsePrice: exact.parsePrice.bind(exact),
    enhancePaymentRequirements: exact.enhancePaymentRequirements.bind(exact),
    getAssetDecimals: exact.getAssetDecimals.bind(exact),
  };
  const resource = new x402ResourceServer(facilitator).register(options.network, upfront);
  return new x402HTTPResourceServer(resource, {
    "GET /paid": { accepts: { scheme: "exact", network: options.network, payTo, price: "$0.01", extra: { assetTransferMethod: "eip3009", paymentFlow: "upfront" } } },
  });
}
