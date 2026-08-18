import type { BasePaymentNetwork } from "./receipt-verifier";

export const PAY_ORIGIN = "https://pay.0xkey.io";

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
  return network === "eip155:8453" ? "base-mainnet" : "base-sepolia";
}

export function resolvePayBaseUrl(
  network: BasePaymentNetwork,
  configuredBaseUrl = PAY_ORIGIN,
): string {
  assertBasePaymentNetwork(network);
  const url = new URL(configuredBaseUrl);
  const pathname = url.pathname.replace(/\/+$/, "");
  const expected = payChannel(network);
  const opposite =
    expected === "base-mainnet" ? "base-sepolia" : "base-mainnet";
  const segments = pathname.split("/").filter(Boolean);
  if (url.origin === PAY_ORIGIN) {
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(
        `PAY_NETWORK_CHANNEL_MISMATCH: ${network} must use a canonical public Pay URL`,
      );
    }
    if (segments.length === 0) {
      url.pathname = `/${expected}`;
    } else if (segments.length !== 1 || segments[0] !== expected) {
      throw new Error(
        `PAY_NETWORK_CHANNEL_MISMATCH: ${network} must use /${expected}`,
      );
    }
    return url.toString().replace(/\/$/, "");
  }
  if (segments.at(-1) === opposite) {
    throw new Error(
      `PAY_NETWORK_CHANNEL_MISMATCH: ${network} cannot use /${opposite}`,
    );
  }
  return url.toString().replace(/\/$/, "");
}
