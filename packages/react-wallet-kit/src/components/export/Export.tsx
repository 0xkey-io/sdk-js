import { useEffect, useState } from "react";
import { useModal } from "../../providers/modal/Hook";
import { useZeroXKey } from "../../providers/client/Hook";
import { IframeStamper } from "@0xkey-io/iframe-stamper";
import { ZeroXKeyError, ZeroXKeyErrorCodes } from "@0xkey-io/sdk-types";
import { ExportWarning } from "./ExportWarning";
import { ActionButton } from "../design/Buttons";
import {
  type Address,
  type WalletId,
  type PrivateKeyId,
  ExportType,
  KeyFormat,
} from "../../types/base";
import clsx from "clsx";
import type { StamperType } from "@0xkey-io/core";

const ZeroXKeyExportIframeContainerId = "0xkey-export-iframe-container-id";
const ZeroXKeyIframeElementId = "zeroxkey-default-iframe-element-id";
const ZeroXKeyIframeClassNames =
  "w-full border-none !text-base bg-icon-background-light dark:bg-icon-background-dark";

// IMPORTANT: These colors need to match --icon-text-light, --icon-background-light, --icon-background-dark and --icon-text-dark in index.css
const iconBackgroundLight = "#e5e7eb";
const iconBackgroundDark = "#333336";
const iconTextLight = "#828282";
const iconTextDark = "#a3a3a5";

export function ExportComponent(params: {
  target: WalletId | PrivateKeyId | Address;
  exportType: ExportType;
  targetPublicKey?: string;
  keyFormat?: KeyFormat | undefined;
  stampWith?: StamperType | undefined;
  organizationId?: string;
  onSuccess: () => void;
  onError: (error: any) => void;
}) {
  const {
    exportType,
    targetPublicKey,
    keyFormat,
    stampWith,
    target,
    organizationId,
    onSuccess,
    onError,
  } = params;
  const { config } = useZeroXKey();

  if (!config) {
    throw new ZeroXKeyError(
      "ZeroXKey SDK is not properly configured. Please check your configuration.",
      ZeroXKeyErrorCodes.CONFIG_NOT_INITIALIZED,
    );
  }

  const [exportIframeVisible, setExportIframeVisible] = useState(false);

  const { closeModal, isMobile } = useModal();

  const exportIframeUrl = config?.exportIframeUrl;

  if (!exportIframeUrl) {
    throw new ZeroXKeyError(
      "Export iframe URL is not configured. Please set it in the ZeroXKey configuration.",
      ZeroXKeyErrorCodes.NOT_FOUND,
    );
  }

  const [exportIframeClient, setExportIframeClient] =
    useState<IframeStamper | null>(null);

  function removeExportIframe() {
    document.getElementById(ZeroXKeyIframeElementId)?.remove();
  }

  useEffect(() => {
    let isMounted = true;
    let currentIframeClient: IframeStamper | null = null;

    const initIframe = async () => {
      try {
        removeExportIframe();

        const newExportIframeClient = new IframeStamper({
          iframeUrl: exportIframeUrl,
          iframeElementId: ZeroXKeyIframeElementId,
          iframeContainer: document.getElementById(
            ZeroXKeyExportIframeContainerId,
          ),
        });
        currentIframeClient = newExportIframeClient;
        await newExportIframeClient.init();

        if (!isMounted) {
          newExportIframeClient.clear();
          return;
        }

        await newExportIframeClient.applySettings({
          styles: {
            fontSize: "16px",
            backgroundColor: config?.ui?.darkMode
              ? config?.ui?.colors?.dark?.iconBackground || iconBackgroundDark
              : config?.ui?.colors?.light?.iconBackground ||
                iconBackgroundLight,
            color: config?.ui?.darkMode
              ? config?.ui?.colors?.dark?.iconText || iconTextDark
              : config?.ui?.colors?.light?.iconText || iconTextLight,
          },
        });

        if (!isMounted) {
          newExportIframeClient.clear();
          return;
        }

        setExportIframeClient(newExportIframeClient);
      } catch (error) {
        onError(
          new ZeroXKeyError(
            `Error initializing IframeStamper`,
            ZeroXKeyErrorCodes.INITIALIZE_IFRAME_ERROR,
            error,
          ),
        );
      }
    };

    initIframe();

    const iframeElement = document.getElementById(ZeroXKeyIframeElementId);
    if (iframeElement) {
      iframeElement.className = ZeroXKeyIframeClassNames;
    }
    return () => {
      isMounted = false;
      currentIframeClient?.clear();
      removeExportIframe();
    };
  }, []);

  useEffect(() => {
    const reapplyIframeStyles = async () => {
      await exportIframeClient?.applySettings({
        styles: {
          fontSize: "16px",
          backgroundColor: config?.ui?.darkMode
            ? config?.ui?.colors?.dark?.iconBackground || iconBackgroundDark
            : config?.ui?.colors?.light?.iconBackground || iconBackgroundLight,
          color: config?.ui?.darkMode
            ? config?.ui?.colors?.dark?.iconText || iconTextDark
            : config?.ui?.colors?.light?.iconText || iconTextLight,
        },
      });
    };
    reapplyIframeStyles();
  }, [config.ui]);

  function handleExportModalClose() {
    if (exportIframeClient) {
      setExportIframeClient(null);
    }

    removeExportIframe();
  }

  return (
    <div
      className={clsx(
        "flex flex-col items-center pt-8",
        isMobile ? "w-full" : "w-72",
      )}
    >
      {!exportIframeVisible && (
        <ExportWarning
          target={target}
          exportIframeClient={exportIframeClient}
          targetPublicKey={targetPublicKey}
          exportType={exportType}
          keyFormat={keyFormat}
          stampWith={stampWith}
          setExportIframeVisible={setExportIframeVisible}
          organizationId={organizationId}
          onError={onError}
        />
      )}
      <div
        className={`transition-all delay-75 -pt-4 ${
          exportIframeVisible
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none w-0 h-0"
        }`}
      >
        <p className="text-xs text-icon-text-light dark:text-icon-text-dark">
          {exportType === ExportType.Wallet ? (
            <>
              Your seed phrase is the key to your wallet. Save it in a secure
              location.
            </>
          ) : exportType === ExportType.WalletAccount ? (
            <>
              Your private key is the key to your wallet account. Save it in a
              secure location.
            </>
          ) : (
            <>
              Your private key is the key to your account. Save it in a secure
              location.
            </>
          )}
        </p>
        <div
          id={ZeroXKeyExportIframeContainerId}
          style={{
            backgroundColor: config?.ui?.darkMode
              ? config?.ui?.colors?.dark?.iconBackground || iconBackgroundDark
              : config?.ui?.colors?.light?.iconBackground ||
                iconBackgroundLight,
            boxSizing: "border-box",
            borderStyle: "solid",
            borderWidth: "1px",
            borderRadius: "8px",
            width: "100%",
            height: "100%",
            borderColor: config?.ui?.darkMode
              ? config?.ui?.colors?.dark?.iconText || iconTextDark
              : config?.ui?.colors?.light?.iconText || iconTextLight,
          }}
          className="p-2"
        />

        <div className="mt-4">
          <ActionButton
            name="export-done"
            onClick={() => {
              handleExportModalClose();
              closeModal();
              onSuccess();
            }}
            spinnerClassName="text-primary-text-light dark:text-primary-text-dark"
            className="text-primary-text-light dark:text-primary-text-dark bg-primary-light dark:bg-primary-dark"
          >
            Done
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
