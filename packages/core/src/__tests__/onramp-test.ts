import { describe, expect, it, jest, afterEach } from "@jest/globals";
import {
  FiatOnRampBlockchainNetwork,
  FiatOnRampCryptoCurrency,
  FiatOnRampCurrency,
  FiatOnRampProvider,
} from "@0xkey-io/sdk-types";
import {
  OnRampErrorCode,
  OnRampError,
  appendMoonPaySignature,
  buildMoonPayOnRampUrl,
  getOnRampProviderCapability,
  inferOnRampAssetFromWalletAccount,
  initOnRampFlow,
  normalizeOnRampStatus,
  pollOnRampTransactionStatus,
} from "../__onramp__";
import { WalletSource, type WalletAccount } from "../__types__";

describe("on-ramp core helpers", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("builds deterministic MoonPay widget URLs", () => {
    const result = buildMoonPayOnRampUrl({
      publishableApiKey: "pk_test",
      walletAddress: "0xabc",
      cryptoCurrencyCode: FiatOnRampCryptoCurrency.ETHEREUM,
      fiatCurrencyCode: FiatOnRampCurrency.USD,
      fiatCurrencyAmount: "100",
      sandboxMode: true,
      externalTransactionId: "external-id",
    });

    expect(result.externalTransactionId).toBe("external-id");
    expect(result.url).toBe(
      "https://buy-sandbox.moonpay.com?apiKey=pk_test&walletAddress=0xabc&currencyCode=eth&baseCurrencyCode=usd&baseCurrencyAmount=100&externalTransactionId=external-id",
    );
  });

  it("appends MoonPay signatures using the existing query string", () => {
    expect(
      appendMoonPaySignature("https://buy.moonpay.com?apiKey=pk", "sig+/="),
    ).toBe("https://buy.moonpay.com?apiKey=pk&signature=sig%2B%2F%3D");
  });

  it("marks Coinbase runtime as unsupported for phase one", () => {
    expect(
      getOnRampProviderCapability(FiatOnRampProvider.COINBASE),
    ).toMatchObject({
      supportsRuntime: false,
      supportsUrlSigning: false,
      supportsStatusRefresh: false,
    });
  });

  it("infers native assets from wallet account address format", () => {
    const account = {
      walletAccountId: "wa",
      address: "0xabc",
      addressFormat: "ADDRESS_FORMAT_ETHEREUM",
      source: WalletSource.Embedded,
    } as WalletAccount;

    expect(inferOnRampAssetFromWalletAccount(account)).toEqual({
      network: FiatOnRampBlockchainNetwork.ETHEREUM,
      cryptoCurrencyCode: FiatOnRampCryptoCurrency.ETHEREUM,
    });
  });

  it("normalizes provider statuses", () => {
    expect(normalizeOnRampStatus("COMPLETED")).toBe("completed");
    expect(normalizeOnRampStatus("waiting_payment")).toBe("pending");
    expect(normalizeOnRampStatus("wat")).toBe("unknown");
  });

  it("rejects on-ramp init for unsupported providers before any request", async () => {
    const runtimeClient = {
      initFiatOnRamp: jest.fn<any>(),
      getOnRampTransactionStatus: jest.fn<any>(),
    };

    const error = await initOnRampFlow({
      runtimeClient,
      onrampProvider: FiatOnRampProvider.COINBASE,
      walletAddress: "0xabc",
      network: FiatOnRampBlockchainNetwork.ETHEREUM,
      cryptoCurrencyCode: FiatOnRampCryptoCurrency.ETHEREUM,
      sandboxMode: true,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OnRampError);
    expect((error as OnRampError).onRampCode).toBe(
      OnRampErrorCode.PROVIDER_UNSUPPORTED,
    );
    expect(runtimeClient.initFiatOnRamp).not.toHaveBeenCalled();
  });

  it("builds a signed result from a MoonPay init response", async () => {
    const runtimeClient = {
      initFiatOnRamp: jest.fn<any>().mockResolvedValue({
        onRampUrl: "https://buy-sandbox.moonpay.com?apiKey=pk",
        onRampTransactionId: "tx-1",
        onRampUrlSignature: "sig123",
      }),
      getOnRampTransactionStatus: jest.fn<any>(),
    };

    const result = await initOnRampFlow({
      runtimeClient,
      onrampProvider: FiatOnRampProvider.MOONPAY,
      walletAddress: "0xabc",
      network: FiatOnRampBlockchainNetwork.ETHEREUM,
      cryptoCurrencyCode: FiatOnRampCryptoCurrency.ETHEREUM,
      sandboxMode: true,
    });

    expect(result.status).toBe("initiated");
    expect(result.onRampTransactionId).toBe("tx-1");
    expect(result.signedUrl).toBe(
      "https://buy-sandbox.moonpay.com?apiKey=pk&signature=sig123",
    );
  });

  it("emits per-poll status updates and resolves on terminal status", async () => {
    jest.useFakeTimers();
    const responses = [
      { transactionStatus: "PENDING" },
      { transactionStatus: "COMPLETED" },
    ];
    const runtimeClient = {
      initFiatOnRamp: jest.fn<any>(),
      getOnRampTransactionStatus: jest
        .fn<any>()
        .mockImplementation(() => Promise.resolve(responses.shift())),
    };
    const updates: string[] = [];

    const promise = pollOnRampTransactionStatus({
      runtimeClient,
      transactionId: "tx",
      intervalMs: 10,
      timeoutMs: 1000,
      onStatusUpdate: (status) => updates.push(status),
    });

    await jest.advanceTimersByTimeAsync(10);
    const status = await promise;

    expect(status).toBe("completed");
    expect(updates).toEqual(["pending", "completed"]);
  });

  it("fails polling after consecutive status refresh errors", async () => {
    jest.useFakeTimers();
    const runtimeClient = {
      initFiatOnRamp: jest.fn<any>(),
      getOnRampTransactionStatus: jest
        .fn<any>()
        .mockRejectedValue(new Error("boom")),
    };

    const promise = pollOnRampTransactionStatus({
      runtimeClient,
      transactionId: "tx",
      intervalMs: 10,
      timeoutMs: 100,
      maxConsecutiveErrors: 2,
    }).catch((error) => error);

    await jest.advanceTimersByTimeAsync(10);
    const error = await promise;

    expect(error).toBeInstanceOf(OnRampError);
    expect((error as OnRampError).onRampCode).toBe(
      OnRampErrorCode.STATUS_POLLING_FAILED,
    );
  });
});
