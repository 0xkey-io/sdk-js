import {
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  X402_VERSION,
  dollarsToAtomic,
} from "./constants";
import {
  encodeBase64Json,
  decodePaymentPayloadHeader,
  decodePaymentRequiredHeader,
  encodePaymentRequired,
} from "./errors";
import type {
  GasPayerBalanceParams,
  GasPayerBalanceResponse,
  PaymentPayload,
  PaymentGetParams,
  PaymentListParams,
  PaymentListResponse,
  PaymentRecord,
  PaymentReceipt,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "./types";

/**
 * Minimal stamper contract (satisfied by `@0xkey-io/api-key-stamper`'s
 * `ApiKeyStamper`). Signs a payload string and returns the X-Stamp header to
 * send. Kept as an interface so `@0xkey-io/pay` need not hard-depend on the
 * stamper package.
 */
export interface Stamper {
  stamp(
    payload: string,
  ): Promise<{ stampHeaderName: string; stampHeaderValue: string }>;
}

export interface FacilitatorClientOptions {
  baseUrl: string;
  /**
   * X-Stamp signer (P-256 API key). Preferred when talking to the PUBLIC
   * pay-gateway (pay.staging.0xkey.io): the org is bound cryptographically.
   * `organizationId` is then required and is embedded in the signed body.
   */
  stamper?: Stamper;
  /**
   * Bearer token for the INTERNAL facilitator (in-cluster, behind a trusted
   * BFF). Ignored when `stamper` is set.
   */
  apiKey?: string;
  organizationId?: string;
  fetch?: typeof fetch;
}

/**
 * Build auth headers + the exact request body for a POST write. In stamper mode
 * the organizationId is embedded in the signed body (so the gateway can read
 * and authorize it) and the X-Stamp is computed over those exact bytes.
 */
async function buildSignedPost(
  opts: FacilitatorClientOptions,
  payload: object,
): Promise<{ headers: Record<string, string>; body: string }> {
  if (opts.stamper) {
    if (!opts.organizationId) {
      throw new Error(
        "organizationId is required when using a stamper (it is embedded in the signed body)",
      );
    }
    const body = JSON.stringify({
      ...payload,
      organizationId: opts.organizationId,
    });
    const { stampHeaderName, stampHeaderValue } =
      await opts.stamper.stamp(body);
    return {
      headers: {
        "Content-Type": "application/json",
        [stampHeaderName]: stampHeaderValue,
      },
      body,
    };
  }
  return {
    headers: {
      "Content-Type": "application/json",
      ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
      ...(opts.organizationId
        ? { "x-0xkey-organization-id": opts.organizationId }
        : {}),
    },
    body: JSON.stringify(payload),
  };
}

/** Build auth headers for an org-scoped GET (org travels in the path). */
async function buildReadHeaders(
  opts: FacilitatorClientOptions,
): Promise<Record<string, string>> {
  if (opts.stamper) {
    // The pay-gateway verifies the stamp over the (empty) body for GETs; the
    // org is taken from the URL path. Replay protection comes from the stamp
    // timestamp, not the body.
    const { stampHeaderName, stampHeaderValue } = await opts.stamper.stamp("");
    return { [stampHeaderName]: stampHeaderValue };
  }
  return {
    ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
    ...(opts.organizationId
      ? { "x-0xkey-organization-id": opts.organizationId }
      : {}),
  };
}

export function createFacilitatorClient(opts: FacilitatorClientOptions) {
  const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  async function verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const { headers, body } = await buildSignedPost(opts, {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    });
    const res = await baseFetch(`${opts.baseUrl.replace(/\/$/, "")}/verify`, {
      method: "POST",
      headers,
      body,
    });
    return (await res.json()) as VerifyResponse;
  }

  async function settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const { headers, body } = await buildSignedPost(opts, {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    });
    const res = await baseFetch(`${opts.baseUrl.replace(/\/$/, "")}/settle`, {
      method: "POST",
      headers,
      body,
    });
    return (await res.json()) as SettleResponse;
  }

  return { verify, settle };
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `Pay API request failed with ${res.status}`,
    );
  }
  return body as T;
}

export function createPayClient(opts: FacilitatorClientOptions) {
  const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = opts.baseUrl.replace(/\/$/, "");

  async function listPayments(
    params: PaymentListParams,
  ): Promise<PaymentListResponse> {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    if (params.txHash) search.set("txHash", params.txHash);
    if (params.network) search.set("network", params.network);
    if (params.direction) search.set("direction", params.direction);
    if (params.address) search.set("address", params.address);
    if (params.createdAfter) search.set("createdAfter", params.createdAfter);
    if (params.createdBefore) search.set("createdBefore", params.createdBefore);
    if (params.limit) search.set("limit", String(params.limit));
    if (params.after) search.set("after", params.after);
    const query = search.toString();
    const res = await baseFetch(
      `${baseUrl}/v1/organizations/${params.organizationId}/payments${
        query ? `?${query}` : ""
      }`,
      { headers: await buildReadHeaders(opts) },
    );
    return readJson<PaymentListResponse>(res);
  }

  async function getPayment(params: PaymentGetParams): Promise<PaymentRecord> {
    const res = await baseFetch(
      `${baseUrl}/v1/organizations/${params.organizationId}/payments/${params.paymentId}`,
      { headers: await buildReadHeaders(opts) },
    );
    return readJson<PaymentRecord>(res);
  }

  async function gasPayerBalance(
    params: GasPayerBalanceParams,
  ): Promise<GasPayerBalanceResponse> {
    const res = await baseFetch(
      `${baseUrl}/v1/organizations/${params.organizationId}/payments/gas-payer-balance`,
      { headers: await buildReadHeaders(opts) },
    );
    return readJson<GasPayerBalanceResponse>(res);
  }

  return {
    payments: {
      list: listPayments,
      get: getPayment,
      gasPayerBalance,
    },
  };
}

export interface PaywallOptions {
  price: string;
  asset: string;
  network: string;
  payTo: string;
  facilitator: FacilitatorClientOptions;
  description?: string;
  resource?: string;
  maxTimeoutSeconds?: number;
  settleFirst?: boolean;
  organizationId?: string;
}

function buildRequirements(opts: PaywallOptions): PaymentRequirements {
  const req: PaymentRequirements = {
    scheme: "exact",
    network: opts.network,
    amount: dollarsToAtomic(opts.price),
    asset: opts.asset,
    payTo: opts.payTo,
    maxTimeoutSeconds: opts.maxTimeoutSeconds ?? 300,
    mimeType: "application/json",
    extra: { name: "USDC", version: "2" },
  };
  if (opts.description) req.description = opts.description;
  if (opts.resource) req.resource = opts.resource;
  return req;
}

function payment402(required: PaymentRequirements, reason?: string): Response {
  const body: {
    x402Version: 2;
    error?: string;
    accepts: PaymentRequirements[];
  } = {
    x402Version: X402_VERSION,
    accepts: [required],
  };
  if (reason) body.error = reason;
  const encoded = encodePaymentRequired(body);
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      [HEADER_PAYMENT_REQUIRED]: encoded,
    },
  });
}

export async function handlePaywallRequest(
  req: Request,
  opts: PaywallOptions,
  handler: () => Promise<Response> | Response,
): Promise<Response> {
  const requirements = buildRequirements(opts);
  const sigHeader = req.headers.get(HEADER_PAYMENT_SIGNATURE);

  if (!sigHeader) {
    return payment402(requirements);
  }

  let payload: PaymentPayload;
  try {
    payload = decodePaymentPayloadHeader<PaymentPayload>(sigHeader);
  } catch {
    return payment402(requirements, "Invalid PAYMENT-SIGNATURE");
  }

  const facilitator = createFacilitatorClient(opts.facilitator);
  const verifyResult = await facilitator.verify(payload, requirements);
  if (!verifyResult.isValid) {
    return payment402(
      requirements,
      verifyResult.invalidReason ?? "verify failed",
    );
  }

  const runHandler = async () => {
    const business = await handler();
    const settleResult = await facilitator.settle(payload, requirements);
    if (!settleResult.success) {
      return new Response(
        JSON.stringify({ error: settleResult.errorReason ?? "settle failed" }),
        { status: 500 },
      );
    }
    const receipt: PaymentReceipt = {
      success: true,
      ...(settleResult.transaction
        ? { transaction: settleResult.transaction }
        : {}),
      ...(settleResult.network ? { network: settleResult.network } : {}),
      ...(settleResult.payer ? { payer: settleResult.payer } : {}),
    };
    const headers = new Headers(business.headers);
    headers.set(HEADER_PAYMENT_RESPONSE, encodeBase64Json(receipt));
    return new Response(business.body, {
      status: business.status,
      statusText: business.statusText,
      headers,
    });
  };

  if (opts.settleFirst) {
    const settleResult = await facilitator.settle(payload, requirements);
    if (!settleResult.success) {
      return payment402(requirements, settleResult.errorReason);
    }
    const business = await handler();
    const receipt: PaymentReceipt = {
      success: true,
      ...(settleResult.transaction
        ? { transaction: settleResult.transaction }
        : {}),
      ...(settleResult.network ? { network: settleResult.network } : {}),
      ...(settleResult.payer ? { payer: settleResult.payer } : {}),
    };
    const headers = new Headers(business.headers);
    headers.set(HEADER_PAYMENT_RESPONSE, encodeBase64Json(receipt));
    return new Response(business.body, { status: business.status, headers });
  }

  return runHandler();
}

/** Express middleware factory */
export function paywallExpress(opts: PaywallOptions) {
  return async (
    req: {
      headers: Record<string, string | string[] | undefined>;
      url?: string;
    },
    res: {
      status: (code: number) => {
        setHeader: (k: string, v: string) => void;
        send: (b: string) => void;
      };
      setHeader: (k: string, v: string) => void;
      send: (b: string) => void;
    },
  ) => {
    const url = req.url ?? "/";
    const request = new Request(`http://local${url}`, {
      headers: req.headers as HeadersInit,
    });
    const response = await handlePaywallRequest(
      request,
      opts,
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    if (response.status === 402) {
      const required = response.headers.get(HEADER_PAYMENT_REQUIRED);
      if (required) res.setHeader(HEADER_PAYMENT_REQUIRED, required);
      res.status(402).send(await response.text());
      return;
    }
    response.headers.forEach((v, k) => res.setHeader(k, v));
    res.status(response.status).send(await response.text());
  };
}

/** Hono middleware */
export function paywallHono(opts: PaywallOptions) {
  return async (c: {
    req: { raw: Request };
    json: (
      data: unknown,
      status?: number,
      init?: { headers?: Record<string, string> },
    ) => Response;
  }) => {
    return handlePaywallRequest(c.req.raw, opts, async () =>
      c.json({ ok: true }),
    );
  };
}

/** Next.js App Router route wrapper */
export function withPaywall(
  opts: PaywallOptions,
  handler: (req: Request) => Promise<Response> | Response,
) {
  return (req: Request) => handlePaywallRequest(req, opts, () => handler(req));
}

export { decodePaymentRequiredHeader, encodePaymentRequired };
