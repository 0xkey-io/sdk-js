export const STAMP_HEADER_API_KEY = "X-Stamp";

export function createStampResult<N extends string>(
  stampHeaderName: N,
  stampHeaderValue: string,
): { stampHeaderName: N; stampHeaderValue: string } {
  return { stampHeaderName, stampHeaderValue };
}
