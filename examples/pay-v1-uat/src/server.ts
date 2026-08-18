import { createServer } from "node:http";
import { createUatApp } from "./app.js";

const port = parsePort(process.env.PORT);
const publicBaseUrl = parseBaseUrl(
  process.env.PAY_UAT_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`,
);
const handle = createUatApp({
  ZEROXKEY_ORGANIZATION_ID: process.env.ZEROXKEY_ORGANIZATION_ID ?? "",
  ZEROXKEY_PAY_TO: process.env.ZEROXKEY_PAY_TO ?? "",
  ZEROXKEY_PUBLIC_KEY: process.env.ZEROXKEY_PUBLIC_KEY ?? "",
  ZEROXKEY_PRIVATE_KEY: process.env.ZEROXKEY_PRIVATE_KEY ?? "",
  MPP_SECRET_KEY: process.env.MPP_SECRET_KEY ?? "",
  ...(process.env.ZEROXKEY_FACILITATOR_URL
    ? { ZEROXKEY_FACILITATOR_URL: process.env.ZEROXKEY_FACILITATOR_URL }
    : {}),
});

const server = createServer(async (incoming, outgoing) => {
  const requestUrl = new URL(incoming.url ?? "/", publicBaseUrl);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  try {
    const response = await handle(
      new Request(requestUrl, { method: incoming.method ?? "GET", headers }),
    );
    outgoing.statusCode = response.status;
    response.headers.forEach((value, name) => outgoing.setHeader(name, value));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
    console.info("pay_uat_request", {
      method: incoming.method,
      path: requestUrl.pathname,
      status: response.status,
    });
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.setHeader("Content-Type", "application/json");
    outgoing.setHeader("Cache-Control", "no-store");
    outgoing.end(JSON.stringify({ errorCode: "UAT_INTERNAL_ERROR" }));
    console.error("pay_uat_request_failed", {
      method: incoming.method,
      path: requestUrl.pathname,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.info("pay_uat_ready", {
    endpoint: new URL("/paid/ping", publicBaseUrl).toString(),
    price: "0.001 USDC",
    protocols: ["x402", "mpp"],
  });
});

function parsePort(value: string | undefined): number {
  const port = Number(value ?? "3402");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PAY_UAT_PUBLIC_BASE_URL must be an origin without a path");
  }
  if (url.protocol !== "https:" && !isLoopbackHttp(url)) {
    throw new Error("PAY_UAT_PUBLIC_BASE_URL must use HTTPS or loopback HTTP");
  }
  return url;
}

function isLoopbackHttp(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}
