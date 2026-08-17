/**
 * Idempotent, client-scoped data repair for the 2026-06/2026-07 street-rate
 * defects (see docs/street-rate-quality.md).
 *
 * 1. Goshen SL - 2184 (client "trilogy"): the June and July 2026 uploads
 *    carried DAILY rates for the AL and AL/MC service lines — verified per
 *    room as exactly 1/30th of the same room's 2026-05 monthly rate. The
 *    original upload files are not persisted, so re-import is impossible;
 *    this multiplies the affected rows ×30 in place.
 *    Idempotency: only rows with street_rate in (0, 500) are touched; after
 *    the ×30 every corrected rate is >= 1170, so a second run matches nothing.
 *
 * 2. Avon - 5166 room 21/A (AL) 2026-07: the source export replaced the
 *    street rate with the resident's prorated first-month charge ($159).
 *    Sets it to the room's own prior-month rate ($4,029) for 2026-07 only.
 *    Idempotency: the WHERE clause requires street_rate < 500.
 *
 * Run with: npx tsx server/scripts/fixStreetRates2026.ts
 */
import { pool } from "../db";

export async function fixStreetRates2026(): Promise<{ goshenUpdated: number; avonUpdated: number }> {
  const goshen = await pool.query(
    `UPDATE rent_roll_data
     SET street_rate = street_rate * 30
     WHERE client_id = 'trilogy'
       AND location = 'Goshen SL - 2184'
       AND upload_month IN ('2026-06', '2026-07')
       AND service_line IN ('AL', 'AL/MC')
       AND street_rate > 0 AND street_rate < 500`,
  );

  const avon = await pool.query(
    `UPDATE rent_roll_data
     SET street_rate = 4029
     WHERE client_id = 'trilogy'
       AND location = 'Avon - 5166'
       AND room_number = '21/A'
       AND service_line = 'AL'
       AND upload_month = '2026-07'
       AND street_rate > 0 AND street_rate < 500`,
  );

  return { goshenUpdated: goshen.rowCount ?? 0, avonUpdated: avon.rowCount ?? 0 };
}

// Verification: Goshen AL avg should be ~$3,900-4,100 for 2026-06/07 (May
// baseline $3,893), and Avon 21/A should read $4,029 for 2026-07.
async function verify(): Promise<void> {
  const g = await pool.query(
    `SELECT upload_month, service_line, count(*) AS n, round(avg(street_rate)) AS avg
     FROM rent_roll_data
     WHERE client_id = 'trilogy' AND location = 'Goshen SL - 2184'
       AND upload_month IN ('2026-05', '2026-06', '2026-07')
       AND service_line IN ('AL', 'AL/MC')
     GROUP BY 1, 2 ORDER BY 2, 1`,
  );
  console.table(g.rows);
  const a = await pool.query(
    `SELECT upload_month, street_rate FROM rent_roll_data
     WHERE client_id = 'trilogy' AND location = 'Avon - 5166' AND room_number = '21/A'
       AND service_line = 'AL' AND upload_month >= '2026-05' ORDER BY 1`,
  );
  console.table(a.rows);
}

// Execute when run directly (tsx sets the entry module).
if (process.argv[1] && process.argv[1].includes("fixStreetRates2026")) {
  (async () => {
    const result = await fixStreetRates2026();
    console.log("[fixStreetRates2026] updated:", result);
    await verify();
    await pool.end();
  })().catch((err) => {
    console.error("[fixStreetRates2026] failed:", err);
    process.exit(1);
  });
}
