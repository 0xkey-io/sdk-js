import type {
  AtomicBoundSessionStore,
  BoundSessionRecord,
} from "../bound-session";

const DATABASE = "ZeroXKeyBoundAuthV3";
const STORE = "BoundSessions";
const KEY_STORE = "KeyStore";
const OWNER_STORE = "KeyOwners";
const META_STORE = "Meta";
const CREDENTIAL_STORES = [STORE, KEY_STORE, OWNER_STORE, META_STORE];

export interface BoundCredentialStores {
  sessions: IDBObjectStore;
  keys: IDBObjectStore;
  owners: IDBObjectStore;
  meta: IDBObjectStore;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable for bound sessions"));
      return;
    }
    let request: IDBOpenDBRequest;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      request = indexedDB.open(DATABASE, 2);
    } catch (error) {
      fail(error instanceof Error ? error : new Error("IndexedDB open failed"));
      return;
    }
    request.onupgradeneeded = () => {
      for (const name of CREDENTIAL_STORES)
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      if (
        CREDENTIAL_STORES.some(
          (name) => !request.result.objectStoreNames.contains(name),
        )
      ) {
        request.result.close();
        fail(new Error("Bound credential schema is incomplete"));
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () =>
      fail(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => fail(new Error("IndexedDB upgrade blocked"));
  });
}

export class WebAtomicBoundSessionStore implements AtomicBoundSessionStore {
  /** One readonly snapshot across every v3 credential store. */
  async withCredentialRead(
    enqueue: (stores: BoundCredentialStores) => void,
  ): Promise<void> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      let settled = false;
      let updateError: unknown;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        db.close();
        if (error) reject(error);
        else resolve();
      };
      try {
        const tx = db.transaction(CREDENTIAL_STORES, "readonly");
        tx.oncomplete = () => finish();
        tx.onabort = () =>
          finish(
            updateError ??
              tx.error ??
              new Error("Bound credential read aborted"),
          );
        tx.onerror = () => {
          try {
            tx.abort();
          } catch {
            // An error may already have started the transaction abort.
          }
        };
        try {
          enqueue({
            sessions: tx.objectStore(STORE),
            keys: tx.objectStore(KEY_STORE),
            owners: tx.objectStore(OWNER_STORE),
            meta: tx.objectStore(META_STORE),
          });
        } catch (error) {
          updateError = error;
          tx.abort();
        }
      } catch (error) {
        finish(error);
      }
    });
  }

  /** Enqueue IDB requests synchronously, or from their request callbacks. */
  async withCredentialTransaction(
    enqueue: (stores: BoundCredentialStores) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new Error("Bound credential transaction aborted");
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction | undefined;
      let settled = false;
      let updateError: unknown;
      const abort = () => {
        if (!tx || settled) return;
        try {
          tx.abort();
        } catch {
          // A completed transaction has already crossed the commit boundary.
        }
      };
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        db.close();
        if (error) reject(error);
        else resolve();
      };
      signal.addEventListener("abort", abort);
      try {
        if (signal.aborted) {
          finish(new Error("Bound credential transaction aborted"));
          return;
        }
        tx = db.transaction(CREDENTIAL_STORES, "readwrite");
        tx.oncomplete = () => finish();
        tx.onabort = () =>
          finish(
            updateError ??
              tx?.error ??
              new Error("Bound credential transaction aborted"),
          );
        tx.onerror = () => abort();
        enqueue({
          sessions: tx.objectStore(STORE),
          keys: tx.objectStore(KEY_STORE),
          owners: tx.objectStore(OWNER_STORE),
          meta: tx.objectStore(META_STORE),
        });
        if (signal.aborted) abort();
      } catch (error) {
        updateError = error;
        if (tx) abort();
        else finish(error);
      }
    });
  }

  async read(key: string): Promise<unknown> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      let value: unknown;
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        db.close();
        if (error) reject(error);
        else resolve(value);
      };
      try {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).get(key);
        request.onsuccess = () => {
          value = request.result;
        };
        tx.oncomplete = () => finish();
        tx.onabort = () =>
          finish(tx.error ?? new Error("IndexedDB read aborted"));
        tx.onerror = () => {
          try {
            tx.abort();
          } catch {
            // An error may already have started the transaction abort.
          }
        };
      } catch (error) {
        finish(error);
      }
    });
  }

  async transact(
    key: string,
    update: (current: unknown) => BoundSessionRecord | undefined,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (signal.aborted) throw new Error("Bound session transaction aborted");
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction | undefined;
      let next: BoundSessionRecord | undefined;
      let settled = false;
      const abort = () => {
        if (!tx || settled) return;
        try {
          tx.abort();
        } catch {
          // A completed transaction has already passed its durable boundary.
        }
      };
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        db.close();
        if (error) reject(error);
        else resolve(next);
      };
      signal.addEventListener("abort", abort);
      try {
        if (signal.aborted) {
          finish(new Error("Bound session transaction aborted"));
          return;
        }
        tx = db.transaction(STORE, "readwrite");
        tx.oncomplete = () => finish();
        tx.onabort = () =>
          finish(tx?.error ?? new Error("Bound session transaction aborted"));
        tx.onerror = () => abort();
        const request = tx.objectStore(STORE).get(key);
        request.onsuccess = () => {
          if (signal.aborted) {
            abort();
            return;
          }
          try {
            next = update(request.result);
            if (signal.aborted) {
              abort();
              return;
            }
            if (next === undefined) tx!.objectStore(STORE).delete(key);
            else tx!.objectStore(STORE).put(next, key);
          } catch (error) {
            abort();
            finish(error);
          }
        };
      } catch (error) {
        abort();
        finish(error);
      }
    });
  }
}
