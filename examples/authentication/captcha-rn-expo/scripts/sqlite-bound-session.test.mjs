import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { openSqliteBoundSessionStore } from "../sqlite-bound-session.ts";

const directory = mkdtempSync(path.join(tmpdir(), "0xkey-sqlite-cas-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const initialA = { targetKey: "target-A", epoch: 0, generation: 0 };
const initialB = { targetKey: "target-B", epoch: 0, generation: 0 };

function database(name) {
  const native = new DatabaseSync(path.join(directory, `${name}.db`));
  native.exec("PRAGMA busy_timeout = 0");
  let failNextRecordWrite = false;
  let heldCommit;
  const connection = {
    execAsync: async (sql) => native.exec(sql),
    getFirstAsync: async (sql, ...params) =>
      native.prepare(sql).get(...params) ?? null,
    runAsync: async (sql, ...params) => {
      if (failNextRecordWrite && /\bbound_records\b/i.test(sql)) {
        failNextRecordWrite = false;
        throw new Error("injected record write failure");
      }
      const result = native.prepare(sql).run(...params);
      return { changes: result.changes };
    },
    withExclusiveTransactionAsync: async (task) => {
      native.exec("BEGIN");
      try {
        await task(connection);
        if (heldCommit) {
          const hold = heldCommit;
          heldCommit = undefined;
          hold.entered();
          await hold.release;
        }
        native.exec("COMMIT");
      } catch (error) {
        native.exec("ROLLBACK");
        throw error;
      }
    },
    failRecordWriteOnce: () => {
      failNextRecordWrite = true;
    },
    holdNextCommit: () => {
      let entered;
      let release;
      const enteredPromise = new Promise((resolve) => {
        entered = resolve;
      });
      const releasePromise = new Promise((resolve) => {
        release = resolve;
      });
      heldCommit = { entered, release: releasePromise };
      return { entered: enteredPromise, release };
    },
    close: () => native.close(),
  };
  return connection;
}

test("two SQLite connections reject a stale revision without overwriting the winner", async () => {
  const firstDb = database("revision");
  const secondDb = database("revision");
  try {
    const first = await openSqliteBoundSessionStore(
      firstDb,
      "target-A",
      initialA,
    );
    const second = await openSqliteBoundSessionStore(
      secondDb,
      "target-A",
      initialA,
    );
    const old = await first.snapshot();
    assert.equal(old.revision, 0);
    await first.compareExchange(old.revision, { sessions: ["A"] });
    await assert.rejects(
      second.compareExchange(old.revision, { sessions: ["B"] }),
      /revision conflict/,
    );
    assert.deepEqual(await second.read("target-A"), { sessions: ["A"] });
    const current = await second.snapshot();
    await second.compareExchange(current.revision, { sessions: ["A", "B"] });
    assert.deepEqual(await first.read("target-A"), { sessions: ["A", "B"] });
  } finally {
    firstDb.close();
    secondDb.close();
  }
});

test("retirement and clearAll fence stale handles across SQLite connections", async () => {
  const oldDb = database("fence");
  const otherDb = database("fence");
  try {
    const old = await openSqliteBoundSessionStore(oldDb, "target-A", initialA);
    const other = await openSqliteBoundSessionStore(
      otherDb,
      "target-B",
      initialB,
    );
    await old.transact(
      "target-A",
      () => ({ token: "A" }),
      new AbortController().signal,
    );
    await other.transact(
      "target-B",
      () => ({ token: "B" }),
      new AbortController().signal,
    );
    await old.retireTarget();
    await assert.rejects(
      old.transact(
        "target-A",
        () => ({ token: "late" }),
        new AbortController().signal,
      ),
      /retired/,
    );
    await assert.rejects(
      openSqliteBoundSessionStore(otherDb, "target-A", initialA),
      /retired/,
    );
    assert.deepEqual(await other.read("target-B"), { token: "B" });
    await other.clearAll();
    await assert.rejects(
      other.transact(
        "target-B",
        () => ({ token: "recreated" }),
        new AbortController().signal,
      ),
      /retired/,
    );
    await assert.rejects(
      openSqliteBoundSessionStore(oldDb, "target-B", initialB),
      /retired/,
    );
  } finally {
    oldDb.close();
    otherDb.close();
  }
});

test("record write failure rolls back the transaction and leaves no partial record", async () => {
  const db = database("rollback");
  try {
    const store = await openSqliteBoundSessionStore(db, "target-A", initialA);
    db.failRecordWriteOnce();
    await assert.rejects(
      store.compareExchange(0, { token: "A" }),
      /injected record write failure/,
    );
    assert.deepEqual(await store.snapshot(), { revision: 0, value: undefined });
    await store.compareExchange(0, { token: "B" });
    assert.deepEqual(await store.read("target-A"), { token: "B" });
  } finally {
    db.close();
  }
});

test("deleting a record preserves its revision so an old empty snapshot cannot recreate it", async () => {
  const db = database("delete-revision");
  try {
    const store = await openSqliteBoundSessionStore(db, "target-A", initialA);
    const empty = await store.snapshot();
    await store.compareExchange(empty.revision, { token: "A" });
    await store.compareExchange((await store.snapshot()).revision, undefined);
    assert.deepEqual(await store.snapshot(), { revision: 2, value: undefined });
    await assert.rejects(
      store.compareExchange(empty.revision, { token: "stale" }),
      /revision conflict/,
    );
  } finally {
    db.close();
  }
});

test("a second connection fails closed while the first holds the SQLite write lock", async () => {
  const firstDb = database("contention");
  const secondDb = database("contention");
  try {
    const first = await openSqliteBoundSessionStore(
      firstDb,
      "target-A",
      initialA,
    );
    const second = await openSqliteBoundSessionStore(
      secondDb,
      "target-A",
      initialA,
    );
    const held = firstDb.holdNextCommit();
    const pending = first.compareExchange(0, { token: "A" });
    await held.entered;
    await assert.rejects(
      second.compareExchange(0, { token: "B" }),
      /database is locked/,
    );
    held.release();
    await pending;
    assert.deepEqual(await second.read("target-A"), { token: "A" });
    await assert.rejects(
      second.compareExchange(0, { token: "stale" }),
      /revision conflict/,
    );
  } finally {
    firstDb.close();
    secondDb.close();
  }
});

test("an old runtime cannot reopen after retirement by adopting the latest fence", async () => {
  const firstDb = database("reopen-retired");
  const secondDb = database("reopen-retired");
  try {
    const oldContext = { targetKey: "target-A", epoch: 0, generation: 0 };
    const old = await openSqliteBoundSessionStore(
      firstDb,
      "target-A",
      oldContext,
    );
    await old.retireTarget();
    await assert.rejects(
      openSqliteBoundSessionStore(secondDb, "target-A", oldContext),
      /retired/,
    );
    await assert.rejects(
      openSqliteBoundSessionStore(secondDb, "target-A"),
      /trusted.*fence/i,
    );
  } finally {
    firstDb.close();
    secondDb.close();
  }
});

test("an old runtime cannot reopen after clearAll by adopting the latest epoch", async () => {
  const firstDb = database("reopen-cleared");
  const secondDb = database("reopen-cleared");
  try {
    const oldContext = { targetKey: "target-A", epoch: 0, generation: 0 };
    const old = await openSqliteBoundSessionStore(
      firstDb,
      "target-A",
      oldContext,
    );
    await old.clearAll();
    await assert.rejects(
      openSqliteBoundSessionStore(secondDb, "target-A", oldContext),
      /retired/,
    );
  } finally {
    firstDb.close();
    secondDb.close();
  }
});

test("shows why a numeric fence alone cannot prove fresh authorization", async () => {
  const firstDb = database("forged-fence");
  const secondDb = database("forged-fence");
  try {
    const old = await openSqliteBoundSessionStore(
      firstDb,
      "target-A",
      initialA,
    );
    await old.retireTarget();
    // An old runtime with raw database access can supply the new generation.
    // A trusted issuer/verifier is required before this adapter is integrated.
    const forged = { targetKey: "target-A", epoch: 0, generation: 1 };
    const reopened = await openSqliteBoundSessionStore(
      secondDb,
      "target-A",
      forged,
    );
    await reopened.transact(
      "target-A",
      () => ({ token: "old-context" }),
      new AbortController().signal,
    );
    assert.deepEqual(await reopened.read("target-A"), { token: "old-context" });
  } finally {
    firstDb.close();
    secondDb.close();
  }
});
