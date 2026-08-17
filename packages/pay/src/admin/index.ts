import type {
  PaymentGetParams,
  PaymentListParams,
  PaymentListResponse,
  PaymentRecord,
} from "../types";
import { createXStampV2Stamper } from "../xstamp";
import type { PayApiKey, RequestStamper } from "../xstamp";

export interface PayAdminClientOptions {
  baseUrl: string;
  organizationId: string;
  apiKey?: PayApiKey;
  stamper?: RequestStamper;
  fetch?: typeof globalThis.fetch;
}

export function createPayAdminClient(options: PayAdminClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const stamper = requireStamper(
    options.stamper ??
      (options.apiKey ? createXStampV2Stamper(options.apiKey) : undefined),
  );

  async function headers(url: string): Promise<Record<string, string>> {
    const result = await stamper.stampRequest({
      method: "GET",
      url,
      organizationId: options.organizationId,
      wireProtocol: "admin",
    });
    return { [result.stampHeaderName]: result.stampHeaderValue };
  }

  async function read<T>(url: string): Promise<T> {
    const response = await fetch(url, { headers: await headers(url) });
    const text = await response.text();
    let body: unknown = text;
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        // Preserve the HTTP status for text and proxy-generated error bodies.
      }
    }
    if (!response.ok) {
      const errorCode =
        isRecord(body) && typeof body.errorCode === "string"
          ? `: ${body.errorCode}`
          : "";
      throw new Error(
        `Pay admin request failed with ${response.status}${errorCode}`,
      );
    }
    if (!isRecord(body)) {
      throw new Error(
        `Pay admin response was not JSON (HTTP ${response.status})`,
      );
    }
    return body as T;
  }

  return {
    payments: {
      async list(params: PaymentListParams): Promise<PaymentListResponse> {
        const query = new URLSearchParams();
        if (params.status) query.set("status", params.status);
        if (params.txHash) query.set("txHash", params.txHash);
        if (params.network) query.set("network", params.network);
        if (params.protocol) query.set("protocol", params.protocol);
        if (params.address) query.set("address", params.address);
        if (params.createdAfter) query.set("createdAfter", params.createdAfter);
        if (params.createdBefore)
          query.set("createdBefore", params.createdBefore);
        if (params.limit) query.set("limit", String(params.limit));
        if (params.after) query.set("after", params.after);
        const suffix = query.size ? `?${query}` : "";
        return read(
          `${baseUrl}/v1/organizations/${options.organizationId}/payments${suffix}`,
        );
      },
      async get(params: PaymentGetParams): Promise<PaymentRecord> {
        return read(
          `${baseUrl}/v1/organizations/${options.organizationId}/payments/${params.paymentId}`,
        );
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireStamper(stamper: RequestStamper | undefined): RequestStamper {
  if (!stamper) throw new Error("Pay admin X-Stamp credentials are required");
  return stamper;
}
