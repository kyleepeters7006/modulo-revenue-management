/**
 * @fileoverview Candidate gates for the "Suggest Rules with AI" flow.
 *
 * The suggestion endpoint asks Opus for up to 10 rules and then runs each
 * candidate through a gauntlet of gates. Those gates are correct — a rule the
 * parser cannot faithfully build must never be offered, because a silently
 * degraded trigger becomes a blanket repricing of everything the action filters
 * match (see .agents/memory/rule-trigger-silent-degradation.md).
 *
 * What was wrong is that every gate was a bare `continue`. If the model drafted
 * ten rules and seven were rejected, the operator saw three cards and no hint
 * that the other seven ever existed — the run simply read as "the AI didn't find
 * much today".
 *
 * That matters more here than generic error reporting would, because of a
 * failure mode this codebase has already been bitten by: the prompt teaches the
 * model an exact phrasing, and the parser must accept exactly that phrasing.
 * When the two drift, the ONLY symptom is fewer suggestions. Attributing each
 * rejection to a reason turns that invisible drift into something both the
 * operator and an engineer can see.
 *
 * The gates live here rather than inline in the route so a test can drive the
 * real decision logic instead of a hand-copied approximation of it — a test that
 * re-implements production logic guards nothing (see
 * .agents/memory/parity-test-design.md).
 */

import {
  parseNaturalLanguageRule,
  validateParsedRule,
  checkRuleEnforceable,
  type ParsedRule,
} from '../naturalLanguageParser';

/**
 * Why a drafted candidate never became a suggestion card.
 *
 * `over_cap` is deliberately not a failure — the model was asked for at most 10
 * rules and returned more, so the surplus is discarded by design. It is tracked
 * separately from the genuine rejections everywhere below.
 */
export type SuggestionRejectionCode =
  | 'empty_sentence'
  | 'unparseable'
  | 'invalid_rule'
  | 'unenforceable'
  | 'blanket_rule'
  | 'unsupported_target'
  | 'zero_qualified_units'
  | 'over_cap';

/**
 * Rejection codes that mean the model's WORDING did not survive the parser.
 *
 * Only these feed drift detection. `invalid_rule` is deliberately excluded even
 * though it also comes from the parser stack: validateParsedRule rejects rules
 * the parser understood perfectly but that break a policy limit (a zero
 * adjustment, a 150% increase). A model drafting over-aggressive rules is a
 * prompt-content problem, not a grammar mismatch, and counting it as drift
 * would point the next engineer at the wrong thing.
 */
const GRAMMAR_CODES: ReadonlySet<SuggestionRejectionCode> = new Set<SuggestionRejectionCode>([
  'unparseable',
  'unenforceable',
]);

export const OVER_CAP_CODE: SuggestionRejectionCode = 'over_cap';

/**
 * Operator-facing wording. Deliberately plain: the raw parser reason is kept in
 * `detail` for engineers and the structured log, and must not be the headline
 * an operator reads.
 */
export const REJECTION_LABELS: Record<SuggestionRejectionCode, string> = {
  empty_sentence: 'Returned without a rule sentence',
  unparseable: 'Could not be read as a pricing rule',
  invalid_rule: 'Missing something the rule needs to be valid',
  unenforceable: 'Described a condition the pricing engine cannot enforce',
  blanket_rule: 'Would have applied to everything, with no condition or target',
  unsupported_target: 'Changed a rate this run does not allow',
  zero_qualified_units: 'Would not affect any eligible units in the selected scope',
  over_cap: 'Beyond the 10-rule limit for one run',
};

export interface SuggestionCandidate {
  rule?: unknown;
  description?: unknown;
  name?: unknown;
  intent?: unknown;
  serviceLines?: unknown;
  serviceLine?: unknown;
}

export interface SuggestionGateOptions {
  /** Service lines this run actually has units for; a candidate is clamped to these. */
  validServiceLines: string[];
  /** Whether the caller opted into in-house rate suggestions (increases only). */
  includeInHouse: boolean;
}

export interface SuggestionRejection {
  code: SuggestionRejectionCode;
  /** Engineer-facing specifics (parser/validator text). Not shown as a headline. */
  detail: string;
  sentence: string;
  serviceLines: string[];
}

export type SuggestionGateOutcome =
  | { ok: true; sentence: string; serviceLines: string[]; parsed: ParsedRule }
  | ({ ok: false } & SuggestionRejection);

/**
 * Resolve the service lines a candidate claims down to the ones this run can
 * actually serve. Mirrors the route's original behaviour: unknown lines are
 * dropped, and a candidate naming none falls back to the first valid line.
 */
function resolveServiceLines(candidate: SuggestionCandidate, validServiceLines: string[]): string[] {
  // No coercion: a malformed field (a nested array, a number) must miss the
  // whitelist and fall back, exactly as the original inline loop did. Coercing
  // it to a string would let junk that used to fall back start matching.
  const raw: unknown[] = Array.isArray(candidate?.serviceLines)
    ? (candidate.serviceLines as unknown[])
    : candidate?.serviceLine
      ? [candidate.serviceLine]
      : [];
  const matched = raw.filter((s): s is string => typeof s === 'string' && validServiceLines.includes(s));
  if (matched.length) return matched;
  return validServiceLines.length ? [validServiceLines[0]] : [];
}

/**
 * Run one model-drafted candidate through every gate, in the same order the
 * route used to. Returns the parsed rule when it survives, or an attributed
 * rejection when it does not.
 *
 * The gates themselves are unchanged — this is about visibility, not
 * permissiveness.
 */
/**
 * Pull the identifying fields out of a raw model candidate without judging it,
 * so a candidate discarded before the gates run (over the cap) can still be
 * reported with its sentence and service lines.
 */
export function describeCandidate(
  candidate: SuggestionCandidate,
  validServiceLines: string[],
): { sentence: string; serviceLines: string[] } {
  // Only a string counts as a sentence. The original loop passed whatever the
  // model returned straight to the parser, so a non-string `rule` took down the
  // whole request; treat it as a candidate that arrived without a sentence
  // instead. Every well-formed candidate behaves identically either way.
  const rawSentence = typeof candidate?.rule === 'string'
    ? candidate.rule
    : typeof candidate?.description === 'string'
      ? candidate.description
      : '';
  return {
    sentence: rawSentence.trim(),
    serviceLines: resolveServiceLines(candidate, validServiceLines),
  };
}

export function evaluateSuggestionCandidate(
  candidate: SuggestionCandidate,
  opts: SuggestionGateOptions,
): SuggestionGateOutcome {
  const { sentence, serviceLines } = describeCandidate(candidate, opts.validServiceLines);

  if (!sentence) {
    return {
      ok: false,
      code: 'empty_sentence',
      detail: 'The model returned an entry with no usable rule sentence.',
      sentence: '',
      serviceLines,
    };
  }

  const parsed = parseNaturalLanguageRule(sentence);
  if (!parsed) {
    return {
      ok: false,
      code: 'unparseable',
      detail: 'parseNaturalLanguageRule returned null.',
      sentence,
      serviceLines,
    };
  }

  const validation = validateParsedRule(parsed);
  if (!validation.isValid) {
    return {
      ok: false,
      code: 'invalid_rule',
      detail: validation.errors.join('; ') || 'validateParsedRule reported the rule invalid.',
      sentence,
      serviceLines,
    };
  }

  // Enforceability gate: never suggest a rule the rule designer cannot
  // faithfully build. parseTrigger silently degrades an unmappable condition to
  // `{type:'immediate'}`, which would turn a targeted suggestion into a blanket
  // repricing of everything its filters match.
  const enforceable = checkRuleEnforceable(sentence, parsed);
  if (!enforceable.ok) {
    return {
      ok: false,
      code: 'unenforceable',
      detail: enforceable.reason || 'checkRuleEnforceable rejected the rule.',
      sentence,
      serviceLines,
    };
  }

  // Complexity gate: drop blanket rules — a suggestion must have a real trigger
  // condition or at least a room-type / occupancy-status target, so the
  // displayed rule matches the promised sophistication.
  const filters = parsed.action?.filters || ({} as Record<string, any>);
  const hasCondition = parsed.trigger?.type === 'condition';
  const hasTargeting = !!(
    filters.roomType?.length ||
    filters.occupancyStatus ||
    filters.vacancyDuration
  );
  if (!hasCondition && !hasTargeting) {
    return {
      ok: false,
      code: 'blanket_rule',
      detail: 'No trigger condition and no room-type / occupancy-status / vacancy-duration target.',
      sentence,
      serviceLines,
    };
  }

  // Target policy: street-rate rules only, unless the caller opted into
  // in-house suggestions (then in-house INCREASES are allowed too).
  const target = parsed.action?.target;
  const adjustmentValue = Number(parsed.action?.adjustmentValue ?? 0);
  if (target !== 'street_rate') {
    const inHouseIncrease = opts.includeInHouse && target === 'in_house_rate' && adjustmentValue > 0;
    if (!inHouseIncrease) {
      return {
        ok: false,
        code: 'unsupported_target',
        detail:
          `Rule targets "${target ?? 'unknown'}"` +
          (target === 'in_house_rate' && !opts.includeInHouse
            ? ' but in-house suggestions were not requested for this run.'
            : target === 'in_house_rate'
              ? ' as a decrease; only in-house increases are allowed.'
              : '; only street-rate rules are allowed.'),
        sentence,
        serviceLines,
      };
    }
  }

  return { ok: true, sentence, serviceLines, parsed };
}

/** The model is asked for at most this many rules; the surplus is discarded. */
export const MAX_SUGGESTIONS_PER_RUN = 10;

export interface AcceptedCandidate {
  /** The raw model entry, for fields the gates do not own (name, intent). */
  candidate: SuggestionCandidate;
  sentence: string;
  serviceLines: string[];
  parsed: ParsedRule;
}

/**
 * Split a run's candidates into the ones that become suggestion cards and the
 * ones that do not, with a reason for every discard.
 *
 * The cap is applied BEFORE the gates on purpose. A draft past the limit was
 * never considered, so blaming it on a gate it never ran through would inflate
 * the "could not be used" count — and, worse, a malformed 11th draft could tip
 * the drift heuristic when the run was actually healthy enough to fill every
 * card.
 */
export function partitionCandidates(
  candidates: SuggestionCandidate[],
  opts: SuggestionGateOptions,
  cap: number = MAX_SUGGESTIONS_PER_RUN,
): { accepted: AcceptedCandidate[]; rejections: SuggestionRejection[] } {
  const accepted: AcceptedCandidate[] = [];
  const rejections: SuggestionRejection[] = [];

  for (const candidate of candidates ?? []) {
    if (accepted.length >= cap) {
      const { sentence, serviceLines } = describeCandidate(candidate, opts.validServiceLines);
      rejections.push({
        code: OVER_CAP_CODE,
        detail: `Run already had ${cap} suggestions.`,
        sentence,
        serviceLines,
      });
      continue;
    }
    const outcome = evaluateSuggestionCandidate(candidate, opts);
    if (!outcome.ok) {
      rejections.push(outcome);
      continue;
    }
    accepted.push({
      candidate,
      sentence: outcome.sentence,
      serviceLines: outcome.serviceLines,
      parsed: outcome.parsed,
    });
  }

  return { accepted, rejections };
}

export interface RejectionGroup {
  code: SuggestionRejectionCode;
  label: string;
  count: number;
  /** A few offending sentences, so drift is diagnosable from the response alone. */
  examples: string[];
}

export interface SuggestionDiagnostics {
  /** Candidates the model returned. */
  drafted: number;
  /** Candidates that became suggestion cards. */
  shown: number;
  /** Genuine rejections. Excludes `over_cap`, which is not a failure. */
  dropped: number;
  /** Surplus candidates discarded because the run already had 10 rules. */
  overCap: number;
  byReason: RejectionGroup[];
  /**
   * Set when an unusually high share of candidates failed on grammar grounds,
   * which is the signature of the prompt and the parser having drifted apart.
   */
  driftWarning: string | null;
}

const MAX_EXAMPLES_PER_REASON = 3;

/**
 * Prompt/parser drift shows up as a burst of grammar failures, never as an
 * error. Require a few candidates before judging so a single bad draft in a
 * two-rule run does not cry wolf.
 */
const DRIFT_MIN_DRAFTED = 4;
const DRIFT_FAILURE_SHARE = 0.4;

export function summarizeRejections(
  rejections: SuggestionRejection[],
  drafted: number,
  shown: number,
): SuggestionDiagnostics {
  const order: SuggestionRejectionCode[] = [];
  const groups = new Map<SuggestionRejectionCode, RejectionGroup>();

  for (const r of rejections) {
    let g = groups.get(r.code);
    if (!g) {
      g = { code: r.code, label: REJECTION_LABELS[r.code], count: 0, examples: [] };
      groups.set(r.code, g);
      order.push(r.code);
    }
    g.count += 1;
    if (g.examples.length < MAX_EXAMPLES_PER_REASON && r.sentence) g.examples.push(r.sentence);
  }

  const byReason = order
    .map(code => groups.get(code)!)
    .sort((a, b) => b.count - a.count);

  const overCap = groups.get(OVER_CAP_CODE)?.count ?? 0;
  const dropped = rejections.length - overCap;

  const grammarFailures = rejections.filter(r => GRAMMAR_CODES.has(r.code)).length;
  let driftWarning: string | null = null;
  if (drafted >= DRIFT_MIN_DRAFTED && grammarFailures / drafted >= DRIFT_FAILURE_SHARE) {
    driftWarning =
      `${grammarFailures} of ${drafted} drafted rules could not be read by the rule parser. ` +
      'That usually means the suggestion prompt and the parser grammar have drifted apart ' +
      'rather than that the data is unremarkable.';
  }

  return { drafted, shown, dropped, overCap, byReason, driftWarning };
}

/**
 * One-line operator summary, or null when nothing was dropped and there is
 * nothing worth saying.
 */
export function describeDiagnostics(d: SuggestionDiagnostics): string | null {
  if (d.dropped <= 0) return null;
  const rule = d.dropped === 1 ? 'rule' : 'rules';
  return (
    `Showing ${d.shown} of ${d.drafted} drafted — ${d.dropped} ${rule} ` +
    'could not be turned into an enforceable pricing rule.'
  );
}

/**
 * Why a run produced no suggestions. Each cause implies a different next
 * action for the operator, so they must not collapse into one grey message.
 */
export type EmptyRunReason =
  | 'no_campuses_match_filters'
  | 'no_rent_roll_data'
  | 'no_units_in_scope'
  | 'model_returned_none'
  | 'all_candidates_rejected';

export const EMPTY_RUN_MESSAGES: Record<EmptyRunReason, string> = {
  no_campuses_match_filters:
    'No campuses match the current filters, so there was nothing to analyze. ' +
    'Widen the campus, region, or division filter and run again.',
  no_rent_roll_data:
    'No rent roll has been imported for this client yet, so there is no pricing data to ' +
    'analyze. Import a rent roll, then run again.',
  no_units_in_scope:
    'The campuses in scope have no units in the selected service lines. ' +
    'Pick a different service line, or widen the campus filter.',
  model_returned_none:
    'The AI reviewed this scope and did not draft any rules. The data here may genuinely ' +
    'not support a rate change — try a different service line or campus.',
  all_candidates_rejected:
    'The AI drafted rules for this scope, but none could be expressed as an enforceable ' +
    'pricing rule, so none are shown. This usually points at a problem with the suggestion ' +
    'prompt rather than with your data — running again may produce different wording.',
};
