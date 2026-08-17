/**
 * On-demand runner for competitor rate matching.
 *
 * Rewrites the stored per-unit `competitor_base_rate` / `competitor_final_rate`
 * columns from the current survey data and matching policy. Run this after
 * anything that changes the inputs to matching — a survey import, a change to
 * the room-type fallback chain, or a `room_type` backfill — otherwise the
 * stored values stay frozen at whatever the last run produced.
 *
 *   npx tsx server/runCompetitorMatching.ts <upload-month> <client-id>
 *   npx tsx server/runCompetitorMatching.ts 2026-07 trilogy
 *
 * Both arguments are required: the previous hardcoded defaults ('2025-11',
 * client 'demo') silently repriced the wrong month for the wrong tenant.
 */
import { processAllUnitsForCompetitorRates } from './services/competitorRateMatching';
import { pool } from './db';

async function main(): Promise<number> {
  const [uploadMonth, clientId] = process.argv.slice(2);

  if (!uploadMonth || !clientId) {
    console.error('Usage: npx tsx server/runCompetitorMatching.ts <upload-month> <client-id>');
    console.error('Example: npx tsx server/runCompetitorMatching.ts 2026-07 trilogy');
    return 1;
  }

  console.log(`🚀 Competitor rate matching — month ${uploadMonth}, client ${clientId}...`);

  const result = await processAllUnitsForCompetitorRates(uploadMonth, clientId);
  console.log(`✅ Complete — processed ${result.processed}, updated ${result.updated}, errors ${result.errors}`);

  // Per-unit failures are swallowed into a counter rather than thrown, so
  // without this an automated run reports success while units went unwritten.
  if (result.errors > 0) {
    console.error(`❌ ${result.errors} unit(s) failed — treating as failure.`);
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
    console.error('❌ Error:', err);
    process.exitCode = 1;
    await pool.end().catch(() => {});
  });
