/**
 * Derived-rate formula tests.
 *
 * These formulas turn one measured number into six charged numbers, so the
 * arithmetic has to be boring and predictable. The two things that actually
 * bite:
 *   - rounding more than once (percentage, then offset), which produces
 *     off-by-a-dollar drift that surfaces as penny mismatches in exports;
 *   - a disabled or nonsensical formula returning a plausible number instead
 *     of null, which is how a placeholder gets billed to a resident.
 */
import { describe, it, expect } from 'vitest';
import {
  DERIVED_RATE_TYPES,
  DERIVED_RATE_TYPE_META,
  applyDerivedFormula,
  defaultFormulas,
  describeFormula,
  isDerivedRateType,
  metaFor,
  resolveFormula,
  validateFormula,
} from '../shared/derivedRates';

const f = (percentOfBase: number, dollarOffset = 0, enabled = true) => ({
  percentOfBase,
  dollarOffset,
  enabled,
});

describe('the six rate types', () => {
  it('has one metadata entry per type, in the same order', () => {
    expect(DERIVED_RATE_TYPE_META.map((m) => m.type)).toEqual([...DERIVED_RATE_TYPES]);
  });

  it('gives every type a label and a description', () => {
    for (const m of DERIVED_RATE_TYPE_META) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
    }
  });

  it('defaults are all valid by its own validator', () => {
    for (const d of defaultFormulas()) expect(validateFormula(d)).toBeNull();
  });

  it('recognises its own types and rejects others', () => {
    for (const t of DERIVED_RATE_TYPES) expect(isDerivedRateType(t)).toBe(true);
    expect(isDerivedRateType('base_rate')).toBe(false);
    expect(isDerivedRateType('')).toBe(false);
  });

  it('metaFor round-trips', () => {
    for (const t of DERIVED_RATE_TYPES) expect(metaFor(t).type).toBe(t);
  });
});

describe('applyDerivedFormula', () => {
  it('applies a plain percentage', () => {
    expect(applyDerivedFormula(400, f(55))).toBe(220);
    expect(applyDerivedFormula(400, f(100))).toBe(400);
    expect(applyDerivedFormula(400, f(130))).toBe(520);
  });

  it('applies a dollar offset', () => {
    expect(applyDerivedFormula(400, f(100, 25))).toBe(425);
    expect(applyDerivedFormula(400, f(100, -40))).toBe(360);
  });

  it('applies percentage and offset together', () => {
    expect(applyDerivedFormula(400, f(80, 15))).toBe(335); // 320 + 15
  });

  it('rounds exactly once, at the end', () => {
    // 413 * 82.5% = 340.725, + 0.30 = 341.025 -> 341.
    // Rounding the percentage first would give 341 + 0.30 -> 341 as well, so
    // use a case where the two disagree: 413 * 82.5% = 340.725 -> 341 (early),
    // + 0.4 = 341.4 -> 341; correct single rounding is 341.125 -> 341.
    // The discriminating case:
    expect(applyDerivedFormula(101, f(50, 0.5))).toBe(51); // 50.5 + 0.5 = 51
    // Early rounding would give round(50.5)=51, then 51+0.5=51.5 -> 52.
    expect(applyDerivedFormula(101, f(50, 0.5))).not.toBe(52);
  });

  it('returns null rather than a plausible number when disabled', () => {
    expect(applyDerivedFormula(400, f(55, 0, false))).toBeNull();
  });

  it('returns null for a missing or non-positive base', () => {
    expect(applyDerivedFormula(null, f(55))).toBeNull();
    expect(applyDerivedFormula(undefined, f(55))).toBeNull();
    expect(applyDerivedFormula(0, f(55))).toBeNull();
    expect(applyDerivedFormula(-100, f(55))).toBeNull();
    expect(applyDerivedFormula(NaN, f(55))).toBeNull();
  });

  it('returns null for a missing formula', () => {
    expect(applyDerivedFormula(400, null)).toBeNull();
    expect(applyDerivedFormula(400, undefined)).toBeNull();
  });

  it('returns null when the result would be zero or negative', () => {
    // A large negative offset must not produce a $0 or negative charge.
    expect(applyDerivedFormula(100, f(50, -50))).toBeNull();
    expect(applyDerivedFormula(100, f(50, -900))).toBeNull();
  });

  it('returns null for non-numeric inputs instead of NaN', () => {
    expect(applyDerivedFormula(400, f(NaN))).toBeNull();
    expect(applyDerivedFormula(400, f(50, NaN))).toBeNull();
  });
});

describe('validateFormula', () => {
  it('accepts ordinary values', () => {
    expect(validateFormula(f(55))).toBeNull();
    expect(validateFormula(f(0))).toBeNull();
    expect(validateFormula(f(155, -25))).toBeNull();
  });

  it('rejects a negative percentage', () => {
    expect(validateFormula(f(-5))).toMatch(/negative/i);
  });

  it('rejects an implausible percentage', () => {
    // 820% is the fat-finger case the preview column exists to catch.
    expect(validateFormula(f(820))).toMatch(/typo/i);
    expect(validateFormula(f(500))).toBeNull(); // boundary is inclusive
  });

  it('rejects non-numbers', () => {
    expect(validateFormula(f(NaN))).toMatch(/number/i);
    expect(validateFormula(f(50, NaN))).toMatch(/number/i);
  });

  it('rejects an out-of-range offset', () => {
    expect(validateFormula(f(100, 250000))).toMatch(/range/i);
    expect(validateFormula(f(100, -250000))).toMatch(/range/i);
  });
});

describe('resolveFormula precedence', () => {
  const portfolio = { rateType: 'second_occupant', serviceLine: null, ...f(55) } as any;
  const hcSpecific = { rateType: 'second_occupant', serviceLine: 'HC', ...f(70) } as any;

  it('prefers a service-line row over the portfolio-wide row', () => {
    const got = resolveFormula([portfolio, hcSpecific], 'second_occupant' as any, 'HC');
    expect(got?.percentOfBase).toBe(70);
  });

  it('falls back to the portfolio-wide row for other service lines', () => {
    const got = resolveFormula([portfolio, hcSpecific], 'second_occupant' as any, 'AL');
    expect(got?.percentOfBase).toBe(55);
  });

  it('is order-independent', () => {
    const got = resolveFormula([hcSpecific, portfolio], 'second_occupant' as any, 'HC');
    expect(got?.percentOfBase).toBe(70);
  });

  it('returns null when nothing matches', () => {
    expect(resolveFormula([], 'second_occupant' as any, 'HC')).toBeNull();
  });
});

describe('describeFormula', () => {
  it('describes a plain percentage', () => {
    expect(describeFormula(f(55))).toBe('55% of base');
  });

  it('shows the sign of an offset', () => {
    expect(describeFormula(f(100, 25))).toContain('+');
    expect(describeFormula(f(100, -25))).toContain('−');
  });

  it('omits a zero offset', () => {
    expect(describeFormula(f(80, 0))).toBe('80% of base');
  });
});
