import { verifySessionJwtSignature } from "@0xkey-io/crypto";
import type { Session } from "@0xkey-io/sdk-types";
import { parseSession } from "@utils";
import { boundTargetKey, type BoundAuthTarget } from "../bound-session";
import { SESSION_JWT_SIGNING_KEY_HEX } from "./session-jwt-pin";
import { WEB_BOUND_OAUTH_TRUST_PROFILE } from "./session-jwt-trust-profile";

/**
 * Local v3 deny gate. Only a reviewed build-supplied trust profile can admit
 * the signed target and pending operation; it does not establish server-side
 * issuance authorization or currentness at later API use.
 */
const fixedBytes = (value: unknown, count: number): boolean => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    return false;
  try {
    const bytes = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return (
      bytes.length === count &&
      btoa(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") ===
        value
    );
  } catch {
    return false;
  }
};
const forbiddenV3Aliases = [
  "sessionVersion",
  "sessionPurpose",
  "parentOrganizationId",
  "authProxyConfigId",
  "configGeneration",
  "configRevision",
  "configDigest",
  "operationNonce",
  "deploymentAudience",
  "organizationId",
  "publicKey",
] as const;

export async function assertSignedBoundSessionJwt(
  token: string,
  expectedTarget: BoundAuthTarget,
  pendingNonce: string,
): Promise<Session> {
  const parts = token.split(".");
  if (
    parts.length !== 3 ||
    parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))
  )
    throw new Error("Invalid signed session JWT");

  let payload: Record<string, unknown>;
  try {
    const base64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    payload = JSON.parse(atob(base64)) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid signed session JWT payload");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid signed session JWT payload");
  const exp = payload.exp;
  if (
    typeof exp !== "number" ||
    !Number.isFinite(exp) ||
    exp <= Date.now() / 1000
  )
    throw new Error("Signed session JWT has no live finite expiry");

  try {
    if (!(await verifySessionJwtSignature(token, SESSION_JWT_SIGNING_KEY_HEX)))
      throw new Error("Session JWT signer is not trusted");
  } catch {
    throw new Error("Session JWT signer is not trusted");
  }
  const profile = WEB_BOUND_OAUTH_TRUST_PROFILE;
  if (!profile) throw new Error("Bound OAuth trust profile unavailable");
  if (
    forbiddenV3Aliases.some((alias) =>
      Object.prototype.hasOwnProperty.call(payload, alias),
    ) ||
    boundTargetKey(expectedTarget) !== boundTargetKey(profile.target) ||
    payload.session_version !== 3 ||
    payload.session_purpose !== "bound-oauth-session-v3" ||
    payload.parent_organization_id !== profile.target.organizationId ||
    payload.auth_proxy_config_id !== profile.target.authProxyConfigId ||
    payload.config_generation !== profile.configGeneration ||
    payload.config_revision !== profile.configRevision ||
    payload.config_digest !== profile.configDigest ||
    payload.deployment_audience !== profile.deploymentAudience ||
    payload.organization_id !== profile.childOrganizationId ||
    !fixedBytes(payload.config_generation, 16) ||
    !/^[1-9][0-9]*$/.test(String(payload.config_revision)) ||
    !fixedBytes(payload.config_digest, 32) ||
    !fixedBytes(payload.operation_nonce, 32) ||
    !fixedBytes(pendingNonce, 32) ||
    payload.operation_nonce !== pendingNonce ||
    typeof payload.public_key !== "string" ||
    !payload.public_key ||
    typeof payload.user_id !== "string" ||
    !payload.user_id ||
    payload.session_type !== "SESSION_TYPE_READ_WRITE" ||
    !Number.isSafeInteger(payload.iat) ||
    (payload.iat as number) <= 0 ||
    (payload.iat as number) >= exp ||
    typeof payload.jti !== "string" ||
    !payload.jti
  )
    throw new Error("Signed session JWT is not bound to the pending v3 claim");
  return parseSession(token);
}
