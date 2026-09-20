import { WebStorageManager } from "./web/storage";
import { isReactNative, isWeb } from "@utils";
import type { StorageBase } from "../__types__";
import { AuthResetError } from "./auth-reset";

// TODO (Amir): Turn this into a class that extends StorageBase and make an init function. See stamper
export async function createStorageManager(): Promise<StorageBase> {
  if (isReactNative()) {
    try {
      // Dynamic import to prevent bundling the native module in web environments
      const { MobileStorageManager } = await import("./mobile/storage");
      const manager = new MobileStorageManager();
      await manager.prepare();
      return manager;
    } catch (error) {
      if (error instanceof AuthResetError) throw error;
      throw new Error("Failed to prepare storage manager for react-native");
    }
  } else if (isWeb()) {
    const manager = new WebStorageManager();
    await manager.prepare();
    return manager;
  } else {
    throw new Error("Unsupported environment for storage manager.");
  }
}
