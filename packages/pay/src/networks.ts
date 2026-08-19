import type { BasePaymentNetwork } from "./receipt-verifier";

export const PAY_API_ORIGIN = "https://api-pay.0xkey.io";
export const PAY_STAGING_API_ORIGIN = "https://api-pay.staging.0xkey.io";

const API_ORIGIN_BY_HOSTNAME = {
  "api-pay.0xkey.io": PAY_API_ORIGIN,
  "api-pay.staging.0xkey.io": PAY_STAGING_API_ORIGIN,
} as const;
const PAY_WEB_HOSTNAMES = new Set(["pay.0xkey.io", "pay.staging.0xkey.io"]);

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

  if (PAY_WEB_HOSTNAMES.has(url.hostname)) {
    throw new Error(
      `PAY_FACILITATOR_ORIGIN_MISMATCH: ${url.hostname} is not a facilitator base URL`,
    );
  }

  const canonicalOrigin =
    API_ORIGIN_BY_HOSTNAME[url.hostname as keyof typeof API_ORIGIN_BY_HOSTNAME];
  if (!canonicalOrigin) return url.toString().replace(/\/$/, "");

  if (
    url.origin !== canonicalOrigin ||
    hasExplicitPort(configuredBaseUrl) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== `/${expected}`)
  ) {
    throw new Error(
      `PAY_FACILITATOR_ORIGIN_MISMATCH: ${network} must use ${canonicalOrigin}/${expected}`,
    );
  }
  if (url.pathname === "/") url.pathname = `/${expected}`;

  return url.toString().replace(/\/$/, "");
}

function hasExplicitPort(value: string): boolean {
  const authority = value.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1];
  const host = authority?.slice(authority.lastIndexOf("@") + 1);
  return host?.includes(":") ?? false;
}
