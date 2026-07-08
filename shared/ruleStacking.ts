/**
 * Shared stacking-vs-exclusive semantics for adjustment rules.
 *
 * Mirrors the pricing engine (server/services/adjustmentRulesService.ts):
 * rules STACK by default; only rules explicitly marked exclusive
 * (action.isAdditive === false) claim the exclusive slot.
 *
 * Used by the Rule Designer badges and the calculation dialog so the UI
 * can never drift from the engine's semantics. Regression-tested in
 * tests/ruleStacking.test.ts — do not change to `!action.isAdditive`.
 */

export interface RuleActionLike {
  isAdditive?: boolean | null;
  [key: string]: any;
}

/** A rule stacks unless its action explicitly sets isAdditive === false. */
export function isRuleAdditive(action: RuleActionLike | null | undefined): boolean {
  return action?.isAdditive !== false;
}

/** A rule is exclusive only when explicitly marked isAdditive === false. */
export function isRuleExclusive(action: RuleActionLike | null | undefined): boolean {
  return action?.isAdditive === false;
}

/**
 * Extract the adjustment type and value from a rule action, mirroring the
 * pricing engine's defaults (percentage by default; legacy `percentage` field
 * as fallback value).
 */
export function getRuleAdjustment(action: RuleActionLike | null | undefined): {
  adjustmentType: string;
  adjustmentValue: number;
} {
  return {
    adjustmentType: (action as any)?.adjustmentType || "percentage",
    adjustmentValue: (action as any)?.adjustmentValue ?? (action as any)?.percentage ?? 0,
  };
}

/**
 * Apply a single rule adjustment step to a rate — the ONLY place the
 * percentage/fixed math and rounding live. Both the pricing engine
 * (server/services/adjustmentRulesService.ts) and the calculation dialog's
 * replay use this, so their chains can never drift apart.
 */
export function applyRuleAdjustmentStep(
  currentRate: number,
  action: RuleActionLike | null | undefined,
): number {
  const { adjustmentType, adjustmentValue } = getRuleAdjustment(action);
  if (adjustmentType === "percentage") {
    return Math.round(currentRate * (1 + adjustmentValue / 100));
  }
  if (adjustmentType === "fixed") {
    return Math.round(currentRate + adjustmentValue);
  }
  return currentRate;
}

export interface RuleChainStep {
  before: number;
  after: number;
  delta: number;
}

/**
 * Replay a chain of already-matched rule actions from a starting rate,
 * in the order given, returning the before/after for each step.
 * Mirrors the engine's stacking loop for rules that actually applied.
 */
export function replayRuleChain(
  startRate: number,
  actions: Array<RuleActionLike | null | undefined>,
): RuleChainStep[] {
  let current = startRate;
  return actions.map((action) => {
    const before = current;
    current = applyRuleAdjustmentStep(current, action);
    return { before, after: current, delta: current - before };
  });
}

/**
 * 1-based priority of a rule among the exclusive rules in a priority-ordered
 * list, or null if the rule is not active-exclusive. Only rules explicitly
 * marked exclusive count toward priority numbering.
 */
export function exclusivePriority<T extends { action?: unknown; isActive?: boolean | null }>(
  orderedActiveRules: T[],
  rule: T,
): number | null {
  if (!rule.isActive || !isRuleExclusive(rule.action as RuleActionLike)) return null;
  const exclusives = orderedActiveRules.filter(r => isRuleExclusive(r.action as RuleActionLike));
  const idx = exclusives.indexOf(rule);
  return idx >= 0 ? idx + 1 : null;
}
