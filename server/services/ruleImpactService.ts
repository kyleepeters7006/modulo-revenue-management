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
  occupied_yn: boolean | null;
  days_vacant: number | null;
  competitor_final_rate: number;
}

interface GroupAgg {
  total: number;
  occupied: number;
  stSum: number; stN: number;        // street rates (raw) where > 100
  compStSum: number; compCSum: number; compN: number; // paired street/comp where both > 100
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
            occupied_yn, days_vacant, competitor_final_rate::float AS competitor_final_rate
     FROM rent_roll_data
     WHERE client_id = $1 AND upload_month = $2`,
    [clientId, latestMonth],
  );
  const units = rows as UnitRow[];

  const groups = new Map<string, UnitRow[]>();
  const metrics = new Map<string, GroupAgg>();
  const bump = (key: string, u: UnitRow) => {
    let g = metrics.get(key);
    if (!g) { g = { total: 0, occupied: 0, stSum: 0, stN: 0, compStSum: 0, compCSum: 0, compN: 0 }; metrics.set(key, g); }
    g.total++;
    if (u.occupied_yn) g.occupied++;
    const st = Number(u.street_rate) || 0;
    const comp = Number(u.competitor_final_rate) || 0;
    if (st > 100) { g.stSum += st; g.stN++; }
    if (st > 100 && comp > 100) { g.compStSum += st; g.compCSum += comp; g.compN++; }
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
  // events (deduped per room + date) / 3 months / active units in the SL.
  // Per-group event counts over-count (room-type strings vary between
  // snapshots), so impact math uses this rate × qualified unit count instead.
  const slRateRes = await pool.query(`
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
  metric: "occupancy_pct" | "vacant_units" | "street_to_comp_var_pct",
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
  // Metrics we can't compute here (inquiry volume, IH variance, …) — treat as
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
  scope?: { locationId?: string | null; serviceLine?: string | null },
): RuleImpactResult {
  const action = rule.action || {};
  const adjustmentType: string = action.adjustmentType || "percentage";
  const adjustmentValue: number = Number(action.adjustmentValue ?? 0);
  const useCareRate = action.target === "care_rate";
  const slScope = effectiveServiceLines(rule);

  const perCampus = new Map<string, RuleCampusImpact>();
  const qualifiedUnitIds = new Set<string>();
  let affectedUnits = 0;
  let rateSum = 0;
  let moveInsTotal = 0;
  let monthlyImpact = 0;
  let deltaWeighted = 0;

  for (const [gKey, groupUnits] of Array.from(ctx.groups.entries())) {
    const [locId, sl, rt] = gKey.split("|");
    if (slScope.length && !slScope.includes(sl)) continue;
    if (scope?.serviceLine && sl !== scope.serviceLine) continue;
    if ((scope?.locationId || rule.locationId) && locId !== (scope?.locationId || rule.locationId)) continue;
    if (!groupPassesTrigger(ctx, rule, locId, sl, rt)) continue;

    const qualified = groupUnits.filter(u => unitPasses(rule, u));
    if (!qualified.length) continue;

    const locationName = qualified[0].location || "Unknown";
    const rates = qualified
      .map(u => toMonthlyRate(Number(useCareRate ? u.care_rate : u.street_rate) || 0, sl))
      .filter(r => r > 0);
    const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
    const delta = adjustmentType === "percentage" ? avgRate * (adjustmentValue / 100) : adjustmentValue;
    // Move-ins = qualified units × portfolio move-in rate for the service line
    // (T3 move-ins / month / active unit). Per-group raw counts over-count.
    const moveIns = qualified.length * (ctx.slMoveInRate.get(sl) ?? 0);
    const gMonthly = moveIns * delta;

    affectedUnits += qualified.length;
    rateSum += avgRate * qualified.length;
    moveInsTotal += moveIns;
    monthlyImpact += gMonthly;
    deltaWeighted += delta * moveIns;
    for (const u of qualified) qualifiedUnitIds.add(u.id);

    const key = locId || locationName;
    const c = perCampus.get(key) || {
      locationId: locId || null, campusName: locationName,
      unitCount: 0, avgRate: 0, moveInsPerMonth: 0, monthlyImpact: 0, annualImpact: 0,
    };
    // avgRate as running weighted mean
    c.avgRate = (c.avgRate * c.unitCount + avgRate * qualified.length) / (c.unitCount + qualified.length);
    c.unitCount += qualified.length;
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
    avgRateChange: moveInsTotal ? Math.round((deltaWeighted / moveInsTotal) * 100) / 100 : 0,
    monthlyImpact: Math.round(monthlyImpact),
    annualImpact: Math.round(monthlyImpact * 12),
    perCampus: campuses,
    qualifiedUnitIds,
  };
}
