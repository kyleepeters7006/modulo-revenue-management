/**
 * derivedRateFormulasService — persistence for the derived-rate formulas.
 *
 * The formulas themselves (what they mean, how they are applied, what the
 * defaults are) live in shared/derivedRates.ts so the client and server cannot
 * disagree about the arithmetic. This module only reads and writes them.
 *
 * READS NEVER FAIL SOFT INTO SILENCE
 * ----------------------------------
 * A client with nothing saved gets the built-in defaults, clearly marked
 * `isDefault: true`, rather than an empty list. The panel then shows a
 * populated, honest starting point instead of six blank rows that look like a
 * loading bug. But a saved row always wins, including a saved row that happens
 * to equal the default.
 *
 * WRITES ARE WHOLE-SET AND TRANSACTIONAL
 * --------------------------------------
 * The panel submits every formula at once, so a save is a single transaction
 * over the full set. A partial save would leave the portfolio priced by a
 * mixture of old and new policy with no way to tell which rows were which.
 *
 * The query function is injectable for the same reason it is elsewhere in this
 * codebase: a test that re-implements the SQL it is checking guarantees
 * nothing.
 */

import {
  DERIVED_RATE_TYPES,
  defaultFormulas,
  isDerivedRateType,
  validateFormula,
  type DerivedRateFormula,
  type DerivedRateType,
} from '@shared/derivedRates';

export type FormulaQueryFn = (sql: string, params?: any[]) => Promise<{ rows: any[] }>;

/**
 * A pool that can hand out a single pinned connection.
 *
 * The save path needs this rather than a bare query function. `pool.query`
 * checks out an arbitrary connection per call, so issuing BEGIN, the upserts,
 * and COMMIT through it can spread those statements across different backends:
 * the BEGIN opens a transaction on one connection and is never committed, the
 * upserts autocommit individually on others, and a mid-way failure leaves half
 * the policy saved with nothing to roll back. The transaction has to live on
 * one client from BEGIN to COMMIT.
 */
export interface FormulaPool {
  query: FormulaQueryFn;
  connect(): Promise<{ query: FormulaQueryFn; release: () => void }>;
}

export interface StoredFormula extends DerivedRateFormula {
  /** True when this row is a built-in default rather than something saved. */
  isDefault: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Every formula for a client: saved rows where they exist, built-in defaults
 * everywhere else, always one row per rate type.
 */
export async function getDerivedRateFormulas(
  query: FormulaQueryFn,
  clientId: string,
): Promise<StoredFormula[]> {
  let saved: any[] = [];
  try {
    const { rows } = await query(
      `SELECT rate_type, service_line, percent_of_base, dollar_offset, enabled,
              updated_by, updated_at
         FROM derived_rate_formulas
        WHERE client_id = $1`,
      [clientId],
    );
    saved = rows;
  } catch {
    // Table not yet created (first boot before the migration runs). Defaults
    // are a correct answer here, not a fallback that hides a failure.
    saved = [];
  }

  // Only portfolio-wide rows are written today; a future per-service-line row
  // would be resolved by resolveFormula at the point of use, not here.
  const savedByType = new Map<string, any>();
  for (const r of saved) {
    if (r.service_line == null) savedByType.set(String(r.rate_type), r);
  }

  return defaultFormulas().map((def) => {
    const row = savedByType.get(def.rateType);
    if (!row) {
      return { ...def, isDefault: true, updatedAt: null, updatedBy: null };
    }
    return {
      rateType: def.rateType,
      serviceLine: null,
      percentOfBase: Number(row.percent_of_base),
      dollarOffset: Number(row.dollar_offset),
      enabled: row.enabled !== false,
      isDefault: false,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      updatedBy: row.updated_by ?? null,
    };
  });
}

export interface SaveFormulaInput {
  rateType: string;
  percentOfBase: number;
  dollarOffset: number;
  enabled?: boolean;
}

/**
 * Validate a submitted set. Returns a list of human-readable errors; an empty
 * list means the set is safe to persist.
 *
 * Validation is a separate exported step so the route can reject the whole
 * payload before opening a transaction, and so tests can exercise the rules
 * without a database.
 */
export function validateFormulaSet(input: SaveFormulaInput[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const f of input) {
    if (!isDerivedRateType(f.rateType)) {
      errors.push(`Unknown rate type "${f.rateType}".`);
      continue;
    }
    if (seen.has(f.rateType)) {
      errors.push(`Duplicate entry for "${f.rateType}".`);
      continue;
    }
    seen.add(f.rateType);

    const err = validateFormula({ percentOfBase: f.percentOfBase, dollarOffset: f.dollarOffset });
    if (err) errors.push(`${f.rateType}: ${err}`);
  }

  // A save is the whole policy, not a patch. Accepting a subset would leave the
  // omitted types on their previous values while the caller believes it has
  // just written the complete set — the portfolio would then be priced by a
  // mixture of old and new policy with nothing recording which was which.
  const missing = DERIVED_RATE_TYPES.filter((t) => !seen.has(t));
  if (missing.length) {
    errors.push(`Missing formulas for: ${missing.join(', ')}. A save must include all rate types.`);
  }

  return errors;
}

/**
 * Persist a set of formulas for a client. Whole-set and transactional: either
 * every row lands or none does.
 */
export async function saveDerivedRateFormulas(
  pool: FormulaPool,
  clientId: string,
  input: SaveFormulaInput[],
  updatedBy: string | null,
): Promise<StoredFormula[]> {
  const errors = validateFormulaSet(input);
  if (errors.length) {
    const e = new Error(errors.join(' '));
    (e as any).statusCode = 400;
    throw e;
  }

  // One pinned client for the whole transaction — see FormulaPool.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of input) {
      await client.query(
        `INSERT INTO derived_rate_formulas
           (client_id, rate_type, service_line, percent_of_base, dollar_offset, enabled, updated_by, updated_at)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, now())
         ON CONFLICT (client_id, rate_type, service_line) DO UPDATE
           SET percent_of_base = EXCLUDED.percent_of_base,
               dollar_offset   = EXCLUDED.dollar_offset,
               enabled         = EXCLUDED.enabled,
               updated_by      = EXCLUDED.updated_by,
               updated_at      = now()`,
        [clientId, f.rateType, f.percentOfBase, f.dollarOffset, f.enabled !== false, updatedBy],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return getDerivedRateFormulas(pool.query, clientId);
}

/** Reset a client back to the built-in defaults by deleting their saved rows. */
export async function resetDerivedRateFormulas(
  query: FormulaQueryFn,
  clientId: string,
): Promise<StoredFormula[]> {
  await query(`DELETE FROM derived_rate_formulas WHERE client_id = $1`, [clientId]);
  return getDerivedRateFormulas(query, clientId);
}

export { DERIVED_RATE_TYPES, type DerivedRateType };
