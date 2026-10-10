import { InAppBrowser } from "react-native-inappbrowser-reborn";
import type { NativeOwner } from "../utils/oauth-native-flow";
import {
  nativeOAuthError,
  type NativeBinding,
} from "../utils/oauth-native-store";
import {
  createGoogleIosNativeAdapter,
  type GoogleIosNativeBridge,
} from "./google-ios";
import { createGoogleIosSystemBridge } from "./google-ios-system";
import type { NativeEntropy, PrivateNativeAdapter } from "./contract";

/** Internal opt-in composition; no Provider route or public package export. */
export function createGoogleIosInstalledAdapter(input: {
  binding: NativeBinding;
  randomBytes: NativeEntropy;
}): PrivateNativeAdapter {
  if (typeof globalThis.fetch !== "function")
    throw nativeOAuthError("config-invalid");
  const bridge: GoogleIosNativeBridge = createGoogleIosSystemBridge({
    browser: InAppBrowser,
    fetcher: (url, init) => globalThis.fetch(url, init),
  });
  return createGoogleIosNativeAdapter({
    binding: input.binding,
    randomBytes: input.randomBytes,
    bridge,
  });
}

/** Connects the installed adapter to the existing durable NativeOwner flow. */
export function createGoogleIosInstalledOwner(
  input: Omit<NativeOwner, "binding" | "authenticate" | "ready"> & {
    binding: NativeBinding;
    randomBytes: NativeEntropy;
    ready: Promise<void>;
  },
): NativeOwner {
  const adapter = createGoogleIosInstalledAdapter(input);
  if (
    !input.ready ||
    typeof input.ready.then !== "function" ||
    typeof input.isCurrent !== "function" ||
    typeof input.createKey !== "function" ||
    typeof input.discardKey !== "function" ||
    typeof input.complete !== "function"
  ) {
    throw nativeOAuthError("config-invalid");
  }
  const ready = input.ready.then(async () => {
    try {
      if (!(await InAppBrowser.isAvailable()))
        throw nativeOAuthError("adapter-failed");
    } catch {
      throw nativeOAuthError("adapter-failed");
    }
  });
  void ready.catch(() => undefined);
  return Object.freeze({
    ready,
    binding: adapter.binding,
    isCurrent: input.isCurrent.bind(input),
    createKey: input.createKey.bind(input),
    discardKey: input.discardKey.bind(input),
    authenticate: adapter.authenticate,
    complete: input.complete.bind(input),
  });
}
