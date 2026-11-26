/** gRPC `UNKNOWN`, used when the body carries no numeric code. */
const GRPC_CODE_UNKNOWN = 2;

/**
 * Reads a gRPC status or Auth Proxy error body. The text comes from
 * `message`, or from `error` when `message` is empty. A numeric `code` (or a
 * numeric string) is the gRPC code; any other string `code` such as
 * `OIDC_TOKEN_EXPIRED` is kept as `reason` and the gRPC code is `UNKNOWN`.
 */
function parseErrorBody(input: GrpcStatus): {
  message: string;
  code: number;
  reason: string | undefined;
} {
  const message =
    typeof input.message === "string" && input.message !== ""
      ? input.message
      : typeof input.error === "string"
        ? input.error
        : "";
  if (typeof input.code === "number") {
    return { message, code: input.code, reason: undefined };
  }
  if (typeof input.code === "string" && input.code !== "") {
    return /^\d+$/.test(input.code)
      ? { message, code: Number(input.code), reason: undefined }
      : { message, code: GRPC_CODE_UNKNOWN, reason: input.code };
  }
  return { message, code: GRPC_CODE_UNKNOWN, reason: undefined };
}

/**@internal */
export class ZeroXKeyRequestError extends Error {
  details: any[] | null;
  /** gRPC status code; `2` (UNKNOWN) when the body has no numeric code. */
  code: number;
  /** String `code` of the body (for example `OIDC_TOKEN_EXPIRED`), if any. */
  reason: string | undefined;
  status: number | undefined;
  retryAfter: string | undefined;
  body: unknown;

  constructor(input: GrpcStatus, response?: ZeroXKeyRequestErrorResponse) {
    const parsed = parseErrorBody(input);
    let zeroXKeyErrorMessage = `0xkey error ${parsed.reason ?? parsed.code}: ${parsed.message}`;

    if (input.details != null) {
      zeroXKeyErrorMessage += ` (Details: ${JSON.stringify(input.details)})`;
    }

    super(zeroXKeyErrorMessage);

    this.name = "ZeroXKeyRequestError";
    this.details = input.details ?? null;
    this.code = parsed.code;
    this.reason = parsed.reason;
    this.status = response?.status;
    this.retryAfter = response?.retryAfter;
    this.body = input;
  }
}

const BODY_SUMMARY_MAX_LENGTH = 200;

/**
 * Error for a failed HTTP response whose body is not a JSON gRPC status
 * (for example a plain-text 401 from a gateway).
 * @internal
 */
export class ZeroXKeyHttpError extends Error {
  status: number;
  statusText: string;
  retryAfter: string | undefined;
  /** Whitespace-collapsed body prefix, at most 200 characters plus an ellipsis. */
  bodySummary: string;

  constructor(
    response: ZeroXKeyRequestErrorResponse & { statusText: string },
    body: string,
  ) {
    super(`${response.status} ${response.statusText}`);
    this.name = "ZeroXKeyHttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.retryAfter = response.retryAfter;
    const collapsed = body.replace(/\s+/g, " ").trim();
    this.bodySummary =
      collapsed.length > BODY_SUMMARY_MAX_LENGTH
        ? `${collapsed.slice(0, BODY_SUMMARY_MAX_LENGTH)}…`
        : collapsed;
  }
}

/**@internal */
export type GrpcStatus = {
  message?: string | undefined;
  /**
   * Auth Proxy error bodies use `{ "error": "...", "code": "OIDC_..." }`:
   * the text is in `error` and `code` is a string.
   */
  error?: string | undefined;
  code?: number | string | undefined;
  details?: unknown[] | null | undefined;
};

/**@internal */
export type ZeroXKeyRequestErrorResponse = {
  status: number;
  retryAfter: string | undefined;
};
