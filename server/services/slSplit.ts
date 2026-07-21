/**
 * Shared helper for splitting combined-service-line RTO/history rows
 * (e.g. "AL, AL/MC, HC") into individual service lines.
 *
 * Methodology:
 * - `avail` is distributed by rent-roll unit counts (physical rooms, B-beds excluded)
 * - `occ` is distributed by rent-roll OCCUPIED counts, so lines that genuinely run
 *   fuller (e.g. AL/MC) are not flattened to the building-wide blend
 * - occ is clamped to avail per line; any excess is redistributed to lines with headroom
 *
 * All endpoints that split combined SL rows must use this helper with identical
 * weights, otherwise pages disagree.
 */

/** Senior-housing service lines where B beds (room numbers ending "/B") are
 * excluded from split weights so weights reflect physical rooms. */
export const SL_WEIGHT_B_BED_SLS = ['AL', 'AL/MC', 'SL', 'VIL', 'IL'] as const;

/** SQL predicate (for WHERE / FILTER clauses) selecting rows that count toward
 * split weights. `col` is the table alias prefix, e.g. "rr." or "" for none. */
export function slWeightSqlPredicate(col: string = ''): string {
  const sls = SL_WEIGHT_B_BED_SLS.map((s) => `'${s}'`).join(',');
  return `NOT (${col}service_line IN (${sls}) AND ${col}room_number LIKE '%/B')`;
}

/** JS predicate mirroring slWeightSqlPredicate for in-memory unit lists. */
export function isSlWeightUnit(serviceLine: string | null | undefined, roomNumber: string | null | undefined): boolean {
  return !(
    SL_WEIGHT_B_BED_SLS.includes((serviceLine || '') as any) &&
    String(roomNumber || '').endsWith('/B')
  );
}

export interface SlWeight {
  units: number;
  occupied: number;
}

export interface SlSplitPart {
  sl: string;
  occ: number;
  avail: number;
}

export function splitCombinedSl(
  tokens: string[],
  occ: number,
  avail: number,
  weightFor: (sl: string) => SlWeight,
): SlSplitPart[] {
  if (tokens.length === 1) return [{ sl: tokens[0], occ, avail }];

  const w = tokens.map((sl) => {
    const wt = weightFor(sl) || { units: 0, occupied: 0 };
    return { sl, units: wt.units || 0, occupied: wt.occupied || 0 };
  });
  const unitTotal = w.reduce((s, x) => s + x.units, 0);
  const occTotal = w.reduce((s, x) => s + x.occupied, 0);

  const availShares = w.map((x) =>
    unitTotal > 0 ? x.units / unitTotal : 1 / tokens.length,
  );
  const occShares =
    occTotal > 0 ? w.map((x) => x.occupied / occTotal) : availShares;

  const parts: SlSplitPart[] = w.map((x, i) => ({
    sl: x.sl,
    occ: occ * occShares[i],
    avail: avail * availShares[i],
  }));

  // Clamp occ <= avail per line; redistribute excess to lines with headroom
  let excess = 0;
  for (const p of parts) {
    if (p.occ > p.avail) {
      excess += p.occ - p.avail;
      p.occ = p.avail;
    }
  }
  let guard = 0;
  while (excess > 1e-9 && guard++ < 10) {
    const open = parts.filter((p) => p.occ < p.avail - 1e-9);
    if (!open.length) break;
    const headroom = open.reduce((s, p) => s + (p.avail - p.occ), 0);
    const give = Math.min(excess, headroom);
    for (const p of open) p.occ += (give * (p.avail - p.occ)) / headroom;
    excess -= give;
  }
  return parts;
}
