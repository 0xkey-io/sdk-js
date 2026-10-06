// Opt-in RED security counterexamples. This models the pre-operation-grant
// native SQL preconditions; it is not the updated iOS/Android module or a
// device test. Keep it RED to show why an exact-token CAS is insufficient.
import assert from "node:assert/strict";
import test from "node:test";
import { openNativeBoundSessionStore } from "../native-bound-context.ts";

const targetA =
  '@0xkey-io/auth/v3/target/["org-A","https://api.example.test","https://auth.example.test",null]';
const targetB =
  '@0xkey-io/auth/v3/target/["org-B","https://api.example.test","https://auth.example.test",null]';

function nativeLedger() {
  let epoch = 0;
  let nextHandle = 0;
  const targets = new Map();
  const grants = new Map();
  const authorize = (targetKey, ownerId) => {
    const target = targets.get(targetKey) ?? {
      generation: 0,
      revision: 0,
      sessions: new Map(),
      active: null,
    };
    target.generation++;
    targets.set(targetKey, target);
    const handle = `native-handle-${++nextHandle}`;
    grants.set(handle, {
      targetKey,
      ownerId,
      epoch,
      generation: target.generation,
      retired: false,
    });
    return handle;
  };
  const checked = (handle, targetKey) => {
    const grant = grants.get(handle);
    const target = targets.get(targetKey);
    if (
      !grant ||
      !target ||
      grant.retired ||
      grant.targetKey !== targetKey ||
      grant.epoch !== epoch ||
      grant.generation !== target.generation
    )
      throw new Error("Native context retired");
    return target;
  };
  const port = (handle) => ({
    capability: async () => {
      const grant = grants.get(handle);
      try {
        checked(handle, grant.targetKey);
      } catch {
        return null;
      }
      return {
        protocol: "0xkey-bound-context-v3",
        handle,
        targetKey: grant.targetKey,
        ownerId: grant.ownerId,
      };
    },
    read: async (value, key) => {
      const target = checked(value, key);
      return {
        revision: target.revision,
        activeSessionKey: target.active,
        sessions: [...target.sessions].map(([sessionKey, token]) => ({
          key: sessionKey,
          token,
        })),
      };
    },
    putSession: async (value, key, revision, sessionKey, prior, next) => {
      const target = checked(value, key);
      if (
        target.revision !== revision ||
        (target.sessions.get(sessionKey) ?? null) !== prior
      )
        return "conflict";
      target.sessions.set(sessionKey, next);
      target.revision++;
      return "committed";
    },
    removeSession: async (value, key, revision, sessionKey, prior) => {
      const target = checked(value, key);
      if (
        target.revision !== revision ||
        target.sessions.get(sessionKey) !== prior
      )
        return "conflict";
      target.sessions.delete(sessionKey);
      if (target.active === sessionKey) target.active = null;
      target.revision++;
      return "committed";
    },
    setActiveSession: async (value, key, revision, sessionKey, prior) => {
      const target = checked(value, key);
      if (
        target.revision !== revision ||
        target.sessions.get(sessionKey) !== prior
      )
        return "conflict";
      target.active = sessionKey;
      target.revision++;
      return "committed";
    },
    clearAll: async (value) => {
      checked(value, grants.get(value).targetKey);
      epoch++;
      targets.clear();
    },
    retire: async (value) => {
      checked(value, grants.get(value).targetKey);
      grants.get(value).retired = true;
    },
  });
  return { authorize, port };
}

test("RED: removed A cannot be reinserted after B under another key using a fresh revision", async () => {
  const native = nativeLedger();
  const handle = native.authorize(targetA, "user-A");
  const context = await openNativeBoundSessionStore(
    native.port(handle),
    targetA,
    "user-A",
  );
  assert.ok(context);
  assert.equal(
    await context.putSession(targetA, 0, "key-A", null, "token-A"),
    "committed",
  );
  assert.equal(
    await context.removeSession(targetA, 1, "key-A", "token-A"),
    "committed",
  );
  assert.equal(
    await context.putSession(targetA, 2, "key-B", null, "token-B"),
    "committed",
  );
  const latest = await context.read(targetA);
  assert.equal(latest.revision, 3);
  assert.equal(
    await context.putSession(
      targetA,
      latest.revision,
      "key-A",
      null,
      "token-A",
    ),
    "conflict",
  );
  assert.deepEqual((await context.read(targetA)).sessions, [
    { key: "key-B", token: "token-B" },
  ]);
});

test("RED: old A caller cannot read B's current token and replace B on the occupied key", async () => {
  const native = nativeLedger();
  const handle = native.authorize(targetA, "user-A");
  const oldContext = await openNativeBoundSessionStore(
    native.port(handle),
    targetA,
    "user-A",
  );
  assert.ok(oldContext);
  assert.equal(
    await oldContext.putSession(targetA, 0, "key-A", null, "token-A"),
    "committed",
  );
  assert.equal(
    await oldContext.removeSession(targetA, 1, "key-A", "token-A"),
    "committed",
  );
  assert.equal(
    await oldContext.putSession(targetA, 2, "key-B", null, "token-B"),
    "committed",
  );
  const latest = await oldContext.read(targetA);
  assert.equal(latest.revision, 3);
  assert.deepEqual(latest.sessions, [{ key: "key-B", token: "token-B" }]);
  assert.equal(
    await oldContext.putSession(
      targetA,
      latest.revision,
      "key-B",
      "token-B",
      "token-A-replacement",
    ),
    "conflict",
  );
  assert.deepEqual((await oldContext.read(targetA)).sessions, [
    { key: "key-B", token: "token-B" },
  ]);
});

test("RED: old A caller cannot read B's current token and remove B", async () => {
  const native = nativeLedger();
  const handle = native.authorize(targetA, "user-A");
  const oldContext = await openNativeBoundSessionStore(
    native.port(handle),
    targetA,
    "user-A",
  );
  assert.ok(oldContext);
  assert.equal(
    await oldContext.putSession(targetA, 0, "key-B", null, "token-B"),
    "committed",
  );
  const latest = await oldContext.read(targetA);
  assert.equal(
    await oldContext.removeSession(
      targetA,
      latest.revision,
      "key-B",
      "token-B",
    ),
    "conflict",
  );
});

test("RED: old A caller cannot read B's current token and select B active", async () => {
  const native = nativeLedger();
  const handle = native.authorize(targetA, "user-A");
  const oldContext = await openNativeBoundSessionStore(
    native.port(handle),
    targetA,
    "user-A",
  );
  assert.ok(oldContext);
  assert.equal(
    await oldContext.putSession(targetA, 0, "key-B", null, "token-B"),
    "committed",
  );
  const latest = await oldContext.read(targetA);
  assert.equal(
    await oldContext.setActiveSession(
      targetA,
      latest.revision,
      "key-B",
      "token-B",
    ),
    "conflict",
  );
});

test("RED: an old JS wrapper on the same live bridge can consume a fresh exact host put grant", async () => {
  let revision = 0;
  let pending = null;
  const port = {
    capability: async () => ({
      protocol: "0xkey-bound-context-v3",
      handle: "same-native-bridge",
      targetKey: targetA,
      ownerId: "user-A",
    }),
    read: async () => ({ revision, activeSessionKey: null, sessions: [] }),
    putSession: async (
      handle,
      key,
      expectedRevision,
      sessionKey,
      expectedToken,
      nextToken,
    ) => {
      if (
        !pending ||
        handle !== pending.handle ||
        key !== pending.key ||
        expectedRevision !== pending.revision ||
        sessionKey !== pending.sessionKey ||
        expectedToken !== pending.prior ||
        nextToken !== pending.next ||
        (expectedToken === null ? "insert" : "replace") !== pending.kind
      )
        throw new Error("Native put authorization required");
      pending = null;
      revision++;
      return "committed";
    },
    removeSession: async () => {
      throw new Error("Host authorization required");
    },
    setActiveSession: async () => {
      throw new Error("Host authorization required");
    },
    retire: async () => {},
  };
  const oldWrapper = await openNativeBoundSessionStore(port, targetA, "user-A");
  const intendedWrapper = await openNativeBoundSessionStore(
    port,
    targetA,
    "user-A",
  );
  assert.ok(oldWrapper && intendedWrapper);
  pending = {
    handle: "same-native-bridge",
    key: targetA,
    revision: 0,
    sessionKey: "key-B",
    prior: null,
    next: "token-B",
    kind: "insert",
  };
  assert.equal(
    await oldWrapper.putSession(targetA, 0, "key-B", null, "token-B"),
    "conflict",
  );
});

test("JS target A grant cannot clear target B after B is authorized", async () => {
  const native = nativeLedger();
  const handleA = native.authorize(targetA, "user-A");
  const contextA = await openNativeBoundSessionStore(
    native.port(handleA),
    targetA,
    "user-A",
  );
  assert.ok(contextA);
  native.authorize(targetB, "user-B");
  await assert.rejects(contextA.clearAll(), /Host authorization required/);
});
