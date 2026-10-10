import type { OAuthTransactionSecureStorage } from "./oauth-transaction";

const TRANSACTION_SERVICE_PREFIX = "com.0xkey.oauth.transaction.v1:";
const TRANSACTION_USERNAME = "0xkey-oauth-transaction-v1";
const VALID_TRANSACTION_KEY = /^0xkey\.oauth\.transaction\.v1\.([0-9a-f]{32})$/;

const BRIDGE_UNAVAILABLE_ERROR =
  "OAuth transaction secure storage requires react-native-keychain";
const STORAGE_FAILURE_ERROR = "OAuth transaction secure storage failed";

interface KeychainCredentials {
  username: string;
  password: string;
}

export interface OAuthKeychainModule {
  getGenericPassword(options: {
    service: string;
  }): Promise<false | KeychainCredentials>;
  setGenericPassword(
    username: string,
    password: string,
    options: { service: string },
  ): Promise<false | { service: string }>;
  resetGenericPassword(options: { service: string }): Promise<boolean>;
}

function storageFailure(): Error {
  return new Error(STORAGE_FAILURE_ERROR);
}

function unavailable(): never {
  throw new Error(BRIDGE_UNAVAILABLE_ERROR);
}

function isKeychainModule(value: unknown): value is OAuthKeychainModule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OAuthKeychainModule>;
  return (
    typeof candidate.getGenericPassword === "function" &&
    typeof candidate.setGenericPassword === "function" &&
    typeof candidate.resetGenericPassword === "function"
  );
}

function serviceForKey(key: string): string {
  if (typeof key !== "string") throw storageFailure();
  const match = VALID_TRANSACTION_KEY.exec(key);
  if (!match) throw storageFailure();
  return `${TRANSACTION_SERVICE_PREFIX}${match[1]}`;
}

function ownedCredentials(
  credentials: false | KeychainCredentials,
): KeychainCredentials | null {
  if (credentials === false) return null;
  if (
    !credentials ||
    typeof credentials !== "object" ||
    credentials.username !== TRANSACTION_USERNAME ||
    typeof credentials.password !== "string"
  ) {
    throw storageFailure();
  }
  return credentials;
}

export function createOAuthKeychainStorage(
  source: OAuthKeychainModule | (() => OAuthKeychainModule),
): OAuthTransactionSecureStorage {
  let cached: OAuthKeychainModule | undefined;

  function loadKeychain(): OAuthKeychainModule {
    if (cached) return cached;
    try {
      const loaded = typeof source === "function" ? source() : source;
      if (!isKeychainModule(loaded)) return unavailable();
      cached = loaded;
      return loaded;
    } catch {
      return unavailable();
    }
  }

  async function getCredentials(
    service: string,
  ): Promise<KeychainCredentials | null> {
    const keychain = loadKeychain();
    try {
      return ownedCredentials(await keychain.getGenericPassword({ service }));
    } catch {
      throw storageFailure();
    }
  }

  return {
    async get(key) {
      const credentials = await getCredentials(serviceForKey(key));
      return credentials?.password ?? null;
    },
    async set(key, value) {
      const service = serviceForKey(key);
      if (typeof value !== "string") throw storageFailure();
      await getCredentials(service);
      const keychain = loadKeychain();
      try {
        const result = await keychain.setGenericPassword(
          TRANSACTION_USERNAME,
          value,
          { service },
        );
        if (result === false) throw storageFailure();
      } catch {
        throw storageFailure();
      }
    },
    async remove(key) {
      const service = serviceForKey(key);
      const existing = await getCredentials(service);
      if (existing === null) return;
      const keychain = loadKeychain();
      let removed = false;
      try {
        removed = await keychain.resetGenericPassword({ service });
      } catch {
        // A native rejection may happen before or after deletion. Verify the
        // exact service before deciding whether the idempotent remove held.
      }
      if (removed) return;
      if ((await getCredentials(service)) === null) return;
      throw storageFailure();
    },
  };
}

export const oauthTransactionSecureStorage = createOAuthKeychainStorage(() =>
  require("react-native-keychain"),
);
