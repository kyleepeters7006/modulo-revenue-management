/**
 * A write that is only kept if the operator still wants it.
 *
 * The motivating case: a slow AI suggestion run caches its result so a reload
 * can restore it. If the operator cancels, the panel deliberately keeps showing
 * the PREVIOUS run — so the cancelled run must not quietly replace that run in
 * the cache, or the next reload shows something the operator explicitly stopped.
 *
 * Checking a cancellation flag before issuing the write is not enough: the
 * client can disconnect while the query is in flight, and by then the row has
 * already been overwritten. Wrapping the write in a transaction and deciding at
 * commit time closes that window — the only remaining gap is between the final
 * check and the COMMIT itself, which no amount of application-level coordination
 * can remove.
 */

export interface CancellableWriteClient {
  query(sql: string, params?: any[]): Promise<any>;
  release(): void;
}

export interface CancellableWritePool {
  connect(): Promise<CancellableWriteClient>;
}

export type CancellableWriteOutcome = 'committed' | 'discarded' | 'failed';

/**
 * Run `sql` inside a transaction and commit only if `isCancelled()` is still
 * false once the write has landed.
 *
 * Never throws: a cache write failing must not turn a successful run into an
 * error for the operator. The outcome is returned so the caller can log it.
 */
export async function commitIfStillWanted(
  pool: CancellableWritePool,
  isCancelled: () => boolean,
  sql: string,
  params: any[],
): Promise<CancellableWriteOutcome> {
  if (isCancelled()) return 'discarded';

  let client: CancellableWriteClient;
  try {
    client = await pool.connect();
  } catch {
    return 'failed';
  }

  try {
    await client.query('BEGIN');
    await client.query(sql, params);
    // Decide as late as possible: the disconnect may have happened during the
    // write above, and that is exactly the case a pre-flight check misses.
    if (isCancelled()) {
      await client.query('ROLLBACK');
      return 'discarded';
    }
    await client.query('COMMIT');
    return 'committed';
  } catch {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    return 'failed';
  } finally {
    client.release();
  }
}
