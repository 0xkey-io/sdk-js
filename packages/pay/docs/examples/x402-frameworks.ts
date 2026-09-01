import { paymentMiddlewareFromHTTPServer as expressMiddleware } from "@x402/express";
import { paymentMiddlewareFromHTTPServer as honoMiddleware } from "@x402/hono";
import { withX402FromHTTPServer } from "@x402/next";
import { NextResponse } from "next/server";
import type { Create0xkeyFacilitatorClientOptions } from "@0xkey-io/pay/x402";
import { createUpfrontHTTPServer } from "./x402-upfront.js";

// Use only the adapter for your framework. The graph must preserve the same
// actual consumer core/server owner in the recipe and the framework package.
export function expressPayment(options: Create0xkeyFacilitatorClientOptions, payTo: string) {
  return expressMiddleware(createUpfrontHTTPServer(options, payTo));
}
export function honoPayment(options: Create0xkeyFacilitatorClientOptions, payTo: string) {
  return honoMiddleware(createUpfrontHTTPServer(options, payTo));
}
export function nextPayment(options: Create0xkeyFacilitatorClientOptions, payTo: string) {
  return withX402FromHTTPServer(
    // Response only: successful same-credential retries can reenter this handler.
    // Direct consumers own business deduplication; the standard facilitator
    // exposes no private paymentId. Use the 0xkey-owned protect() facade for
    // paymentId-based handler context when implementing idempotent writes.
    async () => NextResponse.json({ paid: true }),
    createUpfrontHTTPServer(options, payTo),
  );
}
