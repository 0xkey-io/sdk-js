import type { BoundAuthTarget } from "../bound-session";

/**
 * A deployment owner must supply this through a reviewed build profile.
 * Browser config, a JWT, and an Auth Proxy response cannot select it.
 * No production v3 Web issuance/currentness contract exists yet.
 */
export interface WebBoundOAuthTrustProfile {
  target: Required<BoundAuthTarget>;
  childOrganizationId: string;
  configGeneration: string;
  configRevision: string;
  configDigest: string;
  deploymentAudience: string;
}

export const WEB_BOUND_OAUTH_TRUST_PROFILE:
  | Readonly<WebBoundOAuthTrustProfile>
  | undefined = undefined;
