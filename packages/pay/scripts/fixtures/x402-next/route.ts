// Test-only real Next route. Copy with the public upfront example into a fresh,
// exactly locked fixture; no private imports or type assertions are needed.
import { withX402FromHTTPServer, x402HTTPResourceServer as FrameworkHTTP } from "@x402/next";
import { x402HTTPResourceServer } from "@x402/core/server";
import { NextResponse, type NextRequest } from "next/server";
import { createUpfrontHTTPServer } from "../../x402-upfront";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (FrameworkHTTP !== x402HTTPResourceServer) throw new Error("wrong-framework-owner");
  const operation = request.nextUrl.searchParams.get("operation");
  const fault = request.nextUrl.searchParams.get("fault");
  const counts = { supported: 0, verify: 0, settle: 0, stamp: 0, handler: 0 };
  const network = "eip155:84532";
  const http = createUpfrontHTTPServer({
    network,
    organizationId: "11111111-1111-4111-8111-111111111111",
    facilitatorUrl: "https://fixture.invalid",
    timeoutMs: 20,
    stamper: { async stampRequest() {
      counts.stamp++;
      return { stampHeaderName: "X-Stamp", stampHeaderValue: "synthetic" };
    } },
    async fetch(input, init) {
      const path = new URL(String(input)).pathname;
      if (path === "/supported") counts.supported++;
      else if (path === "/settle") counts.settle++;
      else { counts.verify++; throw new Error("unexpected-operation"); }
      if (path !== "/" + operation) {
        if (path !== "/supported") throw new Error("unexpected-operation");
        return Response.json({ kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} });
      }
      if (fault === "disconnect") throw new Error("private-upstream-sentinel");
      if (fault === "timeout") return new Promise((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("fixture-timeout-bound")), 1000);
        init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("private-timeout-sentinel")); }, { once: true });
      });
      if (fault === "503") return new Response("private-upstream-sentinel", { status: 503 });
      if (fault === "malformed") return Response.json({ unexpected: true });
      if (fault === "UNKNOWN") return Response.json({ errorCode: "PAYMENT_STATUS_UNKNOWN", retryable: true }, { status: 503 });
      return Response.json({ settlement: {
        success: fault === "success", transaction: fault === "success" ? "0x" + "33".repeat(32) : "", network,
        payer: "0x2222222222222222222222222222222222222222",
        ...(fault === "invalid" ? { errorReason: "authorization rejected" } : {}),
      }, paymentId: "11111111-1111-4111-8111-111111111112" });
    },
  }, "0x1111111111111111111111111111111111111111");
  const handler = withX402FromHTTPServer(async () => {
    counts.handler++;
    return NextResponse.json({ paid: true });
  }, http);
  const response = await handler(request);
  response.headers.set("x-fixture-counts", JSON.stringify(counts));
  response.headers.set("x-fixture-owner", "same");
  return response;
}
