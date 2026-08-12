import { storage } from "../storage";
import { pool } from "../db";
import type { AdjustmentRules } from "@shared/schema";
import { isRuleExclusive, applyRuleAdjustmentStep } from "@shared/ruleStacking";
import { buildGuardrailResolver, clampRateWithGuardrails } from "../guardrailsUtil";
import { isBBedRow } from "@shared/bBed";
import { loadCompBenchmark } from "./compBenchmark";

// ---------------------------------------------------------------------------
// In-memory cache for IH-to-Street variance metric
// Key format: `${clientId}:${locationId}:${serviceLine}`
// Populated by POST /api/metrics/ih-street-variance/recalculate
// ---------------------------------------------------------------------------
const _ihVarianceCache = new Map<string, number>();

export function preloadIhStreetVariance(
  rows: Array<{ clientId: string; locationId: string; serviceLine: string; variancePct: number | null }>
) {
  for (const row of rows) {
    if (row.variancePct !== null && row.variancePct !== undefined) {
      _ihVarianceCache.set(`${row.clientId}:${row.locationId}:${row.serviceLine}`, row.variancePct);
    }
  }
}

function _lookupIhVariance(clientId: string, locationId: string, serviceLine: string): number | null {
  const specific = _ihVarianceCache.get(`${clientId}:${locationId}:${serviceLine}`);
  if (specific !== undefined) return specific;
  const campus = _ihVarianceCache.get(`${clientId}:${locationId}:ALL`);
  return campus !== undefined ? campus : null;
}

// ---------------------------------------------------------------------------
// In-memory cache for all campus metrics (occupancy, vacancies, competitor
// variance, payer mix, inquiry volume, avg days vacant, etc.)
//
// Key format: `${clientId}:${locationId}:${sl||''}:${rt||''}:${metricName}`
//   sl = '' means campus-level; sl = 'AL' means AL service line
//   rt = '' means not room-type specific; rt = 'Studio' means Studio room type
//
// Populated by POST /api/metrics/campus-snapshot/recalculate
// or auto-populated before running rules (via recalculateAndPreloadCampusMetrics)
// ---------------------------------------------------------------------------
const _campusMetricsCache = new Map<string, number>();

export function preloadCampusMetrics(
  rows: Array<{
    clientId: string; locationId: string;
    serviceLine: string | null; roomType: string | null;
    metricName: string; value: number | null;
  }>
) {
  for (const row of rows) {
    if (row.value !== null && row.value !== undefined) {
      const key = `${row.clientId}:${row.locationId}:${row.serviceLine || ''}:${row.roomType || ''}:${row.metricName}`;
      _campusMetricsCache.set(key, row.value);
    }
  }
}

/**
 * Lookup a campus metric value.
 * Falls back: SL+RT → SL-only → campus-level.
 */
function _lookupCampusMetric(
  clientId: string, locationId: string,
  sl: string | null, rt: string | null, metricName: string
): number | null {
  const tryKey = (s: string, r: string) => {
    const k = `${clientId}:${locationId}:${s}:${r}:${metricName}`;
    return _campusMetricsCache.has(k) ? _campusMetricsCache.get(k)! : null;
  };
  // Most specific first
  if (sl && rt) { const v = tryKey(sl, rt); if (v !== null) return v; }
  if (sl)       { const v = tryKey(sl, ''); if (v !== null) return v; }
  // Campus-level fallback
  return tryKey('', '');
}

/**
 * Recalculate campus metrics from rent_roll_data and store them in the
 * in-memory cache. Also persists to campus_metrics table so future runs
 * load fresh values.
 *
 * Mirrors the logic in POST /api/metrics/campus-snapshot/recalculate.
 * Called fresh on every Rules Rate run (no module-level dedup cache) so
 * metrics are always current at evaluation time.
 */
export async function recalculateAndPreloadCampusMetrics(
  clientId: string,
  locationId: string
): Promise<void> {
  try {
    // Get latest upload_month for this campus
    const latestRes = await pool.query<{ month: string }>(
      `SELECT MAX(upload_month) AS month FROM rent_roll_data WHERE location_id=$1 AND client_id=$2`,
      [locationId, clientId]
    );
    const latestMonth = latestRes.rows[0]?.month;
    if (!latestMonth) return;

    // Fetch all units for the latest month
    const unitsRes = await pool.query<{
      service_line: string; room_type: string; room_number: string; occupied_yn: boolean;
      days_vacant: number; street_rate: number; in_house_rate: number;
      competitor_final_rate: number; payor_type: string;
    }>(
      `SELECT service_line, room_type, room_number, occupied_yn, days_vacant,
              street_rate, in_house_rate, competitor_final_rate, payor_type
       FROM rent_roll_data WHERE location_id=$1 AND client_id=$2 AND upload_month=$3`,
      [locationId, clientId, latestMonth]
    );
    const units = unitsRes.rows;
    if (!units.length) return;

    // Load survey-based competitor benchmark (same source as the scatter chart)
    // and resolve the location name needed for benchmark lookups.
    const [compBenchmark, locNameRes] = await Promise.all([
      loadCompBenchmark(pool, clientId),
      pool.query<{ name: string }>(`SELECT name FROM locations WHERE id=$1`, [locationId]),
    ]);
    const locationName = locNameRes.rows[0]?.name ?? '';

    // Fetch inquiry/tour volume from inquiry_metrics
    const inqRes = await pool.query<{ service_line: string; inq: string; tour: string }>(
      `SELECT service_line, SUM(inquiry_count) AS inq, SUM(tour_count) AS tour
       FROM inquiry_metrics WHERE location_id=$1 AND client_id=$2 GROUP BY service_line`,
      [locationId, clientId]
    );

    // ── Compute metrics ──────────────────────────────────────────────────
    const avgArr = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    const pctOf  = (n: number, d: number) => d > 0 ? (n / d) * 100 : 0;
    type MetricRow = { sl: string | null; rt: string | null; name: string; val: number };
    const metrics: MetricRow[] = [];

    function pushGroup(sl: string | null, rt: string | null, group: typeof units) {
      const total = group.length;
      if (!total) return;
      const occupied = group.filter(u => u.occupied_yn).length;
      metrics.push({ sl, rt, name: 'total_units',   val: total });
      metrics.push({ sl, rt, name: 'vacant_units',  val: total - occupied });
      metrics.push({ sl, rt, name: 'occupancy_pct', val: pctOf(occupied, total) });

      const vacDays = group.filter(u => !u.occupied_yn && (u.days_vacant || 0) > 0).map(u => u.days_vacant);
      if (vacDays.length) metrics.push({ sl, rt, name: 'avg_days_vacant', val: avgArr(vacDays) });

      // Group-average days_vacant over ALL units (occupied units contribute 0).
      // Matches the ruleImpactService.evalGroupCondition semantics for the
      // conditions-array trigger format, where the intent is "fire on every
      // unit in the group when the group average exceeds the threshold."
      const allDvAvg = group.reduce((s, u) => s + (Number(u.days_vacant) || 0), 0) / group.length;
      metrics.push({ sl, rt, name: 'days_vacant_group_avg', val: allDvAvg });

      // IH-to-street variance % for single-occupant occupied units (mirrors
      // the ih-street-variance recalculate endpoint: SH excludes B-bed companion
      // rows (room_number ending in /letter); HC counts private-pay only;
      // HC daily rates converted to monthly).
      const HC_DAILY = new Set(['HC', 'HC/MC']);
      // B-bed companion rows for SH SLs are excluded consistently from both
      // sides of every comparative metric so populations always match.
      const isBBed = (u: any) => isBBedRow(u.service_line, u.room_number);
      const ihUnits = group.filter(u => {
        if (!u.occupied_yn) return false;
        if (isBBed(u)) return false; // exclude B-bed companion rows for SH SLs
        const daily = HC_DAILY.has(u.service_line || '');
        const st = u.street_rate || 0, ih = (u as any).in_house_rate || 0;
        if (daily) {
          return st > 0 && ih > 0 && (u.payor_type || '').toUpperCase().includes('PRIVATE');
        }
        return st > 100 && ih > 100;
      });

      if (ihUnits.length) {
        const mult = (u: any) => HC_DAILY.has(u.service_line || '') ? 30.44 : 1;
        const avgSt = avgArr(ihUnits.map(u => (u.street_rate || 0) * mult(u)));
        const avgIH = avgArr(ihUnits.map(u => ((u as any).in_house_rate || 0) * mult(u)));
        if (avgSt > 0) {
          metrics.push({ sl, rt, name: 'ih_street_var_pct', val: (avgIH - avgSt) / avgSt * 100 });
        }
      }

      // Use the survey-based competitor benchmark (same source as the competitive
      // position scatter chart) for street_to_comp_var_pct. The stale
      // competitor_final_rate field in the rent roll holds legacy import values
      // that are far below actual market rates for VIL, causing variance triggers
      // like "street < comp by 3%" to never fire.
      // Benchmark is per location+SL; skip at campus level (sl=null) since we
      // cannot blend SLs into a single coherent comp rate.
      if (sl && locationName) {
        const bench = compBenchmark.benchmarkFor(locationName, sl);
        if (bench && bench.adjusted > 0) {
          // Street rate: average of non-B-bed units with a valid street rate.
          const stUnits = group.filter(u => (u.street_rate || 0) > 100 && !isBBed(u));
          if (stUnits.length > 0) {
            const avgSt = avgArr(stUnits.map(u => u.street_rate));
            const pct = (avgSt - bench.adjusted) / bench.adjusted * 100;
            metrics.push({ sl, rt, name: 'competitor_variance_pct', val: pct });
            metrics.push({ sl, rt, name: 'street_to_comp_var_pct',  val: pct });
          }
        }
      }

      // Payer mix — campus/SL level only
      if (rt === null) {
        const occ = group.filter(u => u.occupied_yn);
        const n = occ.length;
        if (n > 0) {
          const up = (s: string) => (s || '').toUpperCase();
          metrics.push({ sl, rt, name: 'private_pay_pct', val: pctOf(occ.filter(u => up(u.payor_type).includes('PRIVATE')).length,  n) });
          metrics.push({ sl, rt, name: 'medicaid_pct',    val: pctOf(occ.filter(u => up(u.payor_type).includes('MEDICAID')).length, n) });
          metrics.push({ sl, rt, name: 'medicare_pct',    val: pctOf(occ.filter(u => up(u.payor_type).includes('MEDICARE')).length, n) });
        }
      }
    }

    // Campus level
    pushGroup(null, null, units);

    // Per service line
    const slMap = new Map<string, typeof units>();
    for (const u of units) { const k = u.service_line || 'Other'; if (!slMap.has(k)) slMap.set(k, []); slMap.get(k)!.push(u); }
    for (const [sl, g] of slMap) pushGroup(sl, null, g);

    // Per room type — keyed by SL+RT for SL-scoped lookup
    const slRtMap = new Map<string, typeof units>();
    for (const u of units) {
      const k = `${u.service_line || 'Other'}|${u.room_type || 'Other'}`;
      if (!slRtMap.has(k)) slRtMap.set(k, []);
      slRtMap.get(k)!.push(u);
    }
    for (const [slRt, g] of slRtMap) {
      const [sl, rt] = slRt.split('|');
      pushGroup(sl, rt, g);
    }

    // Inquiry/tour from inquiry_metrics
    const campInq  = inqRes.rows.reduce((s, r) => s + (Number(r.inq)  || 0), 0);
    const campTour = inqRes.rows.reduce((s, r) => s + (Number(r.tour) || 0), 0);
    metrics.push({ sl: null, rt: null, name: 'inquiry_count', val: campInq });
    metrics.push({ sl: null, rt: null, name: 'tour_count',    val: campTour });
    for (const r of inqRes.rows) {
      if (r.service_line) {
        metrics.push({ sl: r.service_line, rt: null, name: 'inquiry_count', val: Number(r.inq)  || 0 });
        metrics.push({ sl: r.service_line, rt: null, name: 'tour_count',    val: Number(r.tour) || 0 });
      }
    }

    // ── Persist: delete old + bulk insert new ────────────────────────────
    await pool.query(`DELETE FROM campus_metrics WHERE client_id=$1 AND location_id=$2`, [clientId, locationId]);
    if (metrics.length > 0) {
      const now = new Date().toISOString();
      const vals: any[] = [];
      const placeholders = metrics.map((m, i) => {
        const b = i * 7;
        vals.push(locationId, m.sl, m.rt, m.name, m.val, clientId, now);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`;
      });
      await pool.query(
        `INSERT INTO campus_metrics (location_id,service_line,room_type,metric_name,value,client_id,calculated_at) VALUES ${placeholders.join(',')}`,
        vals
      );
    }

    // Sync in-memory cache
    preloadCampusMetrics(metrics.map(m => ({
      clientId, locationId, serviceLine: m.sl, roomType: m.rt, metricName: m.name, value: m.val,
    })));

    console.log(`[adjustmentRules] Preloaded ${metrics.length} campus metrics for ${locationId}`);
  } catch (err) {
    console.warn(`[adjustmentRules] Failed to preload campus metrics for ${locationId}:`, err);
  }
}

export interface UnitAdjustmentResult {
  ruleAdjustedRate: number | null;
  appliedRuleName: string | null;
}

export interface RuleApplication {
  unitId: string;
  originalRate: number;
  adjustedRate: number;
  ruleName: string;
}

/**
 * Evaluate a single condition object { field, operator, value } against a unit.
 */
function evaluateSingleCondition(
  condition: { field: string; operator: string; value: number },
  unit: any,
  clientId: string
): boolean {
  const { field, operator, value } = condition;
  const sl: string | null = unit.serviceLine || null;
  const rt: string | null = unit.roomType    || null;

  function cmpMetric(metricVal: number | null): boolean {
    if (metricVal === null) return false;
    switch (operator) {
      case "<":  return metricVal < value;
      case "<=": return metricVal <= value;
      case ">":  return metricVal > value;
      case ">=": return metricVal >= value;
      case "=": case "==": case "===": return Math.abs(metricVal - value) < 0.01;
      default: return false;
    }
  }

  // IH-to-street variance: prefer the recalculated table cache, then fall back
  // to the campus-metrics value computed fresh from rent roll before each run.
  if (field === "ih_street_variance" || field === "street_to_ih_var") {
    // Legacy rules may store the threshold as a fraction (0.1 = 10%); the
    // metric is on the 0–100 % scale.
    const v = Math.abs(value) <= 1 && value !== 0 ? value * 100 : value;
    const cmpPct = (metricVal: number | null): boolean => {
      if (metricVal === null) return false;
      switch (operator) {
        case "<":  return metricVal < v;
        case "<=": return metricVal <= v;
        case ">":  return metricVal > v;
        case ">=": return metricVal >= v;
        case "=": case "==": case "===": return Math.abs(metricVal - v) < 0.01;
        default: return false;
      }
    };
    const cached = _lookupIhVariance(clientId, unit.locationId, unit.serviceLine || 'ALL');
    if (cached !== null) return cmpPct(cached);
    return cmpPct(_lookupCampusMetric(clientId, unit.locationId, sl, null, 'ih_street_var_pct'));
  }

  // Campus / service-line / room-type occupancy
  if (field === "occupancy" || field === "campus_occupancy") {
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, null, null, 'occupancy_pct'));
  }
  if (field === "service_line_occupancy") {
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, null, 'occupancy_pct'));
  }
  if (field === "room_type_occupancy") {
    // Bug 3 fix: pass sl (not null) so lookup finds SL+RT specific metric first
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, rt, 'occupancy_pct'));
  }

  // Vacant unit counts
  if (field === "vacant_units" || field === "vacant_beds") {
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, null, 'vacant_units'));
  }

  // Competitor rate variance %
  if (field === "competitor_rate" || field === "competitor_variance") {
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, rt, 'competitor_variance_pct'));
  }

  // Street rate to top adjusted competitor rate variance % (raw %, e.g. 10 = 10% above comp)
  if (field === "street_to_comp_var") {
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, rt, 'street_to_comp_var_pct'));
  }

  // Quality / payer mix — private pay %
  if (field === "quality_mix" || field === "private_pay") {
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, null, 'private_pay_pct'));
  }

  // Inquiry volume
  if (field === "inquiry_volume" || field === "inquiry_tour_volume" || field === "inquiry_count") {
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, null, 'inquiry_count'));
  }
  if (field === "tour_count" || field === "tour_volume") {
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, null, 'tour_count'));
  }

  // Average days vacant
  if (field === "avg_days_vacant" || field === "days_vacant_campus") {
    return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, null, 'avg_days_vacant'));
  }

  // Unit-level days vacant (raw day count, e.g. "vacant over 60 days")
  if (field === "days_vacant") {
    const dv = Number(unit.daysVacant ?? unit.days_vacant);
    return cmpMetric(Number.isFinite(dv) ? dv : 0);
  }

  return false;
}

/**
 * Evaluate whether a single rule's trigger matches the given unit.
 * Bug 1 fix: removed hardcoded name-based bypass ("Increase 5% - AL").
 * Bug 2 fix: added support for trigger.conditions array with AND/OR logic.
 */
function evaluateTrigger(rule: AdjustmentRules, unit: any): boolean {
  const trigger = rule.trigger as any;

  if (trigger.type === "immediate" || trigger.immediate === true) {
    return true;
  }

  if (trigger.type === "condition") {
    const clientId: string = unit.clientId || "demo";

    // ── NEW: Array-based multi-condition format ───────────────────────────
    // trigger.conditions is an Array of { field, operator, value } objects
    // combined by trigger.conditionOperator ("AND" | "OR", default "AND")
    if (Array.isArray(trigger.conditions)) {
      const condOperator: string = (trigger.conditionOperator || 'AND').toUpperCase();
      const conditions = trigger.conditions as Array<{ field: string; operator: string; value: number }>;

      // For the array format, days_vacant is evaluated as a group-level average
      // (same as ruleImpactService.evalGroupCondition), not per-unit. The intent
      // is "fire on every unit in the group when the group average exceeds the
      // threshold." Use the days_vacant_group_avg metric computed in
      // recalculateAndPreloadCampusMetrics which averages over ALL units.
      const evalArrayCond = (c: { field: string; operator: string; value: number }): boolean => {
        if (c.field === 'days_vacant') {
          const sl: string | null = unit.serviceLine || null;
          const rt: string | null = unit.roomType    || null;
          const avg = _lookupCampusMetric(clientId, unit.locationId, sl, rt, 'days_vacant_group_avg');
          if (avg === null) return false;
          const { operator, value } = c;
          switch (operator) {
            case '<':  return avg < value;
            case '<=': return avg <= value;
            case '>':  return avg > value;
            case '>=': return avg >= value;
            case '=': case '==': case '===': return Math.abs(avg - value) < 0.01;
            default: return false;
          }
        }
        return evaluateSingleCondition(c, unit, clientId);
      };

      if (condOperator === 'OR') {
        return conditions.some(c => evalArrayCond(c));
      }
      // Default: AND — all conditions must pass
      return conditions.every(c => evalArrayCond(c));
    }

    // ── Singular trigger.condition format ─────────────────────────────────
    if (trigger.condition?.field) {
      return evaluateSingleCondition(
        trigger.condition as { field: string; operator: string; value: number },
        unit,
        clientId
      );
    }

    // ── Legacy plural trigger.conditions object format ────────────────────
    const conditions = trigger.conditions || {};
    let matches = true;

    // Occupancy status condition
    if (conditions.occupancyStatus === "vacant") {
      matches = matches && !unit.occupiedYN;
    } else if (conditions.occupancyStatus === "occupied") {
      matches = matches && Boolean(unit.occupiedYN);
    }

    // Vacancy duration condition
    if (conditions.vacancyDuration && unit.daysVacant !== undefined) {
      const { operator, days } = conditions.vacancyDuration;
      if (operator === ">=") matches = matches && unit.daysVacant >= days;
      else if (operator === ">") matches = matches && unit.daysVacant > days;
      else if (operator === "<") matches = matches && unit.daysVacant < days;
      else if (operator === "<=") matches = matches && unit.daysVacant <= days;
      else if (operator === "===") matches = matches && unit.daysVacant === days;
    }

    // Service line condition (inside trigger conditions)
    if (conditions.serviceLine && conditions.serviceLine !== unit.serviceLine) {
      matches = false;
    }

    return matches;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Service-line scope resolution helpers
// Used by the POST and PATCH /api/adjustment-rules route handlers so the
// "what gets stored" logic lives in one tested place.
// ---------------------------------------------------------------------------

/**
 * POST handler — resolve effective SL scope from the request body.
 * Priority: serviceLines[] (non-empty) > serviceLine string > none.
 * Returns the two storage columns that should be persisted.
 */
export function resolvePostServiceLineScope(body: {
  serviceLine?: string | null;
  serviceLines?: string[] | null;
}): { storeServiceLine: string | null; storeServiceLines: string[] | null } {
  const { serviceLine, serviceLines } = body;
  const effectiveSLs: string[] =
    Array.isArray(serviceLines) && serviceLines.length > 0 ? serviceLines
    : serviceLine ? [serviceLine]
    : [];
  return {
    storeServiceLine: effectiveSLs.length === 1 ? effectiveSLs[0] : null,
    storeServiceLines: effectiveSLs.length > 1 ? effectiveSLs : null,
  };
}

/**
 * PATCH handler — resolve effective SL scope from the request body, falling
 * back to the existing persisted values when neither body param is present.
 * - serviceLines !== undefined wins (even if empty — that clears the scope)
 * - else serviceLine !== undefined wins
 * - else keep existing scope (serviceLines → serviceLine → none)
 */
export function resolvePatchServiceLineScope(
  body: { serviceLine?: string | null; serviceLines?: string[] | null },
  existing: { serviceLine?: string | null; serviceLines?: string[] | null }
): { storeServiceLine: string | null; storeServiceLines: string[] | null } {
  const { serviceLine, serviceLines } = body;
  const effectiveSLs: string[] =
    serviceLines !== undefined
      ? (Array.isArray(serviceLines) ? serviceLines : [])
      : serviceLine !== undefined
        ? (serviceLine ? [serviceLine] : [])
        : (existing.serviceLines?.length
            ? existing.serviceLines
            : existing.serviceLine
              ? [existing.serviceLine]
              : []);
  return {
    storeServiceLine: effectiveSLs.length === 1 ? effectiveSLs[0] : null,
    storeServiceLines: effectiveSLs.length > 1 ? effectiveSLs : null,
  };
}

/**
 * Specificity score for a rule — mirrors ruleSpecificityScore in ruleImpactService.
 * More-specific rules sort before blanket portfolio rules so the right rule name
 * appears as "applied" and the dedup order is consistent with the impact display.
 *
 *   +4  campus-specific (locationId set)
 *   +2  service-line-specific (serviceLine / serviceLines non-empty)
 *   +1  room-type-specific (action.filters.roomType non-empty)
 */
function ruleSpecificityScoreLocal(rule: AdjustmentRules): number {
  let score = 0;
  if ((rule as any).locationId) score += 4;
  const sls: string[] = Array.isArray((rule as any).serviceLines) && (rule as any).serviceLines.length
    ? (rule as any).serviceLines
    : (rule as any).serviceLine ? [(rule as any).serviceLine] : [];
  if (sls.length > 0) score += 2;
  const rt = (rule.action as any)?.filters?.roomType;
  if (Array.isArray(rt) && rt.length > 0) score += 1;
  return score;
}

/**
 * Apply all matching adjustment rules to a unit's rate, in priority order.
 * Latest-cycle-wins: when rules from multiple pricing cycles (effectiveDate months)
 * qualify for the same service line, only the most-recent cycle fires. This
 * prevents Apr-26 rules from stacking on top of Jul-26 rules for the same SL.
 * Rules with no effectiveDate (ongoing) always apply regardless of cycle.
 */
export function applyAdjustmentRulesToUnit(
  unit: any,
  baseRate: number,
  activeRules: AdjustmentRules[]
): UnitAdjustmentResult {
  // Sort rules: specificity first (targeted scope beats blanket portfolio),
  // then explicit priority (user-set order within the same specificity tier),
  // then newer effective date as the final tiebreaker.
  // Specificity is the primary key so a targeted rule always outranks a
  // blanket rule regardless of how explicit priority is set.
  const sortedRules = [...activeRules].sort((a, b) => {
    const specDiff = ruleSpecificityScoreLocal(b) - ruleSpecificityScoreLocal(a);
    if (specDiff !== 0) return specDiff;
    const priDiff = (b.priority || 0) - (a.priority || 0);
    if (priDiff !== 0) return priDiff;
    const da = (a as any).effectiveDate ? new Date((a as any).effectiveDate).toISOString() : '';
    const db = (b as any).effectiveDate ? new Date((b as any).effectiveDate).toISOString() : '';
    return db.localeCompare(da);
  });

  // ── Pass 1: collect qualifying rules (scope + trigger + action filter checks) ──
  const qualifying: AdjustmentRules[] = [];
  for (const rule of sortedRules) {
    if (rule.locationId && rule.locationId !== unit.locationId) continue;

    const slScope: string[] | null =
      (rule as any).serviceLines?.length ? (rule as any).serviceLines
      : rule.serviceLine ? [rule.serviceLine]
      : null;
    if (slScope && !slScope.includes(unit.serviceLine!)) continue;

    if (!evaluateTrigger(rule, unit)) continue;

    const action = rule.action as any;
    if (action.type !== "adjust_rate") continue;
    // Resident-rate (in-house) rules never adjust street pricing.
    if (action.target === "in_house_rate") continue;

    if (action.filters) {
      const filters = action.filters;
      if (filters.roomType && Array.isArray(filters.roomType)) {
        const unitRoomType = (unit.roomType || "").trim().toLowerCase();
        const matches = filters.roomType.some(
          (rt: string) => rt.trim().toLowerCase() === unitRoomType
        );
        if (!matches) continue;
      }
      if (filters.occupancyStatus === "vacant" && unit.occupiedYN) continue;
      if (filters.occupancyStatus === "occupied" && !unit.occupiedYN) continue;
      if (filters.vacancyDuration) {
        // "vacant over N days" — enforce at the unit level so the live engine
        // matches the impact preview (which already applies this filter).
        const { operator, days } = filters.vacancyDuration as { operator: string; days: number };
        const dv = Number(unit.daysVacant ?? 0) || 0;
        const passes = operator === '>' ? dv > days
          : operator === '>=' ? dv >= days
          : operator === '<' ? dv < days
          : operator === '<=' ? dv <= days : dv > days;
        if (!passes) continue;
      }
    }

    qualifying.push(rule);
  }

  // ── Pass 2: latest-cycle-wins per scope key ────────────────────────────────
  // Two rules supersede each other only when they have the SAME effective scope
  // (locationId + serviceLine/serviceLines + roomType filter).  Rules with
  // different scopes run independent cycle clocks even within the targeted tier,
  // so an April "VIL at Campus A" rule is not eliminated by a July "VIL at
  // Campus B" rule.  Blanket rules (no scope) share a single clock.
  // Ongoing rules (no effectiveDate) always survive.
  const ruleScopeKeyLocal = (r: AdjustmentRules): string => {
    const action = (r as any).action;
    const loc = (r as any).locationId ?? '';
    const sls = Array.isArray((r as any).serviceLines) && (r as any).serviceLines.length
      ? [...(r as any).serviceLines].sort().join('+')
      : (r as any).serviceLine ?? '';
    const rt  = Array.isArray(action?.filters?.roomType) && action.filters.roomType.length
      ? [...action.filters.roomType].sort().join('+') : '';
    return `${loc}|${sls}|${rt}`;
  };

  const latestCycleFilterByScope = (rules: AdjustmentRules[]): AdjustmentRules[] => {
    const latestMonthPerScope: Record<string, string> = {};
    for (const rule of rules) {
      if (!rule.effectiveDate) continue;
      const key   = ruleScopeKeyLocal(rule);
      const month = String(rule.effectiveDate).slice(0, 7);
      if (!latestMonthPerScope[key] || month > latestMonthPerScope[key]) {
        latestMonthPerScope[key] = month;
      }
    }
    return rules.filter(rule => {
      if (!rule.effectiveDate) return true; // ongoing — always apply
      const key    = ruleScopeKeyLocal(rule);
      const latest = latestMonthPerScope[key];
      return !latest || String(rule.effectiveDate).slice(0, 7) >= latest;
    });
  };

  const targetedQualifying = qualifying.filter(r => ruleSpecificityScoreLocal(r) > 0);
  const blanketQualifying  = qualifying.filter(r => ruleSpecificityScoreLocal(r) === 0);
  const finalRules = [
    ...latestCycleFilterByScope(targetedQualifying),
    ...latestCycleFilterByScope(blanketQualifying),
  ];

  // ── Pass 3: most-specific-wins suppression ─────────────────────────────────
  // Each unit is governed by exactly ONE specificity level: the highest among all
  // qualifying rules.  Rules at lower specificity levels are unconditionally
  // suppressed — a campus+SL+RT rule (spec 7) wins over a campus+SL rule (spec 6)
  // wins over an SL-only rule (spec 2) wins over a blanket rule (spec 0).
  // Within the same specificity level, multiple qualifying rules still stack
  // (e.g. a vacancy discount at spec 2 alongside a general increase at spec 2).
  // This is consistent with the specificity-ranked claimedUnitIds dedup in the
  // impact/coverage-map display, ensuring reported impacts match applied rates.
  const maxSpec = finalRules.reduce((m, r) => Math.max(m, ruleSpecificityScoreLocal(r)), 0);
  const effectiveFinalRules = finalRules.filter(r => ruleSpecificityScoreLocal(r) === maxSpec);

  let currentRate = baseRate;
  const appliedRuleNames: string[] = [];
  let exclusiveApplied = false;

  for (const rule of effectiveFinalRules) {
    const action = rule.action as any;
    const isExclusive = isRuleExclusive(action);
    if (isExclusive) {
      if (exclusiveApplied) continue;
      exclusiveApplied = true;
    }
    currentRate = applyRuleAdjustmentStep(currentRate, action);
    appliedRuleNames.push(rule.name);
  }

  if (appliedRuleNames.length === 0) {
    return { ruleAdjustedRate: null, appliedRuleName: null };
  }

  return {
    ruleAdjustedRate: currentRate,
    appliedRuleName: appliedRuleNames.join(" + "),
  };
}

/**
 * Apply adjustment rules to multiple units.
 */
export function applyAdjustmentRulesToBatch(
  units: Array<{ id: string; unit: any; [key: string]: any }>,
  activeRules: AdjustmentRules[]
): Array<{ id: string; ruleAdjustedRate: number | null; appliedRuleName: string | null }> {
  return units.map((entry) => {
    const { id, unit } = entry;
    const baseRate: number =
      entry.moduloSuggestedRate ?? unit?.streetRate ?? unit?.street_rate ?? 0;
    const adjustment = applyAdjustmentRulesToUnit(unit, baseRate, activeRules);
    return {
      id,
      ruleAdjustedRate: adjustment.ruleAdjustedRate,
      appliedRuleName: adjustment.appliedRuleName,
    };
  });
}

/**
 * Fetch active rules from DB and apply them to a batch of units.
 * Bug 5 fix: auto-preloads campus metrics for all unique locations before
 * evaluating any rules, so metric-based conditions always have data.
 */
export async function fetchAndApplyAdjustmentRules(
  units: Array<{ id: string; unit: any; [key: string]: any }>
): Promise<Array<{ id: string; ruleAdjustedRate: number | null; appliedRuleName: string | null }>> {
  try {
    const activeRules = await storage.getActiveAdjustmentRules();

    if (activeRules.length === 0) {
      return units.map(({ id }) => ({
        id,
        ruleAdjustedRate: null,
        appliedRuleName: null,
      }));
    }

    // Bug 5 fix: preload campus metrics for all unique locations so that
    // metric-based conditions (SL occupancy, RT occupancy, competitor variance)
    // always have data — no manual pre-call to /api/metrics/campus-snapshot/recalculate needed.
    const hasMetricCondition = activeRules.some(rule => {
      const t = rule.trigger as any;
      if (t?.type !== 'condition') return false;
      if (Array.isArray(t.conditions)) return true;
      if (t.condition?.field && t.condition.field !== 'days_vacant') return true;
      return false;
    });

    if (hasMetricCondition) {
      const clientId = units.find(u => u.unit?.clientId)?.unit?.clientId || 'demo';
      const uniqueLocationIds = [...new Set(
        units.map(u => u.unit?.locationId).filter((id): id is string => Boolean(id))
      )];
      await Promise.all(uniqueLocationIds.map(locId =>
        recalculateAndPreloadCampusMetrics(clientId, locId)
      ));
    }

    console.log(`Found ${activeRules.length} active adjustment rules`);
    const results = applyAdjustmentRulesToBatch(units, activeRules);

    // Guardrails override rules: clamp every rule-adjusted rate against the
    // unit's street rate using the 3-tier guardrail fallback
    // (location+serviceLine → location → global).
    const resolveGuardrails = await buildGuardrailResolver();
    let guardrailClampedCount = 0;
    const clamped = results.map((result, index) => {
      if (result.ruleAdjustedRate === null) return result;
      const unit = units[index]?.unit;
      const baseRate: number = unit?.streetRate ?? unit?.street_rate ?? 0;
      const g = resolveGuardrails(unit?.locationId, unit?.serviceLine);
      if (!g || baseRate <= 0) return result;
      const clampResult = clampRateWithGuardrails(result.ruleAdjustedRate, baseRate, g);
      if (clampResult.wasAdjusted) guardrailClampedCount++;
      return { ...result, ruleAdjustedRate: Math.round(clampResult.finalRate) };
    });
    if (guardrailClampedCount > 0) {
      console.log(`Guardrails clamped ${guardrailClampedCount} rule-adjusted rates`);
    }
    return clamped;
  } catch (error) {
    console.error("Error fetching or applying adjustment rules:", error);
    return units.map(({ id }) => ({
      id,
      ruleAdjustedRate: null,
      appliedRuleName: null,
    }));
  }
}

/**
 * Calculate the revenue impact of applying adjustment rules.
 */
export function calculateRuleImpact(applications: RuleApplication[]): {
  monthlyImpact: number;
  annualImpact: number;
  volumeAdjustedAnnualImpact: number;
} {
  let monthlyImpact = 0;

  for (const app of applications) {
    monthlyImpact += app.adjustedRate - app.originalRate;
  }

  const annualImpact = monthlyImpact * 12;
  const volumeAdjustedAnnualImpact = annualImpact * 1.05;

  return { monthlyImpact, annualImpact, volumeAdjustedAnnualImpact };
}
