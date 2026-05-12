/**@internal */
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

/**@internal */
export type GrpcStatus = {
  message: string;
  code: number;
  details: unknown[] | null;
};
