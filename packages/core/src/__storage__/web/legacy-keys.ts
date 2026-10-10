const LEGACY_DB = "ZeroXKeyStamperDB";
const STORE = "KeyStore";

function isCorePrivateKey(value: unknown): value is CryptoKey {
  if (Object.prototype.toString.call(value) !== "[object CryptoKey]")
    return false;
  const key = value as CryptoKey;
  return (
    key.type === "private" &&
    key.algorithm.name === "ECDSA" &&
    (key.algorithm as EcKeyAlgorithm).namedCurve === "P-256" &&
    key.usages.includes("sign")
  );
}

/** Shared legacy DB: only associated core rows, never the standalone fixed pair. */
export function cleanupLegacyWebKeys(
  publicKeys: string[],
  factory?: IDBFactory,
): Promise<void> {
  if (publicKeys.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let db: IDBDatabase | undefined;
    let transaction: IDBTransaction | undefined;
    const finish = (failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failed) {
        try {
          transaction?.abort();
        } catch {
          // An already completed/aborted transaction cannot be aborted again.
          // Still close the connection and reject the original cleanup attempt.
        }
      }
      db?.close();
      if (failed) reject(new Error("Legacy key cleanup failed"));
      else resolve();
    };
    const timer = setTimeout(() => finish(true), 5000);
    try {
      const request = (factory ?? indexedDB).open(LEGACY_DB);
      request.onblocked = () => finish(true);
      request.onerror = () => finish(true);
      request.onupgradeneeded = () => {
        // A nonexistent database is not created merely to perform cleanup.
        db = request.result;
        request.transaction?.abort();
        finish();
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        db = request.result;
        db.onversionchange = () => finish(true);
        if (!db.objectStoreNames.contains(STORE)) {
          finish();
          return;
        }
        try {
          const tx = db.transaction(STORE, "readwrite");
          transaction = tx;
          tx.oncomplete = () => finish();
          tx.onerror = tx.onabort = () => finish(true);
          const store = tx.objectStore(STORE);
          for (const key of new Set(publicKeys)) {
            if (key === "0xkeyKeyPair-pub" || key === "0xkeyKeyPair-priv")
              continue;
            const read = store.get(key);
            read.onerror = () => finish(true);
            read.onsuccess = () => {
              if (settled) return;
              try {
                if (isCorePrivateKey(read.result)) {
                  const deletion = store.delete(key);
                  deletion.onerror = () => finish(true);
                }
              } catch {
                finish(true);
              }
            };
          }
        } catch {
          finish(true);
        }
      };
    } catch {
      finish(true);
    }
  });
}
