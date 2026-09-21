import { jest } from "@jest/globals";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  ClientContextType,
  ZeroXKeyCallbacks,
  ZeroXKeyProviderConfig,
} from "../../index";

type PublicExports = typeof import("../../index");

export type MountedProvider = {
  container: HTMLDivElement;
  root: Root;
  context(): ClientContextType | undefined;
  rerender(
    config: ZeroXKeyProviderConfig,
    callbacks?: ZeroXKeyCallbacks,
    children?: ReactNode,
  ): Promise<void>;
};

export type ProviderDomOptions = {
  fetchImpl?: typeof fetch;
};

function restoreDescriptor(
  object: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(object, key, descriptor);
  } else {
    Reflect.deleteProperty(object, key);
  }
}

function snapshotStorage(storage: Storage): Array<[string, string]> {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index)!;
    return [key, storage.getItem(key)!];
  });
}

export function setupProviderDom(options: ProviderDomOptions = {}) {
  const textEncoderDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "TextEncoder",
  );
  const textDecoderDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "TextDecoder",
  );
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(window, "crypto");
  const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const actEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const actEnvironmentDescriptor = Object.getOwnPropertyDescriptor(
    actEnvironment,
    "IS_REACT_ACT_ENVIRONMENT",
  );
  const storageSnapshot = snapshotStorage(localStorage);
  const originalUrl = window.location.href;

  Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    writable: true,
    value: TextEncoder,
  });
  Object.defineProperty(globalThis, "TextDecoder", {
    configurable: true,
    writable: true,
    value: TextDecoder,
  });

  if (window.crypto !== globalThis.crypto) {
    throw new Error("jsdom window.crypto and globalThis.crypto diverged");
  }
  const cryptoAdapterInstalled = !window.crypto.subtle;
  if (cryptoAdapterInstalled) {
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }

  Object.defineProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    writable: true,
    value: true,
  });
  jest.useFakeTimers();
  localStorage.clear();
  window.history.replaceState(null, document.title, "/");

  if (options.fetchImpl) {
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      writable: true,
      value: options.fetchImpl,
    });
  }

  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation((...args: Parameters<typeof console.error>) =>
      originalConsoleError(...args),
    );
  const consoleWarn = jest
    .spyOn(console, "warn")
    .mockImplementation((...args: Parameters<typeof console.warn>) =>
      originalConsoleWarn(...args),
    );
  const addEventListener = jest.spyOn(window, "addEventListener");
  const removeEventListener = jest.spyOn(window, "removeEventListener");
  const xhrSend = jest.spyOn(window.XMLHttpRequest.prototype, "send");
  const fetchSpy =
    typeof globalThis.fetch === "function"
      ? jest.spyOn(globalThis, "fetch")
      : undefined;

  const core =
    jest.requireMock<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  const getAuthProxyConfig = jest.spyOn(core, "getAuthProxyConfig");
  let publicExports: PublicExports | undefined;
  const mounted = new Set<MountedProvider>();

  const loadPublicExports = (): PublicExports => {
    publicExports ??= jest.requireActual<PublicExports>("../../index");
    return publicExports;
  };

  const mount = async (
    config: ZeroXKeyProviderConfig,
    callbacks?: ZeroXKeyCallbacks,
    children?: ReactNode,
  ): Promise<MountedProvider> => {
    const { ZeroXKeyProvider, useZeroXKey } = loadPublicExports();
    let latestContext: ClientContextType | undefined;
    function Probe(): ReactNode {
      latestContext = useZeroXKey();
      return (
        <output data-testid="provider-state">
          {latestContext.clientState ?? "unset"}|{latestContext.authState}
        </output>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const handle: MountedProvider = {
      container,
      root,
      context: () => latestContext,
      async rerender(nextConfig, nextCallbacks, nextChildren) {
        await act(async () => {
          root.render(
            <ZeroXKeyProvider
              config={nextConfig}
              {...(nextCallbacks !== undefined && {
                callbacks: nextCallbacks,
              })}
            >
              <Probe />
              {nextChildren}
            </ZeroXKeyProvider>,
          );
        });
      },
    };
    mounted.add(handle);
    await act(async () => {
      root.render(
        <ZeroXKeyProvider
          config={config}
          {...(callbacks !== undefined && { callbacks })}
        >
          <Probe />
          {children}
        </ZeroXKeyProvider>,
      );
    });
    return handle;
  };

  const unmount = async (handle: MountedProvider): Promise<void> => {
    if (!mounted.delete(handle)) return;
    await act(async () => {
      handle.root.unmount();
      await Promise.resolve();
    });
    handle.container.remove();
  };

  const restore = async (): Promise<void> => {
    for (const handle of [...mounted]) {
      await unmount(handle);
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
    localStorage.clear();
    for (const [key, value] of storageSnapshot) {
      localStorage.setItem(key, value);
    }
    window.history.replaceState(null, document.title, originalUrl);
    restoreDescriptor(globalThis, "fetch", fetchDescriptor);
    restoreDescriptor(window, "crypto", cryptoDescriptor);
    restoreDescriptor(globalThis, "TextEncoder", textEncoderDescriptor);
    restoreDescriptor(globalThis, "TextDecoder", textDecoderDescriptor);
    restoreDescriptor(
      actEnvironment,
      "IS_REACT_ACT_ENVIRONMENT",
      actEnvironmentDescriptor,
    );
  };

  return {
    loadPublicExports,
    mount,
    unmount,
    restore,
    observations: {
      consoleError,
      consoleWarn,
      addEventListener,
      removeEventListener,
      xhrSend,
      fetch: fetchSpy,
      getAuthProxyConfig,
      cryptoAdapterInstalled,
    },
  };
}
