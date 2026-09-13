// v18 stores compact snapshots. v17 could contain portfolio-wide resident
// details large enough to terminate mobile Safari during IndexedDB cloning.
const STORAGE_KEY = "inhouse-rate-planning:calculated-plans:v18";
const LEGACY_STORAGE_KEYS = [
  "inhouse-rate-planning:calculated-plans:v17",
  "inhouse-rate-planning:calculated-plans:v16",
  "inhouse-rate-planning:calculated-plans:v15",
  "inhouse-rate-planning:calculated-plans:v14",
  "inhouse-rate-planning:calculated-plans:v13",
  "inhouse-rate-planning:calculated-plans:v11",
  "inhouse-rate-planning:calculated-plans:v10",
  "inhouse-rate-planning:calculated-plans:v9",
  "inhouse-rate-planning:calculated-plans:v8",
  "inhouse-rate-planning:calculated-plans:v7",
  "inhouse-rate-planning:calculated-plans:v6",
  "inhouse-rate-planning:calculated-plans:v5",
  "inhouse-rate-planning:calculated-plans:v4",
  "inhouse-rate-planning:calculated-plans:v3",
  "inhouse-rate-planning:calculated-plans:v2",
  "inhouse-rate-planning:calculated-plans:v1",
];
const DB_NAME = "inhouse-rate-planning:v18";
const LEGACY_DB_NAMES = [
  "inhouse-rate-planning:v17",
  "inhouse-rate-planning:v16",
  "inhouse-rate-planning:v15",
  "inhouse-rate-planning:v14",
  "inhouse-rate-planning:v13",
  "inhouse-rate-planning:v11",
  "inhouse-rate-planning:v10",
  "inhouse-rate-planning:v9",
  "inhouse-rate-planning:v8",
  "inhouse-rate-planning:v7",
  "inhouse-rate-planning:v6",
  "inhouse-rate-planning:v5",
  "inhouse-rate-planning:v4",
  "inhouse-rate-planning:v3",
  "inhouse-rate-planning:v2",
  "inhouse-rate-planning",
];
const STORE_NAME = "calculated-plans";
const MAX_LOCAL_PLAN_SCOPES = 12;
// Safari can deny both IndexedDB and localStorage inside an embedded preview.
// Keep the current SPA session functional even when nothing can survive a
// browser reload; identity + scope keys preserve the same isolation rules.
const sessionPlans = new Map<string, unknown>();

function shouldAvoidIndexedDb(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(?:hone|ad|od)/.test(navigator.userAgent) && /WebKit/.test(navigator.userAgent);
}

function storageKey(identityKey: string, scopeKey: string): string {
  return `${identityKey}::${scopeKey}`;
}

function storedAt(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const lastRunAt = (value as { lastRunAt?: unknown }).lastRunAt;
  return typeof lastRunAt === "string" ? Date.parse(lastRunAt) || 0 : 0;
}

function writeLocalPlan(key: string, value: unknown): boolean {
  // Old versions can consume the entire iOS per-origin quota even though the
  // current compact record is small. They are never read after a version bump.
  for (const legacyKey of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(legacyKey);

  const raw = window.localStorage.getItem(STORAGE_KEY);
  const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  stored[key] = value;

  const bounded = Object.fromEntries(
    Object.entries(stored)
      .sort((a, b) => storedAt(b[1]) - storedAt(a[1]))
      .slice(0, MAX_LOCAL_PLAN_SCOPES),
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
    return true;
  } catch {
    // If existing compact scopes still exhaust quota, retain the calculation
    // the user just ran rather than failing the whole persistence operation.
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ [key]: value }));
    return true;
  }
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
  if (typeof window === "undefined" || !identityKey || !scopeKey) return null;
  const key = storageKey(identityKey, scopeKey);
  if (sessionPlans.has(key)) return sessionPlans.get(key) as T;

  try {
    if (!window.indexedDB || shouldAvoidIndexedDb()) throw new Error("IndexedDB unavailable");
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
): Promise<boolean> {
  if (typeof window === "undefined" || !identityKey || !scopeKey) return false;
  const key = storageKey(identityKey, scopeKey);
  sessionPlans.set(key, value);

  try {
    if (!window.indexedDB || shouldAvoidIndexedDb()) throw new Error("IndexedDB unavailable");
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
    return true;
  } catch {
    // Persistence is best-effort; a storage failure must not fail Calculate.
    try {
      return writeLocalPlan(key, value);
    } catch {
      // The browser has no writable persistent storage. The in-memory copy
      // still keeps the calculated plan usable while this app session remains
      // open, including client-side navigation away from and back to the page.
      return true;
    }
  }
}

/**
 * Save optional single-scope fallbacks first and the complete selected scope
 * last. On iOS quota recovery keeps only the latest write, so the primary
 * snapshot must be the final write rather than the last service line.
 */
export async function writeInhousePlanBundle<T>(
  identityKey: string | null,
  primary: { scopeKey: string; value: T },
  fallbacks: Array<{ scopeKey: string; value: T }>,
): Promise<boolean> {
  const fallbackWrites = await Promise.all(
    fallbacks.map(({ scopeKey, value }) =>
      writeInhousePlan(identityKey, scopeKey, value),
    ),
  );
  const primaryWrite = await writeInhousePlan(
    identityKey,
    primary.scopeKey,
    primary.value,
  );
  // Per-line records are optional recovery aids. Quota pressure may reject one
  // of them even though the complete selected-scope record saves successfully.
  // Only the protected primary determines whether the user's calculation was
  // actually saved; otherwise the UI shows a false destructive warning.
  void fallbackWrites;
  return primaryWrite;
}

export async function clearInhousePlanStorage(): Promise<void> {
  if (typeof window === "undefined") return;
  sessionPlans.clear();

  try {
    window.localStorage.removeItem(STORAGE_KEY);
    // Remove data written by the pre-identity-scoped implementation as well.
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Continue with IndexedDB cleanup when localStorage is unavailable.
  }

  await Promise.all([DB_NAME, ...LEGACY_DB_NAMES].map(deleteDb));
}