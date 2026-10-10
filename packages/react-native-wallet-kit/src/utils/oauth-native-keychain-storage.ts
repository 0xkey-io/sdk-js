import {
  NATIVE_OAUTH_SERVICE,
  NATIVE_OAUTH_USERNAME,
  nativeOAuthError,
  type NativeSlotStorage,
} from "./oauth-native-store";
import type { OAuthKeychainModule } from "./oauth-keychain-storage";

export type NativeOAuthKeychainModule = OAuthKeychainModule;

function isKeychainModule(value: unknown): value is NativeOAuthKeychainModule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NativeOAuthKeychainModule>;
  return (
    typeof candidate.getGenericPassword === "function" &&
    typeof candidate.setGenericPassword === "function" &&
    typeof candidate.resetGenericPassword === "function"
  );
}

export function createNativeOAuthKeychainStorage(
  source: NativeOAuthKeychainModule | (() => NativeOAuthKeychainModule),
): NativeSlotStorage {
  let cached: NativeOAuthKeychainModule | undefined;

  function load(): NativeOAuthKeychainModule {
    if (cached) return cached;
    try {
      const candidate = typeof source === "function" ? source() : source;
      if (!isKeychainModule(candidate))
        throw nativeOAuthError("recovery-required");
      cached = candidate;
      return candidate;
    } catch {
      throw nativeOAuthError("recovery-required");
    }
  }

  async function credentials(): Promise<{
    username: string;
    password: string;
  } | null> {
    const keychain = load();
    try {
      const value = await keychain.getGenericPassword.call(keychain, {
        service: NATIVE_OAUTH_SERVICE,
      });
      if (value === false) return null;
      if (
        !value ||
        typeof value !== "object" ||
        value.username !== NATIVE_OAUTH_USERNAME ||
        typeof value.password !== "string"
      ) {
        throw nativeOAuthError("recovery-required");
      }
      return { username: value.username, password: value.password };
    } catch {
      throw nativeOAuthError("recovery-required");
    }
  }

  return Object.freeze({
    async read() {
      return (await credentials())?.password ?? null;
    },
    async write(value) {
      if (typeof value !== "string")
        throw nativeOAuthError("recovery-required");
      await credentials();
      const keychain = load();
      try {
        const result = await keychain.setGenericPassword.call(
          keychain,
          NATIVE_OAUTH_USERNAME,
          value,
          { service: NATIVE_OAUTH_SERVICE },
        );
        if (result === false) throw nativeOAuthError("recovery-required");
      } catch {
        throw nativeOAuthError("recovery-required");
      }
    },
    async remove() {
      if ((await credentials()) === null) return;
      const keychain = load();
      try {
        if (
          await keychain.resetGenericPassword.call(keychain, {
            service: NATIVE_OAUTH_SERVICE,
          })
        ) {
          return;
        }
      } catch {
        // A native rejection may happen after deletion; verify exact absence.
      }
      if ((await credentials()) === null) return;
      throw nativeOAuthError("recovery-required");
    },
  });
}
