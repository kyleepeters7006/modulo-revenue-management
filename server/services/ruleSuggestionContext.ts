import { supportedTriggerMetrics } from "../naturalLanguageParser";

/**
 * Contract shared by the rule generator and customer-facing assistant.
 *
 * Keep policy and grammar here rather than teaching each model call a subtly
 * different version.  The parser remains authoritative for enforcement; this
 * text is the human/model-readable description of that contract.
 */
export const RULE_SUGGESTION_SCOPE_SEMANTICS =
  "Scope is the selected campus, region, division, or portfolio. A campus/region/division filter is resolved to concrete tenant locations before analysis; an empty match is not widened to portfolio scope. Service-line arrays are analyzed together and the run is capped at 10 rules total.";

export const RULE_SUGGESTION_IMPACT_METHOD =
  "Authoritative projected impact is calculated by the qualified rule-impact engine: trigger conditions and action filters are evaluated at unit/group level, trailing-three-month move-ins are the monthly volume, daily care rates are normalized with the shared days-per-month convention, and first-year annual impact uses ramped move-in cohorts. Do not estimate impact as all units times rate change. Overlapping active rules are attributed to one rule by precedence, so a newer overlapping suggestion may show zero net qualified units.";

export const RULE_SUGGESTION_CONTRACT_PREFIX =
  "RULE SUGGESTION CONTRACT (shared with the rule generator and parser):";

export function buildRuleSuggestionContext(options: {
  includeInHouse?: boolean;
  unavailableMetrics?: Iterable<string>;
} = {}): string {
  const unavailable = new Set(options.unavailableMetrics || []);
  const metrics = supportedTriggerMetrics().filter((metric) => !unavailable.has(metric));
  const inHouse = options.includeInHouse
    ? "Street-rate increases/decreases are allowed; in-house-rate increases are allowed only for occupied units. Care-rate rules are not allowed."
    : "Only street-rate increases/decreases are allowed, and the sentence must say street rate. In-house, resident-rate, and care-rate rules are not allowed.";
  return [
    RULE_SUGGESTION_CONTRACT_PREFIX,
    `Allowed trigger metrics come from supportedTriggerMetrics(): ${metrics.join(", ")}.`,
    "Grammar: use an explicit numeric threshold with occupancy (including service-line, room-type, or trailing 3/6/12 occupancy), street rate to top comp var %, in-house to street variance, or vacancy duration. Every suggested rule must explicitly target exactly one canonical room type; rules with no room type or multiple room types are rejected. Occupied or vacant status may further narrow that room type. Compound conditions use AND or OR. Conditions must be in the rule sentence, not only the intent.",
    "Direction and sign: write a positive adjustment amount with the direction word (increase or decrease); never write a negative amount. Street-rate-to-top-comp variance is positive when our street rate is above the care-adjusted competitor benchmark and negative when below it. In-house-to-street variance is positive when in-house is above street (loss-to-lease) and negative when street is above in-house.",
    "Competitive positioning: evaluate the care-adjusted competitor benchmark for the exact room type when sizing every street-rate suggestion. Treat signed room-type variance as directional evidence, not a hard cap or floor, because survey data can contain entry errors. Below-market positioning supports a stronger increase when occupancy and demand agree; above-market positioning calls for more restraint unless strong occupancy proves pricing power. Missing or implausible competitor data must not be invented or used to block an otherwise supported rule.",
    `Rate posture: default to rate increases when demand, occupancy, target gap, or market position supports them. ${inHouse}`,
    "Discount restriction: discounts are exceptional; require genuinely low occupancy and long vacancy duration in the same rule, keep them small and room-type scoped, use no more than two decreases, never discount solely for being above competitors, and do not discount a service line at or above its growth target.",
    "Active-rule overlap: review existing active rules and avoid repeating their claimed segments. When active rules overlap, unit attribution follows precedence by newest effective date, then created time, then rule identity; older rules count only units not already claimed by higher-precedence rules.",
    RULE_SUGGESTION_SCOPE_SEMANTICS,
    RULE_SUGGESTION_IMPACT_METHOD,
  ].join("\n");
}

export const RULE_SUGGESTION_CONTEXT = buildRuleSuggestionContext();