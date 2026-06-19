import { storage } from "../storage";
import type { AdjustmentRules } from "@shared/schema";

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
 * Evaluate whether a single rule's trigger matches the given unit.
 */
function evaluateTrigger(rule: AdjustmentRules, unit: any): boolean {
  const trigger = rule.trigger as any;

  // Special-case legacy rule identified by name/description
  if (
    rule.name === "Increase 5% - AL" ||
    rule.description?.includes("increase all vacant units by 5%")
  ) {
    return unit.serviceLine === "AL" && !unit.occupiedYN;
  }

  if (trigger.type === "immediate" || trigger.immediate === true) {
    return true;
  }

  if (trigger.type === "condition") {
    // ── New singular trigger.condition format ─────────────────────────────
    // Used by AI-parsed rules for campus-level metrics like ih_street_variance.
    if (trigger.condition?.field) {
      const { field, operator, value } = trigger.condition as { field: string; operator: string; value: number };

      const clientId: string = unit.clientId || "demo";
      const sl: string | null = unit.serviceLine || null;
      const rt: string | null = unit.roomType    || null;

      /** Generic campus-metric comparator */
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
        return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, null, rt, 'occupancy_pct'));
      }

      // Vacant unit counts
      if (field === "vacant_units" || field === "vacant_beds") {
        return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, null, 'vacant_units'));
      }

      // Competitor rate variance % (own street − comp) / comp × 100
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

      // Average days vacant (campus or SL level)
      if (field === "avg_days_vacant" || field === "days_vacant_campus") {
        return cmpMetric(_lookupCampusMetric(clientId, unit.locationId, sl, null, 'avg_days_vacant'));
      }
    }

    // ── Legacy plural trigger.conditions format ───────────────────────────
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

/**
 * Apply all matching adjustment rules to a unit's rate, in priority order.
 * Each rule receives the rate produced by the previous rule (stacking).
 *
 * @param unit - The unit to apply rules to
 * @param baseRate - The base rate to adjust (usually Modulo suggested rate)
 * @param activeRules - Array of active adjustment rules sorted by priority descending
 * @returns The final adjusted rate and a '+'-joined list of applied rule names
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

  // Exclusive/additive semantics:
  //   • An exclusive rule (action.isAdditive !== true) only fires if no other
  //     exclusive rule has already claimed this unit — the highest-priority one wins.
  //   • An additive rule (action.isAdditive === true) always stacks on top,
  //     regardless of priority order.
  let exclusiveApplied = false;

  for (const rule of sortedRules) {
    // Check scope — skip if rule is scoped to a different location or service line
    if (rule.locationId && rule.locationId !== unit.locationId) continue;
    if (rule.serviceLine && rule.serviceLine !== unit.serviceLine) continue;

    if (!evaluateTrigger(rule, unit)) continue;

    const action = rule.action as any;
    if (action.type !== "adjust_rate") continue;

    // Check action-level filters (room type, service line, occupancy)
    if (action.filters) {
      const filters = action.filters;
      if (filters.roomType && Array.isArray(filters.roomType)) {
        const unitRoomType = (unit.roomType || "").trim().toLowerCase();
        const matches = filters.roomType.some(
          (rt: string) => rt.trim().toLowerCase() === unitRoomType
        );
        if (!matches) continue;
      }
      if (filters.serviceLine && Array.isArray(filters.serviceLine)) {
        if (!filters.serviceLine.includes(unit.serviceLine)) continue;
      }
      if (filters.occupancyStatus === "vacant" && unit.occupiedYN) continue;
      if (filters.occupancyStatus === "occupied" && !unit.occupiedYN) continue;
    }

    // Enforce exclusive/additive gating
    const isAdditive = action.isAdditive === true;
    if (!isAdditive) {
      if (exclusiveApplied) continue; // a higher-priority exclusive rule already claimed this unit
      exclusiveApplied = true;
    }

    const adjustmentType = action.adjustmentType || "percentage";
    const adjustmentValue = action.adjustmentValue ?? action.percentage ?? 0;

    if (adjustmentType === "percentage") {
      currentRate = Math.round(currentRate * (1 + adjustmentValue / 100));
    } else if (adjustmentType === "fixed") {
      currentRate = Math.round(currentRate + adjustmentValue);
    }

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
 * Base rate is the unit's street rate (independent of the Modulo engine output).
 */
export function applyAdjustmentRulesToBatch(
  units: Array<{ id: string; unit: any; [key: string]: any }>,
  activeRules: AdjustmentRules[]
): Array<{ id: string; ruleAdjustedRate: number | null; appliedRuleName: string | null }> {
  return units.map(({ id, unit }) => {
    const baseRate: number = unit?.streetRate ?? unit?.street_rate ?? 0;
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
 * Base rate for each unit is its street rate (independent of the Modulo engine output).
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

    console.log(`Found ${activeRules.length} active adjustment rules`);
    return applyAdjustmentRulesToBatch(units, activeRules);
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
