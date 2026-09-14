// ── Reference-data response cache ────────────────────────────────────────────
// GET /api/reference-data runs several heavy aggregations over rent_roll_data.
// Responses are cached in memory (keyed by client + filters) and invalidated
// whenever rules, manual overrides, or calculated rates change — including
// async pricing jobs (pricingJobManager) and cron-triggered daily runs.

const cache = new Map<string, { at: number; payload: any }>();
const inFlight = new Map<string, {
  promise: Promise<any | null>;
  resolve: (payload: any | null) => void;
}>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ENTRIES = 100;
let invalidatedAt = 0;

export function getRefDataCache(key: string): any | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at >= TTL_MS) {
    cache.delete(key);
    return null;
  }
  return e.payload;
}

/** Return the computation already running for this exact tenant/filter key. */
export function getRefDataInFlight(key: string): Promise<any | null> | null {
  return inFlight.get(key)?.promise ?? null;
}

/** Claim a cache miss so concurrent requests wait instead of repeating the SQL. */
export function startRefDataCompute(key: string) {
  if (inFlight.has(key)) return;
  let resolve!: (payload: any | null) => void;
  const promise = new Promise<any | null>((done) => { resolve = done; });
  inFlight.set(key, { promise, resolve });
}

/** Release waiters after a failed or deliberately skipped computation. */
export function clearRefDataInFlight(key: string) {
  const pending = inFlight.get(key);
  if (!pending) return;
  inFlight.delete(key);
  pending.resolve(null);
}

export function setRefDataCache(key: string, payload: any, computeStart: number) {
  // Don't cache results computed from data that was invalidated mid-flight
  if (computeStart < invalidatedAt) {
    clearRefDataInFlight(key);
    return;
  }
  // Prune expired entries; cap total size (evict oldest first)
  const now = Date.now();
  for (const [k, e] of cache) {
    if (now - e.at >= TTL_MS) cache.delete(k);
  }
  if (cache.size >= MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [k, e] of cache) {
      if (e.at < oldestAt) { oldestAt = e.at; oldestKey = k; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { at: now, payload });
  const pending = inFlight.get(key);
  if (pending) {
    inFlight.delete(key);
    pending.resolve(payload);
  }
}

export function invalidateRefDataCache() {
  cache.clear();
  // Keep in-flight ownership until that computation exits. Its computeStart
  // will fail the freshness check and release waiters with null. Clearing the
  // map here would let a second generation claim the same key while the first
  // is still running, recreating the cache-miss herd.
  invalidatedAt = Date.now();
}
