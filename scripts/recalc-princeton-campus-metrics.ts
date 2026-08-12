/**
 * One-off script: recalculate and persist campus_metrics for Princeton-117.
 * Run with: npx tsx scripts/recalc-princeton-campus-metrics.ts
 */
import { recalculateAndPreloadCampusMetrics } from '../server/services/adjustmentRulesService';

const CLIENT_ID  = 'trilogy';
const LOCATION_ID = 'fa3e7b55-54d9-4393-bf66-e8393f032f09';

(async () => {
  console.log(`Recalculating campus metrics for Princeton-117 (${LOCATION_ID}) …`);
  await recalculateAndPreloadCampusMetrics(CLIENT_ID, LOCATION_ID);
  console.log('Done.');
  process.exit(0);
})().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
