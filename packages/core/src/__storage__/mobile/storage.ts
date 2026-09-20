import { AuthStorageManager } from "../auth-storage";
import { cleanupLegacyNativeKeys } from "./legacy-keys";

let AsyncStorage: (typeof import("@react-native-async-storage/async-storage"))["default"];
try {
  const mod = require("@react-native-async-storage/async-storage");
  AsyncStorage = mod.default ?? mod;
} catch {
  throw new Error(
    "Please install @react-native-async-storage/async-storage in your app to use MobileStorageManager",
  );
}

export class MobileStorageManager extends AuthStorageManager {
  constructor() {
    super({
      identity: AsyncStorage,
      get: (key) => AsyncStorage.getItem(key),
      set: (key, value) => AsyncStorage.setItem(key, value),
      remove: (key) => AsyncStorage.removeItem(key),
      cleanup: cleanupLegacyNativeKeys,
    });
  }
}
