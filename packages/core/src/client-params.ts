import type { ProxyTGetWalletKitClientParamsResponse } from "@0xkey-io/sdk-types";

/**
 * Read the current public capability for one Auth Proxy URL and Config ID.
 * This request is intentionally uncached so an existing app sees enable,
 * disable, and site-key rotation on its next attempt.
 */
export async function getClientParams(
  authProxyConfigId: string,
  authProxyUrl = "https://authproxy.0xkey.io",
): Promise<ProxyTGetWalletKitClientParamsResponse> {
  let url: URL;
  try {
    url = new URL(authProxyUrl);
  } catch {
    throw new Error("Invalid Auth Proxy URL");
  }
  if (
    !authProxyConfigId ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Invalid client params selection");
  }
  url.pathname =
    url.pathname.replace(/\/+$/, "") + "/v1/wallet_kit_client_params";

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Proxy-Config-ID": authProxyConfigId,
      },
      body: "{}",
      cache: "no-store",
    });
  } catch {
    throw new Error("Client params unavailable");
  }
  if (!response.ok) {
    throw new Error("Client params unavailable");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("Invalid client params response");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid client params response");
  }
  const fields = Object.keys(body);
  if (fields.length === 0) return {};
  const siteKey = (body as Record<string, unknown>).turnstileSiteKey;
  if (
    fields.length !== 1 ||
    fields[0] !== "turnstileSiteKey" ||
    typeof siteKey !== "string" ||
    !siteKey.trim() ||
    siteKey !== siteKey.trim()
  ) {
    throw new Error("Invalid client params response");
  }
  return { turnstileSiteKey: siteKey };
}
