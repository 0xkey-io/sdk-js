import {
  x402HTTPResourceServer,
  x402ResourceServer,
  type FacilitatorClient,
  type HTTPAdapter,
  type HTTPProcessResult,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { Mppx } from "mppx/server";
import { Credential, Receipt } from "mppx";
import { getAddress } from "viem";
import { PayError } from "./errors";
import { assertBasePaymentNetwork, resolvePayBaseUrl } from "./networks";
import type { BasePaymentNetwork } from "./receipt-verifier";
import { createXStampV2Stamper, type PayApiKey } from "./xstamp";
import { createX402FacilitatorTransport } from "./internal/x402-facilitator";
import { createMppEvmChargeMethod } from "./internal/create-mpp-evm-charge-method";
import { assertMppCredentialHasNoUnknownExtensions } from "./internal/mpp-evm-charge-adapter";
import { X402ExactV2Adapter } from "./internal/x402-exact-v2-adapter";

export interface CreatePayServerOptions {
  network: BasePaymentNetwork;
  organizationId: string;
  payTo: `0x${string}`;
  apiKey: PayApiKey;
  protocols?: readonly PayProtocol[];
  mppSecretKey?: string;
  facilitatorUrl?: string;
  fetch?: typeof globalThis.fetch;
  handlerRevision?: string;
}

export type PayProtocol = "x402" | "mpp";

export interface PayRoute {
  price: string;
  description?: string;
}

export interface PaidHandlerContext {
  request: Request;
  paymentId: string;
  reference: string;
  protocol: PayProtocol;
}

export interface PayServer {
  protect(
    route: PayRoute,
    handler: (context: PaidHandlerContext) => Response | Promise<Response>,
  ): (request: Request) => Promise<Response>;
}

type FulfillmentFailureCode =
  | "HANDLER_ERROR"
  | "HANDLER_TIMEOUT"
  | "RESPONSE_SERIALIZATION_FAILED";

interface FulfillmentUpdate {
  state: "FAILED" | "FULFILLED";
  failureCode?: FulfillmentFailureCode;
}

export function createPayServer(options: CreatePayServerOptions): PayServer {
  const protocols = validateServerOptions(options);
  const fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const stamper = createXStampV2Stamper(options.apiKey);
  const x402EconomicAdapter = new X402ExactV2Adapter(options.network);
  const x402Transport = protocols.includes("x402")
    ? createX402FacilitatorTransport({
        network: options.network,
        organizationId: options.organizationId,
        stamper,
        ...(options.facilitatorUrl ? { facilitatorUrl: options.facilitatorUrl } : {}),
        fetch,
      })
    : undefined;
  function createMppServer(
    onSettlement?: Parameters<typeof createMppEvmChargeMethod>[1],
  ) {
    if (!protocols.includes("mpp")) return undefined;
    const mppMethod = createMppEvmChargeMethod(
        {
          network: options.network,
          organizationId: options.organizationId,
          payTo: options.payTo,
          stamper,
          ...(options.facilitatorUrl ? { facilitatorUrl: options.facilitatorUrl } : {}),
          fetch,
        },
        onSettlement,
      ).method;
    return Mppx.create({ methods: [mppMethod], secretKey: options.mppSecretKey! });
  }

  return {
    protect(route, handler) {
      validateRoute(route);
      let x402Http: x402HTTPResourceServer | undefined;
      let x402Initialization: Promise<void> | undefined;

      function createX402Server(
        onSettlement?: (result: { paymentId: string; reference: string }) => void,
      ): x402HTTPResourceServer {
        if (!x402Transport) throw new Error("x402 is not enabled");
        const facilitator: FacilitatorClient = {
          verify: x402Transport.client.verify,
          getSupported: x402Transport.client.getSupported,
          async settle(payload, requirements) {
            const result = await x402Transport.settlePrivate(payload, requirements);
            onSettlement?.({
              paymentId: result.paymentId,
              reference: result.settlement.transaction,
            });
            return result.settlement;
          },
        };
        const exactScheme = new ExactEvmScheme();
        Object.defineProperty(exactScheme, "paymentFlows", {
          configurable: false,
          enumerable: true,
          value: {
            eip3009: {
              supported: ["authorization", "upfront"],
              default: "authorization",
            },
            permit2: exactScheme.paymentFlows.permit2,
          },
          writable: false,
        });
        const resource = new x402ResourceServer(facilitator)
          .register(options.network, exactScheme)
          .onBeforeVerify(async ({ paymentPayload, requirements }) => ({
            skip: true,
            result: await (async () => {
              const mutablePayload = cloneWire<PaymentPayload>(paymentPayload);
              const mutableRequirements = cloneWire<PaymentRequirements>(requirements);
              x402EconomicAdapter.toCommand(mutablePayload, mutableRequirements);
              return facilitator.verify(mutablePayload, mutableRequirements);
            })(),
          }));
        return new x402HTTPResourceServer(resource, {
          accepts: {
            scheme: "exact",
            network: options.network,
            payTo: options.payTo,
            price: route.price,
            extra: {
              assetTransferMethod: "eip3009",
              paymentFlow: "upfront",
            },
          },
          ...(route.description ? { description: route.description } : {}),
        });
      }

      function getX402Server(): x402HTTPResourceServer {
        if (!x402Http) {
          x402Http = createX402Server();
        }
        return x402Http;
      }

      async function initializeX402(): Promise<x402HTTPResourceServer> {
        const server = getX402Server();
        x402Initialization ??= server.initialize();
        await x402Initialization;
        return server;
      }

      return async (request) => {
        const hasX402 = request.headers.has("PAYMENT-SIGNATURE");
        const hasMpp = isMppCredential(request.headers.get("Authorization"));
        if (hasX402 && hasMpp) {
          return errorResponse(400, "AMBIGUOUS_PAYMENT_CREDENTIAL", false);
        }
        if (
          (hasX402 && !protocols.includes("x402")) ||
          (hasMpp && !protocols.includes("mpp"))
        ) {
          return errorResponse(400, "PAYMENT_PROTOCOL_NOT_ALLOWED", false);
        }

        if (hasX402) {
          let privateSettlement: { paymentId: string; reference: string } | undefined;
          const requestServer = createX402Server((settlement) => {
            privateSettlement = settlement;
          });
          await requestServer.initialize();
          return handleX402(requestServer, request, handler, () => privateSettlement);
        }
        if (hasMpp) return handleMpp(request, handler);

        const responses: Response[] = [];
        if (protocols.includes("x402")) {
          const server = await initializeX402();
          responses.push(toResponse(await server.processHTTPRequest(x402Context(request))));
        }
        const challengeMppServer = createMppServer();
        if (challengeMppServer) {
          const result = await challengeMppServer.evm.charge(mppRouteOptions(route))(request);
          if (result.status !== 402) {
            throw new Error("MPP challenge path settled without a credential");
          }
          responses.push(result.challenge);
        }
        return mergeChallenges(responses);
      };

      async function handleX402(
        server: x402HTTPResourceServer,
        request: Request,
        paidHandler: (context: PaidHandlerContext) => Response | Promise<Response>,
        getPrivateSettlement: () =>
          | { paymentId: string; reference: string }
          | undefined,
      ): Promise<Response> {
        const result = await server.processHTTPRequest(x402Context(request));
        if (result.type !== "payment-verified") return toResponse(result);
        const completed = result.beforeHandlerSettlement;
        if (!completed) return errorResponse(503, "PAYMENT_STATUS_UNKNOWN", true);
        const reference = completed.result.transaction;
        const privateSettlement = getPrivateSettlement();
        if (!privateSettlement || privateSettlement.reference !== reference) {
          return errorResponse(503, "PAYMENT_STATUS_UNKNOWN", true);
        }
        const paymentId = privateSettlement.paymentId;

        let response: Response;
        try {
          response = await paidHandler({ request, paymentId, reference, protocol: "x402" });
        } catch {
          const persistence = await updateFulfillment(paymentId, "x402", {
            state: "FAILED",
            failureCode: "HANDLER_ERROR",
          });
          const failed = persistence.ok
            ? errorResponse(500, "HANDLER_ERROR", false)
            : errorResponse(503, "PAYMENT_STATUS_UNKNOWN", true);
          return withHeaders(
            failed,
            server.createFailurePathSettlementHeaders(undefined, completed, result.paymentPayload),
          );
        }

        if (response.status >= 500) {
          const persistence = await updateFulfillment(paymentId, "x402", {
            state: "FAILED",
            failureCode: "HANDLER_ERROR",
          });
          const target = persistence.ok
            ? response
            : errorResponse(503, "PAYMENT_STATUS_UNKNOWN", true);
          return withHeaders(
            target,
            server.createFailurePathSettlementHeaders(
              undefined,
              completed,
              result.paymentPayload,
              response.headers.get("Cache-Control"),
            ),
          );
        }

        const persistence = await updateFulfillment(paymentId, "x402", {
          state: "FULFILLED",
        });
        const settlement = await server.processSettlement(
          result.paymentPayload,
          result.paymentRequirements,
          result.declaredExtensions,
          undefined,
          undefined,
          completed,
        );
        if (!settlement.success) {
          return new Response(JSON.stringify(settlement.response.body ?? {}), {
            status: settlement.response.status,
            headers: settlement.response.headers,
          });
        }
        const target = persistence.ok
          ? response
          : errorResponse(503, "PAYMENT_STATUS_UNKNOWN", true);
        return withHeaders(target, settlement.headers);
      }

      async function handleMpp(
        request: Request,
        paidHandler: (context: PaidHandlerContext) => Response | Promise<Response>,
      ): Promise<Response> {
        let privateSettlement:
          | { paymentId: string; reference: string }
          | undefined;
        const requestMppServer = createMppServer((settlement) => {
          privateSettlement = settlement;
        });
        if (!requestMppServer) {
          return errorResponse(400, "PAYMENT_PROTOCOL_NOT_ALLOWED", false);
        }
        try {
          assertMppCredentialHasNoUnknownExtensions(
            request.headers.get("Authorization")!,
          );
        } catch {
          return Response.json(
            {
              type: "about:blank",
              title: "Malformed payment credential",
              status: 400,
            },
            {
              status: 400,
              headers: { "Content-Type": "application/problem+json" },
            },
          );
        }
        const result = await requestMppServer.evm
          .charge(mppRouteOptions(route))(canonicalMppRequest(request));
        if (result.status === 402) return result.challenge;
        const receiptCarrier = result.withReceipt(new Response());
        const reference = Receipt.fromResponse(receiptCarrier).reference;
        if (!privateSettlement || privateSettlement.reference !== reference) {
          return errorResponse(503, "PAYMENT_STATUS_UNKNOWN", true);
        }
        const paymentId = privateSettlement.paymentId;
        let response: Response;
        try {
          response = await paidHandler({ request, paymentId, reference, protocol: "mpp" });
        } catch {
          const persistence = await updateFulfillment(paymentId, "mpp", {
            state: "FAILED",
            failureCode: "HANDLER_ERROR",
          });
          return persistence.ok
            ? errorResponse(500, "HANDLER_ERROR", false)
            : errorResponse(503, "PAYMENT_STATUS_UNKNOWN", true);
        }
        if (response.status >= 500) {
          const persistence = await updateFulfillment(paymentId, "mpp", {
            state: "FAILED",
            failureCode: "HANDLER_ERROR",
          });
          return persistence.ok
            ? response
            : errorResponse(503, "PAYMENT_STATUS_UNKNOWN", true);
        }
        const persistence = await updateFulfillment(paymentId, "mpp", {
          state: "FULFILLED",
        });
        if (!persistence.ok) return errorResponse(503, "PAYMENT_STATUS_UNKNOWN", true);
        return result.withReceipt(response);
      }

      async function updateFulfillment(
        paymentId: string,
        wireProtocol: PayProtocol,
        update: FulfillmentUpdate,
      ): Promise<{ ok: boolean }> {
        const baseUrl = resolvePayBaseUrl(options.network, options.facilitatorUrl).replace(/\/+$/, "");
        const url = `${baseUrl}/v1/payments/${encodeURIComponent(paymentId)}/fulfillment`;
        const body = JSON.stringify({
          organizationId: options.organizationId,
          ...update,
          ...(options.handlerRevision ? { handlerRevision: options.handlerRevision } : {}),
        });
        try {
          const stamped = await stamper.stampRequest({
            method: "PUT",
            url,
            body,
            organizationId: options.organizationId,
            wireProtocol,
          });
          const response = await fetch(url, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              [stamped.stampHeaderName]: stamped.stampHeaderValue,
            },
            body,
            signal: AbortSignal.timeout(30_000),
          });
          await response.arrayBuffer();
          return { ok: response.status === 200 };
        } catch {
          return { ok: false };
        }
      }
    },
  };
}

function validateServerOptions(options: CreatePayServerOptions): PayProtocol[] {
  assertBasePaymentNetwork(options.network);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      options.organizationId,
    )
  ) {
    throw profileError("organizationId must be a UUID");
  }
  try {
    getAddress(options.payTo);
  } catch (cause) {
    throw new PayError("PAY_PROFILE_INVALID", "payTo must be an EVM address", {
      phase: "configuration",
      cause,
    });
  }
  const protocols = [...(options.protocols ?? ["x402", "mpp"])] as PayProtocol[];
  if (
    protocols.length === 0 ||
    new Set(protocols).size !== protocols.length ||
    protocols.some((protocol) => protocol !== "x402" && protocol !== "mpp")
  ) {
    throw profileError("protocols must contain unique x402 or mpp values");
  }
  if (
    protocols.includes("mpp") &&
    (!options.mppSecretKey || new TextEncoder().encode(options.mppSecretKey).length < 32)
  ) {
    throw profileError("mppSecretKey must contain at least 32 UTF-8 bytes");
  }
  return protocols;
}

function validateRoute(route: PayRoute): void {
  if (!route.price || typeof route.price !== "string") {
    throw profileError("route price is required");
  }
}

function profileError(message: string): PayError {
  return new PayError("PAY_PROFILE_INVALID", message, { phase: "configuration" });
}

function isMppCredential(value: string | null): boolean {
  return value !== null && Credential.extractPaymentScheme(value) !== null;
}

function canonicalMppRequest(request: Request): Request {
  const extracted = Credential.extractPaymentScheme(request.headers.get("Authorization") ?? "");
  if (!extracted) return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", extracted.replace(/^Payment\s+/i, "Payment "));
  return new Request(request, { headers });
}

function x402Context(request: Request) {
  const url = new URL(request.url);
  const adapter: HTTPAdapter = {
    getHeader: (name) => request.headers.get(name) ?? undefined,
    getMethod: () => request.method,
    getPath: () => url.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("Accept") ?? "application/json",
    getUserAgent: () => request.headers.get("User-Agent") ?? "0xkey-pay",
  };
  return {
    adapter,
    path: url.pathname,
    method: request.method,
    ...(request.headers.get("PAYMENT-SIGNATURE")
      ? { paymentHeader: request.headers.get("PAYMENT-SIGNATURE")! }
      : {}),
  };
}

function toResponse(result: HTTPProcessResult): Response {
  if (result.type === "no-payment-required") return new Response(null, { status: 204 });
  if (result.type === "payment-verified") {
    throw new Error("paid request requires the protected handler");
  }
  const body = result.response.body;
  return new Response(
    body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body),
    { status: result.response.status, headers: result.response.headers },
  );
}

function mergeChallenges(responses: Response[]): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  for (const response of responses) {
    for (const [name, value] of response.headers) {
      if (
        name.toLowerCase() === "payment-required" ||
        name.toLowerCase() === "www-authenticate"
      ) {
        headers.append(name, value);
      }
    }
  }
  return new Response(null, { status: 402, headers });
}

function mppRouteOptions(route: PayRoute): { amount: string; description?: string } {
  return {
    amount: route.price.replace(/^\$/, ""),
    ...(route.description ? { description: route.description } : {}),
  };
}

function errorResponse(status: number, errorCode: string, retryable: boolean): Response {
  return Response.json(
    { errorCode, retryable },
    { status, ...(retryable ? { headers: { "Retry-After": "2" } } : {}) },
  );
}

function cloneWire<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withHeaders(response: Response, additions?: Record<string, string>): Response {
  if (!additions) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(additions)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
