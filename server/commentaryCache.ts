/**
 * Shared in-memory analytics cache and commentary-purge utility.
 *
 * Lives here — not in routes.ts — so pricingJobManager.ts can share
 * the same Map instances without creating a circular import.
 *
 * Generation counter + last-purge-time pattern
 * --------------------------------------------
 * Every call to purgeCommentaryCacheForClient() does three things:
 *
 *  1. Records the current wall-clock time in commentaryLastPurgeTime so the
 *     commentary endpoint can reject DB rows written before the purge, even
 *     when the DB DELETE itself failed.
 *
 *  2. Increments the per-client generation number in commentaryGeneration.
 *     The commentary endpoint captures the generation before kicking off AI
 *     generation; when generation completes it re-reads the counter and, if
 *     it advanced, discards the stale result and starts a fresh regeneration.
 *
 *  3. Clears matching inflight promises so new GETs start fresh generations
 *     rather than joining a pre-purge in-flight.
 */

export interface AnalyticsCacheEntry {
  data: any;
  timestamp: number;
  ttl?: number; // per-entry TTL override; defaults to ANALYTICS_CACHE_TTL
}

/** Singleton in-memory cache shared by routes.ts and pricingJobManager.ts. */
export const analyticsCache = new Map<string, AnalyticsCacheEntry>();

export const ANALYTICS_CACHE_TTL  = 5  * 60 * 1000; // 5 minutes  (default)
export const COMMENTARY_CACHE_TTL = 30 * 60 * 1000; // 30 minutes (AI commentary)

/**
 * In-flight commentary generations, keyed by cache key.
 * Shared here so purgeCommentaryCacheForClient can clear stale promises.
 */
export const commentaryInflight = new Map<string, Promise<any>>();

/**
 * Per-client generation counter.  Incremented by every purge so in-flight
 * generations started before the purge know to retry rather than cache stale results.
 */
export const commentaryGeneration = new Map<string, number>();

/**
 * Wall-clock timestamp of the most recent commentary purge per client.
 * The commentary endpoint compares each DB row's updated_at against this
 * value; rows written before the last purge are discarded even when the
 * DELETE from ai_commentary_cache failed (e.g. transient DB error).
 */
export const commentaryLastPurgeTime = new Map<string, number>();

/**
 * Purge every `pc-commentary:<clientId>:…` entry from:
 *   1. the in-memory analyticsCache
 *   2. any in-flight promise (so new GETs don't reuse a pre-purge promise)
 *   3. the persistent ai_commentary_cache DB table
 *
 * The generation counter and last-purge timestamp are set FIRST so:
 *  - Any in-flight generation that resolves after this call retries with fresh
 *    data instead of returning/caching its pre-recalculation narrative.
 *  - The commentary endpoint can reject stale DB rows even when the DELETE
 *    failed (the timestamp gate acts as a durable fallback).
 *
 * Errors thrown by this function are intentionally NOT caught here.
 * The caller (pricingJobManager) should let the error propagate so that
 * a DB failure during purge surfaces as a job failure rather than silently
 * allowing stale commentary to remain serveable.
 */
export async function purgeCommentaryCacheForClient(
  clientId: string,
  // pool is injected to avoid a circular import through db.ts at module load
  // time in environments where pool isn't ready yet.
  pool: { query: (sql: string, params?: any[]) => Promise<any> },
): Promise<void> {
  const prefix = `pc-commentary:${clientId}:`;
  const now = Date.now();

  // 1. Record last-purge time so the commentary endpoint can reject stale DB
  //    rows even when the DELETE below fails.
  commentaryLastPurgeTime.set(clientId, now);

  // 2. Advance generation so any currently-running AI call discards its result
  //    and retries rather than returning/caching pre-recalculation commentary.
  commentaryGeneration.set(clientId, (commentaryGeneration.get(clientId) ?? 0) + 1);

  // 3. Clear in-flight promises — new GETs after this call will start fresh.
  for (const key of Array.from(commentaryInflight.keys())) {
    if (key.startsWith(prefix)) commentaryInflight.delete(key);
  }

  // 4. In-memory layer — must run before the DB delete so an immediate GET
  //    cannot race and re-serve an old entry while the DB delete is in flight.
  for (const key of Array.from(analyticsCache.keys())) {
    if (key.startsWith(prefix)) analyticsCache.delete(key);
  }

  // 5. Persistent layer — NOT wrapped in try/catch: callers receive the error.
  await pool.query(
    `DELETE FROM ai_commentary_cache WHERE cache_key LIKE $1`,
    [`${prefix}%`],
  );
}
