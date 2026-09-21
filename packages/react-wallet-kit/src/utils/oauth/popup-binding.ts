import type {
  OAuthProviders,
  ProxyTGetWalletKitConfigResponse,
} from "@0xkey-io/sdk-types";
import type { ZeroXKeyProviderConfig } from "../../types/base";

export type OAuthPopupBindingFailureReason =
  | "context-unavailable"
  | "context-changed"
  | "callback-config-invalid"
  | "callback-route-mismatch";

export class OAuthPopupBindingError extends Error {
  readonly reason: OAuthPopupBindingFailureReason;

  constructor(reason: OAuthPopupBindingFailureReason) {
    super(
      reason === "context-unavailable"
        ? "OAuth popup context is unavailable."
        : reason === "context-changed"
          ? "OAuth popup context changed."
          : reason === "callback-config-invalid"
            ? "OAuth popup callback configuration is invalid."
            : "OAuth popup callback route does not match.",
    );
    this.name = "OAuthPopupBindingError";
    this.reason = reason;
  }
}

export type OAuthConstructorIdentity = {
  organizationId: string;
  apiBaseUrl?: string | undefined;
  authProxyUrl?: string | undefined;
  authProxyConfigId?: string | undefined;
};

type EffectiveTransportIdentity = {
  organizationId: string;
  apiBaseUrl: string;
  authProxyUrl?: string | undefined;
  authProxyConfigId?: string | undefined;
};

export type OAuthBindingHttpClient = {
  config: EffectiveTransportIdentity;
};

export type OAuthBindingClient = {
  config: OAuthConstructorIdentity;
  httpClient: OAuthBindingHttpClient;
};

export type OAuthProxySnapshot = {
  value: ProxyTGetWalletKitConfigResponse;
  fetchedFor: {
    authProxyConfigId: string | undefined;
    authProxyUrl: string | undefined;
    shouldFetch: boolean;
  };
};

export type OAuthPopupProviderView = {
  rawConfig: ZeroXKeyProviderConfig;
  masterConfig: ZeroXKeyProviderConfig | undefined;
  proxy: OAuthProxySnapshot | undefined;
  isMobile: boolean;
  client: OAuthBindingClient | undefined;
};

export type OAuthPopupRoute = {
  emittedRedirectUri: string;
  origin: string;
  observedPath: string;
  staticQuery: Array<readonly [string, string]>;
};

export type OAuthPopupBinding = {
  readonly route: OAuthPopupRoute;
  assertCurrent(): void;
};

export type StrictOAuthWebUrl = {
  parsed: URL;
  observedPath: string;
  rawQuery: string;
  rawHash: string;
};

export type OAuthInitializationBinding = {
  readonly constructorIdentity: OAuthConstructorIdentity;
  readonly client: OAuthBindingClient;
  readonly coreConfig: OAuthConstructorIdentity;
  readonly httpClient: OAuthBindingHttpClient;
  readonly httpConfig: EffectiveTransportIdentity;
  readonly effectiveHttpIdentity: EffectiveTransportIdentity;
};

type PopupProjection = {
  provider: OAuthProviders;
  clientId: string | undefined;
  openInPage: boolean;
  emittedRedirectUri: string | undefined;
  enabled: boolean | undefined;
};

const callbackSecurityFields = new Set([
  "state",
  "code",
  "id_token",
  "error",
  "error_description",
  "error_uri",
  "provider",
  "flow",
  "publicKey",
  "nonce",
  "transactionId",
  "sessionKey",
  "oauthIntent",
  "openModal",
  "redirectUri",
  "scope",
  "authuser",
  "prompt",
  "session_state",
]);

function unavailable(): never {
  throw new OAuthPopupBindingError("context-unavailable");
}

function changed(): never {
  throw new OAuthPopupBindingError("context-changed");
}

function invalidCallback(): never {
  throw new OAuthPopupBindingError("callback-config-invalid");
}

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

function hasDotSegment(rawPath: string): boolean {
  return rawPath.split("/").some((segment) => {
    try {
      const decoded = decodeURIComponent(segment).toLowerCase();
      return decoded === "." || decoded === "..";
    } catch {
      return true;
    }
  });
}

export function parseStrictOAuthWebUrl(
  rawUrl: string,
  options: Readonly<{ allowFragment: boolean }>,
): StrictOAuthWebUrl | undefined {
  if (/[\\\u0000-\u001f\u007f]/.test(rawUrl) || !hasValidEscapes(rawUrl)) {
    return undefined;
  }
  const raw = /^(https?):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(rawUrl);
  if (!raw) return undefined;
  const authority = raw[2]!;
  const rawPath = raw[3] ?? "";
  const rawQuery = raw[4]?.slice(1) ?? "";
  const rawHash = raw[5]?.slice(1) ?? "";
  if (
    authority === "" ||
    authority.includes("@") ||
    authority.includes("%") ||
    authority.endsWith(":") ||
    (!options.allowFragment && raw[5] !== undefined) ||
    hasDotSegment(rawPath)
  ) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return undefined;
  }
  return {
    parsed,
    observedPath: rawPath === "" ? "/" : rawPath,
    rawQuery,
    rawHash,
  };
}

function sameConstructorIdentity(
  left: OAuthConstructorIdentity,
  right: OAuthConstructorIdentity,
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.apiBaseUrl === right.apiBaseUrl &&
    left.authProxyUrl === right.authProxyUrl &&
    left.authProxyConfigId === right.authProxyConfigId
  );
}

function copyConstructorIdentity(
  identity: OAuthConstructorIdentity,
): OAuthConstructorIdentity {
  return {
    organizationId: identity.organizationId,
    apiBaseUrl: identity.apiBaseUrl,
    authProxyUrl: identity.authProxyUrl,
    authProxyConfigId: identity.authProxyConfigId,
  };
}

function copyTransportIdentity(
  identity: EffectiveTransportIdentity,
): EffectiveTransportIdentity {
  return {
    organizationId: identity.organizationId,
    apiBaseUrl: identity.apiBaseUrl,
    authProxyUrl: identity.authProxyUrl,
    authProxyConfigId: identity.authProxyConfigId,
  };
}

function sameTransportIdentity(
  left: EffectiveTransportIdentity,
  right: EffectiveTransportIdentity,
): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.apiBaseUrl === right.apiBaseUrl &&
    left.authProxyUrl === right.authProxyUrl &&
    left.authProxyConfigId === right.authProxyConfigId
  );
}

function transportMatchesExplicitConstructor(
  constructorIdentity: OAuthConstructorIdentity,
  transport: EffectiveTransportIdentity,
): boolean {
  return (
    constructorIdentity.organizationId === transport.organizationId &&
    (constructorIdentity.apiBaseUrl === undefined ||
      constructorIdentity.apiBaseUrl === transport.apiBaseUrl) &&
    (constructorIdentity.authProxyUrl === undefined ||
      constructorIdentity.authProxyUrl === transport.authProxyUrl) &&
    constructorIdentity.authProxyConfigId === transport.authProxyConfigId
  );
}

function cloneRelevant(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneRelevant);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        cloneRelevant(nested),
      ]),
    );
  }
  return value;
}

function sameRelevant(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameRelevant(value, right[index]))
    );
  }
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value]) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        sameRelevant(value, (right as Record<string, unknown>)[key]),
    )
  );
}

function providerClientId(
  config: ZeroXKeyProviderConfig,
  provider: OAuthProviders,
): string | undefined {
  const oauth = config.auth?.oauthConfig;
  switch (provider) {
    case "google":
      return oauth?.googleClientId;
    case "apple":
      return oauth?.appleClientId;
    case "facebook":
      return oauth?.facebookClientId;
    case "x":
      return oauth?.xClientId;
    case "discord":
      return oauth?.discordClientId;
    default:
      return undefined;
  }
}

function providerProxyClientId(
  proxy: ProxyTGetWalletKitConfigResponse | undefined,
  provider: OAuthProviders,
): string | undefined {
  const value = proxy?.oauthClientIds?.[provider];
  return typeof value === "string" ? value : undefined;
}

function providerEnabled(
  config: ZeroXKeyProviderConfig,
  provider: OAuthProviders,
): boolean | undefined {
  const methods = config.auth?.methods;
  switch (provider) {
    case "google":
      return methods?.googleOauthEnabled;
    case "apple":
      return methods?.appleOauthEnabled;
    case "facebook":
      return methods?.facebookOauthEnabled;
    case "x":
      return methods?.xOauthEnabled;
    case "discord":
      return methods?.discordOauthEnabled;
    default:
      return undefined;
  }
}

function emittedRedirectUri(
  provider: OAuthProviders,
  redirectUri: string | undefined,
): string | undefined {
  return provider === "google" ? redirectUri?.replace(/\/$/, "") : redirectUri;
}

function projectRaw(
  view: OAuthPopupProviderView,
  provider: OAuthProviders,
  invocation: Readonly<{
    clientId?: string | undefined;
    openInPage?: boolean | undefined;
  }>,
): PopupProjection {
  const proxy = view.proxy?.value;
  const defaultClientId =
    providerClientId(view.rawConfig, provider) ??
    providerProxyClientId(proxy, provider);
  const defaultOpenInPage = view.isMobile
    ? true
    : (view.rawConfig.auth?.oauthConfig?.openOauthInPage ?? false);
  const redirectUri =
    view.rawConfig.auth?.oauthConfig?.oauthRedirectUri ??
    proxy?.oauthRedirectUrl;
  const explicitEnabled = providerEnabled(view.rawConfig, provider);
  return {
    provider,
    clientId: invocation.clientId ?? defaultClientId,
    openInPage: invocation.openInPage ?? defaultOpenInPage,
    emittedRedirectUri: emittedRedirectUri(provider, redirectUri),
    enabled:
      explicitEnabled ?? proxy?.enabledProviders.includes(provider as string),
  };
}

function projectMaster(
  masterConfig: ZeroXKeyProviderConfig,
  provider: OAuthProviders,
  invocation: Readonly<{
    clientId?: string | undefined;
    openInPage?: boolean | undefined;
  }>,
): PopupProjection {
  return {
    provider,
    clientId: invocation.clientId ?? providerClientId(masterConfig, provider),
    openInPage:
      invocation.openInPage ??
      masterConfig.auth?.oauthConfig?.openOauthInPage ??
      false,
    emittedRedirectUri: emittedRedirectUri(
      provider,
      masterConfig.auth?.oauthConfig?.oauthRedirectUri,
    ),
    enabled: providerEnabled(masterConfig, provider),
  };
}

function sameProjection(
  left: PopupProjection,
  right: PopupProjection,
): boolean {
  return (
    left.provider === right.provider &&
    left.clientId === right.clientId &&
    left.openInPage === right.openInPage &&
    left.emittedRedirectUri === right.emittedRedirectUri &&
    left.enabled === right.enabled
  );
}

function captureRoute(
  emitted: string | undefined,
  openerOrigin: string,
): OAuthPopupRoute {
  if (!emitted) return invalidCallback();
  const strict = parseStrictOAuthWebUrl(emitted, { allowFragment: false });
  if (!strict || strict.parsed.origin !== openerOrigin) {
    return invalidCallback();
  }
  const staticQuery = Array.from(
    new URLSearchParams(strict.rawQuery).entries(),
  );
  if (staticQuery.some(([key]) => callbackSecurityFields.has(key))) {
    return invalidCallback();
  }
  return {
    emittedRedirectUri: emitted,
    origin: strict.parsed.origin,
    observedPath: strict.observedPath,
    staticQuery,
  };
}

function currentFetchIdentity(config: ZeroXKeyProviderConfig) {
  return {
    authProxyConfigId: config.authProxyConfigId,
    authProxyUrl: config.authProxyUrl,
    shouldFetch:
      !!config.authProxyConfigId && (config.autoFetchWalletKitConfig ?? true),
  };
}

function sameFetchIdentity(
  left: ReturnType<typeof currentFetchIdentity>,
  right: ReturnType<typeof currentFetchIdentity>,
): boolean {
  return (
    left.authProxyConfigId === right.authProxyConfigId &&
    left.authProxyUrl === right.authProxyUrl &&
    left.shouldFetch === right.shouldFetch
  );
}

function assertProxyProvenance(view: OAuthPopupProviderView): void {
  const current = currentFetchIdentity(view.rawConfig);
  if (current.shouldFetch) {
    if (!view.proxy || !sameFetchIdentity(current, view.proxy.fetchedFor)) {
      changed();
    }
  } else if (view.proxy !== undefined) {
    changed();
  }
}

export function createOAuthInitializationBinding(input: {
  constructorIdentity: OAuthConstructorIdentity;
  client: OAuthBindingClient;
}): OAuthInitializationBinding {
  try {
    const coreConfig = input.client.config;
    const httpClient = input.client.httpClient;
    const httpConfig = httpClient.config;
    const constructorSnapshot = copyConstructorIdentity(
      input.constructorIdentity,
    );
    const coreSnapshot = copyConstructorIdentity(coreConfig);
    const httpSnapshot = copyTransportIdentity(httpConfig);
    if (
      !sameConstructorIdentity(constructorSnapshot, coreSnapshot) ||
      !transportMatchesExplicitConstructor(constructorSnapshot, httpSnapshot)
    ) {
      return changed();
    }
    return {
      constructorIdentity: constructorSnapshot,
      client: input.client,
      coreConfig,
      httpClient,
      httpConfig,
      effectiveHttpIdentity: httpSnapshot,
    };
  } catch {
    return unavailable();
  }
}

export function captureOAuthPopupBinding(input: {
  initialization: OAuthInitializationBinding | undefined;
  readCurrent(): OAuthPopupProviderView;
  provider: OAuthProviders;
  invocation: Readonly<{
    clientId?: string | undefined;
    openInPage?: boolean | undefined;
  }>;
  operation: Readonly<{
    clientId: string;
    openInPage: boolean;
    emittedRedirectUri: string;
  }>;
  completion:
    | { category: "custom" }
    | { category: "internal"; internalSignupDefaults: unknown };
  openerOrigin: string;
}): OAuthPopupBinding {
  const initialization = input.initialization;
  if (!initialization) return unavailable();
  const invocation = {
    clientId: input.invocation.clientId,
    openInPage: input.invocation.openInPage,
  };
  let internalDefaults: unknown;
  let operation: typeof input.operation;
  try {
    internalDefaults =
      input.completion.category === "internal"
        ? cloneRelevant(input.completion.internalSignupDefaults)
        : undefined;
    operation = {
      clientId: input.operation.clientId,
      openInPage: input.operation.openInPage,
      emittedRedirectUri: input.operation.emittedRedirectUri,
    };
  } catch {
    return unavailable();
  }

  const readAndAssert = (): {
    view: OAuthPopupProviderView;
    projection: PopupProjection;
  } => {
    let view: OAuthPopupProviderView;
    try {
      view = input.readCurrent();
      if (!view.masterConfig || !view.client) return unavailable();
      assertProxyProvenance(view);
      if (view.client !== initialization.client) return changed();
      if (
        !sameConstructorIdentity(
          view.rawConfig,
          initialization.constructorIdentity,
        ) ||
        !sameConstructorIdentity(
          view.masterConfig,
          initialization.constructorIdentity,
        )
      ) {
        return changed();
      }
      if (
        view.client.config !== initialization.coreConfig ||
        !sameConstructorIdentity(
          view.client.config,
          initialization.constructorIdentity,
        )
      ) {
        return changed();
      }
      const httpClient = view.client.httpClient;
      if (
        httpClient !== initialization.httpClient ||
        httpClient.config !== initialization.httpConfig ||
        !sameTransportIdentity(
          httpClient.config,
          initialization.effectiveHttpIdentity,
        ) ||
        !transportMatchesExplicitConstructor(
          initialization.constructorIdentity,
          httpClient.config,
        )
      ) {
        return changed();
      }
      const rawProjection = projectRaw(view, input.provider, invocation);
      const masterProjection = projectMaster(
        view.masterConfig,
        input.provider,
        invocation,
      );
      if (!sameProjection(rawProjection, masterProjection)) return changed();
      if (input.completion.category === "internal") {
        const rawDefaults = view.rawConfig.auth?.createSuborgParams?.oauth;
        const masterDefaults =
          view.masterConfig.auth?.createSuborgParams?.oauth;
        if (
          !sameRelevant(rawDefaults, masterDefaults) ||
          !sameRelevant(rawDefaults, internalDefaults)
        ) {
          return changed();
        }
      }
      return { view, projection: rawProjection };
    } catch (error) {
      if (error instanceof OAuthPopupBindingError) throw error;
      return unavailable();
    }
  };

  const captured = readAndAssert().projection;
  if (
    captured.clientId !== operation.clientId ||
    captured.openInPage !== operation.openInPage ||
    captured.emittedRedirectUri !== operation.emittedRedirectUri
  ) {
    return changed();
  }
  if (
    !captured.clientId ||
    captured.openInPage ||
    !captured.emittedRedirectUri
  ) {
    return unavailable();
  }
  const route = captureRoute(captured.emittedRedirectUri, input.openerOrigin);
  return {
    route,
    assertCurrent() {
      const current = readAndAssert().projection;
      if (!sameProjection(current, captured)) changed();
    },
  };
}
