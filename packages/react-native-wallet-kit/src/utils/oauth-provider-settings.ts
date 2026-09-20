import {
  OAuthProviders,
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
} from "@0xkey-io/sdk-types";
import type { ZeroXKeyProviderConfig } from "../types/base";

type EffectiveOauthConfig = NonNullable<
  NonNullable<ZeroXKeyProviderConfig["auth"]>["oauth"]
>;

export type OauthHandlerOverrides = {
  primaryClientId?: unknown;
  secondaryClientIds?: unknown;
  /** @deprecated Use `primaryClientId`. */
  clientId?: unknown;
};

export type ResolveOauthProviderSettingsParams = {
  provider: OAuthProviders;
  oauth?: EffectiveOauthConfig | undefined;
  invocation?: OauthHandlerOverrides | undefined;
  proxyClientIds?: Readonly<Record<string, unknown>> | undefined;
  proxyRedirectUri?: unknown | undefined;
  defaultRedirectUri: string;
};

export type ResolvedOauthProviderSettings = Readonly<{
  clientId: string | undefined;
  /** Kept distinct from Apple's browser Services ID. */
  iosBundleId: string | undefined;
  secondaryClientIds: readonly string[];
  redirectUri: string | undefined;
  appScheme: string | undefined;
}>;

type SettingsRecord = Record<string, unknown>;

function invalid(provider: OAuthProviders, field: string): never {
  throw new ZeroXKeyError(
    `Invalid OAuth ${provider} ${field} configuration.`,
    ZeroXKeyErrorCodes.INVALID_CONFIGURATION,
  );
}

function isRecord(value: unknown): value is SettingsRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: SettingsRecord, allowedKeys: readonly string[]) {
  return Object.keys(record).every((key) => allowedKeys.includes(key));
}

function optionalString(
  record: SettingsRecord | undefined,
  field: string,
  provider: OAuthProviders,
): string | undefined {
  if (!record || record[field] === undefined) return undefined;
  if (typeof record[field] !== "string") invalid(provider, field);
  return record[field] as string;
}

function optionalStringArray(
  record: SettingsRecord | undefined,
  field: string,
  provider: OAuthProviders,
): string[] | undefined {
  if (!record || record[field] === undefined) return undefined;
  const value = record[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalid(provider, field);
  }
  return [...(value as string[])];
}

function providerRecord(
  oauth: EffectiveOauthConfig | undefined,
  provider: OAuthProviders,
): SettingsRecord | undefined {
  const value = oauth?.[provider as keyof EffectiveOauthConfig] as unknown;
  if (value === undefined || typeof value === "boolean") return undefined;
  if (!isRecord(value)) invalid(provider, "provider");
  return value;
}

function invocationRecord(
  invocation: OauthHandlerOverrides | undefined,
  provider: OAuthProviders,
): SettingsRecord | undefined {
  if (invocation === undefined) return undefined;
  if (!isRecord(invocation)) invalid(provider, "handler parameters");
  return invocation;
}

function canonicalPrimary(
  provider: OAuthProviders,
  record: SettingsRecord | undefined,
): { clientId: string | undefined; iosBundleId: string | undefined } {
  if (!record || record.primaryClientId === undefined) {
    return { clientId: undefined, iosBundleId: undefined };
  }
  const primary = record.primaryClientId;

  if (provider === OAuthProviders.GOOGLE) {
    if (!isRecord(primary)) invalid(provider, "primaryClientId");
    if (
      !hasOnlyKeys(primary, ["webClientId"]) ||
      (primary.webClientId !== undefined &&
        typeof primary.webClientId !== "string")
    ) {
      invalid(provider, "primaryClientId");
    }
    return {
      clientId: primary.webClientId as string | undefined,
      iosBundleId: undefined,
    };
  }

  if (provider === OAuthProviders.APPLE) {
    if (!isRecord(primary)) invalid(provider, "primaryClientId");
    if (
      !hasOnlyKeys(primary, ["serviceId", "iosBundleId"]) ||
      (primary.serviceId !== undefined &&
        typeof primary.serviceId !== "string") ||
      (primary.iosBundleId !== undefined &&
        typeof primary.iosBundleId !== "string")
    ) {
      invalid(provider, "primaryClientId");
    }
    return {
      clientId: primary.serviceId as string | undefined,
      iosBundleId: primary.iosBundleId as string | undefined,
    };
  }

  if (typeof primary !== "string") invalid(provider, "primaryClientId");
  return { clientId: primary, iosBundleId: undefined };
}

function proxyClientId(
  proxyClientIds: Readonly<Record<string, unknown>> | undefined,
  provider: OAuthProviders,
): string | undefined {
  const value = proxyClientIds?.[provider];
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalid(provider, "proxy clientId");
  return value;
}

/**
 * Resolves one provider's browser settings without retaining caller-owned
 * mutable inputs. This intentionally does not register secondary accounts or
 * select a native implementation.
 */
export function resolveOauthProviderSettings({
  provider,
  oauth,
  invocation,
  proxyClientIds,
  proxyRedirectUri,
  defaultRedirectUri,
}: ResolveOauthProviderSettingsParams): ResolvedOauthProviderSettings {
  const providerSettings = providerRecord(oauth, provider);
  const invocationSettings = invocationRecord(invocation, provider);
  const invocationPrimary = canonicalPrimary(provider, invocationSettings);
  const configuredPrimary = canonicalPrimary(provider, providerSettings);
  const invocationLegacyClientId = optionalString(
    invocationSettings,
    "clientId",
    provider,
  );
  const configuredLegacyClientId = optionalString(
    providerSettings,
    "clientId",
    provider,
  );
  const configuredProxyClientId = proxyClientId(proxyClientIds, provider);

  const clientId =
    invocationPrimary.clientId ??
    invocationLegacyClientId ??
    configuredPrimary.clientId ??
    configuredLegacyClientId ??
    configuredProxyClientId;

  const iosBundleId =
    invocationPrimary.iosBundleId ?? configuredPrimary.iosBundleId;

  const invocationSecondary = optionalStringArray(
    invocationSettings,
    "secondaryClientIds",
    provider,
  );
  const configuredSecondary = optionalStringArray(
    providerSettings,
    "secondaryClientIds",
    provider,
  );
  const secondaryClientIds = Object.freeze([
    ...(invocationSecondary ?? configuredSecondary ?? []),
  ]);

  const providerRedirectUri = optionalString(
    providerSettings,
    "redirectUri",
    provider,
  );
  const oauthRecord = oauth as SettingsRecord | undefined;
  const sharedRedirectUri = optionalString(
    oauthRecord,
    "redirectUri",
    provider,
  );
  const appScheme = optionalString(oauthRecord, "appScheme", provider);
  if (proxyRedirectUri !== undefined && typeof proxyRedirectUri !== "string") {
    invalid(provider, "proxy redirectUri");
  }

  const sharedOrDefaultRedirect =
    sharedRedirectUri ??
    (proxyRedirectUri as string | undefined) ??
    defaultRedirectUri;
  const redirectUri =
    providerRedirectUri ??
    ((provider === OAuthProviders.X || provider === OAuthProviders.DISCORD) &&
    appScheme
      ? `${appScheme}://`
      : sharedOrDefaultRedirect);

  return Object.freeze({
    clientId,
    iosBundleId,
    secondaryClientIds,
    redirectUri,
    appScheme,
  });
}
