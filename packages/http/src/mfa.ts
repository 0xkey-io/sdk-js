/** Public wire status for an MFA pause. Not a terminal success or failure. */
export const AUTHENTICATORS_NEEDED = "ACTIVITY_STATUS_AUTHENTICATORS_NEEDED";

/** Recovery Session Profile scope. V1 CREATE_AUTHENTICATORS is not allowed. */
export const RECOVERY_SCOPE =
  "activity.type == 'ACTIVITY_TYPE_CREATE_AUTHENTICATORS_V2'";

/** Recovery Session Profile TTL in seconds. */
export const RECOVERY_TTL_SECONDS = 600;

const SENSITIVE_KEYS = [
  "verificationToken",
  "oidcToken",
  "stamp",
  "rawBody",
  "token",
  "contact",
];

export function isAuthenticatorsNeededStatus(status?: string): boolean {
  return status === AUTHENTICATORS_NEEDED;
}

type MethodLike = {
  type?: string;
  authenticationType?: string;
  any?: MethodLike[];
};

/** Factor type names only. Tokens, contacts, stamps, and bodies are dropped. */
export function missingFactorTypes(requiredMethods?: MethodLike[]): string[] {
  if (!requiredMethods) return [];
  const types: string[] = [];
  for (const group of requiredMethods) {
    const nested = group.any ?? [group];
    for (const method of nested) {
      const name = method.authenticationType ?? method.type;
      if (typeof name === "string" && name.length > 0 && !types.includes(name)) {
        types.push(name);
      }
    }
  }
  return types;
}

/**
 * Email OTP and OAuth on the same Google account are not independent
 * channels. Dashboard and recovery copy must warn; this helper never
 * claims they are independent.
 */
export function recoveryIndependenceWarning(factorTypes: string[]): string | null {
  const normalized = factorTypes.map((value) => value.toUpperCase());
  const hasEmail = normalized.some((value) => value.includes("EMAIL"));
  const hasOauth = normalized.some(
    (value) => value.includes("OAUTH") || value.includes("OIDC"),
  );
  if (hasEmail && hasOauth) {
    return "Email OTP and OAuth on the same Google account are not independent channels.";
  }
  return null;
}

export function redactMfaDebugValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactMfaDebugValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.some((name) => key.toLowerCase().includes(name.toLowerCase()))) {
        continue;
      }
      out[key] = redactMfaDebugValue(nested);
    }
    return out;
  }
  return value;
}
