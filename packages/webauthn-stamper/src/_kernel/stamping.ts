export const STAMP_HEADER_WEBAUTHN = "X-Stamp-Webauthn";

export function createStampResult<N extends string>(
  stampHeaderName: N,
  stampHeaderValue: string,
): { stampHeaderName: N; stampHeaderValue: string } {
  return { stampHeaderName, stampHeaderValue };
}
