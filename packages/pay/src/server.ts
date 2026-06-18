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

export interface FacilitatorClientOptions {
  baseUrl: string;
  apiKey?: string;
  organizationId?: string;
  fetch?: typeof fetch;
}

export function createFacilitatorClient(opts: FacilitatorClientOptions) {
  const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  async function verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const res = await baseFetch(`${opts.baseUrl.replace(/\/$/, "")}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        ...(opts.organizationId
          ? { "x-0xkey-organization-id": opts.organizationId }
          : {}),
      },
      body: JSON.stringify({
        x402Version: X402_VERSION,
        paymentPayload,
        paymentRequirements,
      }),
    });
    return (await res.json()) as VerifyResponse;
  }

  async function settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const res = await baseFetch(`${opts.baseUrl.replace(/\/$/, "")}/settle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        ...(opts.organizationId
          ? { "x-0xkey-organization-id": opts.organizationId }
          : {}),
      },
      body: JSON.stringify({
        x402Version: X402_VERSION,
        paymentPayload,
        paymentRequirements,
      }),
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
  const headers = {
    ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
  };

  async function listPayments(
    params: PaymentListParams,
  ): Promise<PaymentListResponse> {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    if (params.txHash) search.set("txHash", params.txHash);
    if (params.limit) search.set("limit", String(params.limit));
    const query = search.toString();
    const res = await baseFetch(
      `${baseUrl}/v1/organizations/${params.organizationId}/payments${
        query ? `?${query}` : ""
      }`,
      { headers },
    );
    return readJson<PaymentListResponse>(res);
  }

  async function getPayment(params: PaymentGetParams): Promise<PaymentRecord> {
    const res = await baseFetch(
      `${baseUrl}/v1/organizations/${params.organizationId}/payments/${params.paymentId}`,
      { headers },
    );
    return readJson<PaymentRecord>(res);
  }

  return {
    payments: {
      list: listPayments,
      get: getPayment,
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
