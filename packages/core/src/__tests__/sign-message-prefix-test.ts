import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  type TSignRawPayloadBody,
  type TSignRawPayloadResponse,
  ZeroXKeyErrorCodes,
} from "@0xkey-io/sdk-types";
import {
  type Hex,
  keccak256,
  serializeSignature,
  stringToHex,
  verifyMessage,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";

import type { ZeroXKeyClient } from "../__clients__/core";
import { WalletSource, type WalletAccount } from "../__types__";
import { createReadyClient } from "./test-support/ready-client";

const PRIVATE_KEY = keccak256(stringToHex("sign-message-prefix-test"));
const signer = privateKeyToAccount(PRIVATE_KEY);
const MESSAGE = "Sign in to Example App: nonce 42 ✓";
const EIP191_PREFIX = "\x19Ethereum Signed Message:\n";

function embeddedAccount(
  addressFormat: WalletAccount["addressFormat"] = "ADDRESS_FORMAT_ETHEREUM",
  address: string = signer.address,
): WalletAccount {
  return {
    walletAccountId: "wallet-account-id",
    organizationId: "org-id",
    walletId: "wallet-id",
    curve: "CURVE_SECP256K1",
    pathFormat: "PATH_FORMAT_BIP32",
    path: "m/44'/60'/0'/0/0",
    addressFormat,
    address,
    createdAt: { seconds: "0", nanos: "0" },
    updatedAt: { seconds: "0", nanos: "0" },
    source: WalletSource.Embedded,
  } as WalletAccount;
}

function connectedEthereumAccount(
  signMessage: (message: string) => Promise<string>,
): WalletAccount {
  return {
    ...embeddedAccount(),
    source: WalletSource.Connected,
    signMessage,
  } as unknown as WalletAccount;
}

async function clientWithLocalSigner(): Promise<{
  client: ZeroXKeyClient;
  requests: TSignRawPayloadBody[];
}> {
  const client = await createReadyClient();
  const requests: TSignRawPayloadBody[] = [];

  jest
    .spyOn(client.httpClient, "signRawPayload")
    .mockImplementation(async (input) => {
      requests.push(input as TSignRawPayloadBody);
      const { payload, hashFunction, encoding } = input as TSignRawPayloadBody;
      const payloadHex = (
        encoding === "PAYLOAD_ENCODING_HEXADECIMAL"
          ? payload
          : stringToHex(payload)
      ) as Hex;
      const digest =
        hashFunction === "HASH_FUNCTION_NO_OP"
          ? payloadHex
          : keccak256(payloadHex);
      const { r, s, yParity } = await sign({
        hash: digest,
        privateKey: PRIVATE_KEY,
      });

      return {
        activity: {
          result: {
            signRawPayloadResult: {
              r: r.slice(2),
              s: s.slice(2),
              v: yParity === 1 ? "01" : "00",
            },
          },
        },
      } as unknown as TSignRawPayloadResponse;
    });

  return { client, requests };
}

function toSignature(result: { r: string; s: string; v: string }): Hex {
  const v = Number.parseInt(result.v, 16);
  return serializeSignature({
    r: `0x${result.r}`,
    s: `0x${result.s}`,
    yParity: v >= 27 ? v - 27 : v,
  });
}

function eip191Payload(message: string): Hex {
  const length = new TextEncoder().encode(message).length;
  return stringToHex(`${EIP191_PREFIX}${length}${message}`);
}

describe("signMessage addEthereumPrefix contract", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  describe("embedded Ethereum account", () => {
    it("signs the raw UTF-8 message when addEthereumPrefix is omitted", async () => {
      const { client, requests } = await clientWithLocalSigner();

      await client.signMessage({
        message: MESSAGE,
        walletAccount: embeddedAccount(),
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        signWith: signer.address,
        payload: stringToHex(MESSAGE),
        encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
        hashFunction: "HASH_FUNCTION_KECCAK256",
      });
    });

    it("prepends the EIP-191 prefix with the UTF-8 byte length when addEthereumPrefix is true", async () => {
      const { client, requests } = await clientWithLocalSigner();

      await client.signMessage({
        message: MESSAGE,
        walletAccount: embeddedAccount(),
        addEthereumPrefix: true,
      });

      expect(requests[0]).toMatchObject({
        payload: eip191Payload(MESSAGE),
        encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
        hashFunction: "HASH_FUNCTION_KECCAK256",
      });
    });

    it("signs the raw UTF-8 message when addEthereumPrefix is false", async () => {
      const { client, requests } = await clientWithLocalSigner();

      await client.signMessage({
        message: MESSAGE,
        walletAccount: embeddedAccount(),
        addEthereumPrefix: false,
      });

      expect(requests[0]).toMatchObject({
        payload: stringToHex(MESSAGE),
        hashFunction: "HASH_FUNCTION_KECCAK256",
      });
    });

    it("keeps the raw message when the caller overrides hashFunction and omits addEthereumPrefix", async () => {
      const { client, requests } = await clientWithLocalSigner();
      const digest = keccak256(stringToHex(MESSAGE));

      await client.signMessage({
        message: digest,
        walletAccount: embeddedAccount(),
        encoding: "PAYLOAD_ENCODING_TEXT_UTF8",
        hashFunction: "HASH_FUNCTION_NO_OP",
      });

      expect(requests[0]).toMatchObject({
        payload: digest,
        encoding: "PAYLOAD_ENCODING_TEXT_UTF8",
        hashFunction: "HASH_FUNCTION_NO_OP",
      });
    });

    it("produces a signature that viem verifyMessage accepts only when addEthereumPrefix is true", async () => {
      const { client } = await clientWithLocalSigner();

      const prefixed = await client.signMessage({
        message: MESSAGE,
        walletAccount: embeddedAccount(),
        addEthereumPrefix: true,
      });
      const omitted = await client.signMessage({
        message: MESSAGE,
        walletAccount: embeddedAccount(),
      });

      await expect(
        verifyMessage({
          address: signer.address,
          message: MESSAGE,
          signature: toSignature(prefixed),
        }),
      ).resolves.toBe(true);
      await expect(
        verifyMessage({
          address: signer.address,
          message: MESSAGE,
          signature: toSignature(omitted),
        }),
      ).resolves.toBe(false);
      expect(toSignature(prefixed)).toBe(
        await signer.signMessage({ message: MESSAGE }),
      );
    });
  });

  describe("connected Ethereum wallet", () => {
    it.each([
      ["omitted", undefined],
      ["false", false],
    ])(
      "rejects when addEthereumPrefix is %s because the wallet always prefixes",
      async (_label, addEthereumPrefix) => {
        const { client, requests } = await clientWithLocalSigner();
        const walletSignMessage = jest.fn(async (_message: string) => "0x");

        const error = await client
          .signMessage({
            message: MESSAGE,
            walletAccount: connectedEthereumAccount(walletSignMessage),
            ...(addEthereumPrefix !== undefined && { addEthereumPrefix }),
          })
          .catch((caught: unknown) => caught);

        expect(error).toMatchObject({
          name: "ZeroXKeyError",
          code: ZeroXKeyErrorCodes.SIGN_MESSAGE_ERROR,
        });
        expect(walletSignMessage).not.toHaveBeenCalled();
        expect(requests).toHaveLength(0);
      },
    );

    it("delegates the unprefixed hex message to the wallet when addEthereumPrefix is true", async () => {
      const { client, requests } = await clientWithLocalSigner();
      const walletSignature = await signer.signMessage({ message: MESSAGE });
      const walletSignMessage = jest.fn(
        async (_message: string) => walletSignature,
      );

      const result = await client.signMessage({
        message: MESSAGE,
        walletAccount: connectedEthereumAccount(walletSignMessage),
        addEthereumPrefix: true,
      });

      expect(walletSignMessage).toHaveBeenCalledWith(stringToHex(MESSAGE));
      expect(requests).toHaveLength(0);
      expect(toSignature(result)).toBe(walletSignature);
    });
  });

  describe("non-Ethereum account", () => {
    it("ignores addEthereumPrefix: true", async () => {
      const { client, requests } = await clientWithLocalSigner();

      await client.signMessage({
        message: MESSAGE,
        walletAccount: embeddedAccount(
          "ADDRESS_FORMAT_TRON",
          "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8",
        ),
        addEthereumPrefix: true,
      });

      expect(requests[0]).toMatchObject({
        payload: stringToHex(MESSAGE),
        encoding: "PAYLOAD_ENCODING_HEXADECIMAL",
        hashFunction: "HASH_FUNCTION_SHA256",
      });
    });
  });
});
