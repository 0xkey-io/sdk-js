/// <reference lib="dom" />
import {
  stringToBase64urlString,
  uint8ArrayToHexString,
} from "@0xkey-io/encoding";
import { fromDerSignature } from "@0xkey-io/crypto";
import { createStampResult } from "./stamping";

const stampHeaderName = "X-Stamp";

export type Runtime = "browser" | "node" | "purejs";

export type TApiKeyStamperConfig = {
  apiPublicKey: string;
  apiPrivateKey: string;
  runtimeOverride?: Runtime | undefined;
};

export enum SignatureFormat {
  Der = "der",
  Raw = "raw",
}

const isCryptoEnabledBrowser: boolean =
  typeof window !== "undefined" &&
  typeof window.document !== "undefined" &&
  typeof crypto !== "undefined" &&
  typeof crypto.subtle !== "undefined";

const isNode: boolean =
  typeof process !== "undefined" &&
  process.versions != null &&
  process.versions.node != null;

export const detectRuntime = (): Runtime => {
  if (isCryptoEnabledBrowser) {
    return "browser";
  }

  if (isNode) {
    return "node";
  }

  return "purejs";
};

export const signWithApiKey = async (
  input: {
    content: string;
    publicKey: string;
    privateKey: string;
  },
  runtimeOverride?: Runtime | undefined,
): Promise<string> => {
  const runtime = runtimeOverride ?? detectRuntime();

  switch (runtime) {
    case "browser":
      return (await import("../webcrypto")).signWithApiKey(input);
    case "node":
      return (await import("../nodecrypto")).signWithApiKey(input);
    case "purejs":
      return (await import("../purejs")).signWithApiKey(input);
    default:
      throw new Error(`Unsupported runtime: ${runtime}`);
  }
};

export class ApiKeyStamper {
  apiPublicKey: string;
  apiPrivateKey: string;
  runtimeOverride?: Runtime | undefined;

  constructor(config: TApiKeyStamperConfig) {
    this.apiPublicKey = config.apiPublicKey;
    this.apiPrivateKey = config.apiPrivateKey;
    this.runtimeOverride = config.runtimeOverride;
  }

  async stamp(payload: string) {
    const signature = await signWithApiKey(
      {
        publicKey: this.apiPublicKey,
        privateKey: this.apiPrivateKey,
        content: payload,
      },
      this.runtimeOverride,
    );

    const stamp = {
      publicKey: this.apiPublicKey,
      scheme: "SIGNATURE_SCHEME_TK_API_P256",
      signature,
    };

    return createStampResult(
      stampHeaderName,
      stringToBase64urlString(JSON.stringify(stamp)),
    );
  }

  async sign(payload: string, format: SignatureFormat) {
    switch (format) {
      case SignatureFormat.Raw: {
        const derSignature = await signWithApiKey(
          {
            publicKey: this.apiPublicKey,
            privateKey: this.apiPrivateKey,
            content: payload,
          },
          this.runtimeOverride,
        );
        const raw = fromDerSignature(derSignature);
        return uint8ArrayToHexString(raw);
      }
      case SignatureFormat.Der: {
        return signWithApiKey(
          {
            publicKey: this.apiPublicKey,
            privateKey: this.apiPrivateKey,
            content: payload,
          },
          this.runtimeOverride,
        );
      }
      default:
        throw new Error(`Unsupported signature format: ${format}`);
    }
  }
}
