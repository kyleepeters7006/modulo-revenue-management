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
 * Apply adjustment rules to a unit's rate
 * @param unit - The unit to apply rules to
 * @param baseRate - The base rate to adjust (usually Modulo suggested rate)
 * @param activeRules - Array of active adjustment rules
 * @returns The adjusted rate and applied rule name
 */
export function applyAdjustmentRulesToUnit(
  unit: any,
  baseRate: number,
  activeRules: AdjustmentRules[]
): UnitAdjustmentResult {
  // Start with no adjustment
  let adjustedRate: number | null = null;
  let appliedRuleName: string | null = null;

  // Sort rules by priority (higher priority first)
  const sortedRules = activeRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));

  for (const rule of sortedRules) {
    // Check if rule applies to this unit's location and service line
    if (rule.locationId && rule.locationId !== unit.locationId) {
      continue;
    }
    if (rule.serviceLine && rule.serviceLine !== unit.serviceLine) {
      continue;
    }

    // Parse the trigger and action
    const trigger = rule.trigger as any;
    const action = rule.action as any;

    // Check trigger conditions
    let triggerMatches = false;

    if (trigger.type === 'immediate' || trigger.immediate === true) {
      // Immediate trigger always applies
      triggerMatches = true;
    } else if (trigger.type === 'condition') {
      // Check specific conditions
      const conditions = trigger.conditions || {};
      
      // Check vacancy condition
      if (conditions.occupancyStatus === 'vacant' && !unit.occupiedYN) {
        triggerMatches = true;
      } else if (conditions.occupancyStatus === 'occupied' && unit.occupiedYN) {
        triggerMatches = true;
      }

      // Check vacancy duration
      if (conditions.vacancyDuration && unit.daysVacant !== undefined) {
        const { operator, days } = conditions.vacancyDuration;
        if (operator === '>=' && unit.daysVacant >= days) {
          triggerMatches = true;
        } else if (operator === '>' && unit.daysVacant > days) {
          triggerMatches = true;
        } else if (operator === '<' && unit.daysVacant < days) {
          triggerMatches = true;
        } else {
          triggerMatches = false;
        }
      }

      // Check service line condition
      if (conditions.serviceLine && conditions.serviceLine !== unit.serviceLine) {
        triggerMatches = false;
      }
    }

    // Special handling for the 5% AL increase rule
    if (rule.name === "Increase 5% - AL" || rule.description?.includes("increase all vacant units by 5%")) {
      // Check if unit is AL service line and vacant
      if (unit.serviceLine === "AL" && !unit.occupiedYN) {
        triggerMatches = true;
      } else {
        triggerMatches = false;
      }
    }

    // Apply action if trigger matches
    if (triggerMatches) {
      if (action.type === 'adjust_rate') {
        const adjustmentType = action.adjustmentType || 'percentage';
        const adjustmentValue = action.adjustmentValue || action.percentage || 0;
        
        if (adjustmentType === 'percentage') {
          // Apply percentage adjustment
          adjustedRate = Math.round(baseRate * (1 + adjustmentValue / 100));
        } else if (adjustmentType === 'fixed') {
          // Apply fixed dollar adjustment
          adjustedRate = Math.round(baseRate + adjustmentValue);
        }
        
        appliedRuleName = rule.name;
        
        // Only apply first matching rule (highest priority)
        break;
      }
    }
  }

  return {
    ruleAdjustedRate: adjustedRate,
    appliedRuleName: appliedRuleName
  };
}

/**
 * Apply adjustment rules to multiple units
 * @param units - Array of units with their Modulo rates
 * @param activeRules - Array of active adjustment rules
 * @returns Array of units with rule adjustments applied
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
      appliedRuleName: adjustment.appliedRuleName
    };
  });
}

/**
 * Fetch and apply active adjustment rules to units
 * @param units - Array of units with their Modulo rates
 * @returns Array of units with rule adjustments applied
 */
export async function fetchAndApplyAdjustmentRules(
  units: Array<{ id: string; unit: any; moduloSuggestedRate: number; [key: string]: any }>
): Promise<Array<{ id: string; ruleAdjustedRate: number | null; appliedRuleName: string | null }>> {
  try {
    // Fetch active adjustment rules
    const activeRules = await storage.getActiveAdjustmentRules();
    
    if (activeRules.length === 0) {
      // No active rules, return null adjustments
      return units.map(({ id }) => ({
        id,
        ruleAdjustedRate: null,
        appliedRuleName: null
      }));
    }

    console.log(`Found ${activeRules.length} active adjustment rules`);

    // Apply rules to units
    return applyAdjustmentRulesToBatch(units, activeRules);
  } catch (error) {
    console.error('Error fetching or applying adjustment rules:', error);
    // Return null adjustments on error
    return units.map(({ id }) => ({
      id,
      ruleAdjustedRate: null,
      appliedRuleName: null
    }));
  }
}

/**
 * Calculate the revenue impact of applying adjustment rules
 * @param applications - Array of rule applications
 * @returns The monthly and annual impact
 */
export function calculateRuleImpact(applications: RuleApplication[]): {
  monthlyImpact: number;
  annualImpact: number;
  volumeAdjustedAnnualImpact: number;
} {
  let monthlyImpact = 0;

  for (const app of applications) {
    const difference = app.adjustedRate - app.originalRate;
    monthlyImpact += difference;
  }

  const annualImpact = monthlyImpact * 12;
  const volumeAdjustedAnnualImpact = annualImpact * 1.05; // 5% volume increase

  return {
    monthlyImpact,
    annualImpact,
    volumeAdjustedAnnualImpact
  };
}