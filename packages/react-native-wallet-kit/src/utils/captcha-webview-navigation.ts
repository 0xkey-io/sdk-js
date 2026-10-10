export type CaptchaNavigationRequest = Readonly<{
  url: string;
  isTopFrame?: boolean;
}>;

/** Unknown frame provenance is sufficient only for the exact owned root. */
export function permitsCaptchaNavigation(
  origin: string,
  request: CaptchaNavigationRequest,
): boolean {
  return (
    request.url === `${origin}/` ||
    (request.isTopFrame === false &&
      request.url.startsWith("https://challenges.cloudflare.com/"))
  );
}
