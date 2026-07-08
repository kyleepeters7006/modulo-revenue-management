import { storage } from "../storage";
import { pool } from "../db";
import type { AdjustmentRules } from "@shared/schema";
import { isRuleExclusive, applyRuleAdjustmentStep } from "@shared/ruleStacking";
import { buildGuardrailResolver, clampRateWithGuardrails } from "../guardrailsUtil";

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
async function recalculateAndPreloadCampusMetrics(
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
      service_line: string; room_type: string; occupied_yn: boolean;
      days_vacant: number; street_rate: number; competitor_final_rate: number; payor_type: string;
    }>(
      `SELECT service_line, room_type, occupied_yn, days_vacant,
              street_rate, competitor_final_rate, payor_type
       FROM rent_roll_data WHERE location_id=$1 AND client_id=$2 AND upload_month=$3`,
      [locationId, clientId, latestMonth]
    );
    const units = unitsRes.rows;
    if (!units.length) return;

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

      const compUnits = group.filter(u => (u.competitor_final_rate || 0) > 100 && (u.street_rate || 0) > 100);
      if (compUnits.length) {
        const avgSt = avgArr(compUnits.map(u => u.street_rate));
        const avgC  = avgArr(compUnits.map(u => u.competitor_final_rate));
        if (avgC > 0) {
          metrics.push({ sl, rt, name: 'competitor_variance_pct', val: (avgSt - avgC) / avgC * 100 });
          metrics.push({ sl, rt, name: 'street_to_comp_var_pct',  val: (avgSt - avgC) / avgC * 100 });
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

  // IH-to-street variance (separate cache)
  if (field === "ih_street_variance") {
    return cmpMetric(_lookupIhVariance(clientId, unit.locationId, unit.serviceLine || 'ALL'));
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

      if (condOperator === 'OR') {
        return conditions.some(c => evaluateSingleCondition(c, unit, clientId));
      }
      // Default: AND — all conditions must pass
      return conditions.every(c => evaluateSingleCondition(c, unit, clientId));
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
 * Apply all matching adjustment rules to a unit's rate, in priority order.
 * Each rule receives the rate produced by the previous rule (stacking).
 */
export function applyAdjustmentRulesToUnit(
  unit: any,
  baseRate: number,
  activeRules: AdjustmentRules[]
): UnitAdjustmentResult {
  // Sort rules by priority (higher priority first)
  const sortedRules = [...activeRules].sort(
    (a, b) => (b.priority || 0) - (a.priority || 0)
  );

  let currentRate = baseRate;
  const appliedRuleNames: string[] = [];

  let exclusiveApplied = false;

  for (const rule of sortedRules) {
    // Check scope — skip if rule is scoped to a different location or service line
    if (rule.locationId && rule.locationId !== unit.locationId) continue;

    // Service line scope gate — prefer serviceLines array, fall back to single serviceLine column
    const slScope: string[] | null =
      (rule as any).serviceLines?.length ? (rule as any).serviceLines
      : rule.serviceLine ? [rule.serviceLine]
      : null;
    if (slScope && !slScope.includes(unit.serviceLine!)) continue;

    if (!evaluateTrigger(rule, unit)) continue;

    const action = rule.action as any;
    if (action.type !== "adjust_rate") continue;

    // Check action-level filters (room type, occupancy)
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
    }

    // Enforce exclusive/additive gating.
    // Rules stack by default; only rules explicitly marked as exclusive
    // (isAdditive === false) claim the exclusive slot.
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
