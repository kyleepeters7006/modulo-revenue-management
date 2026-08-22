/**
 * commitIfStillWanted — the cache write that a cancelled run must not keep.
 *
 * The race being guarded: the AI suggestion endpoint caches its run so a reload
 * can restore it, but when the operator cancels, the panel deliberately keeps
 * showing the PREVIOUS run. If the cancelled run's cache write lands anyway, the
 * next reload shows results the operator explicitly stopped waiting for — the
 * screen and the cache disagree, and nobody can tell why.
 *
 * A pre-flight cancellation check does not close this: the client can disconnect
 * while the write is in flight. These tests drive the real function with a fake
 * client that can flip the cancellation flag at a chosen moment, so the
 * mid-write case is deterministic rather than a matter of timing luck.
 *
 * Run: npx tsx tests/cancellableWrite.test.ts
 */

import { commitIfStillWanted, type CancellableWritePool, type CancellableWriteClient } from '../server/services/cancellableWrite';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`✓ ${label}`); }
  else { failed++; console.log(`✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

const SQL = 'INSERT INTO ai_suggestion_runs (client_id, payload) VALUES ($1, $2)';
const PARAMS = ['demo', '{"suggestions":[]}'];

interface Recorder {
  pool: CancellableWritePool;
  statements: string[];
  released: number;
  connects: number;
}

/**
 * A fake pool that records the statements it is asked to run.
 * `onStatement` can mutate outside state (e.g. cancel) to simulate a disconnect
 * happening at a precise point in the transaction.
 */
function recordingPool(opts: {
  onStatement?: (sql: string) => void;
  failOn?: string;
  failConnect?: boolean;
} = {}): Recorder {
  const rec: Recorder = { statements: [], released: 0, connects: 0, pool: null as any };
  rec.pool = {
    async connect(): Promise<CancellableWriteClient> {
      rec.connects++;
      if (opts.failConnect) throw new Error('pool exhausted');
      return {
        async query(sql: string) {
          const head = sql.trim().split(/\s+/)[0].toUpperCase();
          rec.statements.push(head);
          opts.onStatement?.(head);
          if (opts.failOn && head === opts.failOn) throw new Error(`${head} blew up`);
          return { rows: [] };
        },
        release() { rec.released++; },
      };
    },
  };
  return rec;
}

async function main() {
  console.log('\n=== A run nobody cancelled is kept ===\n');
  {
    const rec = recordingPool();
    const outcome = await commitIfStillWanted(rec.pool, () => false, SQL, PARAMS);
    ok('the write commits', outcome === 'committed', outcome);
    ok('inside a transaction', rec.statements[0] === 'BEGIN' && rec.statements.at(-1) === 'COMMIT', rec.statements.join(','));
    ok('the insert actually ran', rec.statements.includes('INSERT'));
    ok('and the connection goes back to the pool', rec.released === 1);
  }

  console.log('\n=== A run cancelled before the write never touches the row ===\n');
  {
    const rec = recordingPool();
    const outcome = await commitIfStillWanted(rec.pool, () => true, SQL, PARAMS);
    ok('the write is discarded', outcome === 'discarded', outcome);
    ok('no connection is even taken', rec.connects === 0);
    ok('no statement is issued', rec.statements.length === 0, rec.statements.join(','));
  }

  console.log('\n=== A cancel DURING the write still cannot overwrite the cache ===\n');
  {
    // This is the case a pre-flight check misses: the operator was still waiting
    // when the query started and had given up by the time it finished.
    let cancelled = false;
    const rec = recordingPool({ onStatement: (head) => { if (head === 'INSERT') cancelled = true; } });
    const outcome = await commitIfStillWanted(rec.pool, () => cancelled, SQL, PARAMS);
    ok('the write is discarded', outcome === 'discarded', outcome);
    ok('the transaction is rolled back', rec.statements.includes('ROLLBACK'), rec.statements.join(','));
    ok('and never committed', !rec.statements.includes('COMMIT'), rec.statements.join(','));
    ok('the connection is still released', rec.released === 1);
  }
  {
    // Cancelling after BEGIN but before the insert lands the same way.
    let cancelled = false;
    const rec = recordingPool({ onStatement: (head) => { if (head === 'BEGIN') cancelled = true; } });
    const outcome = await commitIfStillWanted(rec.pool, () => cancelled, SQL, PARAMS);
    ok('a cancel right after BEGIN also rolls back', outcome === 'discarded' && rec.statements.includes('ROLLBACK'), rec.statements.join(','));
    ok('...and does not commit', !rec.statements.includes('COMMIT'));
  }

  console.log('\n=== A failing cache write never becomes the operator\'s problem ===\n');
  {
    // The run succeeded; only the convenience cache failed. Throwing here would
    // turn a good run into a red banner.
    const rec = recordingPool({ failOn: 'INSERT' });
    let threw = false;
    let outcome: string | null = null;
    try { outcome = await commitIfStillWanted(rec.pool, () => false, SQL, PARAMS); } catch { threw = true; }
    ok('it does not throw', !threw);
    ok('it reports the failure instead', outcome === 'failed', String(outcome));
    ok('the transaction is rolled back', rec.statements.includes('ROLLBACK'), rec.statements.join(','));
    ok('the connection is not leaked', rec.released === 1);
  }
  {
    const rec = recordingPool({ failOn: 'COMMIT' });
    const outcome = await commitIfStillWanted(rec.pool, () => false, SQL, PARAMS);
    ok('a failing COMMIT is reported, not thrown', outcome === 'failed', outcome);
    ok('and the connection is still released', rec.released === 1);
  }
  {
    const rec = recordingPool({ failConnect: true });
    let threw = false;
    let outcome: string | null = null;
    try { outcome = await commitIfStillWanted(rec.pool, () => false, SQL, PARAMS); } catch { threw = true; }
    ok('an unavailable pool does not throw', !threw);
    ok('...and is reported as failed', outcome === 'failed', String(outcome));
    ok('...with nothing to release', rec.released === 0);
  }
  {
    // A ROLLBACK that itself fails (connection already gone) must not escape.
    const rec = recordingPool({ failOn: 'ROLLBACK' });
    let cancelled = false;
    const recCancel = recordingPool({
      onStatement: (head) => { if (head === 'INSERT') cancelled = true; },
      failOn: 'ROLLBACK',
    });
    let threw = false;
    try { await commitIfStillWanted(recCancel.pool, () => cancelled, SQL, PARAMS); } catch { threw = true; }
    ok('a failing ROLLBACK is swallowed', !threw);
    ok('and the connection is still released', recCancel.released === 1);
    void rec;
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
