// Structured rule builder — converts the Rule Designer's structured-tab payload
// (the conditions and action the user actually picked) directly into a
// ParsedRule, without round-tripping through an English sentence.
//
// The sentence path (naturalLanguageParser.ts) remains for free-text and
// AI-authored rules. This module exists because re-parsing a composed sentence
// repeatedly lost information the UI already had (a dropped "%", a dropped
// minus sign, a threshold read on the wrong scale).

import { generateRuleName, type ParsedRule, type ParsedTrigger, type ParsedAction } from './naturalLanguageParser';

export interface StructuredCondition {
  /** Designer metric label, e.g. "Campus Occupancy". */
  metric: string;
  /** Designer time period label, e.g. "Current Month", "Trailing 3". */
  timePeriod?: string;
  /** Designer operator label, e.g. "is greater than or equal to". */
  operator: string;
  /** Raw value as typed, possibly with % / $ / commas. */
  value: string;
}

export interface StructuredAction {
  /** Designer action value, e.g. "increase_rate". */
  type: string;
  amountType: 'percent' | 'dollar';
  amountValue: string;
  scope?: string;
  /** Day threshold preserved from an edited rule's filters.vacancyDuration. */
  vacancyDays?: number;
}

export interface StructuredRulePayload {
  conditions: StructuredCondition[];
  conditionOperator?: 'AND' | 'OR';
  action: StructuredAction;
}

export type StructuredBuildResult =
  | { ok: true; rule: ParsedRule }
  | { ok: false; reason: string };

type Op = '>' | '<' | '>=' | '<=' | '=' | '!=';

// Metric label (lowercased) → engine field + threshold scale.
// Must stay consistent with METRIC_TO_FIELD in naturalLanguageParser.ts:
// 'fraction' metrics are stored 0–1 by the engine; 'raw' metrics keep the
// number exactly as written (0–100 percents, day counts, unit counts).
const METRIC_MAP: Record<string, { field: string; scale: 'fraction' | 'raw'; trailing?: boolean }> = {
  'campus occupancy':                                     { field: 'occupancy', scale: 'fraction', trailing: true },
  'service line occupancy':                               { field: 'service_line_occupancy', scale: 'fraction', trailing: true },
  'room type occupancy':                                  { field: 'room_type_occupancy', scale: 'fraction', trailing: true },
  'street rate to top comp var %':                        { field: 'street_to_comp_var', scale: 'raw' },
  'in house to street rate var % - single occupant':      { field: 'ih_street_variance', scale: 'raw' },
  'competitor rate':                                      { field: 'competitor_variance', scale: 'raw' },
  'vacant units/beds':                                    { field: 'vacant_units', scale: 'raw' },
  'total units/beds':                                     { field: 'total_units', scale: 'raw' },
  'days vacant':                                          { field: 'days_vacant', scale: 'raw' },
  'inquiry and tour volume':                              { field: 'inquiry_volume', scale: 'raw' },
  'quality mix':                                          { field: 'quality_mix', scale: 'raw' },
};

const OPERATOR_MAP: Record<string, Op> = {
  'is greater than': '>',
  'is greater than or equal to': '>=',
  'is less than': '<',
  'is less than or equal to': '<=',
  'equals': '=',
  // NOTE: no 'does not equal' — neither the live evaluator nor the impact
  // comparator implements '!=', so such a rule would silently never fire.
};

/** Trailing-window suffix for the occupancy family; other periods are the current snapshot. */
// Known designer time periods. Anything else is rejected rather than silently
// coerced to "current", which would evaluate a different condition than picked.
const CURRENT_PERIODS = new Set(['', 'current spot', 'current month']);
function trailingSuffix(timePeriod: string | undefined): string | null {
  const tp = String(timePeriod || '').trim().toLowerCase();
  if (CURRENT_PERIODS.has(tp)) return '';
  const m = tp.match(/^trailing\s*(3|6|12)$/);
  return m ? `_trailing${m[1]}` : null;
}

/**
 * Parse a single threshold value. An explicit "%" is authoritative for
 * fraction-scale metrics ("85%" → 0.85, "0.85%" → 0.0085); without it a
 * magnitude above 1 can only have meant percentage points — the exact same
 * semantics as the sentence parser's extractCmp, so the two paths cannot
 * disagree about a threshold's scale.
 */
function parseThreshold(raw: string, scale: 'fraction' | 'raw'): number | null {
  const s = String(raw).trim();
  const hasPercent = s.includes('%');
  const num = parseFloat(s.replace(/[%$,\s]/g, ''));
  if (!Number.isFinite(num)) return null;
  if (scale === 'raw') return num;
  return hasPercent ? num / 100 : Math.abs(num) > 1 ? num / 100 : num;
}

/** "80 and 90", "80-90", "80 – 90", "80 to 90" → [lo, hi]. */
function parseBetween(raw: string, scale: 'fraction' | 'raw'): [number, number] | null {
  const m = String(raw).match(/(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*[%$]?\s*(?:and|to|[-\u2013\u2014])\s*\$?(-?\d+(?:,\d{3})*(?:\.\d+)?)\s*[%$]?/i);
  if (!m) return null;
  const hasPercent = /%/.test(raw);
  const conv = (s: string): number => {
    const n = parseFloat(s.replace(/,/g, ''));
    if (scale === 'raw') return n;
    return hasPercent ? n / 100 : Math.abs(n) > 1 ? n / 100 : n;
  };
  const lo = conv(m[1]);
  const hi = conv(m[2]);
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/**
 * Build a ParsedRule from the designer's structured payload.
 *
 * Returns { ok: false, reason } when the payload uses a metric, operator, or
 * action the engine cannot evaluate — the caller decides whether to fall back
 * to sentence parsing (status quo) or reject.
 */
export function buildRuleFromStructured(
  payload: StructuredRulePayload,
  description: string,
): StructuredBuildResult {
  if (!payload || typeof payload !== 'object' || !payload.action) {
    return { ok: false, reason: 'missing structured action' };
  }

  // ── Action ────────────────────────────────────────────────────────────
  const a = payload.action;
  const amountNum = parseFloat(String(a.amountValue ?? '').replace(/[%$,\s]/g, ''));
  if (!Number.isFinite(amountNum) || amountNum === 0) {
    return { ok: false, reason: `action amount "${a.amountValue}" is not a number` };
  }
  let sign: 1 | -1;
  switch (a.type) {
    case 'increase_rate':
      sign = 1; break;
    case 'decrease_rate':
    case 'apply_discount':
      sign = -1; break;
    default:
      // The engine only encodes signed rate adjustments; the designer no
      // longer offers anything else, so this is a malformed payload.
      return { ok: false, reason: `unsupported action type "${a.type}" — only increase, decrease, or apply discount can be enforced` };
  }
  const action: ParsedAction = {
    type: 'adjust_rate',
    target: 'street_rate',
    adjustmentType: a.amountType === 'dollar' ? 'absolute' : 'percentage',
    adjustmentValue: sign * Math.abs(amountNum),
  };

  // Scope. Campus/service-line/room-type scopes arrive through the request's
  // explicit locationId / serviceLines / roomTypes fields (injected by the
  // route), so here they add no filter; only vacancy is encoded on the action.
  const NEUTRAL_SCOPES = new Set([
    '', 'All selected campuses', 'Selected campus', 'Selected service line', 'Selected room type',
  ]);
  const scope = String(a.scope ?? '').trim();
  const filters: NonNullable<ParsedAction['filters']> = {};
  if (scope === 'Vacant units only') {
    filters.occupancyStatus = 'vacant';
  } else if (!NEUTRAL_SCOPES.has(scope)) {
    return { ok: false, reason: `unsupported scope "${a.scope}"` };
  }
  // Preserved per-unit vacancy-duration filter from an edited rule.
  const vacancyDays = Number(a.vacancyDays);
  if (Number.isFinite(vacancyDays) && vacancyDays > 0) {
    filters.vacancyDuration = { operator: '>', days: Math.round(vacancyDays) };
    filters.occupancyStatus = 'vacant';
  }
  if (Object.keys(filters).length > 0) action.filters = filters;

  // ── Conditions ────────────────────────────────────────────────────────
  const out: Array<{ field: string; operator: Op; value: number }> = [];
  const conds = Array.isArray(payload.conditions) ? payload.conditions : [];
  const rawCondOp = payload.conditionOperator ?? 'AND';
  if (rawCondOp !== 'AND' && rawCondOp !== 'OR') {
    return { ok: false, reason: `unsupported condition operator "${rawCondOp}"` };
  }
  const conditionOperator: 'AND' | 'OR' = rawCondOp;

  for (const c of conds) {
    if (!c || !String(c.value ?? '').trim()) continue; // designer sends only filled rows, but be tolerant
    const spec = METRIC_MAP[String(c.metric || '').trim().toLowerCase()];
    if (!spec) return { ok: false, reason: `unsupported metric "${c.metric}"` };
    const suffix = trailingSuffix(c.timePeriod);
    if (suffix === null) {
      return { ok: false, reason: `unsupported time period "${c.timePeriod}"` };
    }
    if (suffix && !spec.trailing) {
      // Ignoring the window would silently evaluate a different condition
      // than the user picked — exactly the failure this path exists to stop.
      return { ok: false, reason: `"${c.metric}" has no trailing-window variant` };
    }
    const field = spec.field + (spec.trailing ? suffix : '');

    if (String(c.operator).trim().toLowerCase() === 'is between') {
      if (conditionOperator === 'OR' && conds.length > 1) {
        // A between-range expands into two AND-bound conditions; flattening
        // them under OR would invert the range. Same refusal as the parser.
        return { ok: false, reason: '"is between" cannot be combined with OR' };
      }
      const range = parseBetween(String(c.value), spec.scale);
      if (!range) return { ok: false, reason: `could not read the range "${c.value}"` };
      out.push({ field, operator: '>=', value: range[0] });
      out.push({ field, operator: '<=', value: range[1] });
      continue;
    }

    const op = OPERATOR_MAP[String(c.operator).trim().toLowerCase()];
    if (!op) return { ok: false, reason: `unsupported operator "${c.operator}"` };
    const value = parseThreshold(String(c.value), spec.scale);
    if (value === null) return { ok: false, reason: `threshold "${c.value}" is not a number` };
    out.push({ field, operator: op, value });
  }

  if (out.length === 0) {
    // A structured rule with no filled conditions would become a blanket
    // {type:'immediate'} rule repricing everything its filters match.
    return { ok: false, reason: 'at least one condition with a value is required' };
  }
  const trigger: ParsedTrigger =
      out.length === 1
        ? { type: 'condition', condition: out[0] as any }
        : { type: 'condition', conditions: out as any, conditionOperator };

  return {
    ok: true,
    rule: {
      name: generateRuleName(trigger, action),
      description,
      trigger,
      action,
    },
  };
}
