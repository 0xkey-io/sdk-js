import type { OAuthProviders } from "@0xkey-io/sdk-types";
import {
  createOAuthTransactionStore,
  OAUTH_TRANSACTION_DATABASE_NAME,
} from "./transaction-store";

function compareQueryPair(
  left: [string, string],
  right: [string, string],
): number {
  if (left[0] < right[0]) return -1;
  if (left[0] > right[0]) return 1;
  if (left[1] < right[1]) return -1;
  if (left[1] > right[1]) return 1;
  return 0;
}

function canonicalEndpoint(value: string): string {
  return new URL(value).href;
}

type RedirectIdentity = {
  organizationId: string;
  configId: string | null;
  apiBaseUrl: string;
  authProxyUrl: string;
  provider: OAuthProviders;
  clientId: string;
  redirectUri: string;
};

function redirectBinding(input: RedirectIdentity) {
  const redirect = new URL(input.redirectUri);
  return {
    organizationId: input.organizationId,
    configId: input.configId,
    apiBaseUrl: canonicalEndpoint(input.apiBaseUrl),
    authProxyUrl: canonicalEndpoint(input.authProxyUrl),
    provider: input.provider,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    route: {
      origin: redirect.origin,
      pathname: redirect.pathname,
      staticQuery: Array.from(redirect.searchParams.entries()).sort(
        compareQueryPair,
      ),
    },
    completion: { kind: "redirect" as const },
  };
}

function openRedirectStore(discardFreshKey: (keyRef: string) => Promise<void>) {
  return createOAuthTransactionStore({
    databaseName: OAUTH_TRANSACTION_DATABASE_NAME,
    now: () => Date.now(),
    randomBytes() {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      return bytes;
    },
    discardFreshKey,
  });
}

export async function persistRedirectTransaction(
  input: RedirectIdentity & {
    expectedState: string;
    keyRef: string;
    verifier: string | null;
    discardFreshKey(keyRef: string): Promise<void>;
  },
): Promise<void> {
  const store = openRedirectStore((keyRef) => input.discardFreshKey(keyRef));
  try {
    await store.create({
      expectedState: input.expectedState,
      keyRef: input.keyRef,
      verifier: input.verifier,
      binding: redirectBinding(input),
    });
  } catch (error) {
    try {
      await input.discardFreshKey(input.keyRef);
    } catch {
      /* The caller still needs the persistence failure. */
    }
    throw error;
  }
}

export async function claimRedirectVerifier(
  input: RedirectIdentity & { returnedState: string },
): Promise<string | null> {
  const store = openRedirectStore(async () => {});
  const claimed = await store.claimReturned({
    returnedState: input.returnedState,
    binding: redirectBinding(input),
  });
  return claimed.verifier;
}
