import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ZEROXKEY_CALLBACKS,
  registerOauthCompletion,
  setOauthProvider,
  takeOauthProvider,
} from "../constants/callbacks.ts";

const redirect = { idToken: "synthetic.id.token", publicKey: "02ab" };

test("the provider callback hands the OAuth result to the app's completion", () => {
  const seen: unknown[] = [];
  const unregister = registerOauthCompletion((value) => seen.push(value));
  ZEROXKEY_CALLBACKS.onOauthRedirect?.(redirect);
  unregister();
  assert.deepEqual(seen, [redirect]);
});

test("a result that arrives before the app registers is delivered once", () => {
  ZEROXKEY_CALLBACKS.onOauthRedirect?.(redirect);
  const seen: unknown[] = [];
  const unregister = registerOauthCompletion((value) => seen.push(value));
  unregister();
  const again: unknown[] = [];
  registerOauthCompletion((value) => again.push(value))();
  assert.deepEqual(seen, [redirect]);
  assert.deepEqual(again, []);
});

test("an unregistered handler no longer receives results", () => {
  const seen: unknown[] = [];
  const unregister = registerOauthCompletion((value) => seen.push(value));
  const replaced: unknown[] = [];
  const unregisterReplacement = registerOauthCompletion((value) =>
    replaced.push(value),
  );
  unregister();
  ZEROXKEY_CALLBACKS.onOauthRedirect?.(redirect);
  unregisterReplacement();
  assert.deepEqual(seen, []);
  assert.deepEqual(replaced, [redirect]);
});

test("the started provider name is consumed by exactly one completion", () => {
  setOauthProvider("google");
  assert.equal(takeOauthProvider(), "google");
  assert.equal(takeOauthProvider(), undefined);
});
