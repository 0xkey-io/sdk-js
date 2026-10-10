/**@internal */
export class ZeroXKeyRequestError extends Error {
  details: any[] | null;
  code: number;
  status: number | undefined;
  retryAfter: string | undefined;
  body: unknown;

  constructor(input: GrpcStatus, response?: ZeroXKeyRequestErrorResponse) {
    let zeroXKeyErrorMessage = `ZeroXKey error ${input.code}: ${input.message}`;

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
