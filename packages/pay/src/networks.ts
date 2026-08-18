import type { BasePaymentNetwork } from "./receipt-verifier";

export const PAY_API_ORIGIN = "https://api-pay.0xkey.io";
const RETIRED_PAY_WEB_ORIGIN = "https://pay.0xkey.io";

const CHANNEL_BY_NETWORK = {
  "eip155:8453": "base-mainnet",
  "eip155:84532": "base-sepolia",
} as const;

export function assertBasePaymentNetwork(
  network: unknown,
): asserts network is BasePaymentNetwork {
  if (network === undefined || network === null || network === "") {
    throw new Error(
      "PAY_NETWORK_REQUIRED: choose eip155:8453 or eip155:84532 explicitly",
    );
  }
  if (network !== "eip155:8453" && network !== "eip155:84532") {
    throw new Error(`PAY_NETWORK_UNSUPPORTED: ${String(network)}`);
  }
}

export function payChannel(network: BasePaymentNetwork): string {
  return CHANNEL_BY_NETWORK[network];
}

export function resolvePayBaseUrl(
  network: BasePaymentNetwork,
  configuredBaseUrl = PAY_API_ORIGIN,
): string {
  assertBasePaymentNetwork(network);
  const url = new URL(configuredBaseUrl);
  const expected = payChannel(network);

  if (url.origin === RETIRED_PAY_WEB_ORIGIN) {
    throw new Error(
      "PAY_FACILITATOR_ORIGIN_MISMATCH: pay.0xkey.io is not a facilitator base URL",
    );
  }

  if (url.origin !== PAY_API_ORIGIN) return url.toString().replace(/\/$/, "");

  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== `/${expected}`)
  ) {
    throw new Error(
      `PAY_FACILITATOR_ORIGIN_MISMATCH: ${network} must use ${PAY_API_ORIGIN}/${expected}`,
    );
  }
  if (url.pathname === "/") url.pathname = `/${expected}`;

  return url.toString().replace(/\/$/, "");
}
