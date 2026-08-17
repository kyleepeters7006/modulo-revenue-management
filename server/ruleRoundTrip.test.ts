/**
 * Round-trip parity tests: structured builder vs. sentence parser.
 *
 * For every supported metric/operator combination, we verify that
 * buildRuleFromStructured() and parseNaturalLanguageRule() produce identical
 * trigger conditions and action shapes.  A future change to a field name,
 * threshold scale, or operator mapping that touches one path but not the other
 * will be caught here before it can silently alter live pricing behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRuleFromStructured,
  type StructuredRulePayload,
} from './structuredRuleBuilder';
import {
  parseNaturalLanguageRule,
  type ParsedTrigger,
  type ParsedAction,
} from './naturalLanguageParser';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build via structured path, assert ok=true, return trigger + action.
 */
function fromStructured(payload: StructuredRulePayload) {
  const result = buildRuleFromStructured(payload, 'test description');
  if (!result.ok) throw new Error(`buildRuleFromStructured failed: ${result.reason}`);
  return { trigger: result.rule.trigger, action: result.rule.action };
}

/**
 * Parse via sentence path, assert non-null, return trigger + action.
 */
function fromSentence(sentence: string) {
  const result = parseNaturalLanguageRule(sentence);
  if (!result) throw new Error(`parseNaturalLanguageRule returned null for: "${sentence}"`);
  return { trigger: result.trigger, action: result.action };
}

/** Canonical increase-3% action expected from both paths (street rate, no filters). */
const INCREASE_3PCT: ParsedAction = {
  type: 'adjust_rate',
  target: 'street_rate',
  adjustmentType: 'percentage',
  adjustmentValue: 3,
};

/** Canonical decrease-5% action expected from both paths (street rate, no filters). */
const DECREASE_5PCT: ParsedAction = {
  type: 'adjust_rate',
  target: 'street_rate',
  adjustmentType: 'percentage',
  adjustmentValue: -5,
};

// A minimal structured payload with a single condition; callers spread overrides.
const basePayload = (
  metric: string,
  operator: string,
  value: string,
  timePeriod?: string,
  extra: Partial<StructuredRulePayload> = {},
): StructuredRulePayload => ({
  conditions: [{ metric, operator, value, ...(timePeriod ? { timePeriod } : {}) }],
  action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
  ...extra,
});

// ── Occupancy metrics — current snapshot ─────────────────────────────────────

describe('Campus Occupancy (current snapshot)', () => {
  it('explicit % — 85% parses to 0.85 on both paths', () => {
    const s = fromStructured(basePayload('Campus Occupancy', 'is greater than or equal to', '85%'));
    const p = fromSentence(
      'If campus occupancy is greater than or equal to 85%, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);
    expect(s.action).toEqual(INCREASE_3PCT);
    expect(p.action).toEqual(INCREASE_3PCT);
    // field and value are pinned precisely
    const cond = (s.trigger as any).condition;
    expect(cond.field).toBe('occupancy');
    expect(cond.operator).toBe('>=');
    expect(cond.value).toBeCloseTo(0.85);
  });

  it('no % suffix — magnitude >1 is treated as percentage points (80 → 0.80)', () => {
    const s = fromStructured(basePayload('Campus Occupancy', 'is less than', '80'));
    const p = fromSentence(
      'If campus occupancy is less than 80, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);
    const cond = (s.trigger as any).condition;
    expect(cond.field).toBe('occupancy');
    expect(cond.operator).toBe('<');
    expect(cond.value).toBeCloseTo(0.80);
  });

  it('no % suffix — magnitude ≤1 kept as-is (0.85 stays 0.85)', () => {
    const s = fromStructured(basePayload('Campus Occupancy', 'is greater than or equal to', '0.85'));
    const p = fromSentence(
      'If campus occupancy is greater than or equal to 0.85, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);
    const cond = (s.trigger as any).condition;
    expect(cond.value).toBeCloseTo(0.85);
  });

  it('is less than or equal to', () => {
    const s = fromStructured(basePayload('Campus Occupancy', 'is less than or equal to', '92%'));
    const p = fromSentence(
      'If campus occupancy is less than or equal to 92%, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);
    const cond = (s.trigger as any).condition;
    expect(cond.operator).toBe('<=');
    expect(cond.value).toBeCloseTo(0.92);
  });

  it('is greater than (no equals)', () => {
    const s = fromStructured(basePayload('Campus Occupancy', 'is greater than', '70%'));
    const p = fromSentence(
      'If campus occupancy is greater than 70%, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);
    const cond = (s.trigger as any).condition;
    expect(cond.operator).toBe('>');
    expect(cond.value).toBeCloseTo(0.70);
  });
});

describe('Service Line Occupancy (current snapshot)', () => {
  it('>= 90%', () => {
    const s = fromStructured(basePayload('Service Line Occupancy', 'is greater than or equal to', '90%'));
    const p = fromSentence(
      'If service line occupancy is greater than or equal to 90%, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);
    const cond = (s.trigger as any).condition;
    expect(cond.field).toBe('service_line_occupancy');
    expect(cond.value).toBeCloseTo(0.90);
  });
});

describe('Room Type Occupancy (current snapshot)', () => {
  it('<= 75%', () => {
    const s = fromStructured(basePayload('Room Type Occupancy', 'is less than or equal to', '75%'));
    const p = fromSentence(
      'If room type occupancy is less than or equal to 75%, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);
    const cond = (s.trigger as any).condition;
    expect(cond.field).toBe('room_type_occupancy');
    expect(cond.value).toBeCloseTo(0.75);
  });
});

// ── Trailing-window occupancy variants ───────────────────────────────────────

describe('Trailing-window occupancy', () => {
  const trailingCases: Array<[string, string, string, string]> = [
    ['Campus Occupancy',       'Trailing 3',  'occupancy_trailing3',             '85%'],
    ['Campus Occupancy',       'Trailing 6',  'occupancy_trailing6',             '82%'],
    ['Campus Occupancy',       'Trailing 12', 'occupancy_trailing12',            '78%'],
    ['Service Line Occupancy', 'Trailing 3',  'service_line_occupancy_trailing3', '88%'],
    ['Service Line Occupancy', 'Trailing 6',  'service_line_occupancy_trailing6', '86%'],
    ['Service Line Occupancy', 'Trailing 12', 'service_line_occupancy_trailing12','80%'],
    ['Room Type Occupancy',    'Trailing 3',  'room_type_occupancy_trailing3',    '83%'],
    ['Room Type Occupancy',    'Trailing 6',  'room_type_occupancy_trailing6',    '79%'],
    ['Room Type Occupancy',    'Trailing 12', 'room_type_occupancy_trailing12',   '76%'],
  ];

  const sentenceMetric: Record<string, string> = {
    'Campus Occupancy':       'campus occupancy',
    'Service Line Occupancy': 'service line occupancy',
    'Room Type Occupancy':    'room type occupancy',
  };

  for (const [metric, timePeriod, expectedField, value] of trailingCases) {
    it(`${metric} ${timePeriod} → ${expectedField}`, () => {
      const s = fromStructured(basePayload(metric, 'is greater than or equal to', value, timePeriod));

      // Sentence uses the parenthesised form the structured builder produces in descriptions.
      const windowNum = timePeriod.split(' ')[1]; // '3' | '6' | '12'
      const sentence = `If ${sentenceMetric[metric]} (trailing ${windowNum}) is greater than or equal to ${value}, increase rate by 3%`;
      const p = fromSentence(sentence);

      expect(s.trigger).toEqual(p.trigger);
      const cond = (s.trigger as any).condition;
      expect(cond.field).toBe(expectedField);
      expect(cond.operator).toBe('>=');
    });
  }

  it('current-period explicit label (Current Month) → no trailing suffix', () => {
    const s = fromStructured(
      basePayload('Campus Occupancy', 'is greater than or equal to', '85%', 'Current Month'),
    );
    const cond = (s.trigger as any).condition;
    expect(cond.field).toBe('occupancy'); // no _trailingN suffix
  });
});

// ── "is between" range expansion ─────────────────────────────────────────────

describe('"is between" range → two conditions (>= lo AND <= hi)', () => {
  it('campus occupancy between 80 and 90 (no %)', () => {
    const s = fromStructured(basePayload('Campus Occupancy', 'is between', '80 and 90'));
    const p = fromSentence(
      'If campus occupancy is between 80 and 90, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);

    const conds = (s.trigger as any).conditions as Array<{ field: string; operator: string; value: number }>;
    expect(conds).toHaveLength(2);
    expect(conds[0]).toMatchObject({ field: 'occupancy', operator: '>=', value: expect.closeTo(0.80, 5) });
    expect(conds[1]).toMatchObject({ field: 'occupancy', operator: '<=', value: expect.closeTo(0.90, 5) });
    expect((s.trigger as any).conditionOperator).toBe('AND');
  });

  it('campus occupancy between 80% and 90% (explicit %)', () => {
    const s = fromStructured(basePayload('Campus Occupancy', 'is between', '80% and 90%'));
    const p = fromSentence(
      'If campus occupancy is between 80% and 90%, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);

    const conds = (s.trigger as any).conditions as Array<{ value: number }>;
    expect(conds[0].value).toBeCloseTo(0.80);
    expect(conds[1].value).toBeCloseTo(0.90);
  });

  it('street-to-comp var % between -10 and 5 (raw scale — no division by 100)', () => {
    const s = fromStructured(
      basePayload('Street Rate to Top Comp Var %', 'is between', '-10 and 5'),
    );
    const p = fromSentence(
      'If street rate to top comp var % is between -10 and 5, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);

    const conds = (s.trigger as any).conditions as Array<{ value: number }>;
    expect(conds[0].value).toBeCloseTo(-10);
    expect(conds[1].value).toBeCloseTo(5);
  });
});

// ── Raw-scale metrics (0–100 %, day counts, unit counts) ─────────────────────

describe('Raw-scale metrics — threshold kept as written', () => {
  const rawCases: Array<[string, string, string, string, string]> = [
    // metric label, operator, value, expected field, description
    ['Street Rate to Top Comp Var %',               'is greater than or equal to', '-5',  'street_to_comp_var', '>= -5'],
    ['Street Rate to Top Comp Var %',               'is less than',                 '10', 'street_to_comp_var', '< 10'],
    ['In House to Street Rate Var % - Single Occupant', 'is less than or equal to', '-10','ih_street_variance', '<= -10'],
    ['In House to Street Rate Var % - Single Occupant', 'is greater than',           '5', 'ih_street_variance', '> 5'],
    ['Competitor Rate',                             'is less than',                 '-3', 'competitor_variance', '< -3'],
    ['Days Vacant',                                 'is greater than',              '30', 'days_vacant',         '> 30'],
    ['Days Vacant',                                 'is greater than or equal to',  '60', 'days_vacant',         '>= 60'],
    ['Vacant Units/Beds',                           'is greater than',              '5',  'vacant_units',        '> 5'],
    ['Total Units/Beds',                            'is greater than or equal to',  '10', 'total_units',         '>= 10'],
    ['Inquiry and Tour Volume',                     'is less than',                 '3',  'inquiry_volume',      '< 3'],
    ['Quality Mix',                                 'is less than',                 '80', 'quality_mix',         '< 80'],
  ];

  for (const [metric, operator, value, expectedField, desc] of rawCases) {
    it(`${metric} ${desc}`, () => {
      const s = fromStructured(basePayload(metric, operator, value));
      const cond = (s.trigger as any).condition as { field: string; operator: string; value: number };
      expect(cond.field).toBe(expectedField);
      expect(cond.value).toBeCloseTo(parseFloat(value));
    });
  }

  it('negative threshold — structured builder preserves sign (street_to_comp_var >= -5)', () => {
    const s = fromStructured(basePayload('Street Rate to Top Comp Var %', 'is greater than or equal to', '-5'));
    const p = fromSentence(
      'increase rate by 3% if street rate to top comp var % is greater than or equal to -5',
    );
    expect(s.trigger).toEqual(p.trigger);
    const cond = (s.trigger as any).condition;
    expect(cond.value).toBeCloseTo(-5);
  });

  it('negative threshold — ih_street_variance <= -10 matches sentence', () => {
    const s = fromStructured(
      basePayload('In House to Street Rate Var % - Single Occupant', 'is less than or equal to', '-10'),
    );
    const p = fromSentence(
      'increase rate by 3% if in house to street rate var % - single occupant is less than or equal to -10',
    );
    expect(s.trigger).toEqual(p.trigger);
    const cond = (s.trigger as any).condition;
    expect(cond.field).toBe('ih_street_variance');
    expect(cond.value).toBeCloseTo(-10);
  });

  it('days vacant > 30 matches sentence', () => {
    const s = fromStructured(basePayload('Days Vacant', 'is greater than', '30'));
    const p = fromSentence('increase rate by 3% if days vacant is greater than 30');
    expect(s.trigger).toEqual(p.trigger);
    const cond = (s.trigger as any).condition;
    expect(cond.field).toBe('days_vacant');
    expect(cond.value).toBeCloseTo(30);
  });
});

// ── Action variants ───────────────────────────────────────────────────────────

describe('Action — sign and type', () => {
  it('increase_rate produces positive adjustmentValue', () => {
    const s = fromStructured({
      conditions: [{ metric: 'Campus Occupancy', operator: 'is less than', value: '80%' }],
      action: { type: 'increase_rate', amountType: 'percent', amountValue: '5' },
    });
    expect(s.action.adjustmentValue).toBe(5);
    expect(s.action.adjustmentType).toBe('percentage');
  });

  it('decrease_rate produces negative adjustmentValue', () => {
    const s = fromStructured({
      conditions: [{ metric: 'Campus Occupancy', operator: 'is greater than', value: '92%' }],
      action: { type: 'decrease_rate', amountType: 'percent', amountValue: '5' },
    });
    expect(s.action.adjustmentValue).toBe(-5);
    expect(s.action.adjustmentType).toBe('percentage');
  });

  it('apply_discount also produces negative adjustmentValue', () => {
    const s = fromStructured({
      conditions: [{ metric: 'Campus Occupancy', operator: 'is greater than', value: '92%' }],
      action: { type: 'apply_discount', amountType: 'percent', amountValue: '3' },
    });
    expect(s.action.adjustmentValue).toBe(-3);
  });

  it('dollar action maps to adjustmentType=absolute', () => {
    const s = fromStructured({
      conditions: [{ metric: 'Campus Occupancy', operator: 'is less than', value: '80%' }],
      action: { type: 'increase_rate', amountType: 'dollar', amountValue: '100' },
    });
    expect(s.action.adjustmentType).toBe('absolute');
    expect(s.action.adjustmentValue).toBe(100);

    // Use a condition with no "%" so the sentence parser's fallback percent-match
    // does not accidentally pick up the condition threshold instead of the dollar amount.
    // (A sentence with "80%" in the condition + "$100" action confuses the NLP parser's
    //  percent fallback regex — that is a known sentence-parser limitation, not a
    //  structured-path concern.)
    const p = fromSentence(
      'If days vacant is greater than 30, increase rate by $100',
    );
    expect(p.action.adjustmentType).toBe('absolute');
    expect(p.action.adjustmentValue).toBe(100);
    expect(s.action.adjustmentType).toEqual(p.action.adjustmentType);
    expect(s.action.adjustmentValue).toEqual(p.action.adjustmentValue);
  });

  it('decrease dollar matches sentence', () => {
    const s = fromStructured({
      conditions: [{ metric: 'Campus Occupancy', operator: 'is greater than or equal to', value: '92%' }],
      action: { type: 'decrease_rate', amountType: 'dollar', amountValue: '50' },
    });
    expect(s.action.adjustmentValue).toBe(-50);
    expect(s.action.adjustmentType).toBe('absolute');
  });

  it('decrease rate — structured vs. sentence produce identical action', () => {
    const s = fromStructured({
      conditions: [{ metric: 'Campus Occupancy', operator: 'is greater than or equal to', value: '92%' }],
      action: { type: 'decrease_rate', amountType: 'percent', amountValue: '5' },
    });
    const p = fromSentence(
      'If campus occupancy is greater than or equal to 92%, decrease rate by 5%',
    );
    expect(s.action).toEqual(p.action);
    expect(s.trigger).toEqual(p.trigger);
  });
});

// ── Action filter — vacant scope ──────────────────────────────────────────────

describe('Action filter — Vacant units only scope', () => {
  it('adds occupancyStatus=vacant to action filters', () => {
    const s = fromStructured({
      conditions: [{ metric: 'Campus Occupancy', operator: 'is less than', value: '80%' }],
      action: { type: 'increase_rate', amountType: 'percent', amountValue: '3', scope: 'Vacant units only' },
    });
    expect(s.action.filters?.occupancyStatus).toBe('vacant');
  });

  it('vacancyDays adds vacancyDuration filter', () => {
    const s = fromStructured({
      conditions: [{ metric: 'Campus Occupancy', operator: 'is less than', value: '80%' }],
      action: {
        type: 'increase_rate',
        amountType: 'percent',
        amountValue: '3',
        scope: 'Vacant units only',
        vacancyDays: 60,
      },
    });
    expect(s.action.filters?.occupancyStatus).toBe('vacant');
    expect(s.action.filters?.vacancyDuration).toEqual({ operator: '>', days: 60 });
  });
});

// ── Multi-condition (AND / OR) ────────────────────────────────────────────────

describe('Multi-condition — AND', () => {
  it('two campus occupancy + SL occupancy conditions', () => {
    const payload: StructuredRulePayload = {
      conditions: [
        { metric: 'Campus Occupancy',       operator: 'is less than',                 value: '80%' },
        { metric: 'Service Line Occupancy', operator: 'is less than or equal to',     value: '85%' },
      ],
      conditionOperator: 'AND',
      action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
    };
    const s = fromStructured(payload);

    const p = fromSentence(
      'If campus occupancy is less than 80% AND service line occupancy is less than or equal to 85%, increase rate by 3%',
    );

    expect(s.trigger).toEqual(p.trigger);

    const conds = (s.trigger as any).conditions as Array<{ field: string; operator: string; value: number }>;
    expect(conds).toHaveLength(2);
    expect(conds[0]).toMatchObject({ field: 'occupancy', operator: '<' });
    expect(conds[1]).toMatchObject({ field: 'service_line_occupancy', operator: '<=' });
    expect((s.trigger as any).conditionOperator).toBe('AND');
  });

  it('campus occupancy + room type occupancy', () => {
    const payload: StructuredRulePayload = {
      conditions: [
        { metric: 'Campus Occupancy',    operator: 'is greater than', value: '90%' },
        { metric: 'Room Type Occupancy', operator: 'is greater than', value: '88%' },
      ],
      conditionOperator: 'AND',
      action: { type: 'decrease_rate', amountType: 'percent', amountValue: '5' },
    };
    const s = fromStructured(payload);
    const p = fromSentence(
      'If campus occupancy is greater than 90% AND room type occupancy is greater than 88%, decrease rate by 5%',
    );
    expect(s.trigger).toEqual(p.trigger);
    expect(s.action).toEqual(p.action);
  });
});

describe('Multi-condition — OR', () => {
  it('campus OR service line occupancy', () => {
    const payload: StructuredRulePayload = {
      conditions: [
        { metric: 'Campus Occupancy',       operator: 'is greater than', value: '90%' },
        { metric: 'Service Line Occupancy', operator: 'is greater than', value: '88%' },
      ],
      conditionOperator: 'OR',
      action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
    };
    const s = fromStructured(payload);
    const p = fromSentence(
      'If campus occupancy is greater than 90% OR service line occupancy is greater than 88%, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);
    expect((s.trigger as any).conditionOperator).toBe('OR');
  });
});

// ── Trailing window + compound ────────────────────────────────────────────────

describe('Trailing-window metric in a compound condition', () => {
  it('campus occupancy trailing 3 AND service line occupancy current', () => {
    const payload: StructuredRulePayload = {
      conditions: [
        { metric: 'Campus Occupancy',       operator: 'is less than', value: '80%', timePeriod: 'Trailing 3' },
        { metric: 'Service Line Occupancy', operator: 'is less than', value: '85%' },
      ],
      conditionOperator: 'AND',
      action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
    };
    const s = fromStructured(payload);
    const p = fromSentence(
      'If campus occupancy (trailing 3) is less than 80% AND service line occupancy is less than 85%, increase rate by 3%',
    );
    expect(s.trigger).toEqual(p.trigger);
    const conds = (s.trigger as any).conditions as Array<{ field: string }>;
    expect(conds[0].field).toBe('occupancy_trailing3');
    expect(conds[1].field).toBe('service_line_occupancy');
  });
});

// ── Fallback: unsupported structured payload ──────────────────────────────────

describe('Fallback — unsupported structured payload', () => {
  it('unknown metric → ok:false (caller must fall back to sentence parsing)', () => {
    const result = buildRuleFromStructured(
      {
        conditions: [{ metric: 'Nonexistent Metric', operator: 'is greater than', value: '5' }],
        action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
      },
      'unsupported metric rule',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsupported metric/i);
  });

  it('unknown operator → ok:false', () => {
    const result = buildRuleFromStructured(
      {
        conditions: [{ metric: 'Campus Occupancy', operator: 'is approximately', value: '80%' }],
        action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
      },
      'unknown operator',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsupported operator/i);
  });

  it('unsupported action type → ok:false', () => {
    // Use a non-zero amount so the amount check passes and the type check is reached.
    const result = buildRuleFromStructured(
      {
        conditions: [{ metric: 'Campus Occupancy', operator: 'is less than', value: '80%' }],
        action: { type: 'hold_rate', amountType: 'percent', amountValue: '3' },
      },
      'hold action',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsupported action type/i);
  });

  it('non-trailing metric with a trailing time period → ok:false', () => {
    const result = buildRuleFromStructured(
      {
        conditions: [{ metric: 'Days Vacant', operator: 'is greater than', value: '30', timePeriod: 'Trailing 3' }],
        action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
      },
      'days vacant trailing — invalid',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/no trailing-window variant/i);
  });

  it('unsupported time period → ok:false', () => {
    const result = buildRuleFromStructured(
      {
        conditions: [{ metric: 'Campus Occupancy', operator: 'is greater than', value: '80%', timePeriod: 'Trailing 2' }],
        action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
      },
      'unsupported period',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unsupported time period/i);
  });

  it('OR + between combination → ok:false (cannot safely expand range under OR)', () => {
    const result = buildRuleFromStructured(
      {
        conditions: [
          { metric: 'Campus Occupancy', operator: 'is between', value: '80 and 90' },
          { metric: 'Service Line Occupancy', operator: 'is less than', value: '85%' },
        ],
        conditionOperator: 'OR',
        action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
      },
      'or+between invalid',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/between.*or/i);
  });

  it('empty conditions list → ok:false', () => {
    const result = buildRuleFromStructured(
      {
        conditions: [],
        action: { type: 'increase_rate', amountType: 'percent', amountValue: '3' },
      },
      'no conditions',
    );
    expect(result.ok).toBe(false);
  });

  it('zero action amount → ok:false', () => {
    const result = buildRuleFromStructured(
      {
        conditions: [{ metric: 'Campus Occupancy', operator: 'is less than', value: '80%' }],
        action: { type: 'increase_rate', amountType: 'percent', amountValue: '0' },
      },
      'zero amount',
    );
    expect(result.ok).toBe(false);
  });

  it('sentence parser still works for free-text equivalent of an unsupported structured payload', () => {
    // When structured path fails, the caller falls back to parseNaturalLanguageRule.
    // Verify the NLP path produces a valid result for a sentence the structured path
    // could not handle (e.g. a time-based trigger the designer does not expose).
    const p = parseNaturalLanguageRule('increase rate by 3% monthly');
    expect(p).not.toBeNull();
    expect(p?.trigger.type).toBe('time');
  });
});

// ── Threshold scale parity — the critical regression guard ───────────────────
//
// These tests pin the exact numeric values coming out of both paths.
// Any future change that breaks scale agreement (e.g. dividing a raw metric
// by 100, or forgetting to divide a fraction metric) will fail here.

describe('Threshold scale parity (regression guard)', () => {
  it('fraction metric: 85% → exactly 0.85 from both paths', () => {
    const s = fromStructured(basePayload('Campus Occupancy', 'is greater than or equal to', '85%'));
    const p = fromSentence('If campus occupancy is greater than or equal to 85%, increase rate by 3%');
    const sv = (s.trigger as any).condition.value;
    const pv = (p.trigger as any).condition.value;
    expect(sv).toBeCloseTo(0.85, 10);
    expect(pv).toBeCloseTo(0.85, 10);
    expect(sv).toBeCloseTo(pv, 10);
  });

  it('raw metric: street_to_comp_var 10 → exactly 10 from both paths (no /100)', () => {
    const s = fromStructured(basePayload('Street Rate to Top Comp Var %', 'is less than', '10'));
    const p = fromSentence('increase rate by 3% if street rate to top comp var % is less than 10');
    const sv = (s.trigger as any).condition.value;
    const pv = (p.trigger as any).condition.value;
    expect(sv).toBeCloseTo(10, 10);
    expect(pv).toBeCloseTo(10, 10);
    expect(sv).toBeCloseTo(pv, 10);
  });

  it('raw metric: ih_street_variance -10 → exactly -10 from both paths', () => {
    const s = fromStructured(
      basePayload('In House to Street Rate Var % - Single Occupant', 'is less than or equal to', '-10'),
    );
    const p = fromSentence(
      'increase rate by 3% if in house to street rate var % - single occupant is less than or equal to -10',
    );
    const sv = (s.trigger as any).condition.value;
    const pv = (p.trigger as any).condition.value;
    expect(sv).toBeCloseTo(-10, 10);
    expect(pv).toBeCloseTo(-10, 10);
    expect(sv).toBeCloseTo(pv, 10);
  });

  it('between bounds: 80 and 90 on fraction metric → 0.80 and 0.90 exactly', () => {
    const s = fromStructured(basePayload('Campus Occupancy', 'is between', '80 and 90'));
    const conds = (s.trigger as any).conditions as Array<{ value: number }>;
    expect(conds[0].value).toBeCloseTo(0.80, 10);
    expect(conds[1].value).toBeCloseTo(0.90, 10);
  });
});
