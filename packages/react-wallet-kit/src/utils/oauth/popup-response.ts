import { OAuthProviders } from "@0xkey-io/sdk-types";
import { parseStrictOAuthWebUrl, type OAuthPopupRoute } from "./popup-binding";

export type OAuthPopupResponse =
  | { kind: "pending" }
  | { kind: "rejected"; reason?: "callback-route-mismatch" }
  | { kind: "accepted"; authCode?: string; oidcToken?: string };

const responseSignalFields = [
  "code",
  "id_token",
  "error",
  "error_description",
  "error_uri",
] as const;

const securityFields = ["state", ...responseSignalFields] as const;

const errorFields = ["error", "error_description", "error_uri"] as const;

const permittedQueryMetadata = new Set([
  "scope",
  "authuser",
  "prompt",
  "session_state",
]);

function hasValidEscapes(value: string): boolean {
  for (
    let index = value.indexOf("%");
    index !== -1;
    index = value.indexOf("%", index + 3)
  ) {
    if (!/^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      return false;
    }
  }
  return true;
}

function hasResponseSignal(params: URLSearchParams): boolean {
  return responseSignalFields.some((field) => params.has(field));
}

function hasSecurityFields(params: URLSearchParams): boolean {
  return securityFields.some((field) => params.has(field));
}

function hasProviderError(params: URLSearchParams): boolean {
  return errorFields.some((field) => params.has(field));
}

function hasExactlyOneNonempty(
  params: URLSearchParams,
  field: string,
): boolean {
  const values = params.getAll(field);
  return values.length === 1 && values[0] !== "";
}

function sameMultiset(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const value of left) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of right) {
    const count = counts.get(value);
    if (!count) return false;
    if (count === 1) counts.delete(value);
    else counts.set(value, count - 1);
  }
  return counts.size === 0;
}

function matchesRoute(
  strict: NonNullable<ReturnType<typeof parseStrictOAuthWebUrl>>,
  query: URLSearchParams,
  route: OAuthPopupRoute,
): boolean {
  if (
    strict.parsed.origin !== route.origin ||
    strict.observedPath !== route.observedPath
  ) {
    return false;
  }

  const expectedByKey = new Map<string, string[]>();
  for (const [key, value] of route.staticQuery) {
    const values = expectedByKey.get(key) ?? [];
    values.push(value);
    expectedByKey.set(key, values);
  }
  for (const [key, expectedValues] of expectedByKey) {
    if (!sameMultiset(query.getAll(key), expectedValues)) return false;
  }
  for (const key of new Set(query.keys())) {
    if (
      !expectedByKey.has(key) &&
      !securityFields.includes(key as (typeof securityFields)[number]) &&
      !permittedQueryMetadata.has(key)
    ) {
      return false;
    }
  }
  return true;
}

function inspectRawAppleHash(
  hash: string,
  expectedState: string,
): OAuthPopupResponse {
  if (!hasValidEscapes(hash)) return { kind: "rejected" };

  const codeMarker = "&code=";
  const tokenMarker = "&id_token=";
  const codeIndex = hash.indexOf(codeMarker);
  const tokenIndex = hash.indexOf(tokenMarker);
  if (
    !hash.startsWith("state=provider=apple") ||
    codeIndex === -1 ||
    tokenIndex === -1 ||
    codeIndex !== hash.lastIndexOf(codeMarker) ||
    tokenIndex !== hash.lastIndexOf(tokenMarker) ||
    tokenIndex <= codeIndex + codeMarker.length ||
    hash.includes("&state=") ||
    errorFields.some((field) => hash.includes(`&${field}=`))
  ) {
    return { kind: "rejected" };
  }

  const state = hash.slice("state=".length, codeIndex);
  const code = hash.slice(codeIndex + codeMarker.length, tokenIndex);
  const token = hash.slice(tokenIndex + tokenMarker.length);
  if (
    state !== expectedState ||
    code === "" ||
    token === "" ||
    code.includes("&") ||
    token.includes("&")
  ) {
    return { kind: "rejected" };
  }

  try {
    return { kind: "accepted", oidcToken: decodeURIComponent(token) };
  } catch {
    return { kind: "rejected" };
  }
}

export function inspectOAuthPopupResponse(input: {
  url: string;
  expectedProvider: OAuthProviders;
  expectedState: string;
  openerOrigin: string;
  expectedRoute: OAuthPopupRoute;
}): OAuthPopupResponse {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return { kind: "rejected" };
  }

  const rawQuery = parsed.search.slice(1);
  const rawHash = parsed.hash.slice(1);
  if (!hasValidEscapes(rawQuery) || !hasValidEscapes(rawHash)) {
    return { kind: "rejected" };
  }

  const query = new URLSearchParams(rawQuery);
  const fragment = new URLSearchParams(rawHash);
  const hasQueryResponse = hasResponseSignal(query);
  const hasFragmentResponse = hasResponseSignal(fragment);

  if (!hasQueryResponse && !hasFragmentResponse) {
    return { kind: "pending" };
  }
  const strict = parseStrictOAuthWebUrl(input.url, { allowFragment: true });
  if (
    !strict ||
    strict.parsed.origin !== input.openerOrigin ||
    !matchesRoute(strict, query, input.expectedRoute)
  ) {
    return { kind: "rejected", reason: "callback-route-mismatch" };
  }
  if (hasProviderError(query) || hasProviderError(fragment)) {
    return { kind: "rejected" };
  }

  if (
    input.expectedProvider === OAuthProviders.APPLE &&
    rawHash.startsWith("state=provider=apple")
  ) {
    if (hasSecurityFields(query)) return { kind: "rejected" };
    return inspectRawAppleHash(rawHash, input.expectedState);
  }

  const usesPkce =
    input.expectedProvider === OAuthProviders.FACEBOOK ||
    input.expectedProvider === OAuthProviders.X ||
    input.expectedProvider === OAuthProviders.DISCORD;

  if (usesPkce) {
    if (
      hasSecurityFields(fragment) ||
      !hasExactlyOneNonempty(query, "code") ||
      !hasExactlyOneNonempty(query, "state") ||
      query.has("id_token") ||
      query.get("state") !== input.expectedState
    ) {
      return { kind: "rejected" };
    }
    return { kind: "accepted", authCode: query.get("code")! };
  }

  const permitsHybridCode = input.expectedProvider === OAuthProviders.APPLE;
  if (
    hasSecurityFields(query) ||
    !hasExactlyOneNonempty(fragment, "id_token") ||
    !hasExactlyOneNonempty(fragment, "state") ||
    fragment.get("state") !== input.expectedState ||
    (fragment.has("code") &&
      (!permitsHybridCode || !hasExactlyOneNonempty(fragment, "code")))
  ) {
    return { kind: "rejected" };
  }

  return { kind: "accepted", oidcToken: fragment.get("id_token")! };
}
