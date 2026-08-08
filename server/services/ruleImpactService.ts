import { pool } from "../db";

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
const DAYS_PER_MONTH = 30.4;

export interface UnitRow {
  id: string;
  location_id: string | null;
  location: string | null;
  service_line: string | null;
  room_type: string | null;
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
}

export interface RuleImpactContext {
  clientId: string;
  latestMonth: string;
  units: UnitRow[];
  groups: Map<string, UnitRow[]>;            // `${locId}|${sl}|${rt}`
  metrics: Map<string, GroupAgg>;            // `${locId}`, `${locId}|${sl}`, `${locId}|${sl}|${rt}`
  moveMap: Map<string, number>;              // `${locationName}||${sl}||${rt}` -> t3 move-ins / month
  slMoveInRate: Map<string, number>;         // service line -> t3 move-ins / month / active unit
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

export interface RuleImpactResult {
  affectedUnits: number;
  affectedCampuses: number;
  moveInsPerMonth: number;
  avgStreetRate: number;           // weighted avg monthly rate across qualified units
  avgRateChange: number;           // move-in-weighted avg $ change per unit per month
  monthlyImpact: number;
  annualImpact: number;
  perCampus: RuleCampusImpact[];
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
    `SELECT id, location_id, location, service_line, room_type,
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
    if (!g) { g = { total: 0, occupied: 0, stSum: 0, stN: 0, compStSum: 0, compCSum: 0, compN: 0, ihStSum: 0, ihISum: 0, ihN: 0 }; metrics.set(key, g); }
    g.total++;
    if (u.occupied_yn) g.occupied++;
    const st = Number(u.street_rate) || 0;
    const comp = Number(u.competitor_final_rate) || 0;
    if (st > 100) { g.stSum += st; g.stN++; }
    if (st > 100 && comp > 100) { g.compStSum += st; g.compCSum += comp; g.compN++; }
    // IH-to-street variance inputs: occupied single-occupant units with both
    // rates present (mirrors the ih-street-variance recalculate endpoint:
    // SH excludes Companion rooms; HC counts private-pay only). HC daily
    // rates are converted to monthly so campus-level blending is consistent.
    const ih = Number(u.in_house_rate) || 0;
    const sl = u.service_line || "";
    const isDaily = DAILY_SLS.has(sl);
    const rateOk = isDaily ? (st > 0 && ih > 0) : (st > 100 && ih > 100);
    const singleOcc = isDaily
      ? ((u.payor_type || "").toUpperCase().includes("PRIVATE"))
      : (u.room_type !== "Companion");
    if (u.occupied_yn && rateOk && singleOcc) {
      const mult = isDaily ? DAYS_PER_MONTH : 1;
      g.ihStSum += st * mult;
      g.ihISum += ih * mult;
      g.ihN++;
    }
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

  return { clientId, latestMonth, units, groups, metrics, moveMap, slMoveInRate };
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
      if (g.compN === 0) continue; // fall back to broader scope
      const avgSt = g.compStSum / g.compN;
      const avgC = g.compCSum / g.compN;
      if (avgC <= 0) continue;
      return ((avgSt - avgC) / avgC) * 100;
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

const OCC_FIELDS = new Set(["occupancy", "campus_occupancy", "service_line_occupancy", "room_type_occupancy"]);

/** Evaluate one metric-based trigger condition at the campus/SL/RT group level. */
function evalGroupCondition(
  ctx: RuleImpactContext,
  cond: { field: string; operator: string; value: number },
  locId: string, sl: string, rt: string,
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
  // Unit-level days vacant — cannot be decided at the group level; defer to
  // the unit predicate (unitPasses evaluates days_vacant conditions per unit).
  if (field === "days_vacant") return true;
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
    return op === "OR"
      ? conds.some(c => evalGroupCondition(ctx, c, locId, sl, rt))
      : conds.every(c => evalGroupCondition(ctx, c, locId, sl, rt));
  }
  if (trigger.condition?.field) {
    return evalGroupCondition(ctx, trigger.condition, locId, sl, rt);
  }
  // Legacy object format: unit-level conditions handled by the unit predicate
  return true;
}

/** Unit-level predicate: action filters + legacy trigger unit conditions. */
function unitPasses(rule: any, u: UnitRow): boolean {
  const action = rule.action || {};
  const filters = action.filters || {};
  if (filters.roomType?.length && !filters.roomType.includes(u.room_type)) return false;
  if (filters.location?.length && !filters.location.includes(u.location)) return false;
  if (filters.occupancyStatus === "vacant" && u.occupied_yn) return false;
  if (filters.occupancyStatus === "occupied" && !u.occupied_yn) return false;
  if (filters.vacancyDuration) {
    const { operator, days } = filters.vacancyDuration as { operator: string; days: number };
    if (!cmp(Number(u.days_vacant) || 0, operator, days)) return false;
  }
  const trigger = rule.trigger || {};
  // Unit-level days_vacant trigger conditions (raw day counts) — group-level
  // evaluation deferred them here so each unit is tested individually.
  if (trigger.type === "condition") {
    const condList = Array.isArray(trigger.conditions)
      ? trigger.conditions
      : trigger.condition?.field ? [trigger.condition] : [];
    const dvConds = condList.filter((c: any) => c?.field === "days_vacant");
    if (dvConds.length) {
      const op = (trigger.conditionOperator || "AND").toUpperCase();
      const dv = Number(u.days_vacant) || 0;
      const results = dvConds.map((c: any) => cmp(dv, c.operator, Number(c.value)));
      // Under AND every days_vacant condition must hold for this unit;
      // under OR the group-level pass already satisfied the disjunction only
      // if some condition passed — keep units where at least one dv cond holds
      // OR another (non-dv) condition exists that could have passed.
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
    if (conds.serviceLine && conds.serviceLine !== u.service_line) return false;
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
  const qualifiedUnitIds = new Set<string>();
  let affectedUnits = 0;
  let rateSum = 0;
  let moveInsTotal = 0;
  let monthlyImpact = 0;
  let deltaWeighted = 0;
  let overlapExcludedUnits = 0;

  for (const [gKey, groupUnits] of Array.from(ctx.groups.entries())) {
    const [locId, sl, rt] = gKey.split("|");
    if (slScope.length && !slScope.includes(sl)) continue;
    if (scope?.serviceLine && sl !== scope.serviceLine) continue;
    if ((scope?.locationId || rule.locationId) && locId !== (scope?.locationId || rule.locationId)) continue;
    if (scope?.locationIds && !scope.locationIds.includes(locId)) continue; // empty list = match nothing
    if (!groupPassesTrigger(ctx, rule, locId, sl, rt)) continue;

    const passing = groupUnits.filter(u => unitPasses(rule, u));
    const qualified = excludeUnitIds ? passing.filter(u => !excludeUnitIds.has(u.id)) : passing;
    overlapExcludedUnits += passing.length - qualified.length;
    if (!qualified.length) continue;

    const locationName = qualified[0].location || "Unknown";
    // In-house rules reprice CURRENT residents, so only occupied units count
    // and the impact is direct (occupied units × Δrate), not move-in based.
    const impactUnits = useInHouseRate ? qualified.filter(u => u.occupied_yn) : qualified;
    if (useInHouseRate && !impactUnits.length) continue;
    const rates = impactUnits
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
  }

  const campuses = Array.from(perCampus.values()).map(c => ({
    ...c,
    avgRate: Math.round(c.avgRate),
    moveInsPerMonth: Math.round(c.moveInsPerMonth * 10) / 10,
    monthlyImpact: Math.round(c.monthlyImpact),
    annualImpact: Math.round(c.monthlyImpact * 12),
  })).sort((a, b) => Math.abs(b.monthlyImpact) - Math.abs(a.monthlyImpact));

  return {
    affectedUnits,
    affectedCampuses: campuses.length,
    moveInsPerMonth: Math.round(moveInsTotal * 10) / 10,
    avgStreetRate: affectedUnits ? Math.round(rateSum / affectedUnits) : 0,
    avgRateChange: useInHouseRate
      ? (affectedUnits ? Math.round((deltaWeighted / affectedUnits) * 100) / 100 : 0)
      : (moveInsTotal ? Math.round((deltaWeighted / moveInsTotal) * 100) / 100 : 0),
    monthlyImpact: Math.round(monthlyImpact),
    annualImpact: Math.round(monthlyImpact * 12),
    perCampus: campuses,
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
}

/** Fetch all active adjustment rules for a client ordered by priority DESC. */
export async function fetchActiveRules(clientId: string): Promise<ActiveRule[]> {
  const res = await pool.query(
    `SELECT id, name, description, priority, action, trigger, location_id, service_line
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
  locationId: string | null;
  /**
   * Mode street rate for the group — mirrors mode() WITHIN GROUP from the
   * grouped endpoint's SQL so both endpoints use the same base for preview rates.
   */
  modeStreetRate: number;
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
): RulePreviewResult {
  const rulePreviewMap = new Map<string, number>();
  const ruleRatesMap   = new Map<string, number>();

  /** Evaluate one metric-based condition against the pre-built occupancy maps. */
  const evalCond = (
    c: { field: string; operator: string; value: number },
    campus: string,
    sl: string,
  ): boolean => {
    let metricVal: number | null = null;
    if (c.field === 'service_line_occupancy') {
      metricVal = slOcc.get(`${campus}||${sl}`) ?? null;
    } else if (c.field === 'occupancy' || c.field === 'campus_occupancy') {
      metricVal = campOcc.get(campus) ?? null;
    } else if (c.field === 'ih_street_variance' || c.field === 'street_to_ih_var') {
      metricVal = ihVar.get(`${campus}||${sl}`) ?? null;
    } else {
      // Metric not computable from aggregated group data — don't block display
      return true;
    }
    if (metricVal === null) return false;
    return c.operator === '>='  ? metricVal >= c.value
         : c.operator === '>'   ? metricVal >  c.value
         : c.operator === '<='  ? metricVal <= c.value
         : c.operator === '<'   ? metricVal <  c.value
         : Math.abs(metricVal - c.value) < 0.001;
  };

  /** Does a rule's trigger condition pass for this campus/SL? */
  const passesTrigger = (rule: ActiveRule, campus: string, sl: string): boolean => {
    const trig = rule.trigger as any;
    if (!trig || trig.type !== 'condition') return true;
    const conds: Array<{ field: string; operator: string; value: number }> =
      Array.isArray(trig.conditions) && trig.conditions.length
        ? trig.conditions
        : (trig.condition?.field ? [trig.condition] : []);
    if (!conds.length) return true;
    const op = String(trig.conditionOperator || 'AND').toUpperCase();
    return op === 'OR'
      ? conds.some(c => evalCond(c, campus, sl))
      : conds.every(c => evalCond(c, campus, sl));
  };

  for (const g of groups) {
    const gKey = `${g.campus}||${g.sl}||${g.rt}`;
    for (const rule of rules) {
      const action       = (rule.action as any) || {};
      if (action.target === 'in_house_rate') continue; // resident-rate rules don't preview street rates
      const filters      = action.filters || {};
      const usesCareRate = action.target === 'care_rate';
      const baseRate     = usesCareRate ? g.avgIhRate : g.modeStreetRate;
      if (!baseRate) continue;
      // Rule top-level scope
      if (rule.location_id && g.locationId !== rule.location_id) continue;
      if (rule.service_line && g.sl !== rule.service_line)        continue;
      // Action filters
      if (filters.roomType?.length    && !filters.roomType.includes(g.rt))     continue;
      if (filters.serviceLine?.length && !filters.serviceLine.includes(g.sl))  continue;
      if (filters.location?.length    && !filters.location.includes(g.campus)) continue;
      if (filters.occupancyStatus === 'vacant'   && g.occ >= g.total) continue;
      if (filters.occupancyStatus === 'occupied' && g.occ === 0)      continue;
      // Trigger conditions
      if (!passesTrigger(rule, g.campus, g.sl)) continue;
      // Compute adjusted rate
      const adjustmentType: string  = action.adjustmentType  || 'percentage';
      const adjustmentValue: number = Number(action.adjustmentValue ?? 0);
      const adjRate = adjustmentType === 'percentage'
        ? baseRate * (1 + adjustmentValue / 100)
        : baseRate + adjustmentValue;
      ruleRatesMap.set(`${gKey}||${rule.id}`, adjRate);
      if (!rulePreviewMap.has(gKey)) {
        rulePreviewMap.set(gKey, adjRate);
      }
    }
  }

  return { rulePreviewMap, ruleRatesMap };
}
