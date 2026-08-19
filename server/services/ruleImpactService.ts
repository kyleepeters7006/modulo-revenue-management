import { pool } from "../db";
import { isBBedRow } from "@shared/bBed";
import { loadCompBenchmark, type CompBenchmark } from "./compBenchmark";
import { normalizeRoomType } from "@shared/roomTypes";
import { DAYS_PER_MONTH } from "@shared/careRates";

// ---------------------------------------------------------------------------
// Qualified rule impact — the single source of truth for "how many units does
// this rule actually hit, and what revenue impact does it have?"
//
// 1. Qualification applies BOTH the rule's trigger conditions (campus-level
//    metrics like SL occupancy, room-type occupancy, street-vs-comp variance)
//    AND the action filters (service line, room type, occupancy status).
//    Previous calcs only applied action filters, so an "AL when SL occ >= 93%"
//    rule counted every AL unit in the portfolio.
// 2. Impact = trailing-3-month average move-ins per month for the qualified
//    campus/SL/room-type groups × the change in monthly rate. Only new
//    move-ins pay the new street rate, so units × rate × % wildly overstates.
// ---------------------------------------------------------------------------

const DAILY_SLS = new Set(["HC", "HC/MC"]);

export interface UnitRow {
  id: string;
  location_id: string | null;
  location: string | null;
  service_line: string | null;
  room_type: string | null;
  room_number: string | null;
  street_rate: number;
  care_rate: number;
  in_house_rate: number;
  occupied_yn: boolean | null;
  days_vacant: number | null;
  competitor_final_rate: number;
  payor_type: string | null;
}

interface GroupAgg {
  total: number;
  occupied: number;
  stSum: number; stN: number;        // street rates (raw) where > 100
  compStSum: number; compCSum: number; compN: number; // paired street/comp where both > 100
  ihStSum: number; ihISum: number; ihN: number; // paired street/in-house (monthly) for occupied single-occupant units
  dvSum: number; dvN: number;        // days_vacant accumulator for group-average trigger evaluation
}

export interface RuleImpactContext {
  clientId: string;
  latestMonth: string;
  units: UnitRow[];
  groups: Map<string, UnitRow[]>;            // `${locId}|${sl}|${rt}`
  metrics: Map<string, GroupAgg>;            // `${locId}`, `${locId}|${sl}`, `${locId}|${sl}|${rt}`
  moveMap: Map<string, number>;              // `${locationName}||${sl}||${rt}` -> t3 move-ins / month
  slMoveInRate: Map<string, number>;         // service line -> t3 move-ins / month / active unit
  compBenchmark: CompBenchmark;              // survey-based competitor benchmark (correct source for street_to_comp_var_pct)
  locIdToName: Map<string, string>;          // location_id → location name for benchmark lookup
  campusStreetToCompVar: Map<string, number>; // `${locId}|${sl}` → pre-computed street_to_comp_var_pct from campus_metrics
  /** Trailing-N occupancy % from room_type_occupancy_history.
   *  Key: `${locId}|${sl}|${rt}|trailing${N}` (sl='' campus-level, rt='' SL-level).
   *  Value: weighted avg occ_percent over N most recent months (0–100 scale). */
  trailingOccMap: Map<string, number>;
  /** Reverse RTG lookup: branded group_name → Set of canonical room_type values.
   *  Used by unitPasses() to match rules whose filters.roomType contains a
   *  branded group_name (e.g. 'Legacy Lane - Studio') against units whose
   *  rent_roll_data.room_type is the canonical value ('Studio'). */
  rtgReverse: Map<string, Set<string>>;
}

export interface RuleCampusImpact {
  locationId: string | null;
  campusName: string;
  unitCount: number;
  avgRate: number;                 // avg monthly rate of qualified units
  moveInsPerMonth: number;
  monthlyImpact: number;
  annualImpact: number;
}

export interface RuleServiceLineImpact {
  serviceLine: string;
  unitCount: number;
  moveInsPerMonth: number;
  monthlyImpact: number;
  annualImpact: number;
}

export interface RuleImpactResult {
  affectedUnits: number;
  affectedCampuses: number;
  moveInsPerMonth: number;
  avgStreetRate: number;           // weighted avg monthly rate across qualified units
  avgRateChange: number;           // move-in-weighted avg $ change per unit per month
  monthlyImpact: number;
  annualImpact: number;             // first-year cumulative impact (ramped move-in cohorts)
  steadyStateAnnualImpact: number;  // full-year impact once fully ramped (12 months of cohorts)
  perCampus: RuleCampusImpact[];
  perServiceLine: RuleServiceLineImpact[];
  qualifiedUnitIds: Set<string>;
  overlapExcludedUnits: number;    // units this rule qualifies but already claimed by a higher-precedence rule
}

/** Trailing-3-month move-ins per `${location}||${serviceLine}||${roomType}` (per month). */
export async function getT3MoveInsMap(
  clientId: string,
  scope: { locationId?: string | null; serviceLine?: string | null } = {},
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const monthsRes = await pool.query(
    `SELECT DISTINCT upload_month FROM rent_roll_data
     WHERE client_id = $1 AND upload_month IS NOT NULL
     ORDER BY upload_month DESC LIMIT 3`,
    [clientId],
  );
  const t3 = monthsRes.rows.map((r: any) => r.upload_month).filter(Boolean);
  if (t3.length === 0) return map;

  // Prefer imported move-in/out event data (Move Ins & Outs Detail upload)
  // over rent-roll-derived move-in dates when available for this client.
  const { hasMoveInOutEvents, getT3MoveInsMapFromEvents } = await import("./moveInOutService");
  if (await hasMoveInOutEvents(clientId)) {
    let locationName: string | null = null;
    if (scope.locationId) {
      const locRes = await pool.query(`SELECT name FROM locations WHERE id = $1`, [scope.locationId]);
      locationName = locRes.rows[0]?.name ?? null;
    }
    return getT3MoveInsMapFromEvents(clientId, t3, {
      location: locationName,
      serviceLine: scope.serviceLine ?? null,
    });
  }

  const where: string[] = ["rr.client_id = $1"];
  const params: any[] = [clientId];
  let idx = 2;
  if (scope.locationId) { where.push(`rr.location_id = $${idx}`); params.push(scope.locationId); idx++; }
  if (scope.serviceLine) { where.push(`rr.service_line = $${idx}`); params.push(scope.serviceLine); idx++; }
  const monthsIdx = idx;
  params.push(t3);

  const res = await pool.query(`
    WITH ev AS (
      SELECT DISTINCT ON (rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type)
        rr.location, rr.service_line, rr.room_type, rr.payor_type,
        CASE
          WHEN rr.move_in_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(rr.move_in_date,'YYYY-MM-DD')
          WHEN rr.move_in_date ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN TO_DATE(rr.move_in_date,'MM/DD/YYYY')
          ELSE NULL END AS dt
      FROM rent_roll_data rr
      WHERE ${where.join(" AND ")} AND rr.move_in_date IS NOT NULL AND rr.move_in_date != ''
      ORDER BY rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type,
               (rr.payor_type ILIKE '%private%' OR rr.payor_type ILIKE '%pvt%') DESC, rr.payor_type
    ),
    valid AS (
      SELECT location, service_line, room_type, TO_CHAR(dt,'YYYY-MM') AS mm
      FROM ev
      WHERE dt IS NOT NULL
        AND (CASE WHEN service_line IN ('HC','HC/MC') THEN (payor_type ILIKE '%private%' OR payor_type ILIKE '%pvt%') ELSE TRUE END)
    )
    SELECT location, service_line, room_type, COUNT(*)::float / 3.0 AS t3_moveins
    FROM valid WHERE mm = ANY($${monthsIdx})
    GROUP BY location, service_line, room_type
  `, params);
  for (const r of res.rows as any[]) {
    map.set(`${r.location}||${r.service_line}||${r.room_type}`, Number(r.t3_moveins) || 0);
  }
  return map;
}

/**
 * Like getT3MoveInsMap but applies room-type groupings and the full set of
 * endpoint filters so the returned keys use COALESCE(group_name, room_type)
 * and cover exactly the same rows as the reference-data grouped and units
 * endpoints.
 *
 * Both /api/reference-data and /api/reference-data/units call this function
 * with matching scope so revMonthlyImpact is always computed from an
 * identical pipeline on both sides.
 *
 * @param scope  Optional filters — all are AND-combined. `locations` is an
 *               exact-name allowlist; `regions`/`divisions` are resolved via
 *               the locations table.  `serviceLine` is applied in SQL.
 */
export async function getGroupedT3MoveInsMap(
  clientId: string,
  scope: {
    serviceLine?: string | null;
    locations?: string[];
    regions?: string[];
    divisions?: string[];
  } = {},
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const monthsRes = await pool.query(
    `SELECT DISTINCT upload_month FROM rent_roll_data
     WHERE client_id = $1 AND upload_month IS NOT NULL
     ORDER BY upload_month DESC LIMIT 3`,
    [clientId],
  );
  const t3 = monthsRes.rows.map((r: any) => r.upload_month).filter(Boolean) as string[];
  if (t3.length === 0) return map;

  const { hasMoveInOutEvents, getT3MoveInsMapFromEvents } = await import('./moveInOutService');

  // Resolve location allowlist from explicit names or region/division filters.
  let allowedLocs: Set<string> | null = null;
  if (scope.locations?.length) {
    allowedLocs = new Set(scope.locations);
  } else if (scope.regions?.length || scope.divisions?.length) {
    const p: any[] = [clientId];
    let w = `client_id = $1`;
    if (scope.regions?.length)   { p.push(scope.regions);   w += ` AND region   = ANY($${p.length})`; }
    if (scope.divisions?.length) { p.push(scope.divisions); w += ` AND division = ANY($${p.length})`; }
    const lr = await pool.query(`SELECT name FROM locations WHERE ${w}`, p);
    allowedLocs = new Set(lr.rows.map((r: any) => r.name as string));
  }

  // Room-type groupings: raw_key → group_name (used by both paths below).
  const rtgRes = await pool.query(
    `SELECT DISTINCT rtg.location, rtg.service_line, rr.room_type, rtg.group_name
     FROM room_type_groupings rtg
     JOIN rent_roll_data rr
       ON rr.client_id = rtg.client_id AND rr.location = rtg.location
      AND rr.service_line = rtg.service_line AND rr.source_room_type = rtg.source_room_type
     WHERE rtg.client_id = $1`,
    [clientId],
  );
  const rtgMap = new Map<string, string>();
  for (const r of rtgRes.rows as any[]) {
    rtgMap.set(`${r.location}||${r.service_line}||${r.room_type}`, r.group_name as string);
  }

  if (await hasMoveInOutEvents(clientId)) {
    // Events path: apply groupings to remapped event keys, then filter by allowedLocs.
    const evMap = await getT3MoveInsMapFromEvents(clientId, t3, {
      location: null,
      serviceLine: scope.serviceLine ?? null,
    });
    for (const [k, v] of Array.from(evMap.entries())) {
      const parts = k.split('||');
      if (allowedLocs && !allowedLocs.has(parts[0])) continue;
      const grouped = rtgMap.get(k);
      const key = grouped ? `${parts[0]}||${parts[1]}||${grouped}` : k;
      map.set(key, (map.get(key) || 0) + v);
    }
    return map;
  }

  // Rent-roll path: COALESCE(group_name, room_type) in SQL.
  // Location filtering is applied post-query against allowedLocs for
  // simplicity (avoids a complex JOIN against the locations table here).
  const where: string[] = ['rr.client_id = $1'];
  const params: any[] = [clientId];
  let idx = 2;
  if (scope.serviceLine) { where.push(`rr.service_line = $${idx}`); params.push(scope.serviceLine); idx++; }
  params.push(t3);

  const res = await pool.query(`
    WITH ev AS (
      SELECT DISTINCT ON (rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type)
        rr.location, rr.service_line,
        COALESCE(rtg.group_name, rr.room_type) AS room_type,
        rr.payor_type,
        CASE
          WHEN rr.move_in_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(rr.move_in_date,'YYYY-MM-DD')
          WHEN rr.move_in_date ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN TO_DATE(rr.move_in_date,'MM/DD/YYYY')
          ELSE NULL END AS dt
      FROM rent_roll_data rr
      LEFT JOIN room_type_groupings rtg
        ON rtg.client_id = rr.client_id AND rtg.location = rr.location
       AND rtg.service_line = rr.service_line AND rtg.source_room_type = rr.source_room_type
      WHERE ${where.join(' AND ')} AND rr.move_in_date IS NOT NULL AND rr.move_in_date != ''
      ORDER BY rr.location, rr.room_number, rr.move_in_date, rr.service_line, rr.room_type,
               (rr.payor_type ILIKE '%private%' OR rr.payor_type ILIKE '%pvt%') DESC, rr.payor_type
    ),
    valid AS (
      SELECT location, service_line, room_type, TO_CHAR(dt,'YYYY-MM') AS mm
      FROM ev
      WHERE dt IS NOT NULL
        AND (CASE WHEN service_line IN ('HC','HC/MC') THEN (payor_type ILIKE '%private%' OR payor_type ILIKE '%pvt%') ELSE TRUE END)
    )
    SELECT location, service_line, room_type,
           COUNT(*)::float / GREATEST(CARDINALITY($${idx}::text[]), 1) AS t3_moveins
    FROM valid WHERE mm = ANY($${idx})
    GROUP BY location, service_line, room_type
  `, params);
  for (const r of res.rows as any[]) {
    const loc = r.location as string;
    if (allowedLocs && !allowedLocs.has(loc)) continue;
    map.set(`${loc}||${r.service_line}||${r.room_type}`, Number(r.t3_moveins) || 0);
  }
  return map;
}

/** Build the shared context (one DB pass) used to score every rule. */
export async function buildRuleImpactContext(clientId: string): Promise<RuleImpactContext | null> {
  const latestRes = await pool.query(
    `SELECT MAX(upload_month) AS m FROM rent_roll_data WHERE client_id = $1`,
    [clientId],
  );
  const latestMonth: string | null = latestRes.rows[0]?.m ?? null;
  if (!latestMonth) return null;

  const { rows } = await pool.query(
    `SELECT id, location_id, location, service_line, room_type, room_number,
            street_rate::float AS street_rate, care_rate::float AS care_rate,
            in_house_rate::float AS in_house_rate,
            occupied_yn, days_vacant, competitor_final_rate::float AS competitor_final_rate,
            payor_type
     FROM rent_roll_data
     WHERE client_id = $1 AND upload_month = $2`,
    [clientId, latestMonth],
  );
  const units = rows as UnitRow[];

  const groups = new Map<string, UnitRow[]>();
  const metrics = new Map<string, GroupAgg>();
  const bump = (key: string, u: UnitRow) => {
    let g = metrics.get(key);
    if (!g) { g = { total: 0, occupied: 0, stSum: 0, stN: 0, compStSum: 0, compCSum: 0, compN: 0, ihStSum: 0, ihISum: 0, ihN: 0, dvSum: 0, dvN: 0 }; metrics.set(key, g); }
    g.total++;
    if (u.occupied_yn) g.occupied++;
    const st = Number(u.street_rate) || 0;
    const comp = Number(u.competitor_final_rate) || 0;
    const sl = u.service_line || "";
    // Exclude B-bed companion rows (room_number ending in /letter) for SH SLs
    // so street rate averages reflect primary (single-occupant) units only.
    const isBBedUnit = isBBedRow(sl, u.room_number);
    if (st > 100 && !isBBedUnit) { g.stSum += st; g.stN++; }
    if (st > 100 && comp > 100 && !isBBedUnit) { g.compStSum += st; g.compCSum += comp; g.compN++; }
    // IH-to-street variance inputs: occupied single-occupant units with both
    // rates present (mirrors the ih-street-variance recalculate endpoint:
    // SH excludes B-bed companion rows; HC counts private-pay only). HC daily
    // rates are converted to monthly so campus-level blending is consistent.
    const ih = Number(u.in_house_rate) || 0;
    const isDaily = DAILY_SLS.has(sl);
    const rateOk = isDaily ? (st > 0 && ih > 0) : (st > 100 && ih > 100);
    const singleOcc = isDaily
      ? ((u.payor_type || "").toUpperCase().includes("PRIVATE"))
      : !isBBedUnit;
    if (u.occupied_yn && rateOk && singleOcc) {
      const mult = isDaily ? DAYS_PER_MONTH : 1;
      g.ihStSum += st * mult;
      g.ihISum += ih * mult;
      g.ihN++;
    }
    // Accumulate days_vacant for group-average trigger evaluation.
    // Include all units (occupied and vacant) so the average reflects the
    // full group; B-bed rows are included because they contribute to the
    // actual average vacancy experience of the room type.
    const dv = Number(u.days_vacant) || 0;
    g.dvSum += dv;
    g.dvN++;
  };

  for (const u of units) {
    const loc = u.location_id || "";
    const sl = u.service_line || "Other";
    const rt = u.room_type || "Other";
    const gKey = `${loc}|${sl}|${rt}`;
    let arr = groups.get(gKey);
    if (!arr) { arr = []; groups.set(gKey, arr); }
    arr.push(u);
    bump(loc, u);
    bump(`${loc}|${sl}`, u);
    bump(gKey, u);
  }

  // Build locId → location name map from the units themselves (needed for
  // benchmark lookups which are keyed by location name, not ID).
  const locIdToName = new Map<string, string>();
  for (const u of units) {
    if (u.location_id && u.location) locIdToName.set(u.location_id, u.location);
  }

  // Load the survey-based competitor benchmark (same source as the competitive
  // position scatter chart). This replaces the stale competitor_final_rate field
  // from the rent roll for street_to_comp_var_pct trigger evaluation.
  const compBenchmark = await loadCompBenchmark(pool, clientId);

  const moveMap = await getT3MoveInsMap(clientId);

  // Portfolio-wide move-in rate per service line: trailing-3-month move-in
  // events / 3 months / active units in the SL. Prefer imported move-in/out
  // event data (Move Ins & Outs Detail upload) when present; fall back to
  // rent-roll-derived move-in dates (deduped per room + date) otherwise.
  const t3MonthsRes = await pool.query(
    `SELECT DISTINCT upload_month AS m FROM rent_roll_data
     WHERE client_id = $1 AND upload_month IS NOT NULL
     ORDER BY upload_month DESC LIMIT 3`,
    [clientId],
  );
  const t3Months = t3MonthsRes.rows.map((r: any) => r.m).filter(Boolean);
  const { hasMoveInOutEvents } = await import("./moveInOutService");
  const useEvents = await hasMoveInOutEvents(clientId);

  const slRateRes = useEvents
    ? await pool.query(`
        SELECT service_line, COUNT(*)::float / ${Math.max(t3Months.length, 1)} AS per_month
        FROM move_in_out_events
        WHERE client_id = $1 AND event_type = 'move_in' AND counted = true
          AND SUBSTRING(event_date, 1, 7) = ANY($2)
          AND (CASE WHEN service_line IN ('HC','HC/MC')
               THEN (payer ILIKE '%private%' OR payer ILIKE '%pvt%') ELSE TRUE END)
        GROUP BY service_line
      `, [clientId, t3Months])
    : await pool.query(`
    WITH t3 AS (
      SELECT DISTINCT upload_month FROM rent_roll_data
      WHERE client_id = $1 AND upload_month IS NOT NULL
      ORDER BY upload_month DESC LIMIT 3
    ),
    ev AS (
      SELECT DISTINCT ON (rr.location, rr.room_number, rr.move_in_date, rr.service_line)
        rr.service_line, rr.payor_type,
        CASE
          WHEN rr.move_in_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN TO_DATE(rr.move_in_date,'YYYY-MM-DD')
          WHEN rr.move_in_date ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN TO_DATE(rr.move_in_date,'MM/DD/YYYY')
          ELSE NULL END AS dt
      FROM rent_roll_data rr
      WHERE rr.client_id = $1 AND rr.move_in_date IS NOT NULL AND rr.move_in_date != ''
    )
    SELECT service_line, COUNT(*)::float / 3.0 AS per_month
    FROM ev
    WHERE dt IS NOT NULL AND TO_CHAR(dt,'YYYY-MM') IN (SELECT upload_month FROM t3)
      AND (CASE WHEN service_line IN ('HC','HC/MC') THEN (payor_type ILIKE '%private%' OR payor_type ILIKE '%pvt%') ELSE TRUE END)
    GROUP BY service_line
  `, [clientId]);

  const slUnitCounts = new Map<string, number>();
  for (const u of units) {
    const sl = u.service_line || "Other";
    slUnitCounts.set(sl, (slUnitCounts.get(sl) || 0) + 1);
  }
  const slMoveInRate = new Map<string, number>();
  for (const r of slRateRes.rows as any[]) {
    const total = slUnitCounts.get(r.service_line) || 0;
    if (total > 0) slMoveInRate.set(r.service_line, (Number(r.per_month) || 0) / total);
  }

  // Load pre-computed street_to_comp_var_pct from campus_metrics as a fallback
  // for locations where neither survey benchmark data nor paired rent-roll
  // competitor_final_rate values are available. campus_metrics is populated
  // during the reference-data calculation from survey data, so it has the
  // correct value even when competitor_final_rate is blank in the rent roll.
  const campusMetricsRes = await pool.query(
    `SELECT location_id, service_line, value
     FROM campus_metrics
     WHERE client_id = $1 AND metric_name = 'street_to_comp_var_pct'
       AND service_line IS NOT NULL AND room_type IS NULL`,
    [clientId],
  );
  const campusStreetToCompVar = new Map<string, number>();
  for (const r of campusMetricsRes.rows as any[]) {
    if (r.location_id && r.service_line) {
      campusStreetToCompVar.set(`${r.location_id}|${r.service_line}`, Number(r.value));
    }
  }

  // ── Trailing occupancy from room_type_occupancy_history ──────────────────
  // Fetch all history rows for this client in a single query, then compute
  // rolling averages in memory for windows of 3, 6, and 12 months.
  // Key format: `${locId}|${sl}|${rt}|trailing${N}` (sl='' → campus, rt='' → SL-level)
  const trailingOccMap = new Map<string, number>();
  try {
    // Include rows whose location_id is NULL by resolving them via location_name
    // (matching the established authoritative-source pattern used elsewhere).
    const histRes = await pool.query(
      `SELECT COALESCE(roh.location_id, l.id) AS location_id,
              roh.service_line, roh.normalized_room_type AS room_type,
              roh.year, roh.month, roh.occ_units, roh.available_units, roh.occ_percent
       FROM room_type_occupancy_history roh
       LEFT JOIN locations l
         ON l.client_id = roh.client_id
        AND l.name      = roh.location_name
        AND roh.location_id IS NULL
       WHERE roh.client_id = $1
         AND (roh.location_id IS NOT NULL OR l.id IS NOT NULL)
       ORDER BY COALESCE(roh.location_id, l.id),
                roh.service_line, roh.normalized_room_type, roh.year DESC, roh.month DESC`,
      [clientId],
    );
    if (histRes.rows.length > 0) {
      // Group rows by (locId, sl, rt) — already ordered recency-first per group.
      // Composite service lines ("AL, MC") are tokenised and expanded so each token
      // gets its own history entry, matching the convention used by occupancy-map code.
      type HistRow = { location_id: string; service_line: string; room_type: string; year: number; month: number; occ_units: number | null; available_units: number | null; occ_percent: number | null };
      const byRt = new Map<string, HistRow[]>();
      for (const r of histRes.rows as HistRow[]) {
        const slTokens = String(r.service_line || '').split(',').map(t => t.trim()).filter(Boolean);
        for (const sl of slTokens) {
          const k = `${r.location_id}|${sl}|${r.room_type}`;
          if (!byRt.has(k)) byRt.set(k, []);
          byRt.get(k)!.push(r);
        }
      }

      // Helper: weighted average occ% over top-N rows in the recency-ordered list.
      // Prefers occ_units/available_units for a true weighted average; falls back
      // to averaging occ_percent when unit counts are absent.
      const windowAvg = (rows: HistRow[], n: number): number | null => {
        const slice = rows.slice(0, n);
        if (!slice.length) return null;
        const occSum = slice.reduce((s, r) => s + (r.occ_units ?? 0), 0);
        const avlSum = slice.reduce((s, r) => s + (r.available_units ?? 0), 0);
        if (avlSum > 0) return (occSum / avlSum) * 100;
        // Fallback: simple average of occ_percent
        const pctRows = slice.filter(r => r.occ_percent !== null);
        return pctRows.length ? pctRows.reduce((s, r) => s + (r.occ_percent ?? 0), 0) / pctRows.length : null;
      };

      const WINDOWS = [3, 6, 12] as const;

      byRt.forEach((rows, rtKey) => {
        const [locId, sl, rt] = rtKey.split('|');
        for (const w of WINDOWS) {
          const avg = windowAvg(rows, w);
          if (avg !== null) {
            trailingOccMap.set(`${locId}|${sl}|${rt}|trailing${w}`, avg);
          }
        }
      });

      // SL-level: aggregate across all room types for each (locId, sl)
      // Composite SL values ("AL, MC") are tokenised so each token accumulates separately.
      const bySl = new Map<string, Map<string, HistRow[]>>(); // locId|sl → month_key → rows
      for (const r of histRes.rows as HistRow[]) {
        const monthKey = `${r.year}-${String(r.month).padStart(2, '0')}`;
        const slTokens = String(r.service_line || '').split(',').map(t => t.trim()).filter(Boolean);
        for (const sl of slTokens) {
          const slKey = `${r.location_id}|${sl}`;
          if (!bySl.has(slKey)) bySl.set(slKey, new Map());
          if (!bySl.get(slKey)!.has(monthKey)) bySl.get(slKey)!.set(monthKey, []);
          bySl.get(slKey)!.get(monthKey)!.push(r);
        }
      }
      bySl.forEach((monthMap, slKey) => {
        const [locId, sl] = slKey.split('|');
        // Sort months descending, then for each window take the top-N months and aggregate
        const sortedMonths = Array.from(monthMap.keys()).sort((a: string, b: string) => b.localeCompare(a));
        for (const w of WINDOWS) {
          const topMonths = sortedMonths.slice(0, w);
          let occSum = 0, avlSum = 0, pctSum = 0, pctN = 0;
          for (const mk of topMonths) {
            for (const r of monthMap.get(mk)!) {
              occSum += r.occ_units ?? 0;
              avlSum += r.available_units ?? 0;
              if (r.occ_percent !== null) { pctSum += r.occ_percent; pctN++; }
            }
          }
          const avg = avlSum > 0 ? (occSum / avlSum) * 100 : (pctN > 0 ? pctSum / pctN : null);
          if (avg !== null) {
            trailingOccMap.set(`${locId}|${sl}||trailing${w}`, avg);
          }
        }
      });

      // Campus-level: aggregate across all SLs for each locId
      const byCampus = new Map<string, Map<string, HistRow[]>>(); // locId → month_key → rows
      for (const r of histRes.rows as HistRow[]) {
        const locId = r.location_id;
        if (!byCampus.has(locId)) byCampus.set(locId, new Map());
        const monthKey = `${r.year}-${String(r.month).padStart(2, '0')}`;
        if (!byCampus.get(locId)!.has(monthKey)) byCampus.get(locId)!.set(monthKey, []);
        byCampus.get(locId)!.get(monthKey)!.push(r);
      }
      byCampus.forEach((monthMap, locId) => {
        const sortedMonths = Array.from(monthMap.keys()).sort((a: string, b: string) => b.localeCompare(a));
        for (const w of WINDOWS) {
          const topMonths = sortedMonths.slice(0, w);
          let occSum = 0, avlSum = 0, pctSum = 0, pctN = 0;
          for (const mk of topMonths) {
            for (const r of monthMap.get(mk)!) {
              occSum += r.occ_units ?? 0;
              avlSum += r.available_units ?? 0;
              if (r.occ_percent !== null) { pctSum += r.occ_percent; pctN++; }
            }
          }
          const avg = avlSum > 0 ? (occSum / avlSum) * 100 : (pctN > 0 ? pctSum / pctN : null);
          if (avg !== null) {
            trailingOccMap.set(`${locId}|||trailing${w}`, avg);
          }
        }
      });
    } // end if (histRes.rows.length > 0)
  } catch (err) {
    console.warn('[ruleImpact] Failed to load trailing occupancy history:', err);
  }

  // ── Reverse RTG lookup: `${location}|${service_line}|${group_name}` → Set<rr.room_type> ──
  // Allows unitPasses() to match a rule whose filters.roomType was saved with
  // a branded group name (e.g. 'Legacy Lane - Studio') against rent-roll units
  // whose room_type column holds the canonical normalized value ('Studio').
  //
  // The key MUST include location and service_line.  The same branded group name
  // can map to different canonical room types at different locations/service lines
  // (e.g. 'Legacy Lane - Studio' → 'Studio' at Campus A but → 'Suite' at Campus B).
  // A client-wide key would union those canonical types, causing a branded rule
  // to incorrectly qualify units at a location where the group maps to a
  // different canonical type.
  //
  // We JOIN rent_roll_data (latest month) to get the actual rr.room_type values
  // that unitPasses() evaluates — NOT source_room_type, which can differ from
  // room_type after the import normalization step.
  const rtgReverse = new Map<string, Set<string>>();
  try {
    const rtgRevRes = await pool.query(
      `SELECT DISTINCT rtg.location, rtg.service_line, rtg.group_name, rr.room_type
       FROM room_type_groupings rtg
       JOIN rent_roll_data rr
         ON rr.client_id        = rtg.client_id
        AND rr.location         = rtg.location
        AND rr.service_line     = rtg.service_line
        AND rr.source_room_type = rtg.source_room_type
       WHERE rtg.client_id = $1
         AND rr.upload_month = $2
         AND rtg.group_name IS NOT NULL`,
      [clientId, latestMonth],
    );
    for (const r of rtgRevRes.rows as { location: string; service_line: string; group_name: string; room_type: string }[]) {
      const key = `${r.location}|${r.service_line}|${r.group_name}`;
      let set = rtgReverse.get(key);
      if (!set) { set = new Set(); rtgReverse.set(key, set); }
      set.add(r.room_type);
    }
  } catch (err) {
    console.warn('[ruleImpact] Failed to load RTG reverse lookup:', err);
  }

  return { clientId, latestMonth, units, groups, metrics, moveMap, slMoveInRate, compBenchmark, locIdToName, campusStreetToCompVar, trailingOccMap, rtgReverse };
}

/** Metric lookup with SL+RT → SL → campus fallback (mirrors the rate engine). */
function lookupMetric(
  ctx: RuleImpactContext,
  locId: string, sl: string, rt: string,
  metric: "occupancy_pct" | "vacant_units" | "street_to_comp_var_pct" | "ih_street_var_pct",
): number | null {
  const keys = [`${locId}|${sl}|${rt}`, `${locId}|${sl}`, locId];
  for (const k of keys) {
    const g = ctx.metrics.get(k);
    if (!g || g.total === 0) continue;
    if (metric === "occupancy_pct") return (g.occupied / g.total) * 100;
    if (metric === "vacant_units") return g.total - g.occupied;
    if (metric === "street_to_comp_var_pct") {
      // Prefer the survey-based benchmark (same source as the competitive position
      // scatter chart) over the stale competitor_final_rate from the rent roll.
      // For VIL locations the rent-roll field holds legacy values far below actual
      // market rates, causing the variance to appear falsely positive.
      // When no survey coverage exists for this location (e.g. a location whose
      // survey data has not yet been uploaded), fall back to the rent-roll
      // competitor_final_rate so that street_to_comp_var trigger conditions can
      // still be evaluated using whatever comp data is available.
      const locName = ctx.locIdToName.get(locId);
      // Use room-type-specific benchmark when the survey has that room type
      // (e.g. Studio Dlx vs Studio Dlx competitor) — falls back to the SL-level
      // blended benchmark when no RT-specific data is available.
      const bench = locName
        ? (k === `${locId}|${sl}|${rt}`
            ? (ctx.compBenchmark.benchmarkForRT(locName, sl, rt) ?? ctx.compBenchmark.benchmarkFor(locName, sl))
            : ctx.compBenchmark.benchmarkFor(locName, sl))
        : null;
      if (bench && bench.adjusted > 0) {
        // Survey path — preferred when available.
        if (g.stN === 0) continue; // no street-rate data in this group — try broader scope
        const avgSt = g.stSum / g.stN;
        return ((avgSt - bench.adjusted) / bench.adjusted) * 100;
      }
      // Fallback: use paired rent-roll competitor_final_rate values when no
      // survey benchmark is available for this SL at this location.
      if (g.compN === 0) continue; // no comp data at all — try broader scope
      const avgSt = g.compStSum / g.compN;
      const avgComp = g.compCSum / g.compN;
      if (avgComp <= 0) continue;
      return ((avgSt - avgComp) / avgComp) * 100;
    }
    if (metric === "ih_street_var_pct") {
      if (g.ihN === 0) continue; // fall back to broader scope
      const avgSt = g.ihStSum / g.ihN;
      const avgIH = g.ihISum / g.ihN;
      if (avgSt <= 0) continue;
      // Same formula as the ih-street-variance recalculate endpoint:
      // (avg in-house − avg street) / avg street × 100
      return ((avgIH - avgSt) / avgSt) * 100;
    }
  }
  // Final fallback for street_to_comp_var_pct: use the pre-computed value from
  // campus_metrics (populated from survey data during reference-data calculation).
  // This covers locations where competitor_final_rate is blank in the rent roll
  // and no live survey benchmark is available via compBenchmark.
  if (metric === "street_to_comp_var_pct") {
    const cmKey = `${locId}|${sl}`;
    const precomputed = ctx.campusStreetToCompVar.get(cmKey);
    if (precomputed !== undefined) return precomputed;
  }
  return null;
}

function cmp(val: number | null, op: string, threshold: number): boolean {
  if (val === null || val === undefined) return false;
  switch (op) {
    case "<": return val < threshold;
    case "<=": return val <= threshold;
    case ">": return val > threshold;
    case ">=": return val >= threshold;
    case "=": case "==": case "===": return Math.abs(val - threshold) < 0.01;
    default: return false;
  }
}

const OCC_FIELDS = new Set([
  "occupancy", "campus_occupancy", "service_line_occupancy", "room_type_occupancy",
  "room_type_occupancy_trailing3", "room_type_occupancy_trailing6", "room_type_occupancy_trailing12",
  "service_line_occupancy_trailing3", "service_line_occupancy_trailing6", "service_line_occupancy_trailing12",
  "occupancy_trailing3", "occupancy_trailing6", "occupancy_trailing12",
]);

/** Evaluate one metric-based trigger condition at the campus/SL/RT group level.
 *
 * @param isArrayFormat  true when called from a `trigger.conditions[]` block
 *   (group-average gate for days_vacant — every unit fires if the group avg
 *   meets the threshold); false when called from a singular `trigger.condition`
 *   (defer days_vacant to the unit-level `unitPasses` predicate instead).
 */
function evalGroupCondition(
  ctx: RuleImpactContext,
  cond: { field: string; operator: string; value: number },
  locId: string, sl: string, rt: string,
  isArrayFormat = true,
): boolean {
  const { field, operator } = cond;
  // Occupancy trigger values are often stored as fractions (0.93 = 93%);
  // metrics are always 0–100. Normalise so both scales work.
  let value = Number(cond.value);
  if (OCC_FIELDS.has(field) && Math.abs(value) <= 1) value = value * 100;

  if (field === "occupancy" || field === "campus_occupancy") {
    const g = ctx.metrics.get(locId);
    return cmp(g && g.total ? (g.occupied / g.total) * 100 : null, operator, value);
  }
  if (field === "service_line_occupancy") {
    const g = ctx.metrics.get(`${locId}|${sl}`);
    return cmp(g && g.total ? (g.occupied / g.total) * 100 : null, operator, value);
  }
  if (field === "room_type_occupancy") {
    return cmp(lookupMetric(ctx, locId, sl, rt, "occupancy_pct"), operator, value);
  }
  // ── Trailing-window occupancy variants ──────────────────────────────────
  // Falls back to current rent-roll occupancy when history is insufficient.
  if (field === "room_type_occupancy_trailing3" || field === "room_type_occupancy_trailing6" || field === "room_type_occupancy_trailing12") {
    const win = field.endsWith('12') ? 12 : field.endsWith('6') ? 6 : 3;
    // Normalize the room type at lookup time so aliased rent-roll values (e.g.
    // "1 BR") match the canonical history keys (e.g. "One Bedroom").
    const normRt = normalizeRoomType(rt);
    const rtVal = ctx.trailingOccMap.get(`${locId}|${sl}|${normRt}|trailing${win}`);
    if (rtVal !== undefined) return cmp(rtVal, operator, value);
    const slVal = ctx.trailingOccMap.get(`${locId}|${sl}||trailing${win}`);
    if (slVal !== undefined) return cmp(slVal, operator, value);
    const campVal = ctx.trailingOccMap.get(`${locId}|||trailing${win}`);
    if (campVal !== undefined) return cmp(campVal, operator, value);
    // Fallback: current rent-roll
    return cmp(lookupMetric(ctx, locId, sl, rt, "occupancy_pct"), operator, value);
  }
  if (field === "service_line_occupancy_trailing3" || field === "service_line_occupancy_trailing6" || field === "service_line_occupancy_trailing12") {
    const win = field.endsWith('12') ? 12 : field.endsWith('6') ? 6 : 3;
    const slVal = ctx.trailingOccMap.get(`${locId}|${sl}||trailing${win}`);
    if (slVal !== undefined) return cmp(slVal, operator, value);
    const campVal = ctx.trailingOccMap.get(`${locId}|||trailing${win}`);
    if (campVal !== undefined) return cmp(campVal, operator, value);
    // Fallback: current rent-roll
    const g = ctx.metrics.get(`${locId}|${sl}`);
    return cmp(g && g.total ? (g.occupied / g.total) * 100 : null, operator, value);
  }
  if (field === "occupancy_trailing3" || field === "occupancy_trailing6" || field === "occupancy_trailing12") {
    const win = field.endsWith('12') ? 12 : field.endsWith('6') ? 6 : 3;
    const campVal = ctx.trailingOccMap.get(`${locId}|||trailing${win}`);
    if (campVal !== undefined) return cmp(campVal, operator, value);
    // Fallback: current rent-roll
    const g = ctx.metrics.get(locId);
    return cmp(g && g.total ? (g.occupied / g.total) * 100 : null, operator, value);
  }
  if (field === "vacant_units" || field === "vacant_beds") {
    const g = ctx.metrics.get(`${locId}|${sl}`);
    return cmp(g ? g.total - g.occupied : null, operator, value);
  }
  if (field === "competitor_rate" || field === "competitor_variance" || field === "street_to_comp_var") {
    return cmp(lookupMetric(ctx, locId, sl, rt, "street_to_comp_var_pct"), operator, value);
  }
  // In-house-to-street rate variance % (single occupant), computed from the
  // same rent roll snapshot: (avg IH − avg street) / avg street × 100.
  if (field === "ih_street_variance" || field === "street_to_ih_var") {
    // Legacy rules may store the threshold as a fraction (0.1 = 10%).
    const v = Math.abs(value) <= 1 && value !== 0 ? value * 100 : value;
    return cmp(lookupMetric(ctx, locId, sl, rt, "ih_street_var_pct"), operator, v);
  }
  // days_vacant semantics depend on trigger format:
  //   conditions[] array format → group-average gate: every unit in the group
  //     fires when the group average meets the threshold (isArrayFormat=true).
  //   Singular trigger.condition format → defer to unitPasses() which filters
  //     each unit individually (isArrayFormat=false → return true here).
  if (field === "days_vacant") {
    if (!isArrayFormat) return true; // singular condition: per-unit eval deferred to unitPasses()
    const g = ctx.metrics.get(`${locId}|${sl}|${rt}`);
    const avg = g && g.dvN ? g.dvSum / g.dvN : 0;
    return cmp(avg, operator, Number(cond.value));
  }
  // Metrics we can't compute here (inquiry volume, …) — treat as
  // not passing, same as the rate engine does when the metric is missing.
  return false;
}

/** Does the rule's trigger pass for this campus/SL/RT group? */
function groupPassesTrigger(
  ctx: RuleImpactContext, rule: any, locId: string, sl: string, rt: string,
): boolean {
  const trigger = rule.trigger || {};
  if (trigger.type === "immediate" || trigger.immediate === true) return true;
  if (trigger.type === "time" || trigger.type === "event") return true; // schedule-based: always eligible
  if (trigger.type !== "condition") return true;

  if (Array.isArray(trigger.conditions)) {
    const conds = trigger.conditions as Array<{ field: string; operator: string; value: number }>;
    const op = (trigger.conditionOperator || "AND").toUpperCase();
    // isArrayFormat=true: days_vacant evaluated as group average in this path.
    return op === "OR"
      ? conds.some(c => evalGroupCondition(ctx, c, locId, sl, rt, true))
      : conds.every(c => evalGroupCondition(ctx, c, locId, sl, rt, true));
  }
  if (trigger.condition?.field) {
    // isArrayFormat=false: singular condition defers days_vacant to unitPasses().
    return evalGroupCondition(ctx, trigger.condition, locId, sl, rt, false);
  }
  // Legacy object format: unit-level conditions handled by the unit predicate
  return true;
}

/** Unit-level predicate: action filters + legacy trigger unit conditions.
 *
 * `rtgReverse` is the branded-group-name → canonical-room-type reverse lookup
 * from room_type_groupings.  When a filter value is a branded name (e.g.
 * 'Legacy Lane - Studio') that does not match u.room_type ('Studio') directly,
 * we check whether any canonical room type in the reverse map matches.  This
 * prevents rules whose roomType filter was saved with a branded group name from
 * silently skipping all units and producing 0 impact.
 */
function unitPasses(rule: any, u: UnitRow, rtgReverse?: Map<string, Set<string>>): boolean {
  const action = rule.action || {};
  const filters = action.filters || {};
  if (filters.roomType?.length) {
    const canonicalRt = u.room_type;
    const matchesDirect = filters.roomType.includes(canonicalRt);
    // Reverse RTG lookup: keyed by `${location}|${service_line}|${group_name}` so
    // that the same branded name at different locations/service lines resolves to
    // the canonical type defined ONLY at this unit's location+SL, preventing
    // cross-location contamination.
    const matchesViaRtg = !matchesDirect && rtgReverse
      ? (filters.roomType as string[]).some(filterVal => {
          const key = `${u.location}|${u.service_line}|${filterVal}`;
          const canonicals = rtgReverse.get(key);
          return canonicals ? canonicals.has(canonicalRt ?? '') : false;
        })
      : false;
    if (!matchesDirect && !matchesViaRtg) return false;
  }
  if (filters.location?.length && !filters.location.includes(u.location)) return false;
  if (filters.occupancyStatus === "vacant" && u.occupied_yn) return false;
  if (filters.occupancyStatus === "occupied" && !u.occupied_yn) return false;
  if (filters.vacancyDuration) {
    const { operator, days } = filters.vacancyDuration as { operator: string; days: number };
    if (!cmp(Number(u.days_vacant) || 0, operator, days)) return false;
  }
  const trigger = rule.trigger || {};
  // days_vacant in the `conditions` array format is evaluated at the group
  // level as an average (see evalGroupCondition), so we do NOT re-filter
  // individual units — the intent is "apply to all units in the group when
  // the average vacancy exceeds the threshold".
  // Only apply per-unit days_vacant filtering for the legacy singular
  // `condition` format, where the intent is to target individually-vacant units.
  if (trigger.type === "condition" && !Array.isArray(trigger.conditions)) {
    const condList = trigger.condition?.field ? [trigger.condition] : [];
    const dvConds = condList.filter((c: any) => c?.field === "days_vacant");
    if (dvConds.length) {
      const op = (trigger.conditionOperator || "AND").toUpperCase();
      const dv = Number(u.days_vacant) || 0;
      const results = dvConds.map((c: any) => cmp(dv, c.operator, Number(c.value)));
      if (op === "OR") {
        const hasOtherConds = condList.length > dvConds.length;
        if (!hasOtherConds && !results.some(Boolean)) return false;
      } else if (!results.every(Boolean)) return false;
    }
  }
  if (trigger.type === "condition" && !Array.isArray(trigger.conditions) && !trigger.condition?.field) {
    const conds = trigger.conditions || {};
    if (conds.occupancyStatus === "vacant" && u.occupied_yn) return false;
    if (conds.occupancyStatus === "occupied" && !u.occupied_yn) return false;
    if (conds.vacancyDuration && u.days_vacant != null) {
      const { operator, days } = conds.vacancyDuration;
      if (!cmp(Number(u.days_vacant), operator, days)) return false;
    }
    if (conds.serviceLine) {
      // Family matching: an AL trigger also covers AL/MC units; HC covers HC/MC.
      const tsl = conds.serviceLine as string;
      const tFamily = tsl === 'AL' ? ['AL', 'AL/MC'] : tsl === 'HC' ? ['HC', 'HC/MC'] : [tsl];
      if (!tFamily.includes(u.service_line ?? '')) return false;
    }
  }
  return true;
}

function toMonthlyRate(raw: number, sl: string | null): number {
  return DAILY_SLS.has(sl || "") ? raw * DAYS_PER_MONTH : raw;
}

/** Rule's effective service-line scope (rule columns win over stale action filters). */
export function effectiveServiceLines(rule: any): string[] {
  if (Array.isArray(rule.serviceLines) && rule.serviceLines.length) return rule.serviceLines;
  if (rule.serviceLine) return [rule.serviceLine];
  const f = rule.action?.filters?.serviceLine;
  return Array.isArray(f) && f.length ? f : [];
}

/**
 * Specificity score for a rule — used to break ties during unit-level dedup
 * so targeted rules always claim their units before broad portfolio rules.
 *
 *   +4  campus-specific (locationId set)
 *   +2  service-line-specific (at least one SL scoped)
 *   +1  room-type-specific (action.filters.roomType non-empty)
 *
 * A rule with all three (e.g. "VIL Studio at Campus A") scores 7 and wins
 * over a portfolio-wide, all-SL, all-room-type blanket rule that scores 0.
 */
export function ruleSpecificityScore(rule: any): number {
  let score = 0;
  if (rule.locationId) score += 4;
  const sls = effectiveServiceLines(rule);
  if (sls.length > 0) score += 2;
  const rt = rule.action?.filters?.roomType;
  if (Array.isArray(rt) && rt.length > 0) score += 1;
  return score;
}

/**
 * Ordering used for unit-level overlap dedup: whichever rule comes first claims
 * a contested unit. Specificity DESC → explicit priority DESC → effectiveDate
 * DESC → createdAt DESC, mirroring the live pricing engine.
 *
 * Exported so every caller that needs the deduped view sorts identically. The
 * rules list and the Rule Designer preview must agree on this order or the
 * preview will quote a different affected-unit count than the saved rule shows.
 */
export function compareRuleDedupOrder(a: any, b: any): number {
  const specDiff = ruleSpecificityScore(b) - ruleSpecificityScore(a);
  if (specDiff !== 0) return specDiff;
  const priDiff = (b.priority ?? 0) - (a.priority ?? 0);
  if (priDiff !== 0) return priDiff;
  const da = a.effectiveDate ? new Date(a.effectiveDate).toISOString() : '';
  const db = b.effectiveDate ? new Date(b.effectiveDate).toISOString() : '';
  if (da !== db) return db.localeCompare(da);
  const ca = a.createdAt ? new Date(a.createdAt).toISOString() : '';
  const cb = b.createdAt ? new Date(b.createdAt).toISOString() : '';
  return cb.localeCompare(ca);
}

/** A rule is eligible for the dedup walk only if it can actually move a rate. */
export function isDedupEligibleRule(r: any): boolean {
  return !!r?.isActive && r?.isHistorical !== true && !!r?.action?.adjustmentValue;
}

/**
 * Net impact of a rule that does not exist yet, as it WILL be reported once
 * saved.
 *
 * The Rule Designer preview cannot just call computeQualifiedRuleImpact: the
 * rules list reports every rule net of overlap dedup, where more-specific rules
 * claim contested units first. A prospective rule previewed in isolation
 * therefore quotes its gross population and then appears to collapse the moment
 * it is saved. Replaying the same ordered claim walk with the prospective rule
 * inserted at its real position makes the two numbers agree.
 *
 * Returns both the net result and the gross (standalone) result, so callers can
 * explain a shortfall as "claimed by higher-precedence rules" rather than
 * showing an unexplained drop.
 */
export function computeProspectiveRuleImpact(
  ctx: RuleImpactContext,
  prospective: any,
  existingRules: any[],
  scope?: { locationId?: string | null; serviceLine?: string | null; locationIds?: string[] | null },
): { net: RuleImpactResult; gross: RuleImpactResult; claimedByOtherRules: number } {
  const gross = computeQualifiedRuleImpact(ctx, prospective, scope);

  const PROSPECTIVE = "__prospective__";
  const ordered = [
    ...existingRules.filter(r => isDedupEligibleRule(r) && r.id !== PROSPECTIVE),
    { ...prospective, id: PROSPECTIVE },
  ].sort(compareRuleDedupOrder);

  const claimedUnitIds = new Set<string>();
  let net: RuleImpactResult | null = null;
  for (const rule of ordered) {
    const impact = computeQualifiedRuleImpact(ctx, rule, scope, claimedUnitIds);
    if (rule.id === PROSPECTIVE) net = impact;
    for (const id of Array.from(impact.qualifiedUnitIds)) claimedUnitIds.add(id);
    // Everything after the prospective rule is irrelevant to its own number.
    if (rule.id === PROSPECTIVE) break;
  }

  const resolved = net ?? gross;
  return {
    net: resolved,
    gross,
    claimedByOtherRules: Math.max(0, gross.affectedUnits - resolved.affectedUnits),
  };
}
/**
 * Compute the qualified units + move-ins-based revenue impact for one rule.
 * `scope` optionally narrows to a page-level campus/service-line filter.
 */
export function computeQualifiedRuleImpact(
  ctx: RuleImpactContext,
  rule: any,
  scope?: { locationId?: string | null; serviceLine?: string | null; locationIds?: string[] | null },
  excludeUnitIds?: Set<string>,
): RuleImpactResult {
  const action = rule.action || {};
  const adjustmentType: string = action.adjustmentType || "percentage";
  const adjustmentValue: number = Number(action.adjustmentValue ?? 0);
  const useCareRate = action.target === "care_rate";
  const useInHouseRate = action.target === "in_house_rate";
  const slScope = effectiveServiceLines(rule);

  const perCampus = new Map<string, RuleCampusImpact>();
  const perServiceLine = new Map<string, RuleServiceLineImpact>();
  const qualifiedUnitIds = new Set<string>();
  let affectedUnits = 0;
  let rateSum = 0;
  let moveInsTotal = 0;
  let monthlyImpact = 0;
  let deltaWeighted = 0;
  let overlapExcludedUnits = 0;

  for (const [gKey, groupUnits] of Array.from(ctx.groups.entries())) {
    const [locId, sl, rt] = gKey.split("|");
    // Family matching: AL-scoped rules also cover AL/MC groups; HC-scoped rules also cover HC/MC.
    const slFamily: string[] = sl === 'AL/MC' ? ['AL', 'AL/MC'] : sl === 'HC/MC' ? ['HC', 'HC/MC'] : [sl];
    if (slScope.length && !slScope.some(s => slFamily.includes(s))) continue;
    if (scope?.serviceLine && sl !== scope.serviceLine) continue;
    if ((scope?.locationId || rule.locationId) && locId !== (scope?.locationId || rule.locationId)) continue;
    if (scope?.locationIds && !scope.locationIds.includes(locId)) continue; // empty list = match nothing
    if (!groupPassesTrigger(ctx, rule, locId, sl, rt)) continue;

    const passing = groupUnits.filter(u => unitPasses(rule, u, ctx.rtgReverse) && !isBBedRow(sl, u.room_number));
    const qualified = excludeUnitIds ? passing.filter(u => !excludeUnitIds.has(u.id)) : passing;
    overlapExcludedUnits += passing.length - qualified.length;
    if (!qualified.length) continue;

    const locationName = qualified[0].location || "Unknown";
    // In-house rules reprice CURRENT residents, so only occupied units count
    // and the impact is direct (occupied units × Δrate), not move-in based.
    const impactUnits = useInHouseRate ? qualified.filter(u => u.occupied_yn) : qualified;
    if (useInHouseRate && !impactUnits.length) continue;
    // Exclude B-bed companion rows for SH SLs when computing the street-rate
    // baseline so the average reflects primary (single-occupant) units only.
    const rateBaseUnits = (!useCareRate && !useInHouseRate)
      ? impactUnits.filter(u => !isBBedRow(sl, u.room_number))
      : impactUnits;
    const rates = rateBaseUnits
      .map(u => toMonthlyRate(Number(
        useCareRate ? u.care_rate : useInHouseRate ? u.in_house_rate : u.street_rate) || 0, sl))
      .filter(r => r > 0);
    const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    // Fixed-dollar deltas on in-house rules must be monthly-normalized for
    // daily-rate service lines (HC/HC-MC) since avgRate is already monthly.
    const delta = adjustmentType === "percentage"
      ? avgRate * (adjustmentValue / 100)
      : (useInHouseRate ? toMonthlyRate(adjustmentValue, sl) : adjustmentValue);
    // Move-ins = qualified units × portfolio move-in rate for the service line
    // (T3 move-ins / month / active unit). Per-group raw counts over-count.
    const moveIns = useInHouseRate ? 0 : qualified.length * (ctx.slMoveInRate.get(sl) ?? 0);
    const gMonthly = useInHouseRate ? impactUnits.length * delta : moveIns * delta;

    affectedUnits += impactUnits.length;
    rateSum += avgRate * impactUnits.length;
    moveInsTotal += moveIns;
    monthlyImpact += gMonthly;
    deltaWeighted += delta * (useInHouseRate ? impactUnits.length : moveIns);
    for (const u of impactUnits) qualifiedUnitIds.add(u.id);

    const key = locId || locationName;
    const c = perCampus.get(key) || {
      locationId: locId || null, campusName: locationName,
      unitCount: 0, avgRate: 0, moveInsPerMonth: 0, monthlyImpact: 0, annualImpact: 0,
    };
    // avgRate as running weighted mean
    c.avgRate = (c.avgRate * c.unitCount + avgRate * impactUnits.length) / ((c.unitCount + impactUnits.length) || 1);
    c.unitCount += impactUnits.length;
    c.moveInsPerMonth += moveIns;
    c.monthlyImpact += gMonthly;
    perCampus.set(key, c);

    const s = perServiceLine.get(sl) || {
      serviceLine: sl, unitCount: 0, moveInsPerMonth: 0, monthlyImpact: 0, annualImpact: 0,
    };
    s.unitCount += impactUnits.length;
    s.moveInsPerMonth += moveIns;
    s.monthlyImpact += gMonthly;
    perServiceLine.set(sl, s);
  }

  // Annualization multipliers.
  // In-house rules reprice current residents immediately (fully ramped from
  // day one): first-year and steady-state are both monthly × 12.
  // Street/care rules apply only to NEW move-ins, so cohorts stack: month-1
  // move-ins pay the delta for 12 months, month-2 for 11, ... (Σ = 78 months
  // of delta in year one). Once fully ramped, 12 cohorts each pay the delta
  // for a full year: monthly × 144.
  const firstYearMult = useInHouseRate ? 12 : 78;
  const steadyMult = useInHouseRate ? 12 : 144;

  const campuses = Array.from(perCampus.values()).map(c => ({
    ...c,
    avgRate: Math.round(c.avgRate),
    moveInsPerMonth: Math.round(c.moveInsPerMonth * 10) / 10,
    monthlyImpact: Math.round(c.monthlyImpact),
    annualImpact: Math.round(c.monthlyImpact * firstYearMult),
  })).sort((a, b) => Math.abs(b.monthlyImpact) - Math.abs(a.monthlyImpact));

  const serviceLines = Array.from(perServiceLine.values()).map(s => ({
    ...s,
    moveInsPerMonth: Math.round(s.moveInsPerMonth * 10) / 10,
    monthlyImpact: Math.round(s.monthlyImpact),
    annualImpact: Math.round(s.monthlyImpact * firstYearMult),
  })).sort((a, b) => b.unitCount - a.unitCount);

  return {
    affectedUnits,
    affectedCampuses: campuses.length,
    moveInsPerMonth: Math.round(moveInsTotal * 10) / 10,
    avgStreetRate: affectedUnits ? Math.round(rateSum / affectedUnits) : 0,
    avgRateChange: useInHouseRate
      ? (affectedUnits ? Math.round((deltaWeighted / affectedUnits) * 100) / 100 : 0)
      : (moveInsTotal ? Math.round((deltaWeighted / moveInsTotal) * 100) / 100 : 0),
    monthlyImpact: Math.round(monthlyImpact),
    annualImpact: Math.round(monthlyImpact * firstYearMult),
    steadyStateAnnualImpact: Math.round(monthlyImpact * steadyMult),
    perCampus: campuses,
    perServiceLine: serviceLines,
    qualifiedUnitIds,
    overlapExcludedUnits,
  };
}

// ---------------------------------------------------------------------------
// Shared rule-preview pipeline
// ---------------------------------------------------------------------------
// Both the grouped /api/reference-data endpoint and /api/reference-data/units
// need to compute "which rate would each active rule produce for each
// campus/SL/room-type group?"  This shared helper centralises:
//   • trigger condition evaluation (occupancy thresholds, ih_street_variance)
//   • action filter matching (room type, service line, occupancy status)
//   • adjusted-rate arithmetic
// so any future change to trigger semantics only needs to be made here.
// ---------------------------------------------------------------------------

export interface ActiveRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  action: any;
  trigger: any;
  location_id: string | null;
  service_line: string | null;
  /** Multi-SL targeting: when non-empty, the rule covers exactly these service lines. */
  service_lines: string[] | null;
  effective_date: string | null;
  notes: string | null;
}

/** Specificity score for an ActiveRule (snake_case fields). Mirrors ruleSpecificityScore. */
function activeRuleSpecificityScore(r: ActiveRule): number {
  let score = 0;
  if (r.location_id) score += 4;
  const hasSL = (Array.isArray(r.service_lines) && r.service_lines.length > 0) || !!r.service_line;
  if (hasSL) score += 2;
  const rt = (r.action as any)?.filters?.roomType;
  if (Array.isArray(rt) && rt.length > 0) score += 1;
  return score;
}

/** Fetch all active adjustment rules for a client ordered by priority DESC. */
export async function fetchActiveRules(clientId: string): Promise<ActiveRule[]> {
  const res = await pool.query(
    `SELECT id, name, description, priority, action, trigger, location_id, service_line,
            service_lines, effective_date, notes
     FROM adjustment_rules
     WHERE is_active = true
       AND (location_id IS NULL OR location_id IN (
         SELECT id FROM locations WHERE client_id = $1
       ))
     ORDER BY priority DESC NULLS LAST, created_at ASC`,
    [clientId],
  );
  return res.rows as ActiveRule[];
}

export interface GroupRateInput {
  campus: string;
  sl: string;
  rt: string;
  /**
   * Canonical (pre-grouping) room type from `rent_roll_data.room_type`.
   * When `room_type_groupings` renames a room type (e.g. "Studio" →
   * "Legacy Lane - Studio"), `rt` holds the branded display name while
   * `sourceRt` holds the original canonical name.  Rule `filters.roomType`
   * values are always canonical, so the filter check must test both so
   * that a rule scoped to "Studio" still matches a branded group.
   */
  sourceRt?: string;
  locationId: string | null;
  /**
   * Mode street rate for the group — mirrors mode() WITHIN GROUP from the
   * grouped endpoint's SQL so both endpoints use the same base for preview rates.
   */
  groupStreetRate: number;
  /** Average in-house rate across the group (used when rule targets care_rate). */
  avgIhRate: number;
  total: number;
  occ: number;
}

export interface RulePreviewResult {
  /**
   * campus||sl||rt → adjusted rate from the first (highest-priority) matching
   * active rule.  Used by the units endpoint as a proposed-rate fallback.
   */
  rulePreviewMap: Map<string, number>;
  /**
   * campus||sl||rt||ruleId → adjusted rate for *every* matching active rule.
   * Used by the grouped endpoint to populate per-rule rate columns.
   */
  ruleRatesMap: Map<string, number>;
}

/**
 * Evaluate trigger conditions and compute adjusted rates for every active rule
 * across the provided groups, using the supplied occupancy / IH-variance maps.
 *
 * Both the grouped reference-data endpoint and the units detail endpoint call
 * this function with their respective pre-built occupancy maps so the trigger
 * semantics are identical.
 *
 * @param groups   One entry per (campus, SL, RT) combination to evaluate.
 * @param rules    Active rules ordered priority DESC (from fetchActiveRules).
 * @param campOcc  campus → occupancy fraction 0–1 (authoritative source).
 * @param slOcc    campus||sl → occupancy fraction 0–1.
 * @param ihVar    campus||sl → IH-to-street variance % (may be negative).
 */
export function buildGroupRulePreviewRates(
  groups: GroupRateInput[],
  rules: ActiveRule[],
  campOcc: Map<string, number>,
  slOcc: Map<string, number>,
  ihVar: Map<string, number>,
  /** Optional: `${campus}||${sl}` → street-to-comp variance % from campus_metrics.
   *  When provided, street_to_comp_var trigger conditions are evaluated precisely;
   *  when absent the condition is treated as passing (don't block display). */
  compVarMap?: Map<string, number>,
  /** Optional: campus-name-keyed trailing occupancy averages.
   *  Keys: `${campus}|${sl}|${normRt}|trailing${N}` (RT), `${campus}|${sl}||trailing${N}` (SL),
   *  `${campus}|||trailing${N}` (campus).  When provided, trailing conditions are
   *  evaluated precisely; when absent the condition is treated as passing. */
  trailingOccMap?: Map<string, number>,
): RulePreviewResult {
  const rulePreviewMap = new Map<string, number>();
  const ruleRatesMap   = new Map<string, number>();

  const OCC_GROUP_FIELDS = new Set([
    'occupancy', 'campus_occupancy', 'service_line_occupancy', 'room_type_occupancy',
    'room_type_occupancy_trailing3', 'room_type_occupancy_trailing6', 'room_type_occupancy_trailing12',
    'service_line_occupancy_trailing3', 'service_line_occupancy_trailing6', 'service_line_occupancy_trailing12',
    'occupancy_trailing3', 'occupancy_trailing6', 'occupancy_trailing12',
  ]);

  /** Evaluate one metric-based condition against the pre-built occupancy maps.
   *  rtOccPct is the group's own room-type occupancy percentage (0–100).
   *  rt is the room type string for RT-specific compVar lookups. */
  const evalCond = (
    c: { field: string; operator: string; value: number },
    campus: string,
    sl: string,
    rtOccPct: number | null,
    rt?: string,
  ): boolean => {
    // Normalise fraction-stored occupancy thresholds to percentage (mirrors evalGroupCondition).
    let value = Number(c.value);
    if (OCC_GROUP_FIELDS.has(c.field) && Math.abs(value) <= 1) value = value * 100;
    // Same normalisation for IH-to-street variance. Legacy rules stored this
    // threshold as a fraction (0.1 = 10%) while the metric is on the 0–100 %
    // scale. evaluateSingleCondition and evalGroupCondition both correct for
    // this; without it here the Reference Data preview would fire a legacy rule
    // at >0.1% while the pricing engine required >10%.
    if ((c.field === 'ih_street_variance' || c.field === 'street_to_ih_var')
        && Math.abs(value) <= 1 && value !== 0) value = value * 100;

    let metricVal: number | null = null;
    if (c.field === 'service_line_occupancy') {
      metricVal = slOcc.get(`${campus}||${sl}`) ?? null;
    } else if (c.field === 'occupancy' || c.field === 'campus_occupancy') {
      metricVal = campOcc.get(campus) ?? null;
    } else if (c.field === 'ih_street_variance' || c.field === 'street_to_ih_var') {
      metricVal = ihVar.get(`${campus}||${sl}`) ?? null;
    } else if (c.field === 'room_type_occupancy') {
      metricVal = rtOccPct;
    } else if (
      c.field === 'room_type_occupancy_trailing3' || c.field === 'room_type_occupancy_trailing6' || c.field === 'room_type_occupancy_trailing12' ||
      c.field === 'service_line_occupancy_trailing3' || c.field === 'service_line_occupancy_trailing6' || c.field === 'service_line_occupancy_trailing12' ||
      c.field === 'occupancy_trailing3' || c.field === 'occupancy_trailing6' || c.field === 'occupancy_trailing12'
    ) {
      if (!trailingOccMap) return true; // map not provided — don't block display
      const win = c.field.endsWith('12') ? 12 : c.field.endsWith('6') ? 6 : 3;
      const normRt = rt ? normalizeRoomType(rt) : null;
      if (c.field.startsWith('room_type_occupancy_trailing')) {
        // RT-level → SL-level → campus-level fallback; null history → don't block
        metricVal = (normRt ? trailingOccMap.get(`${campus}|${sl}|${normRt}|trailing${win}`) : undefined)
                 ?? trailingOccMap.get(`${campus}|${sl}||trailing${win}`)
                 ?? trailingOccMap.get(`${campus}|||trailing${win}`)
                 ?? null;
      } else if (c.field.startsWith('service_line_occupancy_trailing')) {
        metricVal = trailingOccMap.get(`${campus}|${sl}||trailing${win}`)
                 ?? trailingOccMap.get(`${campus}|||trailing${win}`)
                 ?? null;
      } else {
        // campus-level trailing
        metricVal = trailingOccMap.get(`${campus}|||trailing${win}`) ?? null;
      }
      if (metricVal === null) return true; // no history for this scope — don't block display
    } else if (c.field === 'street_to_comp_var' || c.field === 'competitor_variance' || c.field === 'competitor_rate') {
      if (!compVarMap) return true; // map not provided — don't block display
      // Try room-type-specific key first (campus||sl||rt), then SL-level fallback.
      metricVal = (rt ? compVarMap.get(`${campus}||${sl}||${rt}`) : undefined)
                  ?? compVarMap.get(`${campus}||${sl}`)
                  ?? null;
      if (metricVal === null) return true; // no data for this scope — don't block
    } else {
      // Metric not computable from aggregated group data — don't block display
      return true;
    }
    if (metricVal === null) return false;
    return c.operator === '>='  ? metricVal >= value
         : c.operator === '>'   ? metricVal >  value
         : c.operator === '<='  ? metricVal <= value
         : c.operator === '<'   ? metricVal <  value
         : Math.abs(metricVal - value) < 0.001;
  };

  /** Does a rule's trigger condition pass for this campus/SL/RT group? */
  const passesTrigger = (rule: ActiveRule, campus: string, sl: string, rtOccPct: number | null, rt?: string): boolean => {
    const trig = rule.trigger as any;
    if (!trig || trig.type !== 'condition') return true;
    const conds: Array<{ field: string; operator: string; value: number }> =
      Array.isArray(trig.conditions) && trig.conditions.length
        ? trig.conditions
        : (trig.condition?.field ? [trig.condition] : []);
    if (!conds.length) return true;
    const op = String(trig.conditionOperator || 'AND').toUpperCase();
    return op === 'OR'
      ? conds.some(c => evalCond(c, campus, sl, rtOccPct, rt))
      : conds.every(c => evalCond(c, campus, sl, rtOccPct, rt));
  };

  // Sort rules by specificity DESC → priority DESC → effectiveDate DESC, then createdAt ASC.
  // This mirrors the engine's applyAdjustmentRulesToUnit sort so that for each group the
  // most-specific qualifying rule is selected first (targeted over blanket).
  const sortedRules = [...rules].sort((a, b) => {
    const specDiff = activeRuleSpecificityScore(b) - activeRuleSpecificityScore(a);
    if (specDiff !== 0) return specDiff;
    const priDiff = (b.priority || 0) - (a.priority || 0);
    if (priDiff !== 0) return priDiff;
    const dateA = String(a.effective_date ?? '');
    const dateB = String(b.effective_date ?? '');
    return dateB.localeCompare(dateA);
  });

  for (const g of groups) {
    const gKey = `${g.campus}||${g.sl}||${g.rt}`;

    // Collect all qualifying rules for this group, tracking whether any is targeted.
    // This allows a single pass to build ruleRatesMap (all qualifying rules) while
    // also computing the preview rate with the same targeted-over-blanket suppression
    // semantics as the live engine (Pass 3 of applyAdjustmentRulesToUnit).
    let hasTargetedQualifying = false;
    const qualifyingForGroup: Array<{ rule: ActiveRule; adjRate: number }> = [];

    for (const rule of sortedRules) {
      const action       = (rule.action as any) || {};
      if (action.target === 'in_house_rate') continue;
      const filters      = action.filters || {};
      const usesCareRate = action.target === 'care_rate';
      const baseRate     = usesCareRate ? g.avgIhRate : g.groupStreetRate;
      if (!baseRate) continue;

      // ── Scope: top-level location/SL ──
      if (rule.location_id && g.locationId !== rule.location_id) continue;
      // Support both singular service_line and array service_lines
      const slScope: string[] | null =
        Array.isArray(rule.service_lines) && rule.service_lines.length ? rule.service_lines
        : rule.service_line ? [rule.service_line]
        : null;
      // Family matching: AL-scoped rules also cover AL/MC groups; HC-scoped rules also cover HC/MC.
      if (slScope) {
        const gSlFamily: string[] = g.sl === 'AL/MC' ? ['AL', 'AL/MC'] : g.sl === 'HC/MC' ? ['HC', 'HC/MC'] : [g.sl];
        if (!slScope.some(s => gSlFamily.includes(s))) continue;
      }

      // ── Action filters ──
      // Compare against both the display room type (g.rt, which may be a branded
      // group_name like "Legacy Lane - Studio") AND the canonical source room type
      // (g.sourceRt, which is rr.room_type = "Studio").  Rules always store canonical
      // names in filters.roomType, so without the sourceRt fallback a rule scoped to
      // "Studio" would silently miss every group that has been renamed by RTG.
      if (filters.roomType?.length && !filters.roomType.includes(g.rt) && !filters.roomType.includes(g.sourceRt ?? '')) continue;
      if (filters.serviceLine?.length) {
        // Family matching: AL in filters also covers AL/MC groups; HC covers HC/MC.
        const gSlFamily: string[] = g.sl === 'AL/MC' ? ['AL', 'AL/MC'] : g.sl === 'HC/MC' ? ['HC', 'HC/MC'] : [g.sl];
        if (!(filters.serviceLine as string[]).some((s: string) => gSlFamily.includes(s))) continue;
      }
      if (filters.location?.length    && !filters.location.includes(g.campus)) continue;
      if (filters.occupancyStatus === 'vacant'   && g.occ >= g.total) continue;
      if (filters.occupancyStatus === 'occupied' && g.occ === 0)      continue;

      // ── Trigger conditions ──
      const rtOccPct = g.total > 0 ? (g.occ / g.total) * 100 : null;
      if (!passesTrigger(rule, g.campus, g.sl, rtOccPct, g.rt)) continue;

      // ── Compute adjusted rate ──
      const adjustmentType: string  = action.adjustmentType  || 'percentage';
      const adjustmentValue: number = Number(action.adjustmentValue ?? 0);
      const adjRate = adjustmentType === 'percentage'
        ? baseRate * (1 + adjustmentValue / 100)
        : baseRate + adjustmentValue;

      ruleRatesMap.set(`${gKey}||${rule.id}`, adjRate);
      qualifyingForGroup.push({ rule, adjRate });
      if (activeRuleSpecificityScore(rule) > 0) hasTargetedQualifying = true;
    }

    // ── Apply most-specific-wins suppression (mirrors engine Pass 3) ──
    // Each unit/group is governed by exactly one specificity level: the highest among
    // all qualifying rules.  Lower-specificity rules are suppressed — a campus+SL+RT
    // rule (spec 7) wins over campus+SL (spec 6) wins over SL-only (spec 2) wins over
    // blanket (spec 0).  Within the same level, qualifying rules still stack.
    const maxQualifyingSpec = qualifyingForGroup.reduce(
      (m, { rule }) => Math.max(m, activeRuleSpecificityScore(rule)), 0
    );
    const effectiveForPreview = qualifyingForGroup.filter(
      ({ rule }) => activeRuleSpecificityScore(rule) === maxQualifyingSpec
    );

    if (effectiveForPreview.length > 0 && !rulePreviewMap.has(gKey)) {
      rulePreviewMap.set(gKey, effectiveForPreview[0].adjRate);
    }
  }

  return { rulePreviewMap, ruleRatesMap };
}

/**
 * Pure aggregation helper — converts raw `room_type_occupancy_history` rows
 * (already fetched from the DB) into a campus-name-keyed trailing occupancy
 * map.  Exported for testability; callers that have DB access use
 * `buildPreviewTrailingOccMap` which wraps this.
 *
 * Key format:
 *   `${locationName}|${sl}|${normRt}|trailing${N}` (RT-level)
 *   `${locationName}|${sl}||trailing${N}`           (SL-level)
 *   `${locationName}|||trailing${N}`                (campus-level)
 *
 * Composite service lines ("AL, MC") are tokenised so each SL token gets its
 * own history entry, matching the convention used by the execution and impact
 * paths.
 */
export function aggregatePreviewTrailingOccRows(rows: Array<{
  location_name: string; service_line: string; normalized_room_type: string;
  year: number; month: number; occ_units: number | null;
  available_units: number | null; occ_percent: number | null;
}>): Map<string, number> {
  const map = new Map<string, number>();
  if (!rows.length) return map;

  const WINDOWS = [3, 6, 12] as const;
  type HRow = typeof rows[0];

  const windowAvg = (rowsIn: HRow[], w: number): number | null => {
    // Rows must be ordered recency-first; take up to W distinct months.
    const seen = new Set<string>();
    const slice: HRow[] = [];
    for (const r of rowsIn) {
      const mk = `${r.year}-${String(r.month).padStart(2, '0')}`;
      if (!seen.has(mk)) { seen.add(mk); if (seen.size > w) break; }
      if (seen.size <= w) slice.push(r);
    }
    const avlSum = slice.reduce((s, r) => s + (r.available_units ?? 0), 0);
    if (avlSum > 0) return slice.reduce((s, r) => s + (r.occ_units ?? 0), 0) / avlSum * 100;
    const pctRows = slice.filter(r => r.occ_percent !== null);
    return pctRows.length ? pctRows.reduce((s, r) => s + (r.occ_percent ?? 0), 0) / pctRows.length : null;
  };

  // RT-level grouping — composite SLs tokenised so each token has its own entry
  const byRt = new Map<string, HRow[]>();
  for (const r of rows) {
    const slTokens = String(r.service_line || '').split(',').map(t => t.trim()).filter(Boolean);
    for (const sl of slTokens) {
      const k = `${r.location_name}|${sl}|${r.normalized_room_type}`;
      if (!byRt.has(k)) byRt.set(k, []);
      byRt.get(k)!.push(r);
    }
  }
  byRt.forEach((rtRows, k) => {
    const [locName, sl, normRt] = k.split('|');
    for (const w of WINDOWS) {
      const avg = windowAvg(rtRows, w);
      if (avg !== null) map.set(`${locName}|${sl}|${normRt}|trailing${w}`, avg);
    }
  });

  // SL-level: aggregate across RTs per month, then rolling window — tokenised
  const bySl = new Map<string, Map<string, HRow[]>>(); // locName|sl → monthKey → rows
  for (const r of rows) {
    const mk = `${r.year}-${String(r.month).padStart(2, '0')}`;
    const slTokens = String(r.service_line || '').split(',').map(t => t.trim()).filter(Boolean);
    for (const sl of slTokens) {
      const slKey = `${r.location_name}|${sl}`;
      if (!bySl.has(slKey)) bySl.set(slKey, new Map());
      if (!bySl.get(slKey)!.has(mk)) bySl.get(slKey)!.set(mk, []);
      bySl.get(slKey)!.get(mk)!.push(r);
    }
  }
  bySl.forEach((monthMap, slKey) => {
    const [locName, sl] = slKey.split('|');
    const sortedMonths = Array.from(monthMap.keys()).sort((a: string, b: string) => b.localeCompare(a));
    for (const w of WINDOWS) {
      const topMonths = sortedMonths.slice(0, w);
      let occSum = 0, avlSum = 0, pctSum = 0, pctN = 0;
      for (const mk of topMonths) {
        for (const r of monthMap.get(mk)!) {
          occSum += r.occ_units ?? 0; avlSum += r.available_units ?? 0;
          if (r.occ_percent !== null) { pctSum += r.occ_percent; pctN++; }
        }
      }
      const avg = avlSum > 0 ? (occSum / avlSum) * 100 : (pctN > 0 ? pctSum / pctN : null);
      if (avg !== null) map.set(`${locName}|${sl}||trailing${w}`, avg);
    }
  });

  // Campus-level: aggregate across all SLs per month (no tokenization needed)
  const byCampus = new Map<string, Map<string, HRow[]>>(); // locName → monthKey → rows
  for (const r of rows) {
    if (!byCampus.has(r.location_name)) byCampus.set(r.location_name, new Map());
    const mk = `${r.year}-${String(r.month).padStart(2, '0')}`;
    if (!byCampus.get(r.location_name)!.has(mk)) byCampus.get(r.location_name)!.set(mk, []);
    byCampus.get(r.location_name)!.get(mk)!.push(r);
  }
  byCampus.forEach((monthMap, locName) => {
    const sortedMonths = Array.from(monthMap.keys()).sort((a: string, b: string) => b.localeCompare(a));
    for (const w of WINDOWS) {
      const topMonths = sortedMonths.slice(0, w);
      let occSum = 0, avlSum = 0, pctSum = 0, pctN = 0;
      for (const mk of topMonths) {
        for (const r of monthMap.get(mk)!) {
          occSum += r.occ_units ?? 0; avlSum += r.available_units ?? 0;
          if (r.occ_percent !== null) { pctSum += r.occ_percent; pctN++; }
        }
      }
      const avg = avlSum > 0 ? (occSum / avlSum) * 100 : (pctN > 0 ? pctSum / pctN : null);
      if (avg !== null) map.set(`${locName}|||trailing${w}`, avg);
    }
  });

  return map;
}

/**
 * Build a campus-name-keyed trailing occupancy map for use in
 * buildGroupRulePreviewRates.  Queries room_type_occupancy_history for the
 * given client and returns the map from `aggregatePreviewTrailingOccRows`.
 * The map is empty when history is unavailable.
 */
export async function buildPreviewTrailingOccMap(clientId: string): Promise<Map<string, number>> {
  try {
    const res = await pool.query<{
      location_name: string; service_line: string; normalized_room_type: string;
      year: number; month: number; occ_units: number | null;
      available_units: number | null; occ_percent: number | null;
    }>(
      `SELECT location_name, service_line, normalized_room_type,
              year, month, occ_units, available_units, occ_percent
       FROM room_type_occupancy_history
       WHERE client_id = $1
       ORDER BY location_name, service_line, normalized_room_type, year DESC, month DESC`,
      [clientId],
    );
    return aggregatePreviewTrailingOccRows(res.rows);
  } catch (err) {
    console.warn('[ruleImpact] buildPreviewTrailingOccMap failed:', err);
  }
  return new Map<string, number>();
}
