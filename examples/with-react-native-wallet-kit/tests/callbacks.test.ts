import assert from "node:assert/strict";
import { test } from "node:test";

import { ZEROXKEY_CALLBACKS } from "../constants/callbacks.ts";

function captureConsole(run: () => void): string {
  const lines: string[] = [];
  const original = { log: console.log, error: console.error };
  console.log = (...args: unknown[]) => lines.push(JSON.stringify(args));
  console.error = (...args: unknown[]) => lines.push(JSON.stringify(args));
  try {
    run();
  } finally {
    console.log = original.log;
    console.error = original.error;
  }
  return lines.join("\n");
}

test("never logs the OIDC token, verification token or session key", () => {
  const output = captureConsole(() => {
    ZEROXKEY_CALLBACKS.onAuthenticationSuccess?.({
      action: "login",
      method: "oauth",
      identifier: "eyJhbGciOi.synthetic-id-token.sig",
      session: undefined,
    } as never);
    ZEROXKEY_CALLBACKS.beforeSessionExpiry?.({ sessionKey: "session-key-1" });
    ZEROXKEY_CALLBACKS.onSessionExpired?.({ sessionKey: "session-key-2" });
  });
  assert.match(output, /Auth success/);
  assert.match(output, /oauth/);
  assert.doesNotMatch(output, /synthetic-id-token|session-key-1|session-key-2/);
});
