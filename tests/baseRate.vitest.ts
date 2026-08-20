/**
 * Base-rate predicate tests.
 *
 * What is actually at risk here:
 *  1. A campus name containing a keyword ("Woodward", "Edwards") being read as
 *     a ward and silently deleting a campus from every rate average. This is
 *     the same class of bug as the earlier COMM/COMMONS trap, and it fails
 *     invisibly — the number just gets quieter.
 *  2. Senior housing changing at all. This work was supposed to leave AL,
 *     AL/MC, SL and VIL byte-identical; a regression there is a regression in
 *     numbers the user has already signed off on.
 *  3. The JS and SQL twins drifting apart. They are two spellings of one rule.
 *
 * The SQL twin is exercised against Postgres in baseRateSqlParity.test.ts;
 * this file covers the pure logic, which needs no database.
 */
import { describe, it, expect } from 'vitest';
import {
  isBaseRateRow,
  isNonBaseBedTypeRow,
  baseRateExclusionSql,
  BED_TYPE_SLS,
} from '../shared/baseRate';

const base = (sl: string, room: string, rt: string, src = rt) =>
  isBaseRateRow(sl, room, rt, src);

describe('senior housing is unchanged by the base-rate predicate', () => {
  const SH = ['AL', 'AL/MC', 'SL', 'VIL'];

  it('keeps ordinary senior-housing rooms', () => {
    for (const sl of SH) {
      expect(base(sl, '101', 'Studio')).toBe(true);
      expect(base(sl, '204', 'One Bedroom')).toBe(true);
      expect(base(sl, '310', 'Companion')).toBe(true); // room TYPE is irrelevant for SH
    }
  });

  it('still drops B-bed companion rows, exactly as before', () => {
    for (const sl of SH) {
      expect(base(sl, '101/B', 'Studio')).toBe(false);
      expect(base(sl, '101/c', 'Studio')).toBe(false);
    }
  });

  it('keeps the /A primary bed', () => {
    for (const sl of SH) expect(base(sl, '101/A', 'Studio')).toBe(true);
  });

  it('does not apply the bed-type arm to senior housing', () => {
    // A senior-housing row described as respite is still a base row: the new
    // arm is deliberately scoped to the two service lines that carry bed-type
    // descriptors. Widening it would change signed-off numbers.
    for (const sl of SH) {
      expect(isNonBaseBedTypeRow(sl, 'Respite Studio', 'Respite Studio')).toBe(false);
      expect(base(sl, '101', 'Respite Studio')).toBe(true);
    }
  });
});

describe('HC and HC/MC exclude non-base products', () => {
  for (const sl of Array.from(BED_TYPE_SLS)) {
    it(`${sl}: keeps single-occupant private rooms`, () => {
      expect(base(sl, '12', 'Private')).toBe(true);
      expect(base(sl, '12', 'Studio')).toBe(true);
      expect(base(sl, '12', 'Deluxe Private')).toBe(true);
    });

    it(`${sl}: drops companion and semi-private beds`, () => {
      expect(base(sl, '12', 'Companion')).toBe(false);
      expect(base(sl, '12', 'Semi-Private')).toBe(false);
      expect(base(sl, '12', 'Semi Private')).toBe(false);
      expect(base(sl, '12', 'SEMIPRIVATE')).toBe(false);
      expect(base(sl, '12', 'Shared')).toBe(false);
      expect(base(sl, '12', 'Double')).toBe(false);
      expect(base(sl, '12', 'Ward')).toBe(false);
    });

    it(`${sl}: drops short-stay products`, () => {
      expect(base(sl, '12', 'Respite')).toBe(false);
      expect(base(sl, '12', 'Rehab')).toBe(false);
      expect(base(sl, '12', 'TCU')).toBe(false);
      expect(base(sl, '12', 'Almost Home')).toBe(false);
    });

    it(`${sl}: catches products that normalisation collapses into "Studio"`, () => {
      // This is the whole reason source_room_type is carried alongside the
      // normalised value. Checking only room_type would let these through at
      // full weight.
      expect(base(sl, '12', 'Studio', 'TCU - Private')).toBe(false);
      expect(base(sl, '12', 'Studio', 'Private Rehab')).toBe(false);
      expect(base(sl, '12', 'Private', 'Companion B')).toBe(false);
    });
  }
});

describe('campus and room names are not mistaken for keywords', () => {
  // Source room types are campus-branded, so substring matching would take
  // out whole buildings.
  const FALSE_POSITIVE_TRAPS = [
    'Woodward - Private',
    'Edward Place - Studio',
    'Howard Commons - Private',
    'Wardell Manor - Private',
    'Accompany Suite',
    'Doubleday House - Private',
    'Sharedale - Private',
    'Rehabilitation Way - Private', // note: SHOULD match, checked separately
  ];

  it('keeps campus names that merely contain a keyword as a substring', () => {
    for (const sl of Array.from(BED_TYPE_SLS)) {
      expect(base(sl, '12', 'Woodward - Private')).toBe(true);
      expect(base(sl, '12', 'Edward Place - Studio')).toBe(true);
      expect(base(sl, '12', 'Howard Commons - Private')).toBe(true);
      expect(base(sl, '12', 'Accompany Suite')).toBe(true);
      expect(base(sl, '12', 'Doubleday House - Private')).toBe(true);
      expect(base(sl, '12', 'Sharedale - Private')).toBe(true);
    }
    expect(FALSE_POSITIVE_TRAPS.length).toBeGreaterThan(0);
  });

  it('still matches a keyword that genuinely starts a word', () => {
    for (const sl of Array.from(BED_TYPE_SLS)) {
      // "Wardell" starts with "ward" but is a longer word — \b...\b means it
      // must be the whole word, so this one is KEPT.
      expect(base(sl, '12', 'Wardell Manor - Private')).toBe(true);
      // "Rehabilitation" starts with "rehab" and rehab is not end-anchored, so
      // it is treated as a rehab product. Documented, not accidental.
      expect(base(sl, '12', 'Rehabilitation Way - Private')).toBe(false);
      // A branded companion room must still be caught.
      expect(base(sl, '12', 'Legacy Lane - Companion')).toBe(false);
    }
  });
});

describe('baseRateExclusionSql', () => {
  it('respects the column prefix', () => {
    expect(baseRateExclusionSql('rr.')).toContain('rr.service_line');
    expect(baseRateExclusionSql('rr.')).toContain('rr.source_room_type');
    expect(baseRateExclusionSql('')).toContain('COALESCE(room_type');
  });

  it('inspects both the normalised and the raw room type', () => {
    const sql = baseRateExclusionSql('rr.');
    expect(sql).toContain('rr.room_type');
    expect(sql).toContain('rr.source_room_type');
  });

  it('uses Postgres word boundaries, never bare substrings', () => {
    const sql = baseRateExclusionSql('rr.');
    // \y is the Postgres word-boundary operator. Its absence would mean the
    // Woodward bug shipped to the SQL surfaces while the JS tests stayed green.
    expect(sql).toContain('\\y');
    expect(sql).not.toContain("~* 'ward'");
  });

  it('keeps the senior-housing B-bed arm intact', () => {
    expect(baseRateExclusionSql('rr.')).toContain("'/[B-Zb-z]$'");
  });

  it('scopes the bed-type arm to HC and HC/MC only', () => {
    const sql = baseRateExclusionSql('rr.');
    expect(sql).toContain("IN ('HC', 'HC/MC')");
  });
});
