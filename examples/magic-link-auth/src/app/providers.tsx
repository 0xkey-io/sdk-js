"use client";

import { useRouter } from "next/navigation";
import {
  ZeroXKeyProvider,
  type ZeroXKeyProviderConfig,
  type CreateSubOrgParams,
} from "@0xkey-io/react-wallet-kit";
import "@0xkey-io/react-wallet-kit/styles.css";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const zeroXKeyConfig: ZeroXKeyProviderConfig = {
    organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
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
