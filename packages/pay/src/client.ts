import type { Account, Hex } from "viem";
import {
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  X402_VERSION,
} from "./constants";
import {
  decodeBase64Json,
  decodePaymentRequiredHeader,
  encodePaymentPayload,
  selectRequirement,
  X402Error,
} from "./errors";
import { buildTransferWithAuthorizationTypedData } from "./eip3009";
import type { PaymentPayload, PaymentReceipt, PaymentRequired } from "./types";

export interface PayClientOptions {
  /** viem Account backed by @0xkey-io/viem createAccount */
  account: Account;
  /** Allowed CAIP-2 networks (default: Base + Base Sepolia) */
  allowedNetworks?: string[];
  /** Host allowlist globs, e.g. ["*.example.com"] */
  allowHosts?: string[];
  /** Per-transaction USD cap for local UX pre-check (not security boundary) */
  perTxUsd?: number;
  /** Optional receipt callback */
  onReceipt?: (receipt: PaymentReceipt, url: string) => void;
  /** Underlying fetch implementation */
  fetch?: typeof fetch;
}

function hostAllowed(url: string, patterns?: string[]): boolean {
  if (!patterns?.length) return true;
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  return patterns.some((p) => {
    if (p.startsWith("*.")) {
      const suffix = p.slice(1);
      return host.endsWith(suffix) || host === p.slice(2);
    }
    return host === p;
  });
}

export interface PayClient {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export const Pay = {
  client(opts: PayClientOptions): PayClient {
    const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    const allowedNetworks = opts.allowedNetworks ?? [
      "eip155:8453",
      "eip155:84532",
    ];

    async function payFetch(
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url = typeof input === "string" ? input : input.toString();
      if (!hostAllowed(url, opts.allowHosts)) {
        throw new X402Error("POLICY_DENIED", `Host not allowed: ${url}`);
      }

      let response = await baseFetch(input, init);
      if (response.status !== 402) {
        return response;
      }

      const requiredHeader = response.headers.get(HEADER_PAYMENT_REQUIRED);
      const required = decodePaymentRequiredHeader(requiredHeader);
      const accept = selectRequirement(required, allowedNetworks);

      const extra = accept.extra as
        | { name?: string; version?: string }
        | undefined;
      const typedDataArgs: Parameters<
        typeof buildTransferWithAuthorizationTypedData
      >[0] = {
        from: opts.account.address,
        to: accept.payTo as Hex,
        valueAtomic: accept.amount,
        verifyingContract: accept.asset as Hex,
        network: accept.network,
        maxTimeoutSeconds: accept.maxTimeoutSeconds,
      };
      if (extra?.name) typedDataArgs.assetName = extra.name;
      if (extra?.version) typedDataArgs.assetVersion = extra.version;
      const typedData = buildTransferWithAuthorizationTypedData(typedDataArgs);

      let signature: Hex;
      try {
        if (!opts.account.signTypedData) {
          throw new Error("account.signTypedData is not available");
        }
        signature = await opts.account.signTypedData({
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message as unknown as Record<string, unknown>,
        });
      } catch (e) {
        throw new X402Error("SIGN_FAILED", "signTypedData failed", {
          cause: e,
        });
      }

      const payload: PaymentPayload = {
        x402Version: X402_VERSION,
        scheme: "exact",
        network: accept.network,
        accepted: accept,
        payload: {
          signature,
          authorization: typedData.message,
        },
      };

      const headers = new Headers(init?.headers);
      headers.set(HEADER_PAYMENT_SIGNATURE, encodePaymentPayload(payload));

      response = await baseFetch(input, { ...init, headers });
      if (response.status === 402) {
        throw new X402Error(
          "SETTLE_FAILED",
          "Payment still required after signature",
          {
            paymentRequired: required,
          },
        );
      }

      const receiptHeader = response.headers.get(HEADER_PAYMENT_RESPONSE);
      if (receiptHeader) {
        try {
          const receipt = decodeBase64Json<PaymentReceipt>(receiptHeader);
          opts.onReceipt?.(receipt, url);
        } catch (e) {
          console.warn("Ignoring malformed PAYMENT-RESPONSE header", e);
        }
      }

      return response;
    }

    return { fetch: payFetch };
  },
};

export type { PaymentRequired, PaymentPayload, PaymentReceipt };
