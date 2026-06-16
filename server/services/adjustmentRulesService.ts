import { storage } from "../storage";
import type { AdjustmentRules } from "@shared/schema";

// ---------------------------------------------------------------------------
// In-memory cache for IH-to-Street variance metric
// Key format: `${clientId}:${locationId}:${serviceLine}`
// Populated by POST /api/metrics/ih-street-variance/recalculate
// ---------------------------------------------------------------------------
const _ihVarianceCache = new Map<string, number>();

/**
 * Load pre-calculated IH-to-street variance rows into the in-memory cache.
 * Called after each recalculate to keep the evaluator in sync without DB hits.
 */
export function preloadIhStreetVariance(
  rows: Array<{ clientId: string; locationId: string; serviceLine: string; variancePct: number | null }>
) {
  for (const row of rows) {
    if (row.variancePct !== null && row.variancePct !== undefined) {
      _ihVarianceCache.set(`${row.clientId}:${row.locationId}:${row.serviceLine}`, row.variancePct);
    }
  }
}

/** Lookup variance %. Falls back to campus total ('ALL') if service-line key not found. */
function _lookupIhVariance(clientId: string, locationId: string, serviceLine: string): number | null {
  const specific = _ihVarianceCache.get(`${clientId}:${locationId}:${serviceLine}`);
  if (specific !== undefined) return specific;
  const campus = _ihVarianceCache.get(`${clientId}:${locationId}:ALL`);
  return campus !== undefined ? campus : null;
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

      if (field === "ih_street_variance") {
        const clientId: string = unit.clientId || "demo";
        const variancePct = _lookupIhVariance(clientId, unit.locationId, unit.serviceLine);
        if (variancePct === null) return false; // not yet calculated for this campus
        switch (operator) {
          case "<":  return variancePct < value;
          case "<=": return variancePct <= value;
          case ">":  return variancePct > value;
          case ">=": return variancePct >= value;
          case "=":
          case "==":
          case "===": return Math.abs(variancePct - value) < 0.01;
          default: return false;
        }
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
