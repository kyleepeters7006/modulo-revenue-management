// ── Reference-data response cache ────────────────────────────────────────────
// GET /api/reference-data runs several heavy aggregations over rent_roll_data.
// Responses are cached in memory (keyed by client + filters) and invalidated
// whenever rules, manual overrides, or calculated rates change — including
// async pricing jobs (pricingJobManager) and cron-triggered daily runs.

const cache = new Map<string, { at: number; payload: any }>();
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

export function setRefDataCache(key: string, payload: any, computeStart: number) {
  // Don't cache results computed from data that was invalidated mid-flight
  if (computeStart < invalidatedAt) return;
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
}

export function invalidateRefDataCache() {
  cache.clear();
  invalidatedAt = Date.now();
}
