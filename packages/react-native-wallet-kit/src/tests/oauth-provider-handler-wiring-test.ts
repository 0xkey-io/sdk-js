import { describe, expect, it, jest } from "@jest/globals";
import type { ClientContextType } from "../providers/Types";
import type { ZeroXKeyProviderConfig } from "../types/base";

let mockUseStateCall = 0;
let mockMasterConfig: ZeroXKeyProviderConfig;
let mockClient: unknown;
const mockIsAvailable = jest.fn();
const mockOpenAuth = jest.fn();

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  return {
    ...actual,
    useCallback: <T>(callback: T): T => callback,
    useEffect: (): undefined => undefined,
    useRef: <T>(initial: T): { current: T } => ({ current: initial }),
    useState: <T>(initial?: T) => {
      mockUseStateCall += 1;
      const value =
        mockUseStateCall === 1
          ? mockClient
          : mockUseStateCall === 3
            ? mockMasterConfig
            : initial;
      return [value, jest.fn()] as const;
    },
  };
});

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("react-native-device-info", () => ({
  __esModule: true,
  default: {},
}));
jest.mock("react-native-inappbrowser-reborn", () => ({
  InAppBrowser: {
    isAvailable: (...args: unknown[]) => mockIsAvailable(...args),
    openAuth: (...args: unknown[]) => mockOpenAuth(...args),
  },
}));

import { ZeroXKeyProvider } from "../providers/ZeroXKeyProvider";

type OauthHandlerName =
  | "handleGoogleOauth"
  | "handleAppleOauth"
  | "handleFacebookOauth"
  | "handleXOauth"
  | "handleDiscordOauth";

const handlerCases: Array<[OauthHandlerName, Record<string, unknown>]> = [
  ["handleGoogleOauth", { primaryClientId: { webClientId: "google-call" } }],
  ["handleAppleOauth", { primaryClientId: { serviceId: "apple-call" } }],
  ["handleFacebookOauth", { primaryClientId: "facebook-call" }],
  ["handleXOauth", { primaryClientId: "x-call" }],
  ["handleDiscordOauth", { primaryClientId: "discord-call" }],
];

describe("OAuth handler settings wiring", () => {
  it.each(handlerCases)(
    "passes invocation overrides from %s",
    async (handler, params) => {
      mockUseStateCall = 0;
      mockClient = undefined;
      mockMasterConfig = {
        organizationId: "organization-id",
        auth: {
          oauth: {
            appScheme: "example",
            redirectUri: "https://oauth.example/callback",
            google: true,
            apple: true,
            facebook: true,
            x: true,
            discord: true,
          },
        },
      };

      const element = ZeroXKeyProvider({
        config: mockMasterConfig,
        children: null,
      }) as unknown as { props: { value: ClientContextType } };
      const invoke = element.props.value[handler] as (
        invocation: Record<string, unknown>,
      ) => Promise<void>;

      // Reaching the client gate proves the per-call ID survived handler wiring;
      // without it each handler fails earlier with its provider-specific ID error.
      await expect(invoke(params)).rejects.toThrow(
        "Client is not initialized.",
      );
    },
  );

  it("forwards Google additionalState into the authorization URL", async () => {
    mockUseStateCall = 0;
    mockClient = {
      createApiKeyPair: jest.fn(async () => "ephemeral-public-key"),
    };
    mockMasterConfig = {
      organizationId: "organization-id",
      auth: {
        oauth: {
          appScheme: "example",
          redirectUri: "https://oauth.example/callback",
          google: true,
        },
      },
    };
    mockIsAvailable.mockImplementation(async () => true);
    mockOpenAuth.mockImplementation(async () => ({ type: "cancel" }));

    const element = ZeroXKeyProvider({
      config: mockMasterConfig,
      children: null,
    }) as unknown as { props: { value: ClientContextType } };

    await expect(
      element.props.value.handleGoogleOauth({
        primaryClientId: { webClientId: "google-call" },
        additionalState: { returnTarget: "settings" },
      }),
    ).rejects.toThrow("OAuth flow did not complete successfully");

    const authorizationUrl = mockOpenAuth.mock.calls[0]?.[0];
    expect(typeof authorizationUrl).toBe("string");
    const state = new URL(authorizationUrl as string).searchParams.get("state");
    expect(new URLSearchParams(state ?? "").get("returnTarget")).toBe(
      "settings",
    );
  });
});
