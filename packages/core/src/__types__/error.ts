/** gRPC `UNKNOWN`, used when neither the body nor the HTTP status gives a code. */
const GRPC_CODE_UNKNOWN = 2;

/**
 * HTTP status to gRPC code (the grpc-gateway mapping, reversed). The same table
 * is used by sdk-swift and sdk-kotlin.
 */
function grpcCodeForHttpStatus(status: number | undefined): number {
  switch (status) {
    case 400:
      return 3; // INVALID_ARGUMENT
    case 401:
      return 16; // UNAUTHENTICATED
    case 403:
      return 7; // PERMISSION_DENIED
    case 404:
      return 5; // NOT_FOUND
    case 409:
      return 6; // ALREADY_EXISTS
    case 412:
      return 9; // FAILED_PRECONDITION
    case 413:
      return 11; // OUT_OF_RANGE
    case 429:
      return 8; // RESOURCE_EXHAUSTED
    case 499:
      return 1; // CANCELLED
    case 501:
      return 12; // UNIMPLEMENTED
    case 503:
      return 14; // UNAVAILABLE
    case 504:
      return 4; // DEADLINE_EXCEEDED
    default:
      return status !== undefined && status >= 500 && status <= 599
        ? 13 // INTERNAL
        : GRPC_CODE_UNKNOWN;
  }
}

/**
 * Reads a gRPC status or Auth Proxy error body. The text comes from
 * `message`, or from `error` when `message` is empty. A numeric `code` (or a
 * string of digits only) is the gRPC code. Any other string `code`, such as
 * `OIDC_TOKEN_EXPIRED`, is kept as `errorCode`. Without a numeric `code` the
 * gRPC code is derived from the HTTP status (401 is 16, 403 is 7, 429 is 8),
 * or is `UNKNOWN` (2) when there is no status.
 */
function parseErrorBody(
  input: GrpcStatus,
  httpStatus: number | undefined,
): {
  message: string;
  code: number;
  errorCode: string | undefined;
} {
  const message =
    typeof input.message === "string" && input.message !== ""
      ? input.message
      : typeof input.error === "string"
        ? input.error
        : "";
  if (typeof input.code === "number") {
    return { message, code: input.code, errorCode: undefined };
  }
  if (typeof input.code === "string" && input.code !== "") {
    return /^\d+$/.test(input.code)
      ? { message, code: Number(input.code), errorCode: undefined }
      : {
          message,
          code: grpcCodeForHttpStatus(httpStatus),
          errorCode: input.code,
        };
  }
  return {
    message,
    code: grpcCodeForHttpStatus(httpStatus),
    errorCode: undefined,
  };
}

/**@internal */
export class ZeroXKeyRequestError extends Error {
  details: any[] | null;
  /**
   * gRPC status code. Without a numeric `code` in the body it is derived from
   * the HTTP status (`2`, UNKNOWN, when there is none).
   */
  code: number;
  /** String `code` of the body (for example `OIDC_TOKEN_EXPIRED`), if any. */
  errorCode: string | undefined;
  status: number | undefined;
  retryAfter: string | undefined;
  body: unknown;

  constructor(input: GrpcStatus, response?: ZeroXKeyRequestErrorResponse) {
    const parsed = parseErrorBody(input, response?.status);
    let zeroXKeyErrorMessage = `0xkey error ${parsed.errorCode ?? parsed.code}: ${parsed.message}`;

    if (input.details != null) {
      zeroXKeyErrorMessage += ` (Details: ${JSON.stringify(input.details)})`;
    }

    super(zeroXKeyErrorMessage);

    this.name = "ZeroXKeyRequestError";
    this.details = input.details ?? null;
    this.code = parsed.code;
    this.errorCode = parsed.errorCode;
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
