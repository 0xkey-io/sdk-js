import {
  ApiKeyStamper,
  SignatureFormat,
} from "@0xkey-io/api-key-stamper";

export type WireProtocol = "x402" | "mpp" | "admin";

export interface PayApiKey {
  publicKey: string;
  privateKey: string;
}

export interface RequestStampInput {
  method: string;
  url: string;
  body?: string;
  organizationId: string;
  wireProtocol: WireProtocol;
}

export interface RequestStamper {
  stampRequest(input: RequestStampInput): Promise<{
    stampHeaderName: "X-Stamp";
    stampHeaderValue: string;
  }>;
}

export function createXStampV2Stamper(apiKey: PayApiKey): RequestStamper {
  const signer = new ApiKeyStamper({
    apiPublicKey: apiKey.publicKey,
    apiPrivateKey: apiKey.privateKey,
  });
  return {
    async stampRequest(input) {
      const timestampMs = Date.now();
      const nonce = randomNonce();
      const body = input.body ?? "";
      const canonical = await xStampV2Canonical({
        ...input,
        body,
        nonce,
        timestampMs,
      });
      const signature = await signer.sign(canonical, SignatureFormat.Der);
      const stamp = {
        version: "2",
        publicKey: apiKey.publicKey,
        signature,
        scheme: "SIGNATURE_SCHEME_TK_API_P256",
        timestampMs,
        nonce,
        organizationId: input.organizationId,
        wireProtocol: input.wireProtocol,
      };
      return {
        stampHeaderName: "X-Stamp",
        stampHeaderValue: base64Url(JSON.stringify(stamp)),
      };
    },
  };
}

export async function xStampV2Canonical(input: RequestStampInput & {
  body: string;
  nonce: string;
  timestampMs: number;
}): Promise<string> {
  const url = new URL(input.url);
  return [
    "2",
    input.method.toUpperCase(),
    url.pathname,
    canonicalQuery(url),
    String(input.timestampMs),
    input.nonce,
    await sha256Hex(input.body),
    input.organizationId,
    input.wireProtocol,
  ].join("\n");
}

function canonicalQuery(url: URL): string {
  return Array.from(url.searchParams.entries())
    .map(([key, value]) => [rfc3986(key), rfc3986(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? compareAscii(leftValue, rightValue)
        : compareAscii(leftKey, rightKey),
    )
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("X-Stamp V2 requires WebCrypto SHA-256");
  }
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function randomNonce(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("X-Stamp V2 requires secure randomness");
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let encoded: string;
  if (typeof btoa === "function") {
    encoded = btoa(String.fromCharCode(...bytes));
  } else {
    const buffer = (globalThis as unknown as {
      Buffer?: { from(value: Uint8Array): { toString(encoding: string): string } };
    }).Buffer;
    if (!buffer) throw new Error("X-Stamp V2 requires a base64 encoder");
    encoded = buffer.from(bytes).toString("base64");
  }
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
