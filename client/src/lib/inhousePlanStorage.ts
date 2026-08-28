const STORAGE_KEY = "inhouse-rate-planning:calculated-plans:v2";
const LEGACY_STORAGE_KEY = "inhouse-rate-planning:calculated-plans:v1";
const DB_NAME = "inhouse-rate-planning:v2";
const LEGACY_DB_NAME = "inhouse-rate-planning";
const STORE_NAME = "calculated-plans";

function storageKey(identityKey: string, scopeKey: string): string {
  return `${identityKey}::${scopeKey}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open plan storage"));
  });
}

function deleteDb(dbName: string): Promise<void> {
  return new Promise((resolve) => {
    if (!window.indexedDB) {
      resolve();
      return;
    }
    const request = window.indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export async function readInhousePlan<T>(
  identityKey: string | null,
  scopeKey: string | null,
): Promise<T | null> {
  if (typeof window === "undefined" || !identityKey || !scopeKey || !window.indexedDB) return null;
  const key = storageKey(identityKey, scopeKey);

  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(key);
      request.onsuccess = () => {
        db.close();
        resolve((request.result ?? null) as T | null);
      };
      request.onerror = () => {
        db.close();
        reject(request.error ?? new Error("Could not read saved plan"));
      };
    });
  } catch {
    // Keep small legacy entries readable if IndexedDB is unavailable.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as Record<string, unknown>;
      return (stored[key] ?? null) as T | null;
    } catch {
      return null;
    }
  }
}

export async function writeInhousePlan<T>(
  identityKey: string | null,
  scopeKey: string | null,
  value: T,
): Promise<void> {
  if (typeof window === "undefined" || !identityKey || !scopeKey) return;
  const key = storageKey(identityKey, scopeKey);

  try {
    if (!window.indexedDB) throw new Error("IndexedDB unavailable");
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(value, key);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error ?? new Error("Could not save plan"));
      };
    });
  } catch {
    // Persistence is best-effort; a storage failure must not fail Calculate.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      stored[key] = value;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // The browser has no writable storage.
    }
  }
}

export async function clearInhousePlanStorage(): Promise<void> {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
    // Remove data written by the pre-identity-scoped implementation as well.
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Continue with IndexedDB cleanup when localStorage is unavailable.
  }

  await Promise.all([deleteDb(DB_NAME), deleteDb(LEGACY_DB_NAME)]);
}