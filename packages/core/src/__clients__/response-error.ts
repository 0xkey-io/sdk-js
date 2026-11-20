import { ZeroXKeyHttpError, ZeroXKeyRequestError } from "../__types__/error";

/**
 * Builds the error for a non-OK response: a {@link ZeroXKeyRequestError} for
 * a JSON gRPC status, otherwise a {@link ZeroXKeyHttpError}. Both carry the
 * HTTP status.
 * @internal
 */
export async function responseError(
  response: Response,
): Promise<ZeroXKeyRequestError | ZeroXKeyHttpError> {
  const errorResponse = {
    status: response.status,
    retryAfter: response.headers?.get?.("retry-after") ?? undefined,
  };
  // The body can only be read once; keep a copy for the summary.
  const copy =
    typeof response.clone === "function" ? response.clone() : undefined;
  try {
    return new ZeroXKeyRequestError(await response.json(), errorResponse);
  } catch (_) {
    const body = (await copy?.text().catch(() => "")) ?? "";
    return new ZeroXKeyHttpError(
      { ...errorResponse, statusText: response.statusText },
      body,
    );
  }
}
