/**
 * @jest-environment jsdom
 * @jest-environment-options {"url":"https://app.example.test/"}
 */
import { describe, expect, it, jest } from "@jest/globals";
import { act } from "react";
import { ZeroXKeyError, ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";
import type { ZeroXKeyClient, ZeroXKeyProviderConfig } from "../index";
import {
  setupProviderDom,
  type MountedProvider,
} from "./fixtures/provider-dom";
import { installControlledResizeObserver } from "./fixtures/provider-modal-environment";

const mockAddPasskey = jest.fn<(params?: unknown) => Promise<string[]>>();

jest.mock("@lottiefiles/react-lottie-player", () => {
  const fixture = jest.requireActual<
    typeof import("./fixtures/provider-modal-environment")
  >("./fixtures/provider-modal-environment");
  return { Player: fixture.InstrumentedPlayer };
});

jest.mock("@0xkey-io/core", () => {
  const actual =
    jest.requireActual<typeof import("@0xkey-io/core")>("@0xkey-io/core");
  return {
    ...actual,
    ZeroXKeyClient: jest.fn((config: unknown) => {
      const constructorConfig = config as ZeroXKeyProviderConfig;
      return {
        config: constructorConfig,
        init: async () => undefined,
        restrictPersistedCredentialsToNewSessions: () => undefined,
        setAuthContextGuard: () => undefined,
        getAllSessions: async () => ({}),
        getActiveSessionKey: async () => undefined,
        getSession: async () => undefined,
        addPasskey: mockAddPasskey,
        httpClient: {
          config: {
            organizationId: constructorConfig.organizationId,
            apiBaseUrl: constructorConfig.apiBaseUrl,
            authProxyUrl: constructorConfig.authProxyUrl,
          },
        },
      } as unknown as ZeroXKeyClient;
    }),
  };
});

const config: ZeroXKeyProviderConfig = {
  organizationId: "org-passkey",
  apiBaseUrl: "https://api.example.test",
  authProxyUrl: "https://auth.example.test",
  autoFetchWalletKitConfig: false,
  autoRefreshManagedState: false,
  auth: {
    methods: { walletAuthEnabled: false },
    autoRefreshSession: false,
  },
  walletConfig: {
    features: { auth: false, connecting: false },
    chains: {
      ethereum: { native: false },
      solana: { native: false },
    },
  },
};

async function mountReady(
  dom: ReturnType<typeof setupProviderDom>,
  callbacks?: { onError: jest.Mock },
): Promise<MountedProvider> {
  const { ClientState } = dom.loadPublicExports();
  const mounted = await dom.mount(config, callbacks);
  for (let index = 0; index < 20; index += 1) {
    if (mounted.context()?.clientState === ClientState.Ready) break;
    await act(async () => {
      await Promise.resolve();
    });
  }
  expect(mounted.context()?.clientState).toBe(ClientState.Ready);
  return mounted;
}

describe("handleAddPasskey", () => {
  it("returns the new authenticator IDs and shows the success page", async () => {
    mockAddPasskey.mockReset();
    mockAddPasskey.mockResolvedValue(["authenticator-1"]);

    const resize = installControlledResizeObserver();
    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    try {
      mounted = await mountReady(dom);

      let result: string[] | undefined;
      await act(async () => {
        result = await mounted!.context()!.handleAddPasskey({
          userId: "user-passkey",
          organizationId: "org-passkey",
        });
      });

      expect(result).toEqual(["authenticator-1"]);
      expect(document.body.textContent).toContain(
        "Successfully added passkey!",
      );
    } finally {
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
      resize.restore();
    }
  });

  it("rejects to the caller without leaving an unhandled rejection", async () => {
    const invalidName = new ZeroXKeyError(
      "Passkey name must be 1-64 characters and only contain letters, numbers, spaces, dashes, underscores, colons, or slashes.",
      ZeroXKeyErrorCodes.INVALID_REQUEST,
    );
    mockAddPasskey.mockReset();
    mockAddPasskey.mockRejectedValue(invalidName);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    const dom = setupProviderDom();
    let mounted: MountedProvider | undefined;
    try {
      const callbacks = { onError: jest.fn() };
      mounted = await mountReady(dom, callbacks);

      let caught: unknown;
      await act(async () => {
        await mounted!
          .context()!
          .handleAddPasskey({
            name: "laptop@home",
            userId: "user-passkey",
            organizationId: "org-passkey",
          })
          .catch((error: unknown) => {
            caught = error;
          });
      });

      expect(caught).toBe(invalidName);
      expect(mockAddPasskey).toHaveBeenCalledWith(
        expect.objectContaining({ name: "laptop@home" }),
      );
      expect(callbacks.onError).toHaveBeenCalledWith(invalidName);
    } finally {
      if (mounted) await dom.unmount(mounted);
      await dom.restore();
    }

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
