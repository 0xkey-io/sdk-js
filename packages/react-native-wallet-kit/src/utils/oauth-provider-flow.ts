import type { ZeroXKeyClient } from "@0xkey-io/core";
import {
  OAuthProviders,
  type ProxyTGetWalletKitConfigResponse,
} from "@0xkey-io/sdk-types";
import type { ZeroXKeyCallbacks, ZeroXKeyProviderConfig } from "../types/base";
import type {
  HandleAppleOauthParams,
  HandleDiscordOauthParams,
  HandleFacebookOauthParams,
  HandleGoogleOauthParams,
  HandleXOauthParams,
} from "../types/method-types";
import {
  completeOAuthFlow,
  exchangeCodeForToken,
  ZEROXKEY_OAUTH_REDIRECT_URL,
  type CompleteOAuthFlowParams,
} from "./oauth";
import {
  createOAuthFlowCoordinator,
  type BrowserResult,
  type OAuthFlowCoordinator,
  type TrustedOauthFlow,
} from "./oauth-flow";
import { oauthTransactionSecureStorage } from "./oauth-keychain-storage";
import { resolveOauthProviderSettings } from "./oauth-provider-settings";
import { createOauthRoutingSnapshot } from "./oauth-routing";
import type { OAuthTransactionSecureStorage } from "./oauth-transaction";

export type OAuthProviderClient = Pick<
  ZeroXKeyClient,
  "config" | "httpClient" | "createApiKeyPair" | "discardUncommittedApiKeyPair"
>;

type CompleteOauth = CompleteOAuthFlowParams["completeOauth"];
type InternalCompletionCallbacks = CompleteOAuthFlowParams["callbacks"];
type HandlerParams =
  | HandleGoogleOauthParams
  | HandleAppleOauthParams
  | HandleFacebookOauthParams
  | HandleXOauthParams
  | HandleDiscordOauthParams;

export type CurrentOAuthProviderContext = {
  client: OAuthProviderClient | undefined;
  /** Latest rendered prop, updated during render before effects run. */
  config: ZeroXKeyProviderConfig;
  masterConfig: ZeroXKeyProviderConfig | undefined;
  proxyConfig: ProxyTGetWalletKitConfigResponse | null;
  callbacks: ZeroXKeyCallbacks | undefined;
  completeOauth: CompleteOauth;
};

type ConfiguredIdentity = Readonly<{
  organizationId: string;
  apiBaseUrl: string | undefined;
  authProxyUrl: string | undefined;
  authProxyConfigId: string | undefined;
}>;

type EffectiveContext = Readonly<{
  organizationId: string;
  apiBaseUrl: string;
  authProxyUrl: string;
  authProxyConfigId: string | undefined;
}>;

export type OAuthProviderFlowRuntime = {
  readonly client: OAuthProviderClient;
  readonly coordinator: OAuthFlowCoordinator;
  isReady(): boolean;
  start(provider: OAuthProviders, params?: HandlerParams): Promise<void>;
  getConfiguredFlows(): readonly TrustedOauthFlow[];
};

const PROVIDERS = [
  OAuthProviders.GOOGLE,
  OAuthProviders.APPLE,
  OAuthProviders.FACEBOOK,
  OAuthProviders.X,
  OAuthProviders.DISCORD,
] as const;

function required(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function identity(config: ZeroXKeyProviderConfig): ConfiguredIdentity {
  if (!required(config.organizationId))
    throw new Error("OAuth client context invalid");
  return Object.freeze({
    organizationId: config.organizationId,
    apiBaseUrl: required(config.apiBaseUrl) ? config.apiBaseUrl : undefined,
    authProxyUrl:
      required(config.authProxyUrl) && config.authProxyUrl.trim()
        ? config.authProxyUrl
        : undefined,
    authProxyConfigId: required(config.authProxyConfigId)
      ? config.authProxyConfigId
      : undefined,
  });
}

function sameIdentity(a: ConfiguredIdentity, b: ConfiguredIdentity): boolean {
  return (
    a.organizationId === b.organizationId &&
    a.apiBaseUrl === b.apiBaseUrl &&
    a.authProxyUrl === b.authProxyUrl &&
    a.authProxyConfigId === b.authProxyConfigId
  );
}

function sameEffective(a: EffectiveContext, b: EffectiveContext): boolean {
  return (
    a.organizationId === b.organizationId &&
    a.apiBaseUrl === b.apiBaseUrl &&
    a.authProxyUrl === b.authProxyUrl &&
    a.authProxyConfigId === b.authProxyConfigId
  );
}

function readEffective(client: OAuthProviderClient): EffectiveContext {
  const httpConfig = client.httpClient.config;
  if (
    !required(httpConfig.organizationId) ||
    !required(httpConfig.apiBaseUrl) ||
    !required(httpConfig.authProxyUrl)
  )
    throw new Error("OAuth client context invalid");
  const proxyId = required(httpConfig.authProxyConfigId)
    ? httpConfig.authProxyConfigId
    : undefined;
  if (
    client.config.organizationId !== httpConfig.organizationId ||
    (client.config.authProxyConfigId ?? undefined) !== proxyId
  )
    throw new Error("OAuth client context invalid");
  return Object.freeze({
    organizationId: httpConfig.organizationId,
    apiBaseUrl: httpConfig.apiBaseUrl,
    authProxyUrl: httpConfig.authProxyUrl,
    authProxyConfigId: proxyId,
  });
}

function locallyEnabled(
  config: ZeroXKeyProviderConfig,
  provider: OAuthProviders,
): boolean | undefined {
  const configured = config.auth?.oauth?.[provider];
  return configured === undefined ? undefined : configured !== false;
}

function selectCompletion(callbacks: ZeroXKeyCallbacks | undefined): {
  category: "onOauthSuccess" | "onOauthRedirect" | "internal";
  callback: ((...args: never[]) => void) | undefined;
  callbacks: InternalCompletionCallbacks | undefined;
} {
  const internal = callbacks as InternalCompletionCallbacks | undefined;
  if (internal?.onOauthSuccess) {
    return {
      category: "onOauthSuccess",
      callback: internal.onOauthSuccess as (...args: never[]) => void,
      callbacks: { onOauthSuccess: internal.onOauthSuccess },
    };
  }
  if (internal?.onOauthRedirect) {
    return {
      category: "onOauthRedirect",
      callback: internal.onOauthRedirect as (...args: never[]) => void,
      callbacks: { onOauthRedirect: internal.onOauthRedirect },
    };
  }
  return { category: "internal", callback: undefined, callbacks: undefined };
}

export function createOAuthProviderFlowRuntime(input: {
  client: OAuthProviderClient;
  initializedConfig: ZeroXKeyProviderConfig;
  getCurrent(): CurrentOAuthProviderContext;
  secureStorage?: OAuthTransactionSecureStorage;
  now?(): number;
  randomBytes?(length: number): Uint8Array;
  isBrowserAvailable(): Promise<boolean>;
  openAuth(url: string, returnTarget: string): Promise<BrowserResult>;
  generatePkce(): Promise<{ verifier: string; codeChallenge: string }>;
  facebookExchange?: typeof exchangeCodeForToken;
}): OAuthProviderFlowRuntime {
  const initializedIdentity = identity(input.initializedConfig);
  const httpClient = input.client.httpClient;
  const effective = readEffective(input.client);
  const facebookExchange = input.facebookExchange ?? exchangeCodeForToken;

  const baseIsCurrent = () => {
    try {
      const current = input.getCurrent();
      return (
        current.client === input.client &&
        current.masterConfig !== undefined &&
        sameIdentity(identity(current.config), initializedIdentity) &&
        sameIdentity(identity(current.masterConfig), initializedIdentity) &&
        input.client.httpClient === httpClient &&
        sameEffective(readEffective(input.client), effective)
      );
    } catch {
      return false;
    }
  };

  const createFlow = (
    provider: OAuthProviders,
    params?: HandlerParams,
  ): TrustedOauthFlow => {
    const current = input.getCurrent();
    if (!baseIsCurrent() || !current.masterConfig)
      throw new Error("OAuth context changed");
    const settings = resolveOauthProviderSettings({
      provider,
      oauth: current.config.auth?.oauth,
      invocation: params,
      proxyClientIds: current.proxyConfig?.oauthClientIds,
      proxyRedirectUri: current.proxyConfig?.oauthRedirectUrl,
      defaultRedirectUri: ZEROXKEY_OAUTH_REDIRECT_URL,
    });
    const selectedCompletion = selectCompletion(current.callbacks);
    const selectedComplete = current.completeOauth;
    const selectedLocalEnablement = locallyEnabled(current.config, provider);
    const selectedProxyEnablement =
      current.proxyConfig?.enabledProviders.includes(provider) === true;
    const snapshot = createOauthRoutingSnapshot({
      organizationId: effective.organizationId,
      apiBaseUrl: effective.apiBaseUrl,
      authProxyUrl: effective.authProxyUrl,
      ...(effective.authProxyConfigId
        ? { authProxyConfigId: effective.authProxyConfigId }
        : {}),
      provider,
      settings,
      completion: selectedCompletion.category,
    });
    const sameRenderedFlow = () => {
      if (!baseIsCurrent()) return false;
      try {
        const latest = input.getCurrent();
        const latestSettings = resolveOauthProviderSettings({
          provider,
          oauth: latest.config.auth?.oauth,
          invocation: params,
          proxyClientIds: latest.proxyConfig?.oauthClientIds,
          proxyRedirectUri: latest.proxyConfig?.oauthRedirectUrl,
          defaultRedirectUri: ZEROXKEY_OAUTH_REDIRECT_URL,
        });
        const latestSnapshot = createOauthRoutingSnapshot({
          organizationId: effective.organizationId,
          apiBaseUrl: effective.apiBaseUrl,
          authProxyUrl: effective.authProxyUrl,
          ...(effective.authProxyConfigId
            ? { authProxyConfigId: effective.authProxyConfigId }
            : {}),
          provider,
          settings: latestSettings,
          completion: selectCompletion(latest.callbacks).category,
        });
        const latestCompletion = selectCompletion(latest.callbacks);
        return (
          latestSnapshot.binding === snapshot.binding &&
          locallyEnabled(latest.config, provider) === selectedLocalEnablement &&
          (latest.proxyConfig?.enabledProviders.includes(provider) === true) ===
            selectedProxyEnablement &&
          latestCompletion.callback === selectedCompletion.callback &&
          latest.completeOauth === selectedComplete
        );
      } catch {
        return false;
      }
    };
    return Object.freeze({
      snapshot,
      isCurrent: sameRenderedFlow,
      async exchange({
        snapshot: exchangeSnapshot,
        nonce,
        authCode,
        codeVerifier,
      }) {
        if (provider === OAuthProviders.FACEBOOK) {
          const response = await facebookExchange(
            exchangeSnapshot.clientId,
            exchangeSnapshot.providerRedirectUri,
            authCode,
            codeVerifier,
          );
          if (!required(response.id_token))
            throw new Error("OAuth exchange failed");
          return response.id_token;
        }
        if (
          provider !== OAuthProviders.X &&
          provider !== OAuthProviders.DISCORD
        )
          throw new Error("OAuth exchange failed");
        const response = await httpClient.proxyOAuth2Authenticate({
          provider:
            provider === OAuthProviders.X
              ? "OAUTH2_PROVIDER_X"
              : "OAUTH2_PROVIDER_DISCORD",
          authCode,
          redirectUri: exchangeSnapshot.providerRedirectUri,
          codeVerifier,
          clientId: exchangeSnapshot.clientId,
          nonce,
        });
        if (!required(response.oidcToken))
          throw new Error("OAuth exchange failed");
        return response.oidcToken;
      },
      complete(completionInput) {
        return completeOAuthFlow({
          ...completionInput,
          ...(selectedCompletion.callbacks
            ? { callbacks: selectedCompletion.callbacks }
            : {}),
          completeOauth: selectedComplete,
        });
      },
    });
  };

  const getConfiguredFlows = (): readonly TrustedOauthFlow[] => {
    if (!baseIsCurrent()) return [];
    const current = input.getCurrent();
    const enabled = new Set(current.proxyConfig?.enabledProviders ?? []);
    const flows: TrustedOauthFlow[] = [];
    for (const provider of PROVIDERS) {
      const local = locallyEnabled(current.config, provider);
      if (local === false || (local === undefined && !enabled.has(provider)))
        continue;
      try {
        flows.push(createFlow(provider));
      } catch {
        // An incomplete configured provider is not a cold-recovery candidate.
      }
    }
    return Object.freeze(flows);
  };

  const cryptoRandom =
    input.randomBytes ??
    ((length: number) => {
      const cryptoSource = globalThis.crypto;
      if (!cryptoSource || typeof cryptoSource.getRandomValues !== "function")
        throw new Error("OAuth randomness unavailable");
      return cryptoSource.getRandomValues(new Uint8Array(length));
    });
  const coordinator = createOAuthFlowCoordinator({
    secureStorage: input.secureStorage ?? oauthTransactionSecureStorage,
    now: input.now ?? Date.now,
    randomBytes: cryptoRandom,
    isBrowserAvailable: input.isBrowserAvailable,
    openAuth: input.openAuth,
    generatePkce: input.generatePkce,
    createApiKeyPair: () => input.client.createApiKeyPair(),
    discardUncommittedApiKeyPair: (publicKey) =>
      input.client.discardUncommittedApiKeyPair(publicKey),
    getConfiguredFlows,
  });

  return {
    client: input.client,
    coordinator,
    isReady: baseIsCurrent,
    getConfiguredFlows,
    async start(provider, params) {
      const additionalState = params?.additionalState;
      await coordinator.startBrowserOAuth({
        flow: createFlow(provider, params),
        ...(additionalState ? { additionalState } : {}),
      });
    },
  };
}
