/** Strip even a caller-supplied receipt, without consuming the response body. */
export function withoutMppReceipt(
  response: Response,
  privateCache = false,
): Response {
  const headers = new Headers(response.headers);
  headers.delete("Payment-Receipt");
  if (privateCache) {
    // Match native mppx receipt wrapping's existing cache policy, even when
    // the HTTP status makes the response ineligible for a receipt.
    const cache = headers.get("Cache-Control");
    if (!cache) headers.set("Cache-Control", "private");
    else if (
      !cache
        .split(",")
        .some((value) => value.trim().toLowerCase() === "private")
    ) {
      headers.set("Cache-Control", `${cache}, private`);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
