import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openNativeBoundSessionStore } from "../native-bound-context.ts";

const targetKey =
  '@0xkey-io/auth/v3/target/["org-A","https://api.example.test","https://auth.example.test",null]';
const grant = {
  protocol: "0xkey-bound-context-v3",
  handle: "host-granted-handle",
  targetKey,
  ownerId: "user-A",
};

function typedNativePort() {
  let revision = 0;
  let epoch = 0;
  let activeSessionKey = null;
  let pendingPut = null;
  const sessions = new Map();
  const assertContext = (handle, target) => {
    if (handle !== grant.handle || target !== targetKey || epoch !== 0)
      throw new Error("native context retired");
  };
  return {
    hostAuthorizePut: (key, token, expectedRevision, expectedToken, kind) => {
      pendingPut = { key, token, expectedRevision, expectedToken, kind };
    },
    capability: async () => (epoch === 0 ? grant : null),
    read: async (handle, target) => {
      assertContext(handle, target);
      return {
        revision,
        activeSessionKey,
        sessions: [...sessions].map(([key, token]) => ({ key, token })),
      };
    },
    putSession: async (
      handle,
      target,
      expectedRevision,
      key,
      expectedToken,
      token,
    ) => {
      assertContext(handle, target);
      if (
        pendingPut?.key !== key ||
        pendingPut.token !== token ||
        pendingPut.expectedRevision !== expectedRevision ||
        pendingPut.expectedToken !== expectedToken ||
        pendingPut.kind !== (expectedToken === null ? "insert" : "replace")
      )
        throw new Error("native put authorization required");
      pendingPut = null;
      if (
        revision !== expectedRevision ||
        (sessions.get(key) ?? null) !== expectedToken
      )
        return "conflict";
      sessions.set(key, token);
      revision++;
      return "committed";
    },
    removeSession: async (
      handle,
      target,
      expectedRevision,
      key,
      expectedToken,
    ) => {
      assertContext(handle, target);
      throw new Error("native host authorization required for remove");
    },
    setActiveSession: async (
      handle,
      target,
      expectedRevision,
      key,
      expectedToken,
    ) => {
      assertContext(handle, target);
      throw new Error(
        "native host authorization required for active selection",
      );
    },
    clearAll: async (handle) => {
      assertContext(handle, targetKey);
      epoch++;
      sessions.clear();
      activeSessionKey = null;
      revision = 0;
    },
    retire: async (handle) => {
      assertContext(handle, targetKey);
      epoch++;
    },
  };
}

test("missing or mismatched host grant stays closed", async () => {
  assert.equal(
    await openNativeBoundSessionStore(null, targetKey, "user-A"),
    null,
  );
  assert.equal(
    await openNativeBoundSessionStore(
      { ...typedNativePort(), capability: async () => null },
      targetKey,
      "user-A",
    ),
    null,
  );
  for (const wrong of [
    { protocol: "0xkey-bound-context-v1" },
    { protocol: "0xkey-bound-context-v2" },
    { targetKey: "target-B" },
    { ownerId: "user-B" },
    { handle: "" },
  ]) {
    await assert.rejects(
      openNativeBoundSessionStore(
        {
          ...typedNativePort(),
          capability: async () => ({ ...grant, ...wrong }),
        },
        targetKey,
        "user-A",
      ),
      /capability mismatch/,
    );
  }
});

test("A to B replacement rejects stale A cleanup even with the latest revision", async () => {
  const native = typedNativePort();
  const context = await openNativeBoundSessionStore(
    native,
    targetKey,
    "user-A",
  );
  assert.ok(context);
  native.hostAuthorizePut("key-1", "token-A", 0, null, "insert");
  assert.equal(
    await context.putSession(targetKey, 0, "key-1", null, "token-A"),
    "committed",
  );
  native.hostAuthorizePut("key-1", "token-B", 1, "token-A", "replace");
  assert.equal(
    await context.putSession(targetKey, 1, "key-1", "token-A", "token-B"),
    "committed",
  );
  await assert.rejects(
    context.removeSession(targetKey, 2, "key-1", "token-A"),
    /host authorization/,
  );
  const latest = await context.read(targetKey);
  assert.equal(latest.revision, 2);
  native.hostAuthorizePut("key-1", "token-A", 2, "token-A", "replace");
  assert.equal(
    await context.putSession(
      targetKey,
      latest.revision,
      "key-1",
      "token-A",
      "token-A",
    ),
    "conflict",
  );
  await assert.rejects(
    context.setActiveSession(targetKey, latest.revision, "key-1", "token-A"),
    /host authorization/,
  );
  assert.deepEqual(await context.read(targetKey), {
    revision: 2,
    activeSessionKey: null,
    sessions: [{ key: "key-1", token: "token-B" }],
  });
});

test("JS global clear rejects without calling a native global mutation", async () => {
  let nativeClearCalled = false;
  const native = {
    ...typedNativePort(),
    clearAll: async () => {
      nativeClearCalled = true;
    },
  };
  const context = await openNativeBoundSessionStore(
    native,
    targetKey,
    "user-A",
  );
  assert.ok(context);
  native.hostAuthorizePut("key-1", "token-A", 0, null, "insert");
  await context.putSession(targetKey, 0, "key-1", null, "token-A");
  await assert.rejects(context.clearAll(), /Host authorization required/);
  assert.equal(nativeClearCalled, false);
  await assert.rejects(context.read(targetKey), /retired/);
});

test("retirement revokes JS access before the durable native fence resolves", async () => {
  let release;
  const fence = new Promise((resolve) => (release = resolve));
  const native = { ...typedNativePort(), retire: async () => fence };
  const context = await openNativeBoundSessionStore(
    native,
    targetKey,
    "user-A",
  );
  assert.ok(context);
  let settled = false;
  const retirement = context.retire().then(() => (settled = true));
  await assert.rejects(context.read(targetKey), /retired/);
  assert.equal(settled, false);
  release();
  await retirement;
  assert.equal(settled, true);
});

test("host-only put grant is exact, single-use, and covers insert and replacement", async () => {
  const native = typedNativePort();
  const context = await openNativeBoundSessionStore(
    native,
    targetKey,
    "user-A",
  );
  assert.ok(context);
  await assert.rejects(
    context.putSession(targetKey, 0, "key-A", null, "token-A"),
    /put authorization/,
  );
  native.hostAuthorizePut("key-A", "token-A", 0, null, "insert");
  await assert.rejects(
    context.putSession(targetKey, 0, "key-A", null, "wrong-token"),
    /put authorization/,
  );
  assert.equal(
    await context.putSession(targetKey, 0, "key-A", null, "token-A"),
    "committed",
  );
  await assert.rejects(
    context.putSession(targetKey, 1, "key-A", "token-A", "token-A"),
    /put authorization/,
  );
  native.hostAuthorizePut("key-A", "token-B", 1, "token-A", "replace");
  assert.equal(
    await context.putSession(targetKey, 1, "key-A", "token-A", "token-B"),
    "committed",
  );
  await assert.rejects(
    context.putSession(targetKey, 2, "key-A", "token-B", "token-A"),
    /put authorization/,
  );
  assert.deepEqual((await context.read(targetKey)).sessions, [
    { key: "key-A", token: "token-B" },
  ]);
});

test("put grant cannot be converted across revision, prior token, or insert/replace purpose", async () => {
  const native = typedNativePort();
  const context = await openNativeBoundSessionStore(
    native,
    targetKey,
    "user-A",
  );
  assert.ok(context);
  native.hostAuthorizePut("key-B", "token-B", 0, null, "insert");
  assert.equal(
    await context.putSession(targetKey, 0, "key-B", null, "token-B"),
    "committed",
  );
  native.hostAuthorizePut("key-B", "token-C", 1, "token-B", "replace");
  for (const mutation of [
    [1, "key-B", null, "token-C"],
    [2, "key-B", "token-B", "token-C"],
    [1, "key-B", "token-A", "token-C"],
  ]) {
    await assert.rejects(
      context.putSession(targetKey, ...mutation),
      /put authorization/,
    );
  }
  assert.equal(
    await context.putSession(targetKey, 1, "key-B", "token-B", "token-C"),
    "committed",
  );
});

test("remove and active selection remain closed without a trusted host intent", async () => {
  const native = typedNativePort();
  const context = await openNativeBoundSessionStore(
    native,
    targetKey,
    "user-A",
  );
  assert.ok(context);
  native.hostAuthorizePut("key-B", "token-B", 0, null, "insert");
  assert.equal(
    await context.putSession(targetKey, 0, "key-B", null, "token-B"),
    "committed",
  );
  await assert.rejects(
    context.removeSession(targetKey, 1, "key-B", "token-B"),
    /host authorization/,
  );
  await assert.rejects(
    context.setActiveSession(targetKey, 1, "key-B", "token-B"),
    /host authorization/,
  );
  assert.deepEqual(await context.read(targetKey), {
    revision: 1,
    activeSessionKey: null,
    sessions: [{ key: "key-B", token: "token-B" }],
  });
});

test("both native method tables provide typed mutations and no generic payload writer", () => {
  for (const platform of [
    "ios/OxkeyBoundContextModule.swift",
    "android/src/main/java/io/zeroxkey/boundcontext/OxkeyBoundContextModule.kt",
  ]) {
    const source = readFileSync(
      new URL(`../modules/oxkey-bound-context/${platform}`, import.meta.url),
      "utf8",
    );
    const methods = [
      ...source.matchAll(/(?:AsyncFunction|Function)\("([^"]+)"/g),
    ]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(methods, [
      "capability",
      "putSession",
      "read",
      "removeSession",
      "retire",
      "setActiveSession",
    ]);
    const removeBody = source
      .split('AsyncFunction("removeSession")')[1]
      ?.split('AsyncFunction("setActiveSession")')[0];
    const activeBody = source
      .split('AsyncFunction("setActiveSession")')[1]
      ?.split('AsyncFunction("retire")')[0];
    assert.match(
      removeBody ?? "",
      /[Hh]ost[Aa]uthorization[Rr]equired|Host authorization required/,
    );
    assert.match(
      activeBody ?? "",
      /[Hh]ost[Aa]uthorization[Rr]equired|Host authorization required/,
    );
    assert.doesNotMatch(removeBody ?? "", /DELETE FROM sessions/);
    assert.doesNotMatch(activeBody ?? "", /UPDATE records/);
    assert.match(
      source,
      /UPDATE sessions SET token = \? WHERE target_key = \? AND owner_id = \? AND session_key = \? AND token = \?/,
    );
    assert.match(source, /JOIN meta m ON m\.epoch = c\.epoch/);
    assert.match(source, /UPDATE meta SET epoch = epoch \+ 1/);
    assert.match(source, /clearAllFromHost/);
    assert.doesNotMatch(source, /\bConstants\s*\(/);
  }
});

test("source-only: each native put requires a host-issued single-use operation", () => {
  for (const platform of [
    "ios/OxkeyBoundContextModule.swift",
    "android/src/main/java/io/zeroxkey/boundcontext/OxkeyBoundContextModule.kt",
  ]) {
    const source = readFileSync(
      new URL(`../modules/oxkey-bound-context/${platform}`, import.meta.url),
      "utf8",
    );
    assert.match(source, /authorizePutFromHost/);
    assert.match(source, /CREATE TABLE(?: IF NOT EXISTS)? put_events/);
    assert.match(source, /session_key TEXT NOT NULL/);
    assert.match(source, /token_digest TEXT NOT NULL/);
    assert.match(source, /expected_revision INTEGER NOT NULL/);
    assert.match(source, /expected_token TEXT/);
    assert.match(source, /operation_kind TEXT NOT NULL/);
    assert.match(source, /consumed INTEGER NOT NULL/);
    assert.match(source, /UPDATE put_events SET consumed = 1/);
    assert.doesNotMatch(source, /AsyncFunction\("authorizePutFromHost"\)/);
    const putBody = source
      .split('AsyncFunction("putSession")')[1]
      ?.split('AsyncFunction("removeSession")')[0];
    assert.match(putBody ?? "", /consumePutAuthorization\(/);
  }
});
