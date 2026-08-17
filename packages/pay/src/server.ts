import { Credential, Errors, Receipt, x402 } from "mppx";
import { Types as EvmTypes } from "mppx/evm";
import { Mppx } from "mppx/server";
import { assets, charge as evmCharge } from "mppx/evm/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "mppx/x402";
import type { Address } from "viem";
import { createXStampV2Stamper } from "./xstamp";
import type { PayApiKey, RequestStamper, WireProtocol } from "./xstamp";

export interface FacilitatorClientOptions {
  baseUrl: string;
  organizationId: string;
  apiKey?: PayApiKey;
  stamper?: RequestStamper;
  fetch?: typeof globalThis.fetch;
}

export function createFacilitatorClient(options: FacilitatorClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const stamper = requireFacilitatorStamper(
    options.stamper ??
      (options.apiKey ? createXStampV2Stamper(options.apiKey) : undefined),
  );

  async function request<T>(
    path: string,
    payload: object,
    wireProtocol: WireProtocol,
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const body = JSON.stringify({
      ...payload,
      organizationId: options.organizationId,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const stamped = await stamper.stampRequest({
      method: "POST",
      url,
      body,
      organizationId: options.organizationId,
      wireProtocol,
    });
    headers[stamped.stampHeaderName] = stamped.stampHeaderValue;
    const response = await fetch(url, { method: "POST", headers, body });
    const text = await response.text();
    let result: unknown = text;
    if (text) {
      try {
        result = JSON.parse(text) as unknown;
      } catch {
        // Preserve the HTTP status for text and proxy-generated error bodies.
      }
    }
    const structuredUnknown = response.status === 503 && isRecord(result);
    if (!response.ok && !structuredUnknown) {
      const errorCode =
        isRecord(result) && typeof result.errorCode === "string"
          ? `: ${result.errorCode}`
          : "";
      throw new Error(
        `Pay facilitator request failed with ${response.status}${errorCode}`,
      );
    }
    if (!isRecord(result)) {
      throw new Error(
        `Pay facilitator response was not JSON (HTTP ${response.status})`,
      );
    }
    return result as T;
  }

  return {
    verify(
      paymentPayload: PaymentPayload,
      paymentRequirements: PaymentRequirements,
      wireProtocol: WireProtocol = "x402",
    ) {
      return request<VerifyResponse>(
        "/verify",
        { x402Version: 2, paymentPayload, paymentRequirements },
        wireProtocol,
      );
    },
    settle(
      paymentPayload: PaymentPayload,
      paymentRequirements: PaymentRequirements,
      wireProtocol: WireProtocol = "x402",
    ) {
      return request<SettleResponse & { paymentId: string }>(
        "/settle",
        { x402Version: 2, paymentPayload, paymentRequirements },
        wireProtocol,
      );
    },
  };
}

export interface CreatePayServerOptions {
  environment: "production" | "sandbox";
  organizationId: string;
  payTo: Address;
  apiKey: PayApiKey;
  mppSecretKey: string;
  facilitatorUrl?: string;
  fetch?: typeof globalThis.fetch;
  onFulfillmentFailed?: (event: {
    paymentId: string;
    reference: string;
    route: string;
    status: number;
  }) => void | Promise<void>;
}

export type PayServerProtocol = "x402" | "mpp";

export interface PayRoute {
  price: string;
  protocols?: readonly PayServerProtocol[];
  description?: string;
}

export interface PaidRequest {
  status: 200;
  paymentId: string;
  reference: string;
  withReceipt(response: Response): Response;
}

export interface PaymentChallenge {
  status: 402 | 400 | 503;
  response: Response;
}

export interface PayServer {
  handle(
    request: Request,
    route: PayRoute,
  ): Promise<PaidRequest | PaymentChallenge>;
  fulfillmentFailed(event: {
    paymentId: string;
    reference: string;
    route: string;
    status: number;
  }): Promise<void>;
}

export function createPayServer(options: CreatePayServerOptions): PayServer {
  if (new TextEncoder().encode(options.mppSecretKey).length < 32) {
    throw new Error("mppSecretKey must contain at least 32 bytes");
  }
  const currency =
    options.environment === "production"
      ? assets.base.USDC
      : assets.baseSepolia.USDC;
  const facilitator = createFacilitatorClient({
    baseUrl:
      options.facilitatorUrl ??
      (options.environment === "production"
        ? "https://pay.0xkey.io"
        : "https://api-pay.staging.0xkey.io"),
    organizationId: options.organizationId,
    apiKey: options.apiKey,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const paymentIds = new BoundedTtlMap<string, string>();
  const pendingFailures = new BoundedTtlMap<
    string,
    {
      errorCode: "PAYMENT_SERVICE_UNAVAILABLE" | "PAYMENT_STATUS_UNKNOWN";
      paymentId?: string;
      transaction?: string;
    }
  >();
  const method = evmCharge({
    currency,
    recipient: options.payTo,
    async settle({ credential, payload, request }) {
      const wireProtocol: WireProtocol =
        payload.nonce === EvmTypes.challengeHash(credential.challenge)
          ? "mpp"
          : "x402";
      const requirements: PaymentRequirements = {
        amount: request.amount,
        asset: request.currency,
        extra: {
          assetTransferMethod: "eip3009",
          name: currency.transfer.name,
          version: currency.transfer.version,
        },
        maxTimeoutSeconds: 300,
        network: currency.network,
        payTo: request.recipient,
        scheme: "exact",
      };
      const paymentPayload: PaymentPayload = {
        accepted: requirements,
        payload: {
          authorization: {
            from: payload.from,
            nonce: payload.nonce,
            to: payload.to,
            validAfter: payload.validAfter,
            validBefore: payload.validBefore,
            value: payload.value,
          },
          signature: payload.signature,
        },
        x402Version: 2,
      };
      let verified: VerifyResponse;
      try {
        verified = await facilitator.verify(
          paymentPayload,
          requirements,
          wireProtocol,
        );
      } catch (error) {
        pendingFailures.set(payload.signature, {
          errorCode: "PAYMENT_SERVICE_UNAVAILABLE",
        });
        throw new Errors.VerificationFailedError({
          reason: "payment service unavailable",
        });
      }
      if (!verified.isValid) {
        throw new Errors.VerificationFailedError({
          reason:
            verified.invalidMessage ??
            verified.invalidReason ??
            "PAYMENT_VERIFICATION_REJECTED",
        });
      }
      let settled: SettleResponse & { paymentId: string };
      try {
        settled = await facilitator.settle(
          paymentPayload,
          requirements,
          wireProtocol,
        );
      } catch (error) {
        pendingFailures.set(payload.signature, {
          errorCode: "PAYMENT_STATUS_UNKNOWN",
        });
        throw new Errors.VerificationFailedError({
          reason: "payment status unknown",
        });
      }
      if (!settled.success) {
        if (settled.errorReason === "PAYMENT_STATUS_UNKNOWN") {
          pendingFailures.set(payload.signature, {
            errorCode: "PAYMENT_STATUS_UNKNOWN",
            paymentId: settled.paymentId,
            ...(settled.transaction
              ? { transaction: settled.transaction }
              : {}),
          });
        }
        throw new Errors.VerificationFailedError({
          reason: settled.errorReason ?? "PAYMENT_STATUS_UNKNOWN",
        });
      }
      if (!settled.paymentId) {
        pendingFailures.set(payload.signature, {
          errorCode: "PAYMENT_STATUS_UNKNOWN",
          transaction: settled.transaction,
        });
        throw new Errors.VerificationFailedError({
          reason: "PAYMENT_ID_MISSING",
        });
      }
      pendingFailures.delete(payload.signature);
      paymentIds.set(settled.transaction, settled.paymentId);
      return {
        reference: settled.transaction,
        timestamp: new Date().toISOString(),
      };
    },
  });
  const mppx = Mppx.create({
    methods: [method],
    secretKey: options.mppSecretKey,
  });

  return {
    async handle(request, route) {
      const protocols = route.protocols ?? ["x402", "mpp"];
      if (!protocols.length) {
        throw new Error("Pay route must enable x402, mpp, or both");
      }
      const hasX402 = request.headers.has("PAYMENT-SIGNATURE");
      const hasMpp =
        request.headers.get("Authorization")?.startsWith("Payment ") ?? false;
      if (hasX402 && hasMpp) {
        return {
          status: 400,
          response: Response.json(
            { errorCode: "AMBIGUOUS_PAYMENT_CREDENTIAL", retryable: false },
            { status: 400 },
          ),
        };
      }
      if (
        (hasX402 && !protocols.includes("x402")) ||
        (hasMpp && !protocols.includes("mpp"))
      ) {
        return {
          status: 400,
          response: Response.json(
            { errorCode: "PAYMENT_PROTOCOL_NOT_ALLOWED", retryable: false },
            { status: 400 },
          ),
        };
      }
      const amount = route.price.replace(/^\$/, "");
      const result = await mppx.evm.charge({
        amount,
        ...(route.description ? { description: route.description } : {}),
      })(request);
      const signature = credentialSignature(request);
      const pendingFailure = signature
        ? pendingFailures.get(signature)
        : undefined;
      if (pendingFailure) {
        return {
          status: 503,
          response: Response.json(
            {
              errorCode: pendingFailure.errorCode,
              retryable: true,
              ...(pendingFailure.paymentId
                ? { paymentId: pendingFailure.paymentId }
                : {}),
              ...(pendingFailure.transaction
                ? { transaction: pendingFailure.transaction }
                : {}),
            },
            { status: 503, headers: { "Retry-After": "2" } },
          ),
        };
      }
      if (result.status === 402) {
        const headers = new Headers(result.challenge.headers);
        if (!protocols.includes("mpp")) headers.delete("WWW-Authenticate");
        if (!protocols.includes("x402")) headers.delete("PAYMENT-REQUIRED");
        return {
          status: 402,
          response: new Response(result.challenge.body, {
            headers,
            status: 402,
            statusText: result.challenge.statusText,
          }),
        };
      }
      const carrier = result.withReceipt(new Response());
      const receipt = Receipt.fromResponse(carrier);
      const paymentId = paymentIds.get(receipt.reference);
      if (!paymentId) {
        return {
          status: 503,
          response: Response.json(
            {
              errorCode: "PAYMENT_STATUS_UNKNOWN",
              retryable: true,
              transaction: receipt.reference,
            },
            { status: 503, headers: { "Retry-After": "2" } },
          ),
        };
      }
      return {
        status: 200,
        paymentId,
        reference: receipt.reference,
        withReceipt: result.withReceipt,
      };
    },
    async fulfillmentFailed(event) {
      try {
        if (options.onFulfillmentFailed) {
          await options.onFulfillmentFailed(event);
          return;
        }
        console.error("pay_fulfillment_failed", event);
      } catch (error) {
        console.error("pay_fulfillment_failed_callback_error", {
          ...event,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    },
  };
}

function requireFacilitatorStamper(
  stamper: RequestStamper | undefined,
): RequestStamper {
  if (!stamper)
    throw new Error("Pay facilitator X-Stamp credentials are required");
  return stamper;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class BoundedTtlMap<Key, Value> {
  private readonly values = new Map<Key, { expiresAt: number; value: Value }>();

  constructor(
    private readonly maxEntries = 10_000,
    private readonly ttlMs = 60 * 60 * 1_000,
  ) {}

  get(key: Key): Value | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: Key, value: Value): void {
    const now = Date.now();
    for (const [candidate, entry] of this.values) {
      if (entry.expiresAt <= now) this.values.delete(candidate);
    }
    if (!this.values.has(key) && this.values.size >= this.maxEntries) {
      const oldest = this.values.keys().next().value as Key | undefined;
      if (oldest !== undefined) this.values.delete(oldest);
    }
    this.values.set(key, { expiresAt: now + this.ttlMs, value });
  }

  delete(key: Key): void {
    this.values.delete(key);
  }
}

function credentialSignature(request: Request): string | undefined {
  try {
    const encoded = request.headers.get("PAYMENT-SIGNATURE");
    if (encoded)
      return x402.Header.decodePaymentSignature(encoded).payload.signature;
    const authorization = request.headers.get("Authorization");
    if (!authorization) return undefined;
    const credential = Credential.deserialize<{ signature?: unknown }>(
      authorization,
    );
    return typeof credential.payload.signature === "string"
      ? credential.payload.signature
      : undefined;
  } catch {
    return undefined;
  }
}
