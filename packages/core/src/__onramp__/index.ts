import {
  ZeroXKeyError,
  ZeroXKeyErrorCodes,
  type TGetOnRampTransactionStatusBody,
  type TGetOnRampTransactionStatusResponse,
  type TInitFiatOnRampBody,
  type TInitFiatOnRampResponse,
} from "@0xkey-io/sdk-types";
import type { WalletAccount } from "../__types__/external-wallets";
import type { StamperType } from "../__types__/enums";

export type OnRampProvider = TInitFiatOnRampBody["onrampProvider"];
export type OnRampNetwork = TInitFiatOnRampBody["network"];
export type OnRampCryptoCurrency = TInitFiatOnRampBody["cryptoCurrencyCode"];
export type OnRampFiatCurrency = NonNullable<
  TInitFiatOnRampBody["fiatCurrencyCode"]
>;
export type OnRampPaymentMethod = NonNullable<
  TInitFiatOnRampBody["paymentMethod"]
>;

export type InitOnRampRuntimeResult = Pick<
  TInitFiatOnRampResponse,
  "onRampUrl" | "onRampTransactionId" | "onRampUrlSignature"
> &
  Partial<Pick<TInitFiatOnRampResponse, "activity">>;

export type OnRampFlowStatus =
  | "initiated"
  | "pending"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired"
  | "unknown";

export enum OnRampErrorCode {
  ORGANIZATION_REQUIRED = "ONRAMP_ORGANIZATION_REQUIRED",
  WALLET_ADDRESS_REQUIRED = "ONRAMP_WALLET_ADDRESS_REQUIRED",
  ASSET_REQUIRED = "ONRAMP_ASSET_REQUIRED",
  SANDBOX_MODE_REQUIRED = "ONRAMP_SANDBOX_MODE_REQUIRED",
  PROVIDER_UNSUPPORTED = "ONRAMP_PROVIDER_UNSUPPORTED",
  POPUP_BLOCKED = "ONRAMP_POPUP_BLOCKED",
  USER_ABORTED = "ONRAMP_USER_ABORTED",
  INIT_FAILED = "ONRAMP_INIT_FAILED",
  STATUS_TIMEOUT = "ONRAMP_STATUS_TIMEOUT",
  STATUS_POLLING_FAILED = "ONRAMP_STATUS_POLLING_FAILED",
  PROVIDER_URL_INVALID = "ONRAMP_PROVIDER_URL_INVALID",
  SIGNATURE_MISSING = "ONRAMP_SIGNATURE_MISSING",
}

export type OnRampProviderCapability = {
  provider: OnRampProvider;
  supportsRuntime: boolean;
  supportsUrlSigning: boolean;
  supportsStatusRefresh: boolean;
  unsupportedReason?: string;
};

export type OnRampFlowResult = {
  onRampTransactionId: string;
  onRampUrl: string;
  signedUrl?: string;
  status: OnRampFlowStatus;
  provider: OnRampProvider;
  sandboxMode: boolean;
  rawStatus?: unknown;
};

export class OnRampError extends ZeroXKeyError {
  constructor(
    public onRampCode: OnRampErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, ZeroXKeyErrorCodes.ONRAMP_ERROR, cause);
    this.name = "OnRampError";
  }
}

export type FiatOnRampRuntimeClient = {
  initFiatOnRamp: (
    input: TInitFiatOnRampBody,
    stampWith?: StamperType,
  ) => Promise<InitOnRampRuntimeResult>;
  getOnRampTransactionStatus: (
    input: TGetOnRampTransactionStatusBody,
    stampWith?: StamperType,
  ) => Promise<TGetOnRampTransactionStatusResponse>;
};

export type OnRampAsset = {
  network: OnRampNetwork;
  cryptoCurrencyCode: OnRampCryptoCurrency;
};

export type BuildMoonPayOnRampUrlParams = {
  publishableApiKey: string;
  walletAddress: string;
  cryptoCurrencyCode: OnRampCryptoCurrency;
  fiatCurrencyCode?: OnRampFiatCurrency;
  fiatCurrencyAmount?: string;
  sandboxMode: boolean;
  externalTransactionId?: string;
};

export type BuildMoonPayOnRampUrlResult = {
  url: string;
  externalTransactionId: string;
};

export type InitOnRampFlowParams = {
  runtimeClient: FiatOnRampRuntimeClient;
  organizationId?: string;
  stampWith?: StamperType;
  onrampProvider?: OnRampProvider;
  walletAddress: string;
  network: OnRampNetwork;
  cryptoCurrencyCode: OnRampCryptoCurrency;
  fiatCurrencyCode?: OnRampFiatCurrency;
  fiatCurrencyAmount?: string;
  paymentMethod?: OnRampPaymentMethod;
  countryCode?: string;
  countrySubdivisionCode?: string;
  sandboxMode: boolean;
  urlForSignature?: string;
};

export type PollOnRampTransactionStatusParams = {
  runtimeClient: FiatOnRampRuntimeClient;
  organizationId?: string;
  transactionId: string;
  stampWith?: StamperType;
  refresh?: boolean;
  intervalMs?: number;
  timeoutMs?: number;
  maxConsecutiveErrors?: number;
  signal?: AbortSignal;
  /**
   * Called after every successful status fetch, including non-terminal
   * statuses, so callers can render progress before the flow settles.
   */
  onStatusUpdate?: (
    status: OnRampFlowStatus,
    raw: TGetOnRampTransactionStatusResponse,
  ) => void;
};

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1_000;
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;

const terminalStatuses: ReadonlySet<OnRampFlowStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

export function getOnRampProviderCapability(
  provider: OnRampProvider,
): OnRampProviderCapability {
  if (provider === "FIAT_ON_RAMP_PROVIDER_MOONPAY") {
    return {
      provider,
      supportsRuntime: true,
      supportsUrlSigning: true,
      supportsStatusRefresh: true,
    };
  }

  return {
    provider,
    supportsRuntime: false,
    supportsUrlSigning: false,
    supportsStatusRefresh: false,
    unsupportedReason:
      "Coinbase credential management is supported, but Coinbase runtime init/status is not wired yet.",
  };
}

export function assertOnRampProviderSupported(provider: OnRampProvider): void {
  const capability = getOnRampProviderCapability(provider);
  if (!capability.supportsRuntime) {
    throw new OnRampError(
      OnRampErrorCode.PROVIDER_UNSUPPORTED,
      capability.unsupportedReason ??
        `${provider} is not supported for on-ramp runtime flows.`,
      capability,
    );
  }
}

export function inferOnRampAssetFromWalletAccount(
  walletAccount: WalletAccount,
): OnRampAsset {
  const addressFormat = walletAccount.addressFormat;
  if (addressFormat === "ADDRESS_FORMAT_ETHEREUM") {
    return {
      network: "FIAT_ON_RAMP_BLOCKCHAIN_NETWORK_ETHEREUM",
      cryptoCurrencyCode: "FIAT_ON_RAMP_CRYPTO_CURRENCY_ETH",
    };
  }

  if (addressFormat?.includes("ADDRESS_FORMAT_BITCOIN")) {
    return {
      network: "FIAT_ON_RAMP_BLOCKCHAIN_NETWORK_BITCOIN",
      cryptoCurrencyCode: "FIAT_ON_RAMP_CRYPTO_CURRENCY_BTC",
    };
  }

  if (addressFormat === "ADDRESS_FORMAT_SOLANA") {
    return {
      network: "FIAT_ON_RAMP_BLOCKCHAIN_NETWORK_SOLANA",
      cryptoCurrencyCode: "FIAT_ON_RAMP_CRYPTO_CURRENCY_SOL",
    };
  }

  throw new OnRampError(
    OnRampErrorCode.ASSET_REQUIRED,
    "Cannot infer on-ramp asset from wallet account. Pass network and cryptoCurrencyCode explicitly.",
    { addressFormat },
  );
}

export function buildMoonPayOnRampUrl(
  params: BuildMoonPayOnRampUrlParams,
): BuildMoonPayOnRampUrlResult {
  const walletAddress = params.walletAddress.trim();
  if (!walletAddress) {
    throw new OnRampError(
      OnRampErrorCode.WALLET_ADDRESS_REQUIRED,
      "walletAddress is required to build a MoonPay on-ramp URL.",
    );
  }

  if (!params.publishableApiKey.trim()) {
    throw new OnRampError(
      OnRampErrorCode.PROVIDER_URL_INVALID,
      "publishableApiKey is required to build a MoonPay on-ramp URL.",
    );
  }

  const externalTransactionId =
    params.externalTransactionId ?? generateExternalTransactionId();
  const query = new URLSearchParams();
  query.set("apiKey", params.publishableApiKey);
  query.set("walletAddress", walletAddress);
  query.set("currencyCode", moonPayCryptoCode(params.cryptoCurrencyCode));
  query.set(
    "baseCurrencyCode",
    moonPayFiatCode(params.fiatCurrencyCode ?? "FIAT_ON_RAMP_CURRENCY_USD"),
  );
  if (params.fiatCurrencyAmount?.trim()) {
    query.set("baseCurrencyAmount", params.fiatCurrencyAmount.trim());
  }
  query.set("externalTransactionId", externalTransactionId);

  const baseUrl = params.sandboxMode
    ? "https://buy-sandbox.moonpay.com"
    : "https://buy.moonpay.com";
  return {
    url: `${baseUrl}?${query.toString()}`,
    externalTransactionId,
  };
}

export function appendMoonPaySignature(
  url: string,
  signature: string | undefined,
): string {
  if (!signature) {
    throw new OnRampError(
      OnRampErrorCode.SIGNATURE_MISSING,
      "MoonPay URL signature is missing.",
    );
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}signature=${encodeURIComponent(signature)}`;
}

export async function initOnRampFlow(
  params: InitOnRampFlowParams,
): Promise<OnRampFlowResult> {
  const provider = params.onrampProvider ?? "FIAT_ON_RAMP_PROVIDER_MOONPAY";
  assertOnRampProviderSupported(provider);
  if (!params.walletAddress.trim()) {
    throw new OnRampError(
      OnRampErrorCode.WALLET_ADDRESS_REQUIRED,
      "walletAddress is required to initialize an on-ramp flow.",
    );
  }

  try {
    const response = await params.runtimeClient.initFiatOnRamp(
      {
        ...(params.organizationId
          ? { organizationId: params.organizationId }
          : {}),
        onrampProvider: provider,
        walletAddress: params.walletAddress,
        network: params.network,
        cryptoCurrencyCode: params.cryptoCurrencyCode,
        ...(params.fiatCurrencyCode
          ? { fiatCurrencyCode: params.fiatCurrencyCode }
          : {}),
        ...(params.fiatCurrencyAmount
          ? { fiatCurrencyAmount: params.fiatCurrencyAmount }
          : {}),
        ...(params.paymentMethod
          ? { paymentMethod: params.paymentMethod }
          : {}),
        ...(params.countryCode ? { countryCode: params.countryCode } : {}),
        ...(params.countrySubdivisionCode
          ? { countrySubdivisionCode: params.countrySubdivisionCode }
          : {}),
        sandboxMode: params.sandboxMode,
        ...(params.urlForSignature
          ? { urlForSignature: params.urlForSignature }
          : {}),
      },
      params.stampWith,
    );

    if (!response.onRampUrl || !response.onRampTransactionId) {
      throw new OnRampError(
        OnRampErrorCode.INIT_FAILED,
        "InitFiatOnRamp response is missing onRampUrl or onRampTransactionId.",
        response,
      );
    }

    const signedUrl = response.onRampUrlSignature
      ? appendMoonPaySignature(response.onRampUrl, response.onRampUrlSignature)
      : undefined;

    return {
      onRampTransactionId: response.onRampTransactionId,
      onRampUrl: response.onRampUrl,
      ...(signedUrl ? { signedUrl } : {}),
      status: "initiated",
      provider,
      sandboxMode: params.sandboxMode,
      rawStatus: response,
    };
  } catch (error) {
    if (error instanceof OnRampError) {
      throw error;
    }
    throw new OnRampError(
      OnRampErrorCode.INIT_FAILED,
      "Failed to initialize on-ramp flow.",
      error,
    );
  }
}

export async function pollOnRampTransactionStatus(
  params: PollOnRampTransactionStatusParams,
): Promise<OnRampFlowStatus> {
  const intervalMs = params.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = params.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const maxConsecutiveErrors =
    params.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;

  while (Date.now() <= deadline) {
    throwIfAborted(params.signal);
    try {
      const response = await params.runtimeClient.getOnRampTransactionStatus(
        {
          ...(params.organizationId
            ? { organizationId: params.organizationId }
            : {}),
          transactionId: params.transactionId,
          refresh: params.refresh ?? true,
        },
        params.stampWith,
      );
      consecutiveErrors = 0;
      const status = normalizeOnRampStatus(response.transactionStatus);
      params.onStatusUpdate?.(status, response);
      if (terminalStatuses.has(status)) {
        return status;
      }
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new OnRampError(
          OnRampErrorCode.STATUS_POLLING_FAILED,
          "Failed to poll on-ramp status too many times.",
          error,
        );
      }
    }

    await delay(intervalMs, params.signal);
  }

  throw new OnRampError(
    OnRampErrorCode.STATUS_TIMEOUT,
    "Timed out while polling on-ramp status.",
    { transactionId: params.transactionId, timeoutMs },
  );
}

export function normalizeOnRampStatus(
  status: string | undefined,
): OnRampFlowStatus {
  switch ((status ?? "").trim().toLowerCase()) {
    case "initiated":
      return "initiated";
    case "pending":
    case "waitingpayment":
    case "waiting_payment":
    case "processing":
      return "pending";
    case "completed":
    case "complete":
    case "success":
      return "completed";
    case "failed":
    case "failure":
    case "error":
      return "failed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "expired":
      return "expired";
    default:
      return "unknown";
  }
}

function moonPayCryptoCode(currency: OnRampCryptoCurrency): string {
  switch (currency) {
    case "FIAT_ON_RAMP_CRYPTO_CURRENCY_BTC":
      return "btc";
    case "FIAT_ON_RAMP_CRYPTO_CURRENCY_ETH":
      return "eth";
    case "FIAT_ON_RAMP_CRYPTO_CURRENCY_SOL":
      return "sol";
    case "FIAT_ON_RAMP_CRYPTO_CURRENCY_USDC":
      return "usdc";
    default:
      return enumSuffix(
        currency,
        "FIAT_ON_RAMP_CRYPTO_CURRENCY_",
      ).toLowerCase();
  }
}

function moonPayFiatCode(currency: OnRampFiatCurrency): string {
  return enumSuffix(currency, "FIAT_ON_RAMP_CURRENCY_").toLowerCase();
}

function enumSuffix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function generateExternalTransactionId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  return randomUUID
    ? randomUUID.call(globalThis.crypto)
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(
        new OnRampError(
          OnRampErrorCode.USER_ABORTED,
          "On-ramp polling was aborted.",
        ),
      );
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new OnRampError(
      OnRampErrorCode.USER_ABORTED,
      "On-ramp flow was aborted.",
    );
  }
}
