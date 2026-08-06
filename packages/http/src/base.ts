import { signWithApiKey } from "@0xkey-io/api-key-stamper";
import { fetch } from "./universal";
import { getBrowserConfig, getConfig } from "./config";
import { stringToBase64urlString } from "@0xkey-io/encoding";
import {
  getWebAuthnAssertion,
  ZeroXKeyCredentialRequestOptions,
} from "./webauthn";
import type { ZeroXKeyClient } from ".";

export type { ZeroXKeyCredentialRequestOptions };
export { fetch };
type TBasicType = string;

type TQueryShape = Record<string, TBasicType | Array<TBasicType>>;
type THeadersShape = Record<string, TBasicType> | undefined;
type TBodyShape = Record<string, any>;
type TSubstitutionShape = Record<string, any>;

const sharedHeaders: THeadersShape = {
  "Content-Type": "application/json",
  Accept: "application/problem+json, application/json",
};

const sharedRequestOptions: Partial<RequestInit> = {
  redirect: "follow",
};

/**
 * Represents a signed request ready to be POSTed to ZeroXKey
 * @deprecated use {@link TSignedRequest} instead
 */
export type SignedRequest = {
  body: string;
  stamp: string;
  url: string;
};

/**
 * @deprecated
 */
export async function signedRequest<
  B extends TBodyShape = never,
  Q extends TQueryShape = never,
  S extends TSubstitutionShape = never,
>(input: {
  uri: string;
  query?: Q;
  body?: B;
  substitution?: S;
  options?: ZeroXKeyCredentialRequestOptions | undefined;
}): Promise<SignedRequest> {
  const {
    uri: inputUri,
    query: inputQuery = {},
    substitution: inputSubstitution = {},
    body: inputBody = {},
  } = input;

  const url = constructUrl({
    uri: inputUri,
    query: inputQuery,
    substitution: inputSubstitution,
  });

  const body = JSON.stringify(inputBody);
  const stamp = await getWebAuthnAssertion(body, input.options);

  return {
    url: url.toString(),
    body,
    stamp,
  };
}

export async function request<
  ResponseData = never,
  B extends TBodyShape = never,
  Q extends TQueryShape = never,
  S extends TSubstitutionShape = never,
  H extends THeadersShape = never,
>(input: {
  uri: string;
  method: "POST";
  headers?: H;
  query?: Q;
  body?: B;
  substitution?: S;
  signal?: AbortSignal;
}): Promise<ResponseData> {
  const {
    uri: inputUri,
    method,
    headers: inputHeaders = {},
    query: inputQuery = {},
    substitution: inputSubstitution = {},
    body: inputBody = {},
    signal,
  } = input;

  const url = constructUrl({
    uri: inputUri,
    query: inputQuery,
    substitution: inputSubstitution,
  });

  const { sealedBody, xStamp } = await sealAndStampRequestBody({
    body: inputBody,
  });

  // Retries reuse the exact sealed body and stamp. Activity mutations remain
  // safe because their activityId is the server-side idempotency key.
  const response = await fetchWithRateLimitRetry(url.toString(), {
    ...sharedRequestOptions,
    method,
    headers: {
      ...sharedHeaders,
      ...inputHeaders,
      "X-Stamp": xStamp,
    },
    body: sealedBody,
    ...(signal ? { signal } : {}),
  });

  if (!response.ok) {
    // Can't use native `cause` here because it's not well supported on Node v16
    // https://node.green/#ES2022-features-Error-cause-property

    let res: GrpcStatus;
    try {
      res = await response.json();
    } catch (_) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    throw new ZeroXKeyRequestError(res);
  }

  const data = await response.json();

  return data as ResponseData;
}

export class RateLimitError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterMs: number | undefined;
  readonly lane: string | undefined;
  readonly scope: string | undefined;
  readonly requestId: string | undefined;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    retryAfterMs: number | undefined;
    lane: string | undefined;
    scope: string | undefined;
    requestId: string | undefined;
  }) {
    super(input.message);
    this.name = "RateLimitError";
    this.status = input.status;
    this.code = input.code;
    this.retryAfterMs = input.retryAfterMs;
    this.lane = input.lane;
    this.scope = input.scope;
    this.requestId = input.requestId;
  }
}

const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_RATE_LIMIT_DELAY_MS = 5000;

async function fetchWithRateLimitRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let totalDelayMs = 0;

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, init);
    if (response.status !== 429 && response.status !== 503) {
      return response;
    }
    const rateLimitError = await rateLimitErrorFromResponse(response.clone());
    if (!rateLimitError) {
      return response;
    }

    const minimumDelayMs = rateLimitError.retryAfterMs ?? 1000;
    if (
      attempt >= MAX_RATE_LIMIT_RETRIES ||
      totalDelayMs + minimumDelayMs > MAX_RATE_LIMIT_DELAY_MS
    ) {
      throw rateLimitError;
    }

    // Jitter is added after the server-provided minimum, never before it.
    const delayMs = Math.min(
      Math.ceil(minimumDelayMs * (1 + Math.random() * 0.2)),
      MAX_RATE_LIMIT_DELAY_MS - totalDelayMs,
    );
    totalDelayMs += delayMs;
    await sleep(delayMs, init.signal);
  }
}

async function rateLimitErrorFromResponse(
  response: Response,
): Promise<RateLimitError | null> {
  if (response.status !== 429 && response.status !== 503) {
    return null;
  }

  const retryAfterMs = retryDelayMs(response);
  let problem: Record<string, unknown> = {};
  try {
    problem = (await response.json()) as Record<string, unknown>;
  } catch (_) {
    if (response.status !== 429) {
      return null;
    }
  }

  const code = typeof problem.code === "string" ? problem.code : "";
  if (response.status === 503 && code !== "RATE_LIMIT_BACKEND_UNAVAILABLE") {
    return null;
  }

  return new RateLimitError({
    status: response.status,
    code:
      code ||
      (response.status === 429
        ? "RATE_LIMIT_EXCEEDED"
        : "RATE_LIMIT_BACKEND_UNAVAILABLE"),
    message:
      stringField(problem, "detail") ??
      stringField(problem, "title") ??
      (response.statusText || "Request rate limited"),
    retryAfterMs,
    lane: stringField(problem, "lane"),
    scope: stringField(problem, "scope"),
    requestId: stringField(problem, "requestId"),
  });
}

function stringField(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof value[key] === "string" ? (value[key] as string) : undefined;
}

function retryDelayMs(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (!retryAfter) {
    return undefined;
  }

  const seconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }
  return Math.max(0, retryAt - Date.now());
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function constructUrl(input: {
  uri: string;
  query: TQueryShape;
  substitution: TSubstitutionShape;
}): URL {
  const { uri, query, substitution } = input;

  const baseUrl = getBaseUrl();

  const url = new URL(substitutePath(uri, substitution), baseUrl);

  for (const key in query) {
    const value = query[key];

    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
    } else {
      url.searchParams.append(key, value ?? "");
    }
  }

  return url;
}

function getBaseUrl(): string {
  try {
    const { baseUrl } = getConfig();
    return baseUrl;
  } catch (e) {
    const { baseUrl } = getBrowserConfig();
    return baseUrl;
  }
}

function substitutePath(
  uri: string,
  substitutionMap: TSubstitutionShape,
): string {
  let result = uri;

  const keyList = Object.keys(substitutionMap);

  for (const key of keyList) {
    const output = result.replaceAll(`{${key}}`, substitutionMap[key]);
    invariant(
      output !== result,
      `Substitution error: cannot find "${key}" in URI "${uri}". \`substitutionMap\`: ${JSON.stringify(
        substitutionMap,
      )}`,
    );

    result = output;
  }

  invariant(
    !/\{.*\}/.test(result),
    `Substitution error: found unsubstituted components in "${result}"`,
  );

  return result;
}

function invariant(condition: any, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function stableStringify(input: Record<string, any>): string {
  return JSON.stringify(input);
}

/**
 * Seals and stamps the request body with your ZeroXKey API credentials.
 *
 * You can either:
 * - Before calling `sealAndStampRequestBody(...)`, initialize with your ZeroXKey API credentials via `init(...)`
 * - Or, provide `apiPublicKey` and `apiPrivateKey` here as arguments
 */
export async function sealAndStampRequestBody(input: {
  body: Record<string, any>;
  apiPublicKey?: string;
  apiPrivateKey?: string;
}): Promise<{
  sealedBody: string;
  xStamp: string;
}> {
  const { body } = input;
  let { apiPublicKey, apiPrivateKey } = input;

  if (!apiPublicKey) {
    const config = getConfig();
    apiPublicKey = config.apiPublicKey;
  }

  if (!apiPrivateKey) {
    const config = getConfig();
    apiPrivateKey = config.apiPrivateKey;
  }

  const sealedBody = stableStringify(body);
  const signature = await signWithApiKey({
    content: sealedBody,
    privateKey: apiPrivateKey,
    publicKey: apiPublicKey,
  });
  const sealedStamp = stableStringify({
    publicKey: apiPublicKey,
    scheme: "SIGNATURE_SCHEME_TK_API_P256",
    signature: signature,
  });

  const xStamp = stringToBase64urlString(sealedStamp);

  return {
    sealedBody,
    xStamp,
  };
}

// Check if the client is an instance of ZeroXKeyClient. We check the name field here since the 'instanceof' operator does not work across if the http client isn't EXACTLY the same (mismatching versions).
export function isHttpClient(client: any): client is ZeroXKeyClient {
  return client?.name === "ZeroXKeyClient";
}

export type THttpConfig = {
  baseUrl: string;
};

/**
 * Represents a signed request ready to be POSTed to ZeroXKey
 */
export type TSignedRequest = {
  body: string;
  stamp: TStamp;
  url: string;
};

/**
 * Represents a stamp header name/value pair
 */
export type TStamp = {
  stampHeaderName: string;
  stampHeaderValue: string;
};

export type GrpcStatus = {
  message: string;
  code: number;
  details: unknown[] | null;
};

/**
 * Interface to implement if you want to provide your own stampers to your {@link ZeroXKeyClient}.
 * Currently ZeroXKey provides 2 stampers:
 * - applications signing requests with Passkeys or webauthn devices should use `@0xkey-io/webauthn-stamper`
 * - applications signing requests with API keys should use `@0xkey-io/api-key-stamper`
 */
export interface TStamper {
  stamp: (input: string) => Promise<TStamp>;
}

export class ZeroXKeyRequestError extends Error {
  details: any[] | null;
  code: number;

  constructor(input: GrpcStatus) {
    let zeroXKeyErrorMessage = `ZeroXKey error ${input.code}: ${input.message}`;

    if (input.details != null) {
      zeroXKeyErrorMessage += ` (Details: ${JSON.stringify(input.details)})`;
    }

    super(zeroXKeyErrorMessage);

    this.name = "ZeroXKeyRequestError";
    this.details = input.details ?? null;
    this.code = input.code;
  }
}
