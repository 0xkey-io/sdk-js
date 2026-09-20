import { OAuthProviders } from "@0xkey-io/sdk-types";
import { extractOAuthTransactionCallback } from "./oauth";
import type { ResolvedOauthProviderSettings } from "./oauth-provider-settings";
import type { OAuthTransactionContext } from "./oauth-transaction";

type CompletionKind = "internal" | "onOauthRedirect" | "onOauthSuccess";
type QueryPair = readonly [string, string];
type AppRoute = Readonly<{
  protocol: string;
  hostname: string;
  port: string;
  /** Raw bytes: URL.pathname silently normalizes dot segments and escapes. */
  path: string;
}>;

export type OauthRoutingInput = Readonly<{
  organizationId: string;
  /** Effective core endpoints, without discovering or normalizing defaults. */
  apiBaseUrl: string;
  authProxyUrl: string;
  authProxyConfigId?: string;
  provider: OAuthProviders;
  settings: Pick<
    ResolvedOauthProviderSettings,
    "clientId" | "redirectUri" | "appScheme"
  >;
  /** Configured category only; per-call closures cannot be reconstructed. */
  completion: CompletionKind;
}>;

/** Internal coordinator input, deliberately not re-exported by the package. */
export type OauthRoutingSnapshot = Readonly<
  OAuthTransactionContext & {
    organizationId: string;
    apiBaseUrl: string;
    authProxyUrl: string;
    authProxyConfigId: string | null;
    clientId: string;
    providerRedirectUri: string;
    appReturnTarget: string;
    appScheme: string;
    mode: "relay";
    completion: CompletionKind;
    appRoute: AppRoute;
    staticQuery: readonly QueryPair[];
    staticQueryPolicy: "required" | "all-or-absent";
  }
>;

const UNSAFE_APP_SCHEMES = new Set([
  "javascript",
  "data",
  "file",
  "http",
  "https",
  "ftp",
  "about",
  "blob",
  "intent",
  "chrome",
]);
const RESERVED_QUERY_NAMES = new Set([
  "state",
  "code",
  "id_token",
  "access_token",
  "refresh_token",
  "token_type",
  "expires_in",
  "expires_at",
  "error",
  "error_description",
  "error_uri",
  "session_state",
  "scheme",
  "transactionId",
  "provider",
  "publicKey",
  "nonce",
  "configId",
  "registrationId",
  "organizationId",
  "client_id",
  "clientId",
  "redirect_uri",
  "redirectUri",
]);
const INVALID_CONFIG = "Invalid OAuth routing configuration";
const INVALID_ROUTE = "Invalid OAuth callback route";

function requireString(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(INVALID_CONFIG);
  }
}

function isAppScheme(scheme: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*$/i.test(scheme) &&
    !UNSAFE_APP_SCHEMES.has(scheme.toLowerCase())
  );
}

/** Validate raw hierarchical syntax before allowing the URL parser to normalize. */
function parseRoute(
  raw: string,
  kind: "https" | "app",
  configured: boolean,
): {
  route: AppRoute;
  query: string;
} {
  if (
    typeof raw !== "string" ||
    /[\s\u0000-\u001f\u007f\\]/u.test(raw) ||
    (configured && raw.includes("#"))
  ) {
    throw new Error(INVALID_ROUTE);
  }
  const parts =
    /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(
      raw,
    );
  if (!parts) throw new Error(INVALID_ROUTE);
  const scheme = parts[1]!;
  const authority = parts[2]!;
  const path = parts[3]!;
  const query = parts[4] ?? "";
  if (
    authority.includes("@") ||
    (!authority && path.startsWith("//")) ||
    (kind === "https"
      ? scheme.toLowerCase() !== "https" || !authority
      : !isAppScheme(scheme))
  )
    throw new Error(INVALID_ROUTE);
  // Strict escape/UTF-8 validation only. Never use decoded path bytes for equality.
  decodeURIComponent(authority);
  decodeURIComponent(path);
  if (
    path.split("/").some((segment) => {
      const dots = segment.replace(/%2e/gi, ".");
      return dots === "." || dots === "..";
    })
  )
    throw new Error(INVALID_ROUTE);
  const parsed = new URL(raw);
  if (
    parsed.username ||
    parsed.password ||
    (kind === "https" && !parsed.hostname)
  ) {
    throw new Error(INVALID_ROUTE);
  }
  return {
    route: Object.freeze({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path,
    }),
    query,
  };
}

function parseQuery(query: string): QueryPair[] {
  // URLSearchParams is deliberately used only after strict once-decode checks.
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const name = separator < 0 ? pair : pair.slice(0, separator);
    const value = separator < 0 ? "" : pair.slice(separator + 1);
    decodeURIComponent(name.replace(/\+/g, " "));
    decodeURIComponent(value.replace(/\+/g, " "));
  }
  const pairs: QueryPair[] = [];
  new URLSearchParams(query).forEach((value, name) =>
    pairs.push(Object.freeze([name, value])),
  );
  return pairs;
}

/**
 * Capture once before allocating a key. Use providerRedirectUri verbatim for
 * authorization AND exchange, and pass this snapshot as transaction context.
 * The tuple binds a completion category, not a function or proof of reinstatement.
 */
export function createOauthRoutingSnapshot(
  input: OauthRoutingInput,
): OauthRoutingSnapshot {
  try {
    const {
      organizationId,
      apiBaseUrl,
      authProxyUrl,
      authProxyConfigId,
      provider,
      settings,
      completion,
    } = input;
    const { clientId, redirectUri, appScheme } = settings;
    for (const value of [organizationId, apiBaseUrl, authProxyUrl])
      requireString(value);
    requireString(clientId);
    requireString(redirectUri);
    requireString(appScheme);
    if (authProxyConfigId !== undefined) requireString(authProxyConfigId);
    if (
      !Object.values(OAuthProviders).includes(provider) ||
      !["internal", "onOauthRedirect", "onOauthSuccess"].includes(completion) ||
      !isAppScheme(appScheme)
    ) {
      throw new Error(INVALID_CONFIG);
    }
    const direct =
      provider === OAuthProviders.X || provider === OAuthProviders.DISCORD;
    const providerRoute = parseRoute(
      redirectUri,
      direct ? "app" : "https",
      true,
    );
    const pairs = parseQuery(providerRoute.query);
    const schemes = pairs.filter(([name]) => name === "scheme");
    if (
      schemes.length > 1 ||
      (schemes.length === 1 && (direct || schemes[0]![1] !== appScheme))
    ) {
      throw new Error(INVALID_CONFIG);
    }
    const staticQuery = pairs.filter(([name]) => {
      if (!direct && name === "scheme") return false;
      if (RESERVED_QUERY_NAMES.has(name)) throw new Error(INVALID_CONFIG);
      return true;
    });
    let providerRedirectUri = redirectUri;
    if (!direct && schemes.length === 0) {
      const separator = !redirectUri.includes("?")
        ? "?"
        : /[?&]$/.test(redirectUri)
          ? ""
          : "&";
      providerRedirectUri +=
        separator + new URLSearchParams({ scheme: appScheme }).toString();
    }
    const appReturnTarget = direct ? redirectUri : `${appScheme}://`;
    const appRoute = direct
      ? providerRoute.route
      : parseRoute(appReturnTarget, "app", true).route;
    const proxyId = authProxyConfigId ?? null;
    const configId = JSON.stringify(
      authProxyConfigId === undefined
        ? [
            "oauth-config",
            1,
            "local",
            organizationId,
            apiBaseUrl,
            authProxyUrl,
            null,
          ]
        : ["oauth-config", 1, "proxy", authProxyConfigId],
    );
    const mode = "relay";
    const binding = JSON.stringify([
      "oauth-routing",
      1,
      configId,
      organizationId,
      apiBaseUrl,
      authProxyUrl,
      proxyId,
      provider,
      clientId,
      providerRedirectUri,
      appReturnTarget,
      appScheme,
      mode,
      completion,
    ]);
    return Object.freeze({
      configId,
      provider,
      binding,
      organizationId,
      apiBaseUrl,
      authProxyUrl,
      authProxyConfigId: proxyId,
      clientId,
      providerRedirectUri,
      appReturnTarget,
      appScheme,
      mode,
      completion,
      appRoute,
      staticQuery: Object.freeze(staticQuery),
      staticQueryPolicy: direct ? "required" : "all-or-absent",
    });
  } catch {
    // Configuration may contain sensitive static values; never echo any input.
    throw new Error(INVALID_CONFIG);
  }
}

function matchesStaticQuery(
  snapshot: OauthRoutingSnapshot,
  pairs: readonly QueryPair[],
): boolean {
  const names = new Set(snapshot.staticQuery.map(([name]) => name));
  const received = pairs.filter(([name]) => names.has(name));
  // Relay forwards all static fields for query results, none for fragment results.
  // Absence cannot prove which branch ran; these fields never authorize anything.
  if (received.length === 0 && snapshot.staticQueryPolicy === "all-or-absent")
    return true;
  const sorted = (values: readonly QueryPair[]) =>
    values.map((pair) => JSON.stringify(pair)).sort();
  const expected = sorted(snapshot.staticQuery);
  const actual = sorted(received);
  return (
    expected.length === actual.length &&
    expected.every((pair, index) => pair === actual[index])
  );
}

/**
 * Validate the trusted route before extracting an UNTRUSTED correlation hint.
 * This neither authorizes nor consumes/cancels a transaction. The coordinator
 * must consume using exact returnedState and this snapshot before using results.
 */
export function validateOauthCallbackUrl(
  snapshot: OauthRoutingSnapshot,
  url: string,
): {
  transactionId: string;
  returnedState: string;
} {
  let parsed: ReturnType<typeof parseRoute>;
  try {
    parsed = parseRoute(url, "app", false);
    const expected = snapshot.appRoute;
    const actual = parsed.route;
    if (
      actual.protocol !== expected.protocol ||
      actual.hostname !== expected.hostname ||
      actual.port !== expected.port ||
      actual.path !== expected.path
    ) {
      throw new Error(INVALID_ROUTE);
    }
  } catch {
    throw new Error(INVALID_ROUTE);
  }
  let pairs: QueryPair[];
  try {
    pairs = parseQuery(parsed.query);
  } catch {
    throw new Error("Invalid OAuth transaction callback");
  }
  if (!matchesStaticQuery(snapshot, pairs)) throw new Error(INVALID_ROUTE);
  return extractOAuthTransactionCallback(url);
}
