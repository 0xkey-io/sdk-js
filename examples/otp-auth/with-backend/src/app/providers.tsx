"use client";

import {
  ZeroXKeyProvider,
  ZeroXKeyProviderConfig,
} from "@0xkey-io/react-wallet-kit";

const zeroXKeyConfig: ZeroXKeyProviderConfig = {
  organizationId: process.env.NEXT_PUBLIC_ORGANIZATION_ID!,
};

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ZeroXKeyProvider
      config={zeroXKeyConfig}
      callbacks={{
        onError: (error) => console.error("ZeroXKey error:", error),
      }}
    >
      {children}
    </ZeroXKeyProvider>
  );
}
