import type { AtomicBoundSessionStore } from "../../../packages/core/src/__storage__/bound-session";
import type { openSqliteBoundSessionStore } from "./sqlite-bound-session";

type Assert<T extends true> = T;
export type SqliteStoreMatchesCore = Assert<
  Awaited<
    ReturnType<typeof openSqliteBoundSessionStore>
  > extends AtomicBoundSessionStore
    ? true
    : false
>;
