/**
 * Service-level tests for the derived-rate formula persistence.
 *
 * The interesting behaviour is not the SQL, it is the invariants around it:
 *  - a save is the WHOLE policy, so a subset must be rejected rather than
 *    quietly leaving the omitted types on their old values;
 *  - a read with nothing saved returns defaults, clearly marked, rather than
 *    an empty list that looks like a loading failure;
 *  - the transaction is pinned to one connection, so a mid-save failure
 *    rolls everything back instead of leaving half a policy behind.
 */
import { describe, it, expect } from 'vitest';
import {
  getDerivedRateFormulas,
  saveDerivedRateFormulas,
  validateFormulaSet,
} from '../server/services/derivedRateFormulasService';
import { DERIVED_RATE_TYPES, defaultFormulas } from '../shared/derivedRates';

const fullSet = (overrides: Record<string, Partial<{ percentOfBase: number; dollarOffset: number; enabled: boolean }>> = {}) =>
  DERIVED_RATE_TYPES.map((t) => ({
    rateType: t,
    percentOfBase: 100,
    dollarOffset: 0,
    enabled: true,
    ...(overrides[t] ?? {}),
  }));

describe('validateFormulaSet', () => {
  it('accepts a complete, valid set', () => {
    expect(validateFormulaSet(fullSet())).toEqual([]);
  });

  it('rejects a partial save', () => {
    const partial = fullSet().slice(0, 3);
    const errs = validateFormulaSet(partial);
    expect(errs.join(' ')).toMatch(/Missing formulas/i);
  });

  it('rejects an empty save', () => {
    expect(validateFormulaSet([]).join(' ')).toMatch(/Missing formulas/i);
  });

  it('names every missing type so the caller can fix it in one pass', () => {
    const errs = validateFormulaSet(fullSet().slice(0, 4)).join(' ');
    for (const t of DERIVED_RATE_TYPES.slice(4)) expect(errs).toContain(t);
  });

  it('rejects an unknown rate type', () => {
    const bad = [...fullSet(), { rateType: 'nonsense', percentOfBase: 50, dollarOffset: 0 }];
    expect(validateFormulaSet(bad).join(' ')).toMatch(/Unknown rate type/i);
  });

  it('rejects duplicates', () => {
    const dup = [...fullSet(), { rateType: DERIVED_RATE_TYPES[0], percentOfBase: 50, dollarOffset: 0 }];
    expect(validateFormulaSet(dup).join(' ')).toMatch(/Duplicate/i);
  });

  it('surfaces per-formula validation errors with the type name attached', () => {
    const errs = validateFormulaSet(fullSet({ [DERIVED_RATE_TYPES[0]]: { percentOfBase: 900 } }));
    expect(errs.join(' ')).toContain(DERIVED_RATE_TYPES[0]);
    expect(errs.join(' ')).toMatch(/typo/i);
  });
});

describe('getDerivedRateFormulas', () => {
  it('returns built-in defaults, marked as such, when nothing is saved', async () => {
    const rows = await getDerivedRateFormulas(async () => ({ rows: [] }), 'acme');
    expect(rows).toHaveLength(DERIVED_RATE_TYPES.length);
    expect(rows.every((r) => r.isDefault)).toBe(true);
    expect(rows.map((r) => r.percentOfBase)).toEqual(defaultFormulas().map((d) => d.percentOfBase));
  });

  it('returns defaults rather than throwing when the table does not exist yet', async () => {
    const rows = await getDerivedRateFormulas(async () => {
      throw new Error('relation "derived_rate_formulas" does not exist');
    }, 'acme');
    expect(rows).toHaveLength(DERIVED_RATE_TYPES.length);
    expect(rows.every((r) => r.isDefault)).toBe(true);
  });

  it('lets a saved row win, and marks it as not a default', async () => {
    const target = DERIVED_RATE_TYPES[0];
    const rows = await getDerivedRateFormulas(
      async () => ({
        rows: [{
          rate_type: target, service_line: null, percent_of_base: 61,
          dollar_offset: 12, enabled: true, updated_by: 'jo', updated_at: '2026-08-20T00:00:00Z',
        }],
      }),
      'acme',
    );
    const got = rows.find((r) => r.rateType === target)!;
    expect(got.percentOfBase).toBe(61);
    expect(got.dollarOffset).toBe(12);
    expect(got.isDefault).toBe(false);
    expect(got.updatedBy).toBe('jo');
    // Untouched types stay on their defaults.
    expect(rows.filter((r) => r.isDefault)).toHaveLength(DERIVED_RATE_TYPES.length - 1);
  });

  it('always returns one row per type, in a stable order', async () => {
    const rows = await getDerivedRateFormulas(async () => ({ rows: [] }), 'acme');
    expect(rows.map((r) => r.rateType)).toEqual([...DERIVED_RATE_TYPES]);
  });

  it('preserves a saved row that happens to equal the default, still marked saved', async () => {
    const target = DERIVED_RATE_TYPES[0];
    const def = defaultFormulas().find((d) => d.rateType === target)!;
    const rows = await getDerivedRateFormulas(
      async () => ({
        rows: [{
          rate_type: target, service_line: null, percent_of_base: def.percentOfBase,
          dollar_offset: def.dollarOffset, enabled: true, updated_by: null, updated_at: null,
        }],
      }),
      'acme',
    );
    expect(rows.find((r) => r.rateType === target)!.isDefault).toBe(false);
  });
});

/** Minimal pool fake that records the statements issued on the pinned client. */
function fakePool(opts: { failOnNthInsert?: number } = {}) {
  const statements: string[] = [];
  let inserts = 0;
  let released = false;
  const clientQuery = async (sql: string) => {
    statements.push(sql.trim().split(/\s+/)[0].toUpperCase());
    if (sql.startsWith('INSERT')) {
      inserts++;
      if (opts.failOnNthInsert && inserts === opts.failOnNthInsert) throw new Error('boom');
    }
    return { rows: [] };
  };
  return {
    statements,
    get released() { return released; },
    query: async () => ({ rows: [] }),
    connect: async () => ({ query: clientQuery, release: () => { released = true; } }),
  };
}

describe('saveDerivedRateFormulas', () => {
  it('rejects an invalid set before touching the database', async () => {
    const pool = fakePool();
    await expect(saveDerivedRateFormulas(pool as any, 'acme', [], null)).rejects.toThrow(/Missing formulas/i);
    expect(pool.statements).toEqual([]);
  });

  it('wraps the whole set in one transaction on a pinned client', async () => {
    const pool = fakePool();
    await saveDerivedRateFormulas(pool as any, 'acme', fullSet(), 'jo');
    expect(pool.statements[0]).toBe('BEGIN');
    expect(pool.statements.at(-1)).toBe('COMMIT');
    expect(pool.statements.filter((s) => s === 'INSERT')).toHaveLength(DERIVED_RATE_TYPES.length);
  });

  it('rolls back and releases the client when an upsert fails partway', async () => {
    const pool = fakePool({ failOnNthInsert: 3 });
    await expect(saveDerivedRateFormulas(pool as any, 'acme', fullSet(), null)).rejects.toThrow('boom');
    expect(pool.statements).toContain('ROLLBACK');
    expect(pool.statements).not.toContain('COMMIT');
    expect(pool.released).toBe(true);
  });

  it('releases the client on success too', async () => {
    const pool = fakePool();
    await saveDerivedRateFormulas(pool as any, 'acme', fullSet(), null);
    expect(pool.released).toBe(true);
  });
});
