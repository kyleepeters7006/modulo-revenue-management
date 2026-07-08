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
