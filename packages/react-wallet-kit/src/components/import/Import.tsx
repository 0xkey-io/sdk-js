import { useEffect, useState } from "react";
import { useModal } from "../../providers/modal/Hook";
import { useZeroXKey } from "../../providers/client/Hook";
import { IframeStamper, KeyFormat } from "@0xkey-io/iframe-stamper";
import {
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
  v1AddressFormat,
  v1Curve,
  v1WalletAccountParams,
} from "@0xkey-io/sdk-types";
import { ActionButton } from "../design/Buttons";
import { Input } from "@headlessui/react";
import {
  type StamperType,
  generateWalletAccountsFromAddressFormat,
} from "@0xkey-io/core";
import { SuccessPage } from "../design/Success";
import clsx from "clsx";
import { ImportType } from "../../types/base";

const ZeroXKeyImportIframeContainerId = "0xkey-import-iframe-container-id";
const ZeroXKeyIframeElementId = "zeroxkey-default-iframe-element-id";
const ZeroXKeyIframeClassNames =
  "w-full h-full overflow-hidden border-none !text-base bg-icon-background-light dark:bg-icon-background-dark";

// IMPORTANT: These colors need to match --icon-text-light, --icon-background-light, --icon-background-dark and --icon-text-dark in index.css
const iconBackgroundLight = "#e5e7eb";
const iconBackgroundDark = "#333336";
const iconTextLight = "#828282";
const iconTextDark = "#a3a3a5";

export function ImportComponent(props: {
  importType: ImportType;
  defaultWalletAccounts?: v1AddressFormat[] | v1WalletAccountParams[];
  addressFormats?: v1AddressFormat[] | undefined; // Only used if importType is ImportType.PrivateKey
  curve?: v1Curve | undefined; // Only used if importType is ImportType.PrivateKey
  keyFormat?: KeyFormat | undefined; // Only used if importType is ImportType.PrivateKey
  onSuccess: (id: string) => void;
  onError: (error: ZeroXKeyError) => void;
  successPageDuration?: number | undefined; // Duration in milliseconds for the success page to show. If 0, it will not show the success page.
  stampWith?: StamperType | undefined;
  clearClipboardOnPaste?: boolean | undefined;
  name?: string;
  organizationId?: string;
  userId?: string;
}) {
  const {
    importType,
    curve = "CURVE_SECP256K1",
    addressFormats = ["ADDRESS_FORMAT_ETHEREUM"],
    onSuccess,
    onError,
    defaultWalletAccounts,
    successPageDuration,
    clearClipboardOnPaste,
    stampWith,
    name,
    keyFormat,
  } = props;

  const { config, session, importWallet, importPrivateKey, httpClient } =
    useZeroXKey();

  if (!config) {
    throw new ZeroXKeyError(
      "ZeroXKey SDK is not properly configured. Please check your configuration.",
      ZeroXKeyErrorCodes.CONFIG_NOT_INITIALIZED,
    );
  }

  const organizationId = props.organizationId || session?.organizationId;
  if (!organizationId) {
    throw new ZeroXKeyError(
      "Organization ID or a valid session is required for importing. Please pass in an organizationId or log in.",
      ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
    );
  }
  const userId = props.userId || session?.userId;
  if (!userId) {
    throw new ZeroXKeyError(
      "User ID or a valid session is required for importing. Please pass in a userId or log in.",
      ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
    );
  }

  const [walletName, setWalletName] = useState<string>(name || "");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<ZeroXKeyError | null>(null);

  const [shaking, setShaking] = useState(false);

  const shakeInput = () => {
    setShaking(true);
    setTimeout(() => setShaking(false), 250);
  };

  const importIframeUrl = config?.importIframeUrl!;

  const { closeModal, pushPage, isMobile } = useModal();

  const [importIframeClient, setImportIframeClient] =
    useState<IframeStamper | null>(null);

  const subtitle =
    importType === ImportType.Wallet
      ? "Enter your seed phrase. Seed phrases are typically 12-24 words."
      : importType === ImportType.PrivateKey
        ? "Enter your private key."
        : "";

  const placeholder =
    importType === ImportType.Wallet
      ? "Enter your wallet name"
      : importType === ImportType.PrivateKey
        ? "Enter your private key name"
        : "";

  function removeImportIframe() {
    document.getElementById(ZeroXKeyIframeElementId)?.remove();
  }

  useEffect(() => {
    let isMounted = true;
    let currentIframeClient: IframeStamper | null = null;

    const initIframe = async () => {
      try {
        removeImportIframe();

        const newImportIframeClient = new IframeStamper({
          iframeUrl: importIframeUrl,
          iframeElementId: ZeroXKeyIframeElementId,
          iframeContainer: document.getElementById(
            ZeroXKeyImportIframeContainerId,
          ),
          clearClipboardOnPaste,
        });
        currentIframeClient = newImportIframeClient;
        await newImportIframeClient.init();

        if (!isMounted) {
          newImportIframeClient.clear();
          return;
        }

        await newImportIframeClient.applySettings({
          styles: {
            fontSize: "16px",
            // IMPORTANT: These colors need to match --icon-text-light and --icon-text-dark in index.css
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
          newImportIframeClient.clear();
          return;
        }

        setImportIframeClient(newImportIframeClient);
      } catch (error) {
        const iframeError = new ZeroXKeyError(
          `Error initializing IframeStamper`,
          ZeroXKeyErrorCodes.INTERNAL_ERROR,
          error,
        );
        setError(iframeError);
        onError(iframeError);
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
      removeImportIframe();
    };
  }, []);

  useEffect(() => {
    const reapplyIframeStyles = async () => {
      await importIframeClient?.applySettings({
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

  function handleImportModalClose() {
    if (importIframeClient) {
      setImportIframeClient(null);
    }

    removeImportIframe();
  }

  async function handleImport() {
    setIsLoading(true);
    try {
      if (!importIframeClient) {
        throw new ZeroXKeyError(
          "Import iframe client not initialized",
          ZeroXKeyErrorCodes.INTERNAL_ERROR,
        );
      }
      let response;
      switch (importType) {
        case ImportType.Wallet:
          const initWalletResult = await httpClient?.initImportWallet(
            {
              organizationId: organizationId!,
              userId: userId!,
            },
            stampWith,
          );

          if (!initWalletResult || !initWalletResult.importBundle) {
            throw new ZeroXKeyError(
              "Failed to retrieve import bundle",
              ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
            );
          }

          const injectedWallet = await importIframeClient.injectImportBundle(
            initWalletResult.importBundle,
            organizationId!,
            userId!,
          );

          if (!injectedWallet) {
            throw new ZeroXKeyError(
              "Failed to inject import bundle",
              ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
            );
          }
          const encryptedWalletBundle =
            await importIframeClient.extractWalletEncryptedBundle();
          if (!encryptedWalletBundle || encryptedWalletBundle.trim() === "") {
            throw new ZeroXKeyError(
              "Encrypted bundle is empty",
              ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
            );
          }

          let accounts: v1WalletAccountParams[] = [];
          if (
            Array.isArray(defaultWalletAccounts) &&
            defaultWalletAccounts.length > 0 &&
            (defaultWalletAccounts as any[])[0]?.addressFormat === undefined
          ) {
            accounts = generateWalletAccountsFromAddressFormat({
              addresses: defaultWalletAccounts as v1AddressFormat[],
            });
          } else if (Array.isArray(defaultWalletAccounts)) {
            accounts = defaultWalletAccounts as v1WalletAccountParams[];
          }

          response = await importWallet({
            walletName: walletName,
            accounts,
            encryptedBundle: encryptedWalletBundle,
            stampWith,
            organizationId: organizationId!,
            userId: userId!,
          });

          break;
        case ImportType.PrivateKey:
          const initPrivateKeyResult = await httpClient?.initImportPrivateKey(
            {
              organizationId: organizationId!,
              userId: userId!,
            },
            stampWith,
          );

          if (!initPrivateKeyResult || !initPrivateKeyResult.importBundle) {
            throw new ZeroXKeyError(
              "Failed to retrieve import bundle",
              ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
            );
          }
          const injectedKey = await importIframeClient.injectImportBundle(
            initPrivateKeyResult.importBundle,
            organizationId!,
            userId!,
          );
          if (!injectedKey) {
            throw new ZeroXKeyError(
              "Failed to inject import bundle",
              ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
            );
          }

          const encryptedKeyBundle =
            await importIframeClient.extractKeyEncryptedBundle(keyFormat);
          if (!encryptedKeyBundle || encryptedKeyBundle.trim() === "") {
            throw new ZeroXKeyError(
              "Encrypted bundle is empty",
              ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
            );
          }

          response = await importPrivateKey({
            addressFormats,
            curve,
            privateKeyName: walletName,
            encryptedBundle: encryptedKeyBundle,
            stampWith,
            organizationId: organizationId!,
            userId: userId!,
          });

          break;

        default:
          throw new ZeroXKeyError(
            "Invalid import type",
            ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
          );
      }

      if (response) {
        onSuccess(response);
        if (successPageDuration && successPageDuration !== 0) {
          pushPage({
            key: "success",
            content: (
              <SuccessPage
                text={
                  importType === ImportType.Wallet
                    ? "Wallet imported successfully!"
                    : importType === ImportType.PrivateKey
                      ? "Private key imported successfully!"
                      : "Success!"
                }
                duration={successPageDuration}
                onComplete={() => {
                  handleImportModalClose();
                  closeModal();
                }}
              />
            ),
            preventBack: true,
            showTitle: false,
          });
        } else {
          handleImportModalClose();
          closeModal();
        }
        handleImportModalClose();
      } else {
        await importIframeClient.clear();
        throw new ZeroXKeyError(
          "Failed to import wallet",
          ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
        );
      }
    } catch (error) {
      shakeInput();
      setError(
        error instanceof ZeroXKeyError
          ? error
          : new ZeroXKeyError(
              `Error importing wallet`,
              ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
              error,
            ),
      );

      if (error instanceof ZeroXKeyError) onError(error);
      throw new ZeroXKeyError(
        `Error importing wallet`,
        ZeroXKeyErrorCodes.IMPORT_WALLET_ERROR,
        error,
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className={clsx(
        "flex flex-col items-center pt-4",
        isMobile ? "w-full" : "w-[21rem]",
      )}
    >
      <p className="text-sm text-icon-text-light dark:text-icon-text-dark">
        {subtitle}
      </p>
      <div
        id={ZeroXKeyImportIframeContainerId}
        style={{
          height: "100%",
          overflow: "hidden",
          display: "block",
          backgroundColor: config?.ui?.darkMode
            ? config?.ui?.colors?.dark?.iconBackground || iconBackgroundDark
            : config?.ui?.colors?.light?.iconBackground || iconBackgroundLight,
          width: "100%",
          boxSizing: "border-box",
          padding: "5px",
          borderStyle: "solid",
          borderWidth: "1px",
          borderRadius: "8px",
          borderColor: config?.ui?.darkMode
            ? config?.ui?.colors?.dark?.iconText || iconTextDark
            : config?.ui?.colors?.light?.iconText || iconTextLight,
        }}
        className={`transition-all ${shaking ? "animate-shake" : ""}`}
      />
      {!name && (
        <Input
          type="text"
          data-testid="import-wallet-name-input"
          placeholder={placeholder}
          value={walletName}
          onChange={(e) => setWalletName(e.target.value)}
          className="placeholder:text-icon-text-light dark:placeholder:text-icon-text-dark w-full mt-2 py-3 px-3 rounded-md text-inherit bg-icon-background-light dark:bg-icon-background-dark border border-modal-background-dark/20 dark:border-modal-background-light/20 focus:outline-primary-light focus:dark:outline-primary-dark focus:outline-[1px] focus:outline-offset-0 box-border"
        />
      )}
      <ActionButton
        name="import-button"
        loading={isLoading || !importIframeClient}
        spinnerClassName="text-primary-text-light dark:text-primary-text-dark"
        onClick={handleImport}
        className="bg-primary-light mt-2 dark:bg-primary-dark text-primary-text-light dark:text-primary-text-dark"
      >
        Import
      </ActionButton>
      <p
        data-testid="import-error-message"
        className={clsx(
          "text-sm text-red-500 transition-opacity delay-75 line-clamp-2 w-full",
          error
            ? "opacity-100 pointer-events-auto mt-2"
            : "opacity-0 pointer-events-none absolute",
        )}
      >
        {error?.message}:{" "}
        {error?.cause instanceof ZeroXKeyError
          ? error?.cause.message
          : error?.cause?.toString() || "Unknown error"}
      </p>
    </div>
  );
}
