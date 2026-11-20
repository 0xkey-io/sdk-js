/**@internal */
export class ZeroXKeyRequestError extends Error {
  details: any[] | null;
  code: number;
  status: number | undefined;
  retryAfter: string | undefined;
  body: unknown;

  constructor(input: GrpcStatus, response?: ZeroXKeyRequestErrorResponse) {
    let zeroXKeyErrorMessage = `0xkey error ${input.code}: ${input.message}`;

    if (input.details != null) {
      zeroXKeyErrorMessage += ` (Details: ${JSON.stringify(input.details)})`;
    }

    super(zeroXKeyErrorMessage);

    this.name = "ZeroXKeyRequestError";
    this.details = input.details ?? null;
    this.code = input.code;
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
  message: string;
  code: number;
  details: unknown[] | null;
};

/**@internal */
export type ZeroXKeyRequestErrorResponse = {
  status: number;
  retryAfter: string | undefined;
};
