/**
 * Regression coverage for Reference Data's latest move-in/out columns.
 *
 * Run with: npx tsx tests/referenceDataMoveInOut.test.ts
 */
import { pool } from "../server/db";
import { getLatestGroupedMoveInOutCounts } from "../server/services/moveInOutService";

const clientRes = await pool.query<{ client_id: string }>(`
  SELECT client_id
  FROM move_in_out_events_active
  WHERE counted = true
  GROUP BY client_id
  ORDER BY COUNT(*) DESC
  LIMIT 1
`);
const clientId = clientRes.rows[0]?.client_id;
if (!clientId) throw new Error("No counted move-in/out events are available for the regression test");

const spotRes = await pool.query<{ month: string }>(
  `SELECT MAX(upload_month) AS month FROM rent_roll_data WHERE client_id = $1`,
  [clientId],
);
const spotMonth = spotRes.rows[0]?.month;
if (!spotMonth) throw new Error(`No rent-roll spot month is available for ${clientId}`);

const latest = await getLatestGroupedMoveInOutCounts(clientId, spotMonth);
if (!latest.month) throw new Error("The latest event month was not resolved");
if (latest.moveIns.size === 0) throw new Error("Latest move-ins did not resolve to any Reference Data room-type keys");
if (latest.moveOuts.size === 0) throw new Error("Latest move-outs did not resolve to any Reference Data room-type keys");

for (const key of [...latest.moveIns.keys(), ...latest.moveOuts.keys()]) {
  const [location, serviceLine, roomType] = key.split("||");
  if (!location || !serviceLine || !roomType) {
    throw new Error(`Resolved event key is incomplete: ${key}`);
  }
}

const displayedIns = Array.from(latest.moveIns.values()).reduce((sum, n) => sum + n, 0);
const displayedOuts = Array.from(latest.moveOuts.values()).reduce((sum, n) => sum + n, 0);
if (displayedIns <= 0 || displayedOuts <= 0) {
  throw new Error(`Expected positive latest counts, got ${displayedIns} move-ins and ${displayedOuts} move-outs`);
}

console.log(
  `✓ ${clientId} ${latest.month}: ${displayedIns.toLocaleString()} move-ins and ${displayedOuts.toLocaleString()} move-outs resolved across ` +
  `${latest.moveIns.size} / ${latest.moveOuts.size} grouped room-type keys`,
);

await pool.end();