// Natural Language Parser for Adjustment Rules
// Uses a grammar-based approach to parse common pricing adjustment patterns

export interface ParsedTrigger {
  type: 'event' | 'time' | 'condition' | 'immediate';
  event?: 'sale' | 'move_in' | 'move_out';
  timeInterval?: { unit: 'day' | 'week' | 'month' | 'quarter' | 'year'; value: number };
  // Singular condition (legacy single-condition format)
  condition?: {
    field: string;
    operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
    value: number | string;
  };
  // Multi-condition format (AND / OR)
  conditions?: Array<{
    field: string;
    operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
    value: number | string;
  }>;
  conditionOperator?: 'AND' | 'OR';
}

export interface ParsedAction {
  type: 'adjust_rate';
  target: 'street_rate' | 'care_rate' | 'all_rates' | 'in_house_rate';
  adjustmentType: 'percentage' | 'absolute';
  adjustmentValue: number;
  filters?: {
    roomType?: string[];
    serviceLine?: string[];
    location?: string[];
    occupancyStatus?: 'occupied' | 'vacant';
    vacancyDuration?: { operator: '>' | '<' | '>='; days: number };
  };
}

export interface ParsedRule {
  name: string;
  description: string;
  trigger: ParsedTrigger;
  action: ParsedAction;
}

// Common patterns and synonyms
const TIME_UNITS: Record<string, string> = {
  'daily': 'day',
  'weekly': 'week',
  'monthly': 'month',
  'quarterly': 'quarter',
  'annually': 'year',
  'yearly': 'year',
  'every day': 'day',
  'every week': 'week',
  'every month': 'month',
  'every quarter': 'quarter',
  'every year': 'year',
  'each day': 'day',
  'each week': 'week',
  'each month': 'month',
  'each quarter': 'quarter',
  'each year': 'year',
};

const RATE_TYPES: Record<string, string> = {
  'street rate': 'street_rate',
  'street rates': 'street_rate',
  'base rate': 'street_rate',
  'base rates': 'street_rate',
  'rent': 'street_rate',
  'rents': 'street_rate',
  'in-house rate': 'in_house_rate',
  'in-house rates': 'in_house_rate',
  'in house rate': 'in_house_rate',
  'in house rates': 'in_house_rate',
  'ih rate': 'in_house_rate',
  'ih rates': 'in_house_rate',
  'resident rate': 'in_house_rate',
  'resident rates': 'in_house_rate',
  'care rate': 'care_rate',
  'care rates': 'care_rate',
  'care fee': 'care_rate',
  'care fees': 'care_rate',
  'all rates': 'all_rates',
  'all prices': 'all_rates',
  'rates': 'all_rates',
};

const ROOM_TYPES: Record<string, string> = {
  'studio': 'Studio',
  'studios': 'Studio',
  'one bedroom': 'One Bedroom',
  'one bedrooms': 'One Bedroom',
  '1 bedroom': 'One Bedroom',
  '1br': 'One Bedroom',
  'two bedroom': 'Two Bedroom',
  'two bedrooms': 'Two Bedroom',
  '2 bedroom': 'Two Bedroom',
  '2br': 'Two Bedroom',
  'companion': 'Companion',
  'companions': 'Companion',
  'studio deluxe': 'Studio Dlx',
  'studio dlx': 'Studio Dlx',
  'deluxe studio': 'Studio Dlx',
};

const SERVICE_LINES: Record<string, string> = {
  'assisted living': 'AL',
  'al': 'AL',
  'memory care': 'MC',
  'mc': 'MC',
  'al/mc': 'AL/MC',
  'assisted living memory care': 'AL/MC',
  'health center': 'HC',
  'hc': 'HC',
  'skilled nursing': 'HC',
  'independent living': 'IL',
  'il': 'IL',
  'senior living': 'SL',
  'sl': 'SL',
};

// ── Condition type alias ───────────────────────────────────────────────────
type SingleCond = { field: string; operator: '>' | '<' | '>=' | '<=' | '='; value: number };

// ── Comparison operator table ─────────────────────────────────────────────
// Ordered most-specific first.
// Group 1 = signed magnitude, group 2 = the "%" sign when the author wrote one.
// Capturing the sign matters: it is the author declaring which scale they mean,
// and guessing from magnitude alone silently turns "0.85%" into 85%.
const CMP_OPS: Array<{ re: RegExp; op: '>' | '<' | '>=' | '<=' | '=' }> = [
  { re: /is\s+greater\s+than\s+or\s+equal\s+to\s+(-?\d+(?:\.\d+)?)\s*(%?)/i, op: '>=' },
  { re: /is\s+less\s+than\s+or\s+equal\s+to\s+(-?\d+(?:\.\d+)?)\s*(%?)/i, op: '<=' },
  { re: /is\s+greater\s+than\s+(-?\d+(?:\.\d+)?)\s*(%?)/i, op: '>' },
  { re: /is\s+less\s+than\s+(-?\d+(?:\.\d+)?)\s*(%?)/i, op: '<' },
  { re: />=\s*(-?\d+(?:\.\d+)?)\s*(%?)/i, op: '>=' },
  { re: /<=\s*(-?\d+(?:\.\d+)?)\s*(%?)/i, op: '<=' },
  { re: />\s*(-?\d+(?:\.\d+)?)\s*(%)/, op: '>' },
  { re: /<\s*(-?\d+(?:\.\d+)?)\s*(%)/, op: '<' },
  { re: /(?:drops?|falls?)\s+below\s+(-?\d+(?:\.\d+)?)\s*(%?)/i, op: '<' },
  { re: /(?:above|over|exceeds?)\s+(-?\d+(?:\.\d+)?)\s*(%?)/i, op: '>=' },
  { re: /(?:below|under)\s+(-?\d+(?:\.\d+)?)\s*(%?)/i, op: '<' },
];

interface RawCmp {
  op: '>' | '<' | '>=' | '<=' | '=';
  /** The number exactly as written, sign preserved, unscaled. */
  raw: number;
  /** True when the author wrote an explicit "%" after the number. */
  hadPercent: boolean;
}

function matchCmp(text: string): RawCmp | null {
  for (const { re, op } of CMP_OPS) {
    const m = text.match(re);
    if (m) return { op, raw: parseFloat(m[1]), hadPercent: m[2] === '%' };
  }
  return null;
}

/**
 * Fraction-scale metrics (the occupancy family): the engine stores 0–1.
 *
 * An explicit "%" is authoritative — "85%" is 0.85 and "0.85%" is 0.0085. Only
 * when the author omitted the sign do we fall back to reading the magnitude,
 * where a value above 1 can only have meant percentage points.
 */
function extractCmp(text: string): { op: '>' | '<' | '>=' | '<=' | '='; value: number } | null {
  const m = matchCmp(text);
  if (!m) return null;
  const value = m.hadPercent ? m.raw / 100 : m.raw > 1 ? m.raw / 100 : m.raw;
  return { op: m.op, value };
}

/** Raw-scale metrics (0–100 percentages, day counts, unit counts): keep as written. */
function extractCmpRaw(text: string): { op: '>' | '<' | '>=' | '<=' | '='; value: number } | null {
  const m = matchCmp(text);
  if (!m) return null;
  return { op: m.op, value: m.raw };
}

/**
 * Detect "between X and Y" / "between X - Y" patterns and return [lo, hi] bounds.
 * Handles optional $, % signs and comma-separated thousands.
 * Also recognises the protected token __BETW_AND__ used internally when the "and"
 * inside a range must not be confused with a condition conjunction during splitting.
 *
 * Value normalisation:
 *   - Dollar prefix ($) detected → currency, keep raw (no /100 scaling)
 *   - rawPct=true               → keep raw (e.g. 10 means 10 percentage points)
 *   - rawPct=false              → apply extractCmp scaling (>1 → /100 for fractions)
 */
function extractBetween(
  text: string,
  rawPct: boolean,
): [SingleCond, SingleCond] | null {
  // Capture optional leading $ on each bound so we can detect currency.
  // Groups: 1=lo_dollar, 2=lo_num, 3=hi_dollar, 4=hi_num
  const re =
    /(?:is\s+)?between\s+(\$?)(-?\d+(?:,\d{3})*(?:\.\d+)?)[%$]?\s*(?:and|__BETW_AND__|[-\u2013])\s*(\$?)(-?\d+(?:,\d{3})*(?:\.\d+)?)[%$]?/i;
  const m = text.match(re);
  if (!m) return null;

  const isCurrency = m[1] === '$' || m[3] === '$';

  // Strip commas from thousand-separated numbers (e.g. $3,000 → 3000)
  const parseVal = (s: string) => parseFloat(s.replace(/,/g, ''));
  let lo = parseVal(m[2]);
  let hi = parseVal(m[4]);

  if (!isCurrency && !rawPct) {
    // Same rule as extractCmp: an explicit "%" anywhere in the range is the
    // author declaring the scale and always wins over the magnitude heuristic.
    if (/%/.test(m[0])) {
      lo = lo / 100;
      hi = hi / 100;
    } else {
      if (lo > 1) lo = lo / 100;
      if (hi > 1) hi = hi / 100;
    }
  }
  // isCurrency or rawPct → keep raw values unchanged

  return [
    { field: '', operator: '>=', value: lo },
    { field: '', operator: '<=', value: hi },
  ];
}

// ── Metric name → internal field name mapping ─────────────────────────────
// Keys must be lowercase to match against lowercased phrase input.
// IMPORTANT: More-specific trailing variants must appear BEFORE the generic
// plain-occupancy entries so the loop's early-exit picks the right field.
const METRIC_TO_FIELD: Array<{ key: string; field: string; rawPct?: boolean }> = [
  // ── Room-type occupancy — trailing windows ─────────────────────────────
  // Parenthesised form generated by buildDescription (structured builder):
  { key: 'room type occupancy (trailing 3)',                    field: 'room_type_occupancy_trailing3' },
  { key: 'room type occupancy (trailing-3)',                    field: 'room_type_occupancy_trailing3' },
  { key: 'room type occupancy (trailing three',                 field: 'room_type_occupancy_trailing3' },
  { key: 'room type occupancy trailing 3',                      field: 'room_type_occupancy_trailing3' },
  { key: 'room type occupancy trailing-3',                      field: 'room_type_occupancy_trailing3' },
  { key: 'trailing 3 room type occupancy',                      field: 'room_type_occupancy_trailing3' },
  { key: 'trailing-3 room type occupancy',                      field: 'room_type_occupancy_trailing3' },
  { key: 'room type occupancy (trailing 6)',                    field: 'room_type_occupancy_trailing6' },
  { key: 'room type occupancy (trailing-6)',                    field: 'room_type_occupancy_trailing6' },
  { key: 'room type occupancy (trailing six',                   field: 'room_type_occupancy_trailing6' },
  { key: 'room type occupancy trailing 6',                      field: 'room_type_occupancy_trailing6' },
  { key: 'room type occupancy trailing-6',                      field: 'room_type_occupancy_trailing6' },
  { key: 'trailing 6 room type occupancy',                      field: 'room_type_occupancy_trailing6' },
  { key: 'trailing-6 room type occupancy',                      field: 'room_type_occupancy_trailing6' },
  { key: 'room type occupancy (trailing 12)',                   field: 'room_type_occupancy_trailing12' },
  { key: 'room type occupancy (trailing-12)',                   field: 'room_type_occupancy_trailing12' },
  { key: 'room type occupancy (trailing twelve',                field: 'room_type_occupancy_trailing12' },
  { key: 'room type occupancy trailing 12',                     field: 'room_type_occupancy_trailing12' },
  { key: 'room type occupancy trailing-12',                     field: 'room_type_occupancy_trailing12' },
  { key: 'trailing 12 room type occupancy',                     field: 'room_type_occupancy_trailing12' },
  { key: 'trailing-12 room type occupancy',                     field: 'room_type_occupancy_trailing12' },
  // ── Service-line occupancy — trailing windows ──────────────────────────
  { key: 'service line occupancy (trailing 3)',                 field: 'service_line_occupancy_trailing3' },
  { key: 'service line occupancy (trailing-3)',                 field: 'service_line_occupancy_trailing3' },
  { key: 'service line occupancy (trailing three',              field: 'service_line_occupancy_trailing3' },
  { key: 'service line occupancy trailing 3',                   field: 'service_line_occupancy_trailing3' },
  { key: 'service line occupancy trailing-3',                   field: 'service_line_occupancy_trailing3' },
  { key: 'trailing 3 service line occupancy',                   field: 'service_line_occupancy_trailing3' },
  { key: 'trailing-3 service line occupancy',                   field: 'service_line_occupancy_trailing3' },
  { key: 'service line occupancy (trailing 6)',                 field: 'service_line_occupancy_trailing6' },
  { key: 'service line occupancy (trailing-6)',                 field: 'service_line_occupancy_trailing6' },
  { key: 'service line occupancy (trailing six',                field: 'service_line_occupancy_trailing6' },
  { key: 'service line occupancy trailing 6',                   field: 'service_line_occupancy_trailing6' },
  { key: 'service line occupancy trailing-6',                   field: 'service_line_occupancy_trailing6' },
  { key: 'trailing 6 service line occupancy',                   field: 'service_line_occupancy_trailing6' },
  { key: 'trailing-6 service line occupancy',                   field: 'service_line_occupancy_trailing6' },
  { key: 'service line occupancy (trailing 12)',                field: 'service_line_occupancy_trailing12' },
  { key: 'service line occupancy (trailing-12)',                field: 'service_line_occupancy_trailing12' },
  { key: 'service line occupancy (trailing twelve',             field: 'service_line_occupancy_trailing12' },
  { key: 'service line occupancy trailing 12',                  field: 'service_line_occupancy_trailing12' },
  { key: 'service line occupancy trailing-12',                  field: 'service_line_occupancy_trailing12' },
  { key: 'trailing 12 service line occupancy',                  field: 'service_line_occupancy_trailing12' },
  { key: 'trailing-12 service line occupancy',                  field: 'service_line_occupancy_trailing12' },
  // ── Campus occupancy — trailing windows ───────────────────────────────
  { key: 'campus occupancy (trailing 3)',                       field: 'occupancy_trailing3' },
  { key: 'campus occupancy (trailing-3)',                       field: 'occupancy_trailing3' },
  { key: 'campus occupancy (trailing three',                    field: 'occupancy_trailing3' },
  { key: 'campus occupancy trailing 3',                         field: 'occupancy_trailing3' },
  { key: 'campus occupancy trailing-3',                         field: 'occupancy_trailing3' },
  { key: 'trailing 3 campus occupancy',                         field: 'occupancy_trailing3' },
  { key: 'trailing-3 campus occupancy',                         field: 'occupancy_trailing3' },
  { key: 'campus occupancy (trailing 6)',                       field: 'occupancy_trailing6' },
  { key: 'campus occupancy (trailing-6)',                       field: 'occupancy_trailing6' },
  { key: 'campus occupancy (trailing six',                      field: 'occupancy_trailing6' },
  { key: 'campus occupancy trailing 6',                         field: 'occupancy_trailing6' },
  { key: 'campus occupancy trailing-6',                         field: 'occupancy_trailing6' },
  { key: 'trailing 6 campus occupancy',                         field: 'occupancy_trailing6' },
  { key: 'trailing-6 campus occupancy',                         field: 'occupancy_trailing6' },
  { key: 'campus occupancy (trailing 12)',                      field: 'occupancy_trailing12' },
  { key: 'campus occupancy (trailing-12)',                      field: 'occupancy_trailing12' },
  { key: 'campus occupancy (trailing twelve',                   field: 'occupancy_trailing12' },
  { key: 'campus occupancy trailing 12',                        field: 'occupancy_trailing12' },
  { key: 'campus occupancy trailing-12',                        field: 'occupancy_trailing12' },
  { key: 'trailing 12 campus occupancy',                        field: 'occupancy_trailing12' },
  { key: 'trailing-12 campus occupancy',                        field: 'occupancy_trailing12' },
  // ── Plain (current snapshot) occupancy — must come AFTER trailing variants ─
  { key: 'service line occupancy',                              field: 'service_line_occupancy' },
  { key: 'room type occupancy',                                 field: 'room_type_occupancy' },
  { key: 'campus occupancy',                                    field: 'occupancy' },
  { key: 'street rate to top comp var %',                       field: 'street_to_comp_var', rawPct: true },
  // ── In-house to street rate variance ───────────────────────────────────
  // The canonical column label plus the natural phrasings people (and the AI
  // rule generator) actually write. Without these aliases the metric parsed
  // ONLY as a standalone whole-rule condition via the regex fallback further
  // down; inside a compound "A AND B" trigger the phrase matched nothing here
  // and the condition was silently dropped, producing a rule that looked
  // correct in its description but ignored the variance entirely.
  //
  // rawPct: the metric is on the 0–100 % scale (10 = 10%), matching the
  // regex fallback and every engine that evaluates ih_street_variance.
  { key: 'in house to street rate var % - single occupant',     field: 'ih_street_variance', rawPct: true },
  { key: 'in-house to street rate var',                         field: 'ih_street_variance', rawPct: true },
  { key: 'in house to street rate var',                         field: 'ih_street_variance', rawPct: true },
  { key: 'in-house to street var',                              field: 'ih_street_variance', rawPct: true },
  { key: 'in house to street var',                              field: 'ih_street_variance', rawPct: true },
  { key: 'in-house to street rate variance',                    field: 'ih_street_variance', rawPct: true },
  { key: 'in house to street rate variance',                    field: 'ih_street_variance', rawPct: true },
  { key: 'ih to street var',                                    field: 'ih_street_variance', rawPct: true },
  { key: 'ih-street var',                                       field: 'ih_street_variance', rawPct: true },
  { key: 'ih street var',                                       field: 'ih_street_variance', rawPct: true },
  // Compared against competitor_variance_pct, which is on the 0–100 scale.
  { key: 'competitor rate',                                     field: 'competitor_variance', rawPct: true },
  { key: 'vacant units/beds',                                   field: 'vacant_units', rawPct: true },
  { key: 'total units/beds',                                    field: 'total_units', rawPct: true },
  { key: 'days vacant',                                         field: 'days_vacant', rawPct: true },
  { key: 'inquiry and tour volume',                             field: 'inquiry_volume', rawPct: true },
  // Compared against private_pay_pct, which is on the 0–100 scale.
  { key: 'quality mix',                                         field: 'quality_mix', rawPct: true },
];

/**
 * Parse a single condition phrase (e.g. "service line occupancy (current month) is greater than or equal to 93")
 * into a structured condition object (or a two-element array when the phrase uses
 * "between X and Y", which expands into a >= lo AND <= hi pair).
 *
 */
// ── Clause boundaries ────────────────────────────────────────────────────────
// One vocabulary, used everywhere a clause boundary matters: gate detection in
// the enforceability guard, metric-scoped comparison extraction, and the
// vacancy-duration match. Keeping these in sync matters — when the vacancy regex
// recognised fewer boundary words than the guard did, a duration belonging to a
// second clause was silently attached to the first.

/** Words that introduce a conditional clause. */
const GATE_WORD_SRC = 'if|when|whenever|where|unless|while|provided\\s+that|as\\s+long\\s+as';

/** A boundary between two propositions: a conjunction or a gate introducer. */
const CLAUSE_BOUNDARY_SRC = `\\b(?:and|or|${GATE_WORD_SRC})\\b`;

/**
 * Slice the proposition a metric phrase belongs to, stopping at the next
 * conjunction or gate introducer. Used to keep a metric's comparison extraction
 * from reaching into an unrelated clause and adopting its number.
 */
function clauseAroundMetric(input: string, metric: string): string | null {
  const idx = input.indexOf(metric);
  if (idx === -1) return null;
  const rest = input.slice(idx);
  const stop = rest.search(new RegExp(CLAUSE_BOUNDARY_SRC, 'i'));
  return stop === -1 ? rest : rest.slice(0, stop);
}

/**
 * Vacancy duration, tolerating room-type and service-line labels (including
 * slashes, e.g. "vacant AL/MC Studio units over 60 days") between the vacancy
 * keyword and "units", but never crossing a clause boundary.
 */
const VACANCY_GAP = `(?:(?!${CLAUSE_BOUNDARY_SRC})[\\w\\s/-])`;
const VACANCY_DURATION_RE = new RegExp(
  `(?:vacant|empty|unoccupied)\\b${VACANCY_GAP}{0,40}?\\bunits?\\b${VACANCY_GAP}{0,20}?` +
    `(?:for|over|more\\s+than|exceeding|at\\s+least)\\s+(\\d+)\\+?\\s*days?`,
  'i',
);

function parseSingleConditionPhrase(
  phrase: string,
): SingleCond | [SingleCond, SingleCond] | null {
  const lower = phrase.toLowerCase().trim();

  for (const { key, field, rawPct } of METRIC_TO_FIELD) {
    if (!lower.startsWith(key) && !lower.includes(key)) continue;

    // "between X and Y" → two conditions (>= lo, <= hi).
    // OR+between combinations are rejected upstream in resolveIfClause before
    // this function is reached, so no guard is needed here.
    const between = extractBetween(lower, !!rawPct);
    if (between) {
      between[0].field = field;
      between[1].field = field;
      return between;
    }

    if (rawPct) {
      const cmp = extractCmpRaw(lower);
      if (cmp) return { field, operator: cmp.op, value: cmp.value };
    } else {
      const cmp = extractCmp(lower);
      if (cmp) return { field, operator: cmp.op, value: cmp.value };
    }
    break;
  }
  return null;
}

/**
 * Split an "if" clause on AND / OR conjunctions (uppercase or lowercase).
 *
 * To avoid splitting inside comparison phrases like "is greater than or equal to"
 * or "is less than or equal to", we temporarily replace those protected phrases
 * before splitting, then restore them in each part.
 */
function splitConditionPhrases(ifClause: string): { parts: string[]; operator: 'AND' | 'OR' } {
  // Uppercase conjunctions (from structured builder) — check first, most reliable
  const hasUpperAnd = / AND /.test(ifClause);
  const hasUpperOr  = / OR /.test(ifClause);

  if (hasUpperAnd || hasUpperOr) {
    const sep = hasUpperAnd ? / AND / : / OR /;
    const operator: 'AND' | 'OR' = hasUpperAnd ? 'AND' : 'OR';
    return { parts: ifClause.split(sep).map(s => s.trim()), operator };
  }

  // Lowercase conjunctions (free-typed text) — protect comparison phrases first
  // so "or" in "greater than or equal to" is not treated as a condition separator.
  const PROTECT: Array<[RegExp, string]> = [
    [/greater than or equal to/gi, '__GTE__'],
    [/less than or equal to/gi,    '__LTE__'],
  ];
  const restore = (s: string) =>
    s.replace(/__GTE__/g, 'greater than or equal to')
     .replace(/__LTE__/g, 'less than or equal to');

  let protected2 = ifClause;
  for (const [re, placeholder] of PROTECT) {
    protected2 = protected2.replace(re, placeholder);
  }

  const hasLowerAnd = / and /i.test(protected2);
  const hasLowerOr  = / or /i.test(protected2);

  if (!hasLowerAnd && !hasLowerOr) return { parts: [ifClause], operator: 'AND' };

  const sep = hasLowerAnd ? / and /i : / or /i;
  const operator: 'AND' | 'OR' = hasLowerAnd ? 'AND' : 'OR';
  const parts = protected2.split(sep).map(p => restore(p.trim()));
  return { parts, operator };
}

export function parseNaturalLanguageRule(input: string): ParsedRule | null {
  try {
    const normalizedInput = input.toLowerCase().trim();
    
    // Extract trigger
    const trigger = parseTrigger(input); // pass original (mixed-case) for AND/OR split
    
    // Extract action
    const action = parseAction(normalizedInput);
    
    if (!trigger || !action) {
      return null;
    }
    
    // Generate a readable name
    const name = generateRuleName(trigger, action);
    
    return {
      name,
      description: input,
      trigger,
      action,
    };
  } catch (error) {
    console.error('Failed to parse rule:', error);
    return null;
  }
}

function parseTrigger(input: string): ParsedTrigger | null {
  const lowerInput = input.toLowerCase().trim();

  // Event-based triggers
  if (lowerInput.includes('after each sale') || lowerInput.includes('when a unit sells') || lowerInput.includes('after sale')) {
    return { type: 'event', event: 'sale' };
  }
  if (lowerInput.includes('after move in') || lowerInput.includes('when occupied')) {
    return { type: 'event', event: 'move_in' };
  }
  if (lowerInput.includes('after move out') || lowerInput.includes('when vacant')) {
    return { type: 'event', event: 'move_out' };
  }
  
  // Time-based triggers
  const timeMatch = lowerInput.match(/every\s+(\d+)?\s*(day|week|month|quarter|year)|each\s+(\w+)|(daily|weekly|monthly|quarterly|yearly|annually)/);
  if (timeMatch) {
    const value = timeMatch[1] ? parseInt(timeMatch[1]) : 1;
    let unit = timeMatch[2] || timeMatch[3] || timeMatch[4];
    
    // Normalize time unit
    unit = TIME_UNITS[unit] || unit;
    
    if (['day', 'week', 'month', 'quarter', 'year'].includes(unit)) {
      return { 
        type: 'time', 
        timeInterval: { 
          unit: unit as 'day' | 'week' | 'month' | 'quarter' | 'year', 
          value 
        }
      };
    }
  }

  // ── Multi-condition detection ─────────────────────────────────────────
  // Two supported forms:
  //   Form 1 (leading If): "If SL occ < 80%, decrease rate by 3%..."
  //     — "If" starts the string and the clause ends at a comma+action verb.
  //   Form 2 (trailing If): "Decrease 3% - Studio If SL occ < 80% AND RT occ < 90%"
  //     — "If" appears anywhere after the action and the clause runs to end-of-string.
  //
  // Both forms share the same splitConditionPhrases / parseSingleConditionPhrase logic.

  function resolveIfClause(ifClause: string) {
    // Pre-protect "between X and Y" (any casing of "and") so the conjunction inside
    // the range is not mistaken for a condition separator during splitting.
    // The /gi flag covers "and", "AND", "And", etc.
    const protectedClause = ifClause.replace(
      /\bbetween\s+(\$?-?\d+(?:,\d{3})*(?:\.\d+)?[%$]?)\s+(and)\s+(\$?-?\d+(?:,\d{3})*(?:\.\d+)?[%$]?)/gi,
      (_: string, lo: string, _and: string, hi: string) => `between ${lo} __BETW_AND__ ${hi}`,
    );

    const { parts, operator } = splitConditionPhrases(protectedClause);
    // Restore the protected "and" in each part before parsing
    const restoredParts = parts.map((p: string) => p.replace(/__BETW_AND__/g, 'and'));

    // If the outer operator is OR and any part contains a "between" range,
    // we cannot safely expand it: both bounds require AND semantics, and flattening
    // them under OR would invert the bounded range (e.g. matching occupancy BELOW
    // the floor OR ABOVE the ceiling). Reject the entire clause so no incorrect
    // rule is persisted rather than silently dropping a bound.
    const BETWEEN_RE = /\bbetween\b/i;
    if (operator === 'OR' && restoredParts.some(p => BETWEEN_RE.test(p))) {
      return null;
    }

    // Flatten: parseSingleConditionPhrase may return a single cond or a [lo,hi] pair.
    // allowBetween is always true here because OR+between was already rejected above.
    const parsedConditions: SingleCond[] = [];
    for (const p of restoredParts) {
      const result = parseSingleConditionPhrase(p);
      if (result === null) continue;
      if (Array.isArray(result)) parsedConditions.push(...result);
      else parsedConditions.push(result);
    }

    if (parsedConditions.length >= 2) {
      return {
        type: 'condition' as const,
        conditions: parsedConditions,
        conditionOperator: operator,
      };
    }

    if (parsedConditions.length === 1) {
      return { type: 'condition' as const, condition: parsedConditions[0] };
    }

    return null;
  }

  // Form 1: "If <clause>, <action verb>..."
  // When the input explicitly starts with "if ...", the clause is the canonical trigger
  // specification. If resolveIfClause cannot parse it (unrecognised metric or an
  // OR+between combination that cannot be safely flattened), return null rather than
  // falling through to generalised single-condition paths that could produce an
  // incorrect partial trigger.
  const ifMatchLeading = input.match(/^if\s+(.+?)(?:,\s*(?:increase|decrease|reduce|raise|lower|set|apply|remove|cap|boost|add|adjust))/i);
  if (ifMatchLeading) {
    return resolveIfClause(ifMatchLeading[1]); // null propagates — never falls through
  }

  // Form 2: "<action description> If <clause>" — "if" appears after the action, clause
  // runs to end of string. Same terminal-rejection semantics as Form 1.
  const ifMatchTrailing = input.match(/\bif\s+(.+)$/i);
  if (ifMatchTrailing) {
    return resolveIfClause(ifMatchTrailing[1]); // null propagates — never falls through
  }

  // ── Generalized single-condition triggers (no "If" prefix required) ───

  // Helper: extract trailing window number (3, 6, or 12) from the input string.
  // Matches patterns like "(trailing 3)", "trailing-3", "trailing three", "trailing 12".
  function extractTrailingWindow(s: string): 3 | 6 | 12 | null {
    const m = s.match(/trailing[-\s]?(?:(\d+)|(three|six|twelve))/i);
    if (!m) return null;
    const n = m[1] ? parseInt(m[1]) : m[2]?.toLowerCase() === 'three' ? 3 : m[2]?.toLowerCase() === 'six' ? 6 : 12;
    return (n === 3 || n === 6 || n === 12) ? n as 3 | 6 | 12 : null;
  }

  // Service line occupancy — trailing variants must be checked before the plain fallback.
  // "sl occupancy" is an alias for "service line occupancy" (not the SL service line)
  if (/(?:service.?line|sl)\s+occupancy|(?:trailing[-\s]?\d+\s+(?:service.?line|sl)\s+occupancy)/i.test(lowerInput)) {
    const win = extractTrailingWindow(lowerInput);
    const cmp = extractCmp(lowerInput);
    if (cmp) {
      const field = win ? (`service_line_occupancy_trailing${win}` as const) : 'service_line_occupancy';
      return { type: 'condition', condition: { field, operator: cmp.op, value: cmp.value } };
    }
  }

  // Room type occupancy — trailing variants must be checked before the plain fallback.
  if (/room.?type\s+occupancy|(?:trailing[-\s]?\d+\s+room.?type\s+occupancy)/i.test(lowerInput)) {
    const win = extractTrailingWindow(lowerInput);
    const cmp = extractCmp(lowerInput);
    if (cmp) {
      const field = win ? (`room_type_occupancy_trailing${win}` as const) : 'room_type_occupancy';
      return { type: 'condition', condition: { field, operator: cmp.op, value: cmp.value } };
    }
  }

  // General / campus occupancy — trailing variants first.
  if (/\boccupancy\b/i.test(lowerInput)) {
    const win = extractTrailingWindow(lowerInput);
    const cmp = extractCmp(lowerInput);
    if (cmp) {
      const field = win ? (`occupancy_trailing${win}` as const) : 'occupancy';
      return { type: 'condition', condition: { field, operator: cmp.op, value: cmp.value } };
    }
  }

  // Street rate to top competitor adjusted rate variance %
  if (/street\s+rate\s+to\s+(top\s+)?comp|street.to.comp.var|street.*comp.*var\s*%/i.test(lowerInput)) {
    const cmp = extractCmpRaw(lowerInput);
    if (cmp) return { type: 'condition', condition: { field: 'street_to_comp_var', operator: cmp.op, value: cmp.value } };
  }

  // In-house to street rate variance
  if (/in.?house\s+to\s+street|ih.street\s+var|in_house_to_street|ih_street_var/i.test(lowerInput)) {
    // Raw % scale (10 = 10%) to match the engines' ih_street_var_pct metric.
    const cmp = extractCmpRaw(lowerInput);
    if (cmp) return { type: 'condition', condition: { field: 'ih_street_variance', operator: cmp.op, value: cmp.value } };
  }

  // Vacancy duration (days vacant)
  if (lowerInput.includes('vacant for') || lowerInput.includes('empty for') || lowerInput.includes('vacant over') || lowerInput.includes('days vacant')) {
    const vacancyMatch = lowerInput.match(/(?:vacant|empty)\s*(?:for|over)?\s*(\d+)\s*days?/);
    if (vacancyMatch) {
      return { type: 'condition', condition: { field: 'days_vacant', operator: '>', value: parseInt(vacancyMatch[1]) } };
    }
    // Comparison phrasing puts the number AFTER the metric — "days vacant is
    // greater than 45" — which the duration regex above cannot match. Without
    // this fallback a metric METRIC_TO_FIELD advertises as supported would
    // silently degrade to a blanket rule. days_vacant is a raw-scale metric.
    //
    // Scope the extraction to the days-vacant proposition only. Reading a
    // comparison from the whole sentence would import an unrelated clause's
    // number — "days vacant is high and T12 growth is below -2" would store
    // days_vacant < -2, a condition the text never states.
    const dvClause = clauseAroundMetric(lowerInput, 'days vacant');
    const cmp = dvClause ? extractCmpRaw(dvClause) : null;
    if (cmp) {
      return { type: 'condition', condition: { field: 'days_vacant', operator: cmp.op, value: cmp.value } };
    }
  }

  // Default to immediate if no specific trigger found
  return { type: 'immediate' };
}

function parseAction(input: string): ParsedAction | null {
  // Parse adjustment value.
  // Prefer a match that immediately follows an action verb and "by", so that condition
  // percentages (e.g. "occupancy >= 90%") are not mistakenly used as the adjustment value.
  // A written minus must be captured, not discarded. Dropping it silently turned
  // "adjust by -5%" into a 5% INCREASE — a sign flip on a live price.
  const actionPctMatch =
    input.match(/(?:increase|raise|reduce|decrease|lower|boost|add|adjust)\s+(?:\w+\s+){0,3}by\s+(-?\d+(?:\.\d+)?)%/i) ||
    input.match(/(?:increase|raise|reduce|decrease|lower|boost)\s+(?:rate\s+)?(?:by\s+)?(-?\d+(?:\.\d+)?)%/i);
  const percentMatch = actionPctMatch || input.match(/(-?\d+(?:\.\d+)?)\s*(?:%|percent(?:age)?)/);
  // Only match dollar amounts if explicitly mentioned with $ or "dollar" word, and NOT followed by "percent"
  const dollarMatch = input.match(/\$\s*(-?\d+(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s*dollars?(?!\s*percent)/);
  
  if (!percentMatch && !dollarMatch) {
    return null;
  }
  
  const isIncrease = input.includes('increase') || input.includes('raise') || input.includes('up') || 
                     input.includes('add') || input.includes('boost');
  const isDecrease = input.includes('decrease') || input.includes('reduce') || input.includes('lower') || 
                     input.includes('down') || input.includes('discount');
  
  let adjustmentType: 'percentage' | 'absolute' = 'percentage';
  let adjustmentValue = 0;
  
  // A direction verb ("decrease") owns the sign. A bare written minus survives so
  // the neutral "adjust by -5%" still reduces. When a minus contradicts the verb
  // the sentence is ambiguous, and checkRuleEnforceable refuses it rather than
  // silently picking a direction.
  if (percentMatch) {
    adjustmentType = 'percentage';
    const signed = parseFloat(percentMatch[1]);
    adjustmentValue = isDecrease ? -Math.abs(signed) : signed;
  } else if (dollarMatch) {
    adjustmentType = 'absolute';
    // ?? not ||, so a legitimate "$0" does not fall through to the other group.
    const signed = parseFloat(dollarMatch[1] ?? dollarMatch[2]);
    adjustmentValue = isDecrease ? -Math.abs(signed) : signed;
  }
  
  // Parse target rate type
  let target: 'street_rate' | 'care_rate' | 'all_rates' | 'in_house_rate' = 'street_rate';
  for (const [pattern, rateType] of Object.entries(RATE_TYPES)) {
    if (input.includes(pattern)) {
      target = rateType as 'street_rate' | 'care_rate' | 'all_rates' | 'in_house_rate';
      break;
    }
  }
  
  // Parse filters
  const filters: ParsedAction['filters'] = {};
  
  // Whole-word matcher: short codes like "al" and "il" must not match inside
  // words ("all", "renewal", "until"). Escapes regex specials (e.g. "al/mc").
  const wordMatch = (text: string, pattern: string): boolean => {
    const esc = pattern.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, 'i').test(text);
  };

  // Room type filter — collect ALL mentioned room types (rules often target
  // several, e.g. "Studio, One Bedroom, and Companion units"). Longest pattern
  // first, consuming matched text so "studio dlx" doesn't also match "studio".
  const matchedRoomTypes: string[] = [];
  let rtScan = input;
  for (const [pattern, roomType] of Object.entries(ROOM_TYPES).sort((a, b) => b[0].length - a[0].length)) {
    if (wordMatch(rtScan, pattern) && !matchedRoomTypes.includes(roomType)) {
      matchedRoomTypes.push(roomType);
      const esc = pattern.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      rtScan = rtScan.replace(new RegExp(esc, 'gi'), ' ');
    }
  }
  if (matchedRoomTypes.length) filters.roomType = matchedRoomTypes;
  
  // Service line filter — sort longest key first so "al/mc" matches before "al"
  for (const [pattern, serviceLine] of Object.entries(SERVICE_LINES).sort((a, b) => b[0].length - a[0].length)) {
    if (wordMatch(input, pattern)) {
      // Skip "sl" when it appears as part of "sl occupancy" — that phrase refers to the
      // *service line occupancy* metric, not to the "SL" (Senior Living) service line filter.
      if (pattern === 'sl' && /\bsl\s+occupancy\b/.test(input)) {
        continue;
      }
      filters.serviceLine = [serviceLine];
      break;
    }
  }
  
  // Location filter
  const locationMatch = input.match(/(?:in|at)\s+([\w\s]+?)(?:\s+location|\s+campus|\s+facility)?(?:\s+(?:by|if|when|after)|$)/);
  if (locationMatch) {
    filters.location = [locationMatch[1].trim()];
  }
  
  // Occupancy status filter.
  // A room type commonly sits between the vacancy word and "units" -- "vacant Studio Dlx
  // units", "vacant One Bedroom units" -- so a literal 'vacant unit' substring test silently
  // drops the filter and the rule ends up applying to occupied units too, contradicting its
  // own description. Match across a short run of intervening words instead. The gap refuses
  // clause words so it cannot leak across conditions (e.g. "...vacant AND occupied units").
  // "beds" is as common as "units" in senior-housing phrasing ("vacant beds"), so both
  // nouns close the match.
  const OCC_GAP = String.raw`(?:(?!(?:and|or|if|when|than|occupied|vacant|empty)\b)[A-Za-z0-9\/\-]+\s+){0,4}?`;
  const OCC_NOUN = String.raw`(?:units?|beds?)`;
  const vacantUnitsRe = new RegExp(String.raw`\b(?:vacant|empty)\s+${OCC_GAP}${OCC_NOUN}\b`, 'i');
  const occupiedUnitsRe = new RegExp(String.raw`\boccupied\s+${OCC_GAP}${OCC_NOUN}\b`, 'i');
  if (vacantUnitsRe.test(input) || /\bunoccupied\b/i.test(input)) {
    filters.occupancyStatus = 'vacant';
  } else if (occupiedUnitsRe.test(input)) {
    filters.occupancyStatus = 'occupied';
  }
  
  // Vacancy duration filter — handles both word orders:
  //   "units vacant for 60 days", "vacant units over 120 days",
  //   "vacant units unoccupied for 90 days or more"
  //
  // The second pattern deliberately allows words BETWEEN the vacancy keyword and
  // "units" so a room type can sit in the middle: "vacant One Bedroom units over
  // 60 days". Requiring "vacant" to be immediately followed by "units" silently
  // dropped the day threshold from exactly the phrasing the AI suggestion prompt
  // tells the model to produce, turning a 60-day-vacancy rule into a blanket one.
  const vacancyFilterMatch =
    input.match(/units?\s+(?:vacant|empty|unoccupied)\s*(?:for|over|more\s+than)?\s*(\d+)\s*days?/) ||
    input.match(VACANCY_DURATION_RE) ||
    input.match(/(?:vacant|empty|unoccupied)\s*(?:for|over|more\s+than)\s+(\d+)\+?\s*days?/);
  if (vacancyFilterMatch) {
    filters.vacancyDuration = {
      operator: '>',
      days: parseInt(vacancyFilterMatch[1])
    };
    if (!filters.occupancyStatus) filters.occupancyStatus = 'vacant';
  }
  
  return {
    type: 'adjust_rate',
    target,
    adjustmentType,
    adjustmentValue,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  };
}

export function generateRuleName(trigger: ParsedTrigger, action: ParsedAction): string {
  let name = '';
  
  // Add adjustment description
  const adjustmentStr = action.adjustmentType === 'percentage' 
    ? `${Math.abs(action.adjustmentValue)}%`
    : `$${Math.abs(action.adjustmentValue)}`;
  const adjustmentAction = action.adjustmentValue > 0 ? 'Increase' : 'Decrease';
  
  name = `${adjustmentAction} ${adjustmentStr}`;
  
  // Add target description
  if (action.filters?.roomType) {
    name += ` - ${action.filters.roomType.join(', ')}`;
  } else if (action.filters?.serviceLine) {
    name += ` - ${action.filters.serviceLine.join(', ')}`;
  } else if (action.target === 'care_rate') {
    name += ' - Care Rates';
  } else if (action.target === 'in_house_rate') {
    name += ' - In-House Rates';
  } else if (action.target === 'all_rates') {
    name += ' - All Rates';
  }
  
  // Add trigger description
  if (trigger.type === 'event') {
    name += ` on ${trigger.event?.replace('_', ' ')}`;
  } else if (trigger.type === 'time') {
    name += ` ${trigger.timeInterval?.unit}ly`;
  } else if (trigger.type === 'condition') {
    // Multi-condition summary
    if (trigger.conditions && trigger.conditions.length > 0) {
      const firstCond = trigger.conditions[0];
      if (firstCond.field === 'service_line_occupancy') {
        name += ` when SL occupancy ${firstCond.operator} ${typeof firstCond.value === 'number' && firstCond.value < 1 ? Math.round((firstCond.value as number) * 100) + '%' : firstCond.value + '%'}`;
      } else if (firstCond.field === 'room_type_occupancy') {
        name += ` when RT occupancy ${firstCond.operator} ${typeof firstCond.value === 'number' && firstCond.value < 1 ? Math.round((firstCond.value as number) * 100) + '%' : firstCond.value + '%'}`;
      } else if (firstCond.field === 'street_to_comp_var') {
        name += ` when street-to-comp ${firstCond.operator} ${firstCond.value}%`;
      }
      if (trigger.conditions.length > 1) {
        name += ` +${trigger.conditions.length - 1} more`;
      }
    } else if (trigger.condition) {
      if (trigger.condition.field === 'occupancy') {
        name += ` when occupancy ${trigger.condition.operator} ${typeof trigger.condition.value === 'number' && trigger.condition.value < 1 ? Math.round((trigger.condition.value as number) * 100) + '%' : trigger.condition.value + '%'}`;
      } else if (trigger.condition.field === 'days_vacant') {
        name += ` for ${trigger.condition.value}+ day vacancies`;
      }
    }
  }
  
  return name;
}

// Validation function to check if a parsed rule is valid
export function validateParsedRule(rule: ParsedRule): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate trigger
  if (!rule.trigger) {
    errors.push('No trigger condition found');
  } else if (rule.trigger.type === 'time' && !rule.trigger.timeInterval) {
    errors.push('Time trigger missing interval');
  } else if (rule.trigger.type === 'condition' && !rule.trigger.condition && !rule.trigger.conditions?.length) {
    errors.push('Condition trigger missing condition details');
  }
  
  // Validate action
  if (!rule.action) {
    errors.push('No action specified');
  } else {
    if (rule.action.adjustmentValue === 0) {
      errors.push('Adjustment value cannot be zero');
    }
    if (Math.abs(rule.action.adjustmentValue) > 100 && rule.action.adjustmentType === 'percentage') {
      errors.push('Percentage adjustment cannot exceed 100%');
    }
    if (Math.abs(rule.action.adjustmentValue) > 10000 && rule.action.adjustmentType === 'absolute') {
      errors.push('Dollar adjustment seems too large (>$10,000)');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// ── Enforceability guard ─────────────────────────────────────────────────────
// parseTrigger falls back to `{ type: 'immediate' }` whenever it cannot map a
// clause onto a supported metric, and validateParsedRule happily accepts that
// fallback. The failure is SILENT and severe: a sentence promising
// "…where the T12 growth is negative" becomes a BLANKET rule that reprices every
// unit matching the action filters. One such rule shipped against 12,551 units
// when its own note described roughly 1,000.
//
// checkRuleEnforceable compares what a sentence PROMISES against what the parser
// actually captured, so callers can refuse the rule rather than persist a
// silently-widened one. The AI suggestion pipeline must never propose a rule the
// rule designer cannot faithfully build.

/** Gate-introducing words — these announce a condition the engine must enforce. */
const GATE_INTRO_RE = new RegExp(`\\b(?:${GATE_WORD_SRC})\\b`, 'i');

/** Same vocabulary, global, for splitting a sentence into gate propositions. */
const GATE_INTRO_SPLIT_RE = new RegExp(`\\b(?:${GATE_WORD_SRC})\\b`, 'gi');

/**
 * A threshold gate: comparison phrasing bound to an actual magnitude.
 *
 * The magnitude requirement is what stops proper nouns from being mistaken for
 * conditions. Campuses have names like "Above Market Campus" and "Overlook
 * Ridge"; matching a bare "above" or "over" would reject perfectly valid
 * unconditional rules scoped to those locations.
 */
const COMPARISON_RE = new RegExp(
  [
    // "greater than 90", "less than or equal to $500"
    String.raw`\b(?:greater|less|more|fewer|higher|lower)\s+than\s+(?:or\s+equal\s+to\s+)?\$?\d`,
    // "at least 85", "no more than 3"
    String.raw`\b(?:at\s+least|at\s+most|no\s+more\s+than|no\s+less\s+than)\s+\$?\d`,
    // "exceeds 90", "drops below 80", "rises above 95"
    String.raw`\b(?:exceeds?|exceeding|surpass(?:es|ing)?)\s+\$?\d`,
    String.raw`\b(?:drops?|falls?|rises?|climbs?)\s+(?:below|under|above|over)\s+\$?\d`,
    // bare directional comparison, but only against a number
    String.raw`\b(?:above|below|under|over)\s+\$?\d`,
    // "between 80 and 90"
    String.raw`\bbetween\s+\$?\d+[^.]{0,20}?\band\s+\$?\d`,
    // sign tests, which carry no numeral: "growth is negative"
    String.raw`\bis\s+(?:negative|positive)\b`,
    // symbolic operators
    String.raw`[<>]=?\s*\$?\d`,
  ].join('|'),
  'i',
);

/**
 * Remove the parts of a sentence that the ACTION filters legitimately capture,
 * so their wording is not mistaken for an unparsed trigger condition.
 */
function stripEnforcedFilterPhrases(sentence: string, action?: ParsedAction | null): string {
  let s = ` ${sentence} `;

  // Vacancy duration ("over 60 days", "for 90 days or more") — enforced per-unit
  // through filters.vacancyDuration when it parsed.
  if (action?.filters?.vacancyDuration) {
    s = s.replace(
      /(?:for|over|more\s+than|exceeding|at\s+least)\s+\d+\+?\s*days?(?:\s+or\s+more)?/gi,
      ' ',
    );
  }
  // Occupancy status ("for vacant units", "occupied units").
  if (action?.filters?.occupancyStatus) {
    s = s.replace(/\b(?:for\s+)?(?:vacant|occupied|unoccupied|empty)\s+units?\b/gi, ' ');
    s = s.replace(/\bfor\s+(?:vacant|occupied|unoccupied|empty)\b/gi, ' ');
  }
  // Proper nouns captured as filters — room types and campus/location names.
  // Campuses are named things like "Above Market Campus" or "Overlook Ridge";
  // leaving them in the residual would read as comparison phrasing.
  const properNouns = [
    ...(action?.filters?.roomType ?? []),
    ...(action?.filters?.location ?? []),
    ...(action?.filters?.serviceLine ?? []),
  ];
  for (const noun of properNouns) {
    if (!noun) continue;
    s = s.replace(new RegExp(`\\b${noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ');
  }
  // The adjustment clause itself ("increase street rate by 5%").
  s = s.replace(
    /\b(?:increase|decrease|raise|lower|reduce|cut|adjust)\s+(?:the\s+)?(?:street|in[-\s]?house|market|care)?\s*rates?\s+by\s+\$?\d+(?:\.\d+)?%?/gi,
    ' ',
  );
  return s;
}

/**
 * Remove the wording that produced an event or time trigger, so the trigger's
 * own "when"/"after" is not re-read as an unparsed condition.
 */
function stripTriggerPhrase(sentence: string, trigger?: ParsedTrigger | null): string {
  let s = ` ${sentence} `;
  if (trigger?.type === 'time') {
    s = s
      .replace(/\b(?:every|each)\s+\d*\s*(?:day|week|month|quarter|year)s?\b/gi, ' ')
      .replace(/\b(?:daily|weekly|biweekly|monthly|quarterly|annually|yearly)\b/gi, ' ');
  } else if (trigger?.type === 'event') {
    s = s
      .replace(
        /\b(?:when|whenever|after|upon|on)\s+(?:a\s+|an\s+|the\s+)?(?:unit\s+)?(?:is\s+|becomes?\s+|gets?\s+)?(?:vacant|occupied|available|empty|sells?|sold|leas(?:es|ed)|rent(?:s|ed)?|move[-\s]?ins?|move[-\s]?outs?|turnovers?|turns?\s+over)\b/gi,
        ' ',
      )
      .replace(
        /\b(?:on|upon|after)\s+(?:each\s+|every\s+)?(?:sale|lease|move[-\s]?in|move[-\s]?out|turnover|vacancy)\b/gi,
        ' ',
      );
  }
  return s;
}

/**
 * How many distinct threshold gates the sentence appears to promise.
 *
 * Propositions are separated by gate introducers as well as by AND/OR:
 * "when occupancy is above 90 where T12 growth is negative" is two gates, not
 * one. Counting only within the first gate clause would miss the second and let
 * an under-parsed compound through.
 */
function countPromisedConditions(residual: string): number {
  let n = 0;
  for (const gatePart of residual.split(GATE_INTRO_SPLIT_RE)) {
    if (!gatePart) continue;
    for (const part of splitConditionPhrases(gatePart).parts) {
      if (!COMPARISON_RE.test(part)) continue;
      // "between X and Y" expands into two bounds (>= lo, <= hi).
      n += /\bbetween\b/i.test(part) ? 2 : 1;
    }
  }
  return n;
}

// ── Threshold scale families ────────────────────────────────────────────────
// The engine stores two different scales, and the evaluators rescale a value
// they judge to be "on the wrong one". That rescaling is what makes an
// out-of-range threshold dangerous rather than merely wrong: it silently
// multiplies by 100 instead of failing.

/** Occupancy family — stored 0–1; evaluators multiply by 100 when |v| <= 1. */
const FRACTION_SCALE_FIELDS = new Set([
  'occupancy', 'campus_occupancy', 'service_line_occupancy', 'room_type_occupancy',
  'occupancy_trailing3', 'occupancy_trailing6', 'occupancy_trailing12',
  'service_line_occupancy_trailing3', 'service_line_occupancy_trailing6', 'service_line_occupancy_trailing12',
  'room_type_occupancy_trailing3', 'room_type_occupancy_trailing6', 'room_type_occupancy_trailing12',
]);

/** On the 0–100 scale, but evaluators ALSO rescale sub-1 values as legacy fractions. */
const RESCALED_PCT_FIELDS = new Set(['ih_street_variance', 'street_to_ih_var']);

/** A written minus that contradicts the direction verb in the same clause. */
const CONTRADICTORY_SIGN_RE =
  /\b(increase|raise|boost|decrease|reduce|lower)\b[^.]{0,40}?\bby\s+\$?-\s*\d/i;

/**
 * Verify each threshold survives the engine's own rescaling as the number the
 * author wrote. A threshold outside its field's representable range is not
 * clamped or rejected downstream — it is multiplied by 100, so "variance above
 * 0.5" silently becomes "above 50%".
 */
function checkThresholdScales(conditions: SingleCond[]): EnforceabilityResult {
  for (const c of conditions) {
    if (!c || typeof c.value !== 'number' || Number.isNaN(c.value)) continue;

    if (RESCALED_PCT_FIELDS.has(c.field) && c.value !== 0 && Math.abs(c.value) <= 1) {
      return {
        ok: false,
        reason:
          `The threshold ${c.value} for "${c.field}" is ambiguous: this metric is on the ` +
          `0–100 scale, and the pricing engine rescales values of 1 or less as legacy ` +
          `fractions, so ${c.value} would be applied as ${c.value * 100}%. ` +
          `Write the threshold in percentage points — 10 means 10%.`,
      };
    }

    if (FRACTION_SCALE_FIELDS.has(c.field) && Math.abs(c.value) > 1) {
      return {
        ok: false,
        reason:
          `The occupancy threshold for "${c.field}" resolves to ${Math.round(c.value * 100)}%, ` +
          `which is outside the 0–100% range the pricing engine can represent. ` +
          `Write it as a percentage — "85%" or "85".`,
      };
    }
  }
  return { ok: true };
}

export interface EnforceabilityResult {
  /** False when the engine would not enforce what the sentence promises. */
  ok: boolean;
  /** Operator-facing explanation of what was dropped. */
  reason?: string;
}

/**
 * Verify that every gate a rule sentence promises survived parsing into a
 * trigger the pricing engine actually evaluates.
 *
 * Conservative by design: it only reports a problem when the sentence clearly
 * announces a threshold gate that is absent from the parsed trigger. Rules with
 * no conditional language at all are left alone — a deliberately unconditional,
 * well-targeted rule is legitimate.
 */
export function checkRuleEnforceable(
  sentence: string,
  parsed: ParsedRule | null,
): EnforceabilityResult {
  if (!parsed) return { ok: false, reason: 'The rule could not be parsed at all.' };

  const trigger = parsed.trigger;

  const actualCount =
    trigger?.type === 'condition'
      ? (trigger.conditions?.length ?? (trigger.condition ? 1 : 0))
      : 0;

  // Event and time triggers are real triggers, but they do NOT carry conditions.
  // "Increase 5% monthly when T12 growth is negative" parses as a time trigger
  // and drops the gate just as silently as the immediate fallback does, so the
  // residual still has to be checked — after removing the trigger's own wording,
  // which legitimately contains "when".
  let residual = stripEnforcedFilterPhrases(sentence, parsed.action);
  residual = stripTriggerPhrase(residual, trigger);
  const hasGateIntro = GATE_INTRO_RE.test(residual);
  const hasComparison = COMPARISON_RE.test(residual);

  // Case 1 — the sentence announces a gate but NOTHING was captured.
  if (actualCount === 0 && (hasGateIntro || hasComparison)) {
    return {
      ok: false,
      reason:
        'The rule text describes a condition the pricing engine cannot evaluate, so it ' +
        'would be saved as a blanket rule that applies to every unit matching its filters. ' +
        'Rewrite the condition using a supported metric, or remove it.',
    };
  }

  // Case 2 — a compound clause under-parsed: a phrase can parse standalone yet
  // vanish inside "A AND B" (or after a second gate introducer), leaving a rule
  // narrower in text than in effect.
  if (actualCount > 0) {
    const promised = countPromisedConditions(residual);
    if (promised > actualCount) {
      return {
        ok: false,
        reason:
          `The rule text promises ${promised} conditions but only ${actualCount} could be ` +
          'encoded, so the saved rule would apply more broadly than described.',
      };
    }
  }

  // Case 3 — the gates parsed, but on a scale that does not mean what was written.
  if (trigger?.type === 'condition') {
    const conds = (trigger.conditions ?? (trigger.condition ? [trigger.condition] : [])) as SingleCond[];
    const scale = checkThresholdScales(conds);
    if (!scale.ok) return scale;
  }

  // Case 4 — the amount's sign contradicts the direction verb. "Increase by -5%"
  // has two defensible readings and the parser must not pick one on its own.
  if (CONTRADICTORY_SIGN_RE.test(sentence)) {
    return {
      ok: false,
      reason:
        'The rule states a direction (increase/decrease) but writes the amount as a ' +
        'negative number, which has two possible meanings. Use a positive amount with ' +
        'the direction word — "decrease street rate by 5%".',
    };
  }

  return { ok: true };
}

/**
 * Human-readable list of the metrics a trigger condition may reference.
 * Sourced from METRIC_TO_FIELD so prompt text and parser grammar cannot drift.
 */
export function supportedTriggerMetrics(): string[] {
  return Array.from(new Set(METRIC_TO_FIELD.map(m => m.field))).sort();
}
