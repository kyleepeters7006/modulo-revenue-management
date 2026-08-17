/**
 * On-demand runner for the room-type normalization backfill.
 *
 * The backfill is otherwise only fired ~5s after server start, which makes it
 * easy to ship a normalizer fix that never actually reaches the stored data
 * (the app has to be restarted, and a failure inside the transaction is only
 * visible in startup logs). Run this directly after changing `normalizeRoomType`:
 *
 *   npx tsx server/scripts/backfillRoomTypesRun.ts          # apply
 *   npx tsx server/scripts/backfillRoomTypesRun.ts --dry    # report only
 *
 * Room types feed competitor-rate matching, so a stale `room_type` column
 * silently produces wrong competitor benchmarks even when the survey data and
 * the matching policy are both correct.
 *
 * SCOPE: this backfill is GLOBAL — it re-derives `room_type` for every tenant,
 * not just one client. There is deliberately no client argument.
 */
import { backfillRoomTypes, analyzeRoomTypes } from '../backfillRoomTypes';
import { pool } from '../db';

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry');

  if (dryRun) {
    console.log('Scope: ALL CLIENTS (global room-type normalization) — dry run, no rows written.\n');
    await analyzeRoomTypes();
    console.log('\n(dry run — no rows written)');
    return 0;
  }

  console.log('Scope: ALL CLIENTS (global room-type normalization) — applying writes.\n');

  const result = await backfillRoomTypes();
  if (!result.success) {
    console.error(`❌ Backfill failed after ${result.duration}ms:`, result.error);
    return 1;
  }
  console.log(`✅ Backfill complete: ${result.totalUpdated} rows/types updated, ${result.totalErrors} errors, ${result.duration}ms`);

  // A partial success is still a failure for automation: some source types were
  // left un-normalized, which silently degrades competitor matching.
  if (result.totalErrors > 0) {
    console.error(`❌ ${result.totalErrors} type(s) failed to normalize — treating as failure.`);
    return 2;
  }
  return 0;
}

main()
  .then(async (code) => {
    process.exitCode = code;
    await pool.end();
  })
  .catch(async (err) => {
    console.error('❌ Fatal:', err);
    process.exitCode = 1;
    await pool.end().catch(() => {});
  });
