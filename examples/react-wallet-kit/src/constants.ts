import {
  CreateSubOrgParams,
  ZeroXKeyProviderConfig,
} from "@0xkey-io/react-wallet-kit";

export const createSuborgParams: CreateSubOrgParams = {
  customWallet: {
    walletName: "Wallet 1",
    walletAccounts: [
      {
        addressFormat: "ADDRESS_FORMAT_ETHEREUM",
        curve: "CURVE_SECP256K1",
        pathFormat: "PATH_FORMAT_BIP32",
        path: "m/44'/60'/0'/0/0",
      },
      {
        addressFormat: "ADDRESS_FORMAT_SOLANA",
        curve: "CURVE_ED25519",
        pathFormat: "PATH_FORMAT_BIP32",
        path: "m/44'/501'/0'/0/0",
      },
    ],
  },
};

export const initialConfig: ZeroXKeyProviderConfig = {
  apiBaseUrl: process.env.NEXT_PUBLIC_BASE_URL || "https://api.0xkey.com",
  authProxyUrl:
    process.env.NEXT_PUBLIC_AUTH_PROXY_URL || "https://authproxy.0xkey.com",
  authProxyConfigId: process.env.NEXT_PUBLIC_AUTH_PROXY_ID!,
  organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
  importIframeUrl:
    process.env.NEXT_PUBLIC_IMPORT_IFRAME_URL || "https://import.0xkey.com",
  exportIframeUrl:
    process.env.NEXT_PUBLIC_EXPORT_IFRAME_URL || "https://export.0xkey.com",
  auth: {
    oauthConfig: {
      googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      facebookClientId: process.env.NEXT_PUBLIC_FACEBOOK_CLIENT_ID,
      appleClientId: process.env.NEXT_PUBLIC_APPLE_CLIENT_ID,
      oauthRedirectUri: process.env.NEXT_PUBLIC_OAUTH_REDIRECT_URI,
      openOauthInPage: true,
    },
    methods: {
      emailOtpAuthEnabled: true,
      smsOtpAuthEnabled: false,
      passkeyAuthEnabled: true,
      walletAuthEnabled: true,
      googleOauthEnabled: true,
      appleOauthEnabled: false,
      facebookOauthEnabled: false,
      xOauthEnabled: false,
      discordOauthEnabled: false,
    },
    // Coming soon: SMS OTP remains configured below, but hidden from the demo order for now.
    methodOrder: ["socials", "email", "passkey", "wallet"],
    autoRefreshSession: true,
    createSuborgParams: {
      emailOtpAuth: createSuborgParams,
      smsOtpAuth: createSuborgParams,
      passkeyAuth: createSuborgParams,
      walletAuth: createSuborgParams,
      oauth: createSuborgParams,
    },
    verifyWalletOnSignup: true,
  },
  ui: {
    darkMode: true,
    borderRadius: 16,
    renderModalInProvider: true, // This is needed for the config panel to push the modal over
    colors: {
      light: {
        primary: "#335bf9",
        modalBackground: "#f5f7fb",
      },
      dark: {
        primary: "#335bf9",
        primaryText: "#ffffff",
        modalBackground: "#111216",
        modalText: "#f5f7fb",
        button: "#202124",
        iconBackground: "#202124",
        iconText: "#ffffff",
      },
    },
  },
  walletConfig: {
    features: {
      auth: true,
      connecting: true,
    },
    chains: {
      ethereum: {
        native: true,
        walletConnectNamespaces: ["eip155:1"],
      },
      solana: {
        native: true,
        walletConnectNamespaces: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
      },
    },
    walletConnect: {
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
      appMetadata: {
        name: "ZeroXKey Wallet",
        description: "A wallet for ZeroXKey",
        url: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_URL!,
        icons: ["/favicon.svg"],
      },
    },
  },
};
