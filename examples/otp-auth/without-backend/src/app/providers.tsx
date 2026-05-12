"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ZeroXKeyProvider,
  type ZeroXKeyProviderConfig,
  type CreateSubOrgParams,
} from "@0xkey-io/react-wallet-kit";
import "@0xkey-io/react-wallet-kit/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const suborgParams = useMemo<CreateSubOrgParams>(() => {
    const ts = Date.now();
    return {
      userName: `User-${ts}`,
      customWallet: {
        walletName: `Default Wallet`,
        walletAccounts: [
          {
            curve: "CURVE_SECP256K1",
            pathFormat: "PATH_FORMAT_BIP32",
            path: `m/44'/60'/0'/0/0`,
            addressFormat: "ADDRESS_FORMAT_ETHEREUM",
          },
          {
            curve: "CURVE_ED25519",
            pathFormat: "PATH_FORMAT_BIP32",
            path: `m/44'/501'/0'/0'`,
            addressFormat: "ADDRESS_FORMAT_SOLANA",
          },
        ],
      },
    };
  }, []);

  const zeroXKeyConfig: ZeroXKeyProviderConfig = {
    organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
    authProxyConfigId: process.env.NEXT_PUBLIC_AUTH_PROXY_CONFIG_ID!,
    authProxyUrl:
      process.env.NEXT_PUBLIC_AUTH_PROXY_BASE_URL ||
      "https://authproxy.0xkey.com",
    auth: {
      methods: {
        emailOtpAuthEnabled: true,
        smsOtpAuthEnabled: false,
        passkeyAuthEnabled: false,
        walletAuthEnabled: false,
        googleOauthEnabled: false,
        appleOauthEnabled: false,
        facebookOauthEnabled: false,
        xOauthEnabled: false,
        discordOauthEnabled: false,
      },
      createSuborgParams: {
        emailOtpAuth: suborgParams,
      },
      autoRefreshSession: true,
    },
  };

  return (
    <ZeroXKeyProvider
      config={zeroXKeyConfig}
      callbacks={{
        onAuthenticationSuccess: ({ session }) => {
          console.log("Authenticated:", session);
          router.push("/dashboard");
        },
        onError: (error) => {
          console.error("ZeroXKey error:", error);
        },
      }}
    >
      {children}
    </ZeroXKeyProvider>
  );
}
