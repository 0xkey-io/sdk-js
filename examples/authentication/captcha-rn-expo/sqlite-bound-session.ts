import type { SQLiteDatabase } from "expo-sqlite";

type Database = Pick<
  SQLiteDatabase,
  "execAsync" | "getFirstAsync" | "runAsync" | "withExclusiveTransactionAsync"
>;
type Row = {
  epoch: number;
  generation: number;
  revision: number | null;
  payload: string | null;
};
export type BoundSessionSnapshot = { revision: number; value: unknown };
export type ExpectedBoundFence = {
  targetKey: string;
  epoch: number;
  generation: number;
};

const SELECT_ROW = `SELECT m.epoch, f.generation, r.revision, r.payload
  FROM bound_meta AS m JOIN bound_fences AS f ON f.target_key = ?
  LEFT JOIN bound_records AS r ON r.target_key = f.target_key WHERE m.id = 1`;
const parseValue = (row: Row): unknown =>
  row.payload === null ? undefined : JSON.parse(row.payload);
const assertSignal = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new Error("Bound transaction aborted");
};

/**
 * Experimental Expo-only adapter. The expected fence must come from an
 * independently trusted authorization flow; this module cannot issue one.
 * Numeric fence values alone are forgeable by a caller with database access.
 * No default RN path imports this module.
 */
export async function openSqliteBoundSessionStore(
  db: Database,
  targetKey: string,
  expectedFence: ExpectedBoundFence,
) {
  if (!targetKey) throw new Error("Bound target key is required");
  if (
    !expectedFence ||
    expectedFence.targetKey !== targetKey ||
    !Number.isSafeInteger(expectedFence.epoch) ||
    expectedFence.epoch < 0 ||
    !Number.isSafeInteger(expectedFence.generation) ||
    expectedFence.generation < 0
  )
    throw new Error("Trusted expected bound fence required");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS bound_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL, lock_revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bound_fences (
      target_key TEXT PRIMARY KEY, generation INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bound_records (
      target_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT
    );
    INSERT OR IGNORE INTO bound_meta (id, epoch, lock_revision) VALUES (1, 0, 0);
  `);
  await db.runAsync(
    "INSERT OR IGNORE INTO bound_fences (target_key, generation) VALUES (?, 0)",
    targetKey,
  );
  const observed = await db.getFirstAsync<Row>(SELECT_ROW, targetKey);
  if (!observed) throw new Error("Bound target fence is unavailable");
  const lease = expectedFence;
  if (
    observed.epoch !== lease.epoch ||
    observed.generation !== lease.generation
  )
    throw new Error("Bound target retired");
  const assertLease = (row: Row | null): Row => {
    if (
      !row ||
      row.epoch !== lease.epoch ||
      row.generation !== lease.generation
    )
      throw new Error("Bound target retired");
    return row;
  };
  const assertKey = (key: string): void => {
    if (key !== targetKey) throw new Error("Bound target key mismatch");
  };
  const snapshot = async (): Promise<BoundSessionSnapshot> => {
    const row = assertLease(await db.getFirstAsync<Row>(SELECT_ROW, targetKey));
    return { revision: row.revision ?? 0, value: parseValue(row) };
  };
  const exchange = async (
    update: (current: unknown) => unknown,
    expectedRevision?: number,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    assertSignal(signal);
    let committed: unknown;
    await db.withExclusiveTransactionAsync(async (txn) => {
      // Acquire the SQLite write lock before inspecting the fence or record.
      await txn.runAsync(
        "UPDATE bound_meta SET lock_revision = lock_revision + 1 WHERE id = 1",
      );
      const row = assertLease(
        await txn.getFirstAsync<Row>(SELECT_ROW, targetKey),
      );
      const revision = row.revision ?? 0;
      if (expectedRevision !== undefined && revision !== expectedRevision)
        throw new Error("Bound revision conflict");
      assertSignal(signal);
      const next = update(parseValue(row));
      assertSignal(signal);
      if (next === undefined) {
        if (revision !== 0) {
          const result = await txn.runAsync(
            "UPDATE bound_records SET revision = revision + 1, payload = NULL WHERE target_key = ? AND revision = ?",
            targetKey,
            revision,
          );
          if (result.changes !== 1) throw new Error("Bound revision conflict");
        }
      } else {
        const payload = JSON.stringify(next);
        if (payload === undefined)
          throw new Error("Bound record is not serializable");
        const result =
          revision === 0
            ? await txn.runAsync(
                "INSERT OR IGNORE INTO bound_records (target_key, revision, payload) VALUES (?, 1, ?)",
                targetKey,
                payload,
              )
            : await txn.runAsync(
                "UPDATE bound_records SET revision = revision + 1, payload = ? WHERE target_key = ? AND revision = ?",
                payload,
                targetKey,
                revision,
              );
        if (result.changes !== 1) throw new Error("Bound revision conflict");
      }
      assertSignal(signal);
      committed = next;
    });
    return committed;
  };
  const retireTarget = async (): Promise<void> => {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(
        "UPDATE bound_meta SET lock_revision = lock_revision + 1 WHERE id = 1",
      );
      assertLease(await txn.getFirstAsync<Row>(SELECT_ROW, targetKey));
      await txn.runAsync(
        "UPDATE bound_fences SET generation = generation + 1 WHERE target_key = ?",
        targetKey,
      );
      await txn.runAsync(
        "DELETE FROM bound_records WHERE target_key = ?",
        targetKey,
      );
    });
  };
  const clearAll = async (): Promise<void> => {
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(
        "UPDATE bound_meta SET lock_revision = lock_revision + 1 WHERE id = 1",
      );
      assertLease(await txn.getFirstAsync<Row>(SELECT_ROW, targetKey));
      await txn.runAsync(
        "UPDATE bound_meta SET epoch = epoch + 1 WHERE id = 1",
      );
      await txn.runAsync("DELETE FROM bound_records");
    });
  };
  return {
    snapshot,
    read: async (key: string): Promise<unknown> => {
      assertKey(key);
      return (await snapshot()).value;
    },
    transact: async (
      key: string,
      update: (current: unknown) => unknown,
      signal: AbortSignal,
    ): Promise<unknown> => {
      assertKey(key);
      return exchange(update, undefined, signal);
    },
    compareExchange: (
      expectedRevision: number,
      next: unknown,
      signal?: AbortSignal,
    ): Promise<unknown> => exchange(() => next, expectedRevision, signal),
    retireTarget,
    clearAll,
  };
}
