/**
 * One-off data cleanup: remove the 15 stale duplicate campus alias records
 * for client 'trilogy' (Task: clean up duplicate campus records cluttering
 * location lists and maps).
 *
 * Background: these rows duplicate real campuses under a corrupted name
 * prefix (the numeric code is trustworthy; the prefix is not). Each has
 * zero rent_roll_data rows and no address, and sits on a state-centroid
 * coordinate, producing bogus stacked map pins and dead picker entries.
 *
 * Safety guards — a candidate is deleted ONLY if ALL hold:
 *   1. client_id = 'trilogy'
 *   2. name is in the exact allowlist below
 *   3. it has ZERO rent_roll_data rows
 *   4. it has no address
 * Dependent rows are removed first (only bulk-applied default rows exist in
 * pricing_weights and revenue_growth_targets — verified identical to the
 * portfolio-wide defaults created in one batch). All other FK tables were
 * verified to hold zero references. Everything runs in one transaction.
 *
 * Genuine same-campus pairs (e.g. "Romeo - 2512"/"Romeo SL - 527",
 * "Batesville - 120"/"Bloomington HS - 5149") are NOT in the allowlist and
 * are never touched.
 *
 * Idempotent: re-running after the aliases are gone is a no-op.
 *
 * Run with: npx tsx server/scripts/cleanupTrilogyDuplicateLocations.ts
 */
import { pool } from "../db";

const STALE_ALIAS_NAMES = [
  "Ashland-117",        // duplicates Princeton - 117
  "Canton-121",         // duplicates Scottsburg - 121
  "Columbus-110",       // duplicates Boonville - 110
  "Delaware-135",       // duplicates West Lafayette - 2135
  "Findlay-147",        // duplicates Lexington WF - 2147
  "Georgetown-2146",    // duplicates Lexington WH - 2146
  "IndianapolisCS-116", // duplicates Hanover - 116
  "Madison-131",        // duplicates Vincennes - 131
  "Mansfield-123",      // duplicates Richmond FP - 123
  "Mansfield-125",      // duplicates Greenfield - 125
  "Marion-111",         // duplicates Evansville RP - 111
  "Mount Vernon-124",   // duplicates Goshen MW - 124
  "Ontario-132",        // duplicates Elkhart - 132
  "Rensselaer-156",     // duplicates Lowell - 156
  "Sandusky-133",       // duplicates Lafayette CS - 133
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Resolve candidates with all safety guards applied.
    const { rows: candidates } = await client.query<{ id: string; name: string }>(
      `SELECT l.id, l.name
         FROM locations l
        WHERE l.client_id = 'trilogy'
          AND l.name = ANY($1::text[])
          AND COALESCE(l.address, '') = ''
          AND NOT EXISTS (SELECT 1 FROM rent_roll_data rr WHERE rr.location_id = l.id)
        ORDER BY l.name`,
      [STALE_ALIAS_NAMES],
    );

    if (candidates.length === 0) {
      console.log("No stale alias locations found — nothing to do (already cleaned).");
      await client.query("ROLLBACK");
      return;
    }
    const ids = candidates.map((c) => c.id);
    console.log(`Deleting ${candidates.length} stale aliases:`, candidates.map((c) => c.name).join(", "));

    // Verify no unexpected FK references remain outside the two known
    // bulk-default tables; abort if anything else points at these ids.
    const { rows: fkTables } = await client.query<{ table_name: string; column_name: string }>(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'locations' AND ccu.column_name = 'id'`,
    );
    const allowedDependents = new Set(["pricing_weights", "revenue_growth_targets"]);
    for (const { table_name, column_name } of fkTables) {
      if (allowedDependents.has(table_name)) continue;
      if (!/^[a-z_][a-z0-9_]*$/.test(table_name) || !/^[a-z_][a-z0-9_]*$/.test(column_name)) continue;
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM ${table_name} WHERE ${column_name} = ANY($1::text[])`,
        [ids],
      );
      if (rows[0].n > 0) {
        throw new Error(`Unexpected ${rows[0].n} reference(s) in ${table_name}.${column_name}; aborting.`);
      }
    }

    // Delete dependents (bulk-applied defaults only), then the aliases.
    const pw = await client.query(`DELETE FROM pricing_weights WHERE location_id = ANY($1::text[])`, [ids]);
    const rgt = await client.query(`DELETE FROM revenue_growth_targets WHERE location_id = ANY($1::text[])`, [ids]);
    const loc = await client.query(
      `DELETE FROM locations WHERE id = ANY($1::text[]) AND client_id = 'trilogy'`,
      [ids],
    );
    await client.query("COMMIT");
    console.log(`Deleted: ${loc.rowCount} locations, ${pw.rowCount} pricing_weights, ${rgt.rowCount} revenue_growth_targets rows.`);

    // Post-cleanup verification.
    const { rows: remain } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM locations WHERE client_id = 'trilogy' AND name = ANY($1::text[])`,
      [STALE_ALIAS_NAMES],
    );
    console.log(`Verification: ${remain[0].n} targeted aliases remain (expected 0).`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Cleanup failed:", err);
    process.exit(1);
  });
