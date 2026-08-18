import { createPayServer } from "@0xkey-io/pay/server";

type Address = `0x${string}`;

const UAT_ROUTE = {
  description: "0xkey Standalone Pay v1 staging acceptance ping",
  price: "$0.001",
  protocols: ["x402", "mpp"] as const,
};

export interface UatEnvironment {
  ZEROXKEY_ORGANIZATION_ID: string;
  ZEROXKEY_PAY_TO: string;
  ZEROXKEY_PUBLIC_KEY: string;
  ZEROXKEY_PRIVATE_KEY: string;
  MPP_SECRET_KEY: string;
  ZEROXKEY_FACILITATOR_URL?: string;
}

export function createUatApp(environment: UatEnvironment) {
  const organizationId = requireValue(
    environment.ZEROXKEY_ORGANIZATION_ID,
    "ZEROXKEY_ORGANIZATION_ID",
  );
  const payTo = requireAddress(environment.ZEROXKEY_PAY_TO);
  const publicKey = requireValue(
    environment.ZEROXKEY_PUBLIC_KEY,
    "ZEROXKEY_PUBLIC_KEY",
  );
  const privateKey = requireValue(
    environment.ZEROXKEY_PRIVATE_KEY,
    "ZEROXKEY_PRIVATE_KEY",
  );
  const mppSecretKey = requireValue(
    environment.MPP_SECRET_KEY,
    "MPP_SECRET_KEY",
  );
  const payments = createPayServer({
    environment: "sandbox",
    organizationId,
    payTo,
    apiKey: { publicKey, privateKey },
    mppSecretKey,
    ...(environment.ZEROXKEY_FACILITATOR_URL
      ? { facilitatorUrl: environment.ZEROXKEY_FACILITATOR_URL }
      : {}),
  });

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }
    if (request.method !== "GET" || url.pathname !== "/paid/ping") {
      return Response.json(
        { errorCode: "NOT_FOUND" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const payment = await payments.handle(request, UAT_ROUTE);
    if (payment.status !== 200) return payment.response;

    return payment.withReceipt(
      Response.json(
        {
          ok: true,
          paymentId: payment.paymentId,
          message: "standalone-pay-v1-uat-accepted",
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
    );
  };
}

function requireValue(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function requireAddress(value: string): Address {
  const normalized = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error("ZEROXKEY_PAY_TO must be an EVM address");
  }
  if (/^0x0{40}$/i.test(normalized)) {
    throw new Error("ZEROXKEY_PAY_TO must not be the zero address");
  }
  return normalized as Address;
}
