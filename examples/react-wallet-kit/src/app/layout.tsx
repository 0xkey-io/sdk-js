"use client";

import "@0xkey-io/react-wallet-kit/styles.css";
import "./global.css";
import { ZeroXKeyConfigProvider } from "@/providers/config/ConfigProvider";
import "@fortawesome/fontawesome-svg-core/styles.css";
import { Slide, toast } from "react-toastify";
import { initialConfig } from "@/constants";
import { ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";

interface RootLayoutProps {
  children: React.ReactNode;
}

function RootLayout({ children }: RootLayoutProps) {
  const notify = (message: String) =>
    toast.error("Error: " + message, {
      position: "bottom-right",
      autoClose: 5000,
      hideProgressBar: false,
      pauseOnFocusLoss: false,
      closeOnClick: false,
      pauseOnHover: true,
      draggable: true,
      progress: undefined,
      transition: Slide,
    });

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>ZeroXKey Demo EWK</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body className="bg-background-light dark:bg-background-dark">
        <ZeroXKeyConfigProvider
          initialConfig={initialConfig}
          callbacks={{
            onError: (error) => {
              console.error("ZeroXKey Error:", error.code);
              switch (error.code) {
                case ZeroXKeyErrorCodes.ACCOUNT_ALREADY_EXISTS:
                  notify(
                    "This social login is already associated with another account.",
                  );
                  break;
                default:
                  notify(error.message);
              }
            },
          }}
        >
          {children}
        </ZeroXKeyConfigProvider>
      </body>
    </html>
  );
}

export default RootLayout;
