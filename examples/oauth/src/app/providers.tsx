// app/providers.tsx
"use client";
import { useRouter } from "next/navigation";
import {
  ZeroXKeyProvider,
  type ZeroXKeyProviderConfig,
} from "@0xkey-io/react-wallet-kit";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const config: ZeroXKeyProviderConfig = {
    organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
    auth: { autoRefreshSession: true },
  };

  return (
    <ZeroXKeyProvider
      config={config}
      callbacks={{
        onAuthenticationSuccess: () => router.push("/dashboard"),
        onError: (e) => console.error(e),
      }}
    >
      {children}
    </ZeroXKeyProvider>
  );
}
