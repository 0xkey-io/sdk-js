import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  type TGetSendTransactionStatusResponse,
  ZeroXKeyErrorCodes,
} from "@0xkey-io/sdk-types";

import { StamperType } from "../__types__";
import { createReadyClient } from "./test-support/ready-client";

async function createClientWithStatusResponse(
  response: TGetSendTransactionStatusResponse,
) {
  const client = await createReadyClient();
  jest
    .spyOn(client.httpClient, "getSendTransactionStatus")
    .mockResolvedValue(response);

  return client;
}

describe("pollTransactionStatus", () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  it("throws a ZeroXKeyError with the terminal status payload for failed EVM transactions", async () => {
    const response: TGetSendTransactionStatusResponse = {
      txStatus: "FAILED",
      error: {
        message: "execution reverted: Slippage check failed",
        revertChain: [
          {
            address: "0xrouter",
            errorType: "ERROR_TYPE_CUSTOM",
            displayMessage: "SlippageCheckFailed(minOut=1000, actualOut=995)",
            custom: {
              errorName: "SlippageCheckFailed",
              paramsJson: '{"minOut":"1000","actualOut":"995"}',
            },
          },
        ],
        eth: {
          revertChain: [
            {
              address: "0xrouter",
              errorType: "ERROR_TYPE_CUSTOM",
              displayMessage: "SlippageCheckFailed(minOut=1000, actualOut=995)",
              custom: {
                errorName: "SlippageCheckFailed",
                paramsJson: '{"minOut":"1000","actualOut":"995"}',
              },
            },
          ],
        },
      },
    };

    const client = await createClientWithStatusResponse(response);
    jest.useFakeTimers();
    const promise = client.pollTransactionStatus({
      organizationId: "org-id",
      sendTransactionStatusId: "status-id",
      stampWith: StamperType.Passkey,
      pollingIntervalMs: 10,
    });
    const rejectedError = promise.catch((error) => error);

    await jest.advanceTimersByTimeAsync(10);

    const error = await rejectedError;

    expect(error).toMatchObject({
      name: "ZeroXKeyError",
      code: ZeroXKeyErrorCodes.POLL_TRANSACTION_STATUS_ERROR,
      message: "execution reverted: Slippage check failed",
      cause: response,
    });
    expect((error as any).cause?.error?.eth?.revertChain).toEqual(
      response.error?.eth?.revertChain,
    );
  });

  it("falls back to the terminal status when no structured error is present", async () => {
    const response: TGetSendTransactionStatusResponse = {
      txStatus: "CANCELLED",
    };

    const client = await createClientWithStatusResponse(response);
    jest.useFakeTimers();
    const promise = client.pollTransactionStatus({
      organizationId: "org-id",
      sendTransactionStatusId: "status-id",
      stampWith: StamperType.Passkey,
      pollingIntervalMs: 10,
    });
    const rejectedError = promise.catch((error) => error);

    await jest.advanceTimersByTimeAsync(10);

    const error = await rejectedError;

    expect(error).toMatchObject({
      name: "ZeroXKeyError",
      code: ZeroXKeyErrorCodes.POLL_TRANSACTION_STATUS_ERROR,
      message: "Transaction CANCELLED",
      cause: response,
    });
  });
});
