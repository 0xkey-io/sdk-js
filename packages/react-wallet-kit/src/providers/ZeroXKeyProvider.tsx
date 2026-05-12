"use client";

import { ClientProvider } from "./client/Provider";
import { ModalProvider } from "./modal/Provider";
import { ModalRoot } from "./modal/Root";
import { ZeroXKeyThemeOverrides } from "./theme/Overrides";
import type { ZeroXKeyCallbacks, ZeroXKeyProviderConfig } from "../types/base";

/** @internal */
export function ZeroXKeyProvider({
  children,
  config,
  callbacks,
}: {
  children: React.ReactNode;
  config: ZeroXKeyProviderConfig;
  callbacks?: ZeroXKeyCallbacks;
}) {
  return (
    <ModalProvider>
      <ClientProvider config={config} callbacks={callbacks}>
        <ZeroXKeyThemeOverrides
          light={config.ui?.colors?.light}
          dark={config.ui?.colors?.dark}
        />
        {children}

        {config.ui?.renderModalInProvider && (
          // https://github.com/tailwindlabs/headlessui/discussions/666#discussioncomment-3449763
          <div id="headlessui-portal-root">
            <div></div>
          </div>
        )}

        <ModalRoot config={config} />
      </ClientProvider>
    </ModalProvider>
  );
}
