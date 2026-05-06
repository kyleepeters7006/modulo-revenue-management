import { storage } from "../storage";
import type { AdjustmentRules } from "@shared/schema";

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
 */
export function applyAdjustmentRulesToBatch(
  units: Array<{ id: string; unit: any; moduloSuggestedRate: number; [key: string]: any }>,
  activeRules: AdjustmentRules[]
): Array<{ id: string; ruleAdjustedRate: number | null; appliedRuleName: string | null }> {
  return units.map(({ id, unit, moduloSuggestedRate }) => {
    const adjustment = applyAdjustmentRulesToUnit(unit, moduloSuggestedRate, activeRules);
    return {
      id,
      ruleAdjustedRate: adjustment.ruleAdjustedRate,
      appliedRuleName: adjustment.appliedRuleName,
    };
  });
}

/**
 * Fetch active rules from DB and apply them to a batch of units.
 */
export async function fetchAndApplyAdjustmentRules(
  units: Array<{ id: string; unit: any; moduloSuggestedRate: number; [key: string]: any }>
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
