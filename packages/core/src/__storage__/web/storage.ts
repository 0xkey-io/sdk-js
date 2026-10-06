import WindowWrapper from "@polyfills/window";
import type { Wallet } from "../../__types__";
import { AuthStorageManager } from "../auth-storage";
import { WebAtomicBoundSessionStore } from "./bound-session";
import { cleanupLegacyWebKeys } from "./legacy-keys";

const browserStorage = WindowWrapper.localStorage;

export class WebStorageManager extends AuthStorageManager {
  constructor() {
    super(
      {
        identity: browserStorage,
        get: async (key) => browserStorage.getItem(key),
        set: async (key, value) => {
          browserStorage.setItem(key, value);
        },
        remove: async (key) => {
          browserStorage.removeItem(key);
        },
        cleanup: (keys) => cleanupLegacyWebKeys(keys),
      },
      // Keep the adapter present so Core init rejects unavailable IndexedDB
      // instead of treating this built-in Web manager as legacy storage.
      new WebAtomicBoundSessionStore(),
    );
  }
  storeWallets = async (wallets: Wallet[]): Promise<void> => {
    for (const wallet of wallets)
      browserStorage.setItem(wallet.walletId, JSON.stringify(wallet));
  };
}
