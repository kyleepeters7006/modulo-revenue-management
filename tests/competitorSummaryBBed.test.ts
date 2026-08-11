/**
 * Integration-level regression: competitor rate summary must exclude B-bed
 * companion rows for senior housing SLs from avgStreetRate, avgCompetitorRate,
 * avgDifference AND count — using the exact SQL expressions from
 * server/services/competitorRateMatching.ts getCompetitorRateSummary(),
 * executed against Postgres over a fixed literal row set.
 *
 * Run with: npx tsx tests/competitorSummaryBBed.test.ts
 */
import { pool } from '../server/db';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

function assert(description: string, actual: number, expected: number) {
  if (Math.abs(actual - expected) < 1e-6) {
    console.log(`${PASS} ${description}`);
    passed++;
  } else {
    console.log(`${FAIL} ${description}`);
    console.log(`    Expected: ${expected}, Got: ${actual}`);
    failed++;
  }
}

async function main() {
  // Same aggregate expressions as getCompetitorRateSummary, over literal rows:
  // AL: 101 (primary, 5000 vs comp 5200), 101/B (companion, 3000 vs comp 5200), 102 (6000 vs 5800)
  // HC: 201/A (300 vs 320), 201/B (280 vs 320) — both kept
  const res = await pool.query(`
    WITH rows(service_line, room_number, street_rate, competitor_rate) AS (
      VALUES
        ('AL', '101',   5000::numeric, 5200::numeric),
        ('AL', '101/B', 3000::numeric, 5200::numeric),
        ('AL', '102',   6000::numeric, 5800::numeric),
        ('HC', '201/A',  300::numeric,  320::numeric),
        ('HC', '201/B',  280::numeric,  320::numeric)
    )
    SELECT
      service_line,
      AVG(CASE WHEN service_line IN ('AL', 'AL/MC', 'SL', 'VIL') AND room_number ~ '/[A-Za-z]+$' THEN NULL ELSE street_rate END) AS avg_street,
      AVG(CASE WHEN service_line IN ('AL', 'AL/MC', 'SL', 'VIL') AND room_number ~ '/[A-Za-z]+$' THEN NULL ELSE competitor_rate END) AS avg_comp,
      AVG(CASE WHEN service_line IN ('AL', 'AL/MC', 'SL', 'VIL') AND room_number ~ '/[A-Za-z]+$' THEN NULL ELSE competitor_rate - street_rate END) AS avg_diff,
      COUNT(*) FILTER (WHERE NOT (service_line IN ('AL', 'AL/MC', 'SL', 'VIL') AND room_number ~ '/[A-Za-z]+$')) AS cnt
    FROM rows
    GROUP BY service_line
    ORDER BY service_line
  `);

  const al = res.rows.find(r => r.service_line === 'AL')!;
  const hc = res.rows.find(r => r.service_line === 'HC')!;

  console.log('\n=== Competitor summary B-bed exclusion (SQL) ===\n');
  assert('AL avgStreetRate excludes companion ((5000+6000)/2)', Number(al.avg_street), 5500);
  assert('AL avgCompetitorRate excludes companion ((5200+5800)/2)', Number(al.avg_comp), 5500);
  assert('AL avgDifference excludes companion ((200-200)/2)', Number(al.avg_diff), 0);
  assert('AL count excludes companion (2)', Number(al.cnt), 2);
  assert('HC avgStreetRate keeps both beds ((300+280)/2)', Number(hc.avg_street), 290);
  assert('HC avgCompetitorRate keeps both beds (320)', Number(hc.avg_comp), 320);
  assert('HC avgDifference keeps both beds ((20+40)/2)', Number(hc.avg_diff), 30);
  assert('HC count keeps both beds (2)', Number(hc.cnt), 2);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.end();
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
