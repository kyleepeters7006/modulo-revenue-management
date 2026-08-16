/**
 * Care Level 2 rate resolution.
 *
 * `care_level_rates` holds our own Level-2 care charge per campus + service line.
 * Coverage is incomplete for the memory-care lines: most campuses have an AL row
 * but no AL/MC row, and an HC row but no HC/MC row (portfolio-wide only 81 of 127
 * AL campuses carry AL/MC, and only 19 of 106 HC campuses carry HC/MC).
 *
 * Where an explicit MC row does exist it usually equals its base line (55 of 80
 * AL/MC rows equal AL; 11 of 18 HC/MC rows equal HC), so inheriting the base rate
 * is the right default when the MC row is absent — it is far closer to the truth
 * than showing nothing, which is what the map popups and the care adjustment used
 * to do (a missing row silently produced a $0 care adjustment).
 *
 * Inheritance is always reported back via `inherited` so the UI can mark the value
 * as derived rather than surveyed, and so a campus whose MC care genuinely differs
 * can still be spotted and entered explicitly.
 */

/** Memory-care service lines and the base line they inherit care pricing from. */
const MC_BASE_SERVICE_LINE: Record<string, string> = {
  'AL/MC': 'AL',
  'HC/MC': 'HC',
};

/** Service lines that carry a Level-2 care charge at all. SL and VIL never do. */
export const CARE_ELIGIBLE_SERVICE_LINES = new Set(['AL', 'AL/MC', 'HC', 'HC/MC']);

/**
 * Rates for HC and HC/MC are quoted per day everywhere in this app; the senior
 * housing lines are quoted per month. Competitor care rates arrive monthly in
 * every case, so HC comparisons have to be converted before they can be
 * differenced against our daily figure.
 */
export const isDailyServiceLine = (sl: string): boolean => sl === 'HC' || sl === 'HC/MC';

export const DAYS_PER_MONTH = 30.44;

export interface ResolvedCareRate {
  /** The Level-2 rate in the service line's native basis (daily for HC lines). */
  rate: number;
  /** True when the value came from the base service line, not an explicit row. */
  inherited: boolean;
  /** Which service line the rate was actually read from. */
  sourceServiceLine: string;
}

/**
 * Look up our Level-2 care rate for a service line, falling back to the base
 * line for memory care when no explicit row exists.
 *
 * Returns null only when neither the service line nor its base has a rate, or
 * when the line is not care-eligible at all.
 */
export function resolveCareLevel2(
  ratesByServiceLine: Map<string, number> | undefined,
  serviceLine: string,
): ResolvedCareRate | null {
  if (!ratesByServiceLine || !CARE_ELIGIBLE_SERVICE_LINES.has(serviceLine)) return null;

  const direct = ratesByServiceLine.get(serviceLine);
  if (direct != null && Number.isFinite(direct)) {
    return { rate: Number(direct), inherited: false, sourceServiceLine: serviceLine };
  }

  const base = MC_BASE_SERVICE_LINE[serviceLine];
  if (base) {
    const inheritedRate = ratesByServiceLine.get(base);
    if (inheritedRate != null && Number.isFinite(inheritedRate)) {
      return { rate: Number(inheritedRate), inherited: true, sourceServiceLine: base };
    }
  }

  return null;
}

/**
 * Convert a competitor Level-2 care rate into the service line's native basis.
 *
 * Survey imports record care rates monthly regardless of service line (an HC
 * competitor shows $1,196/mo), while our own HC care rate is stored daily ($33).
 * Differencing them without this conversion overstates an HC care adjustment by
 * roughly 30x. Values already small enough to be daily are passed through so
 * re-normalising an already-converted figure is a no-op.
 */
export function normalizeCompetitorCareRate(rate: number | null | undefined, serviceLine: string): number | null {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  if (isDailyServiceLine(serviceLine) && rate >= 500) {
    return rate / DAYS_PER_MONTH;
  }
  return rate;
}

/**
 * Threshold above which an HC-line street rate must be a monthly figure.
 *
 * Our own HC street rates top out around $830/day, so nothing daily comes close
 * to this; the cheapest plausible monthly skilled-nursing rate is far above it.
 * The handful of survey rows that land between the two readings are bad data on
 * either interpretation.
 */
const HC_MONTHLY_STREET_THRESHOLD = 2000;

/**
 * Convert a competitor street rate into the service line's native basis.
 *
 * `monthly_rate_avg` is misleadingly named: for the HC lines its basis changed
 * partway through the survey history. The older surveys recorded genuinely
 * monthly figures (averaging a few thousand), while every recent survey records
 * a daily rate (averaging a few hundred) — which is why an unconditional
 * "divide HC by DAYS_PER_MONTH", as the original popup did, now understates a
 * current HC competitor by ~30x, and why doing nothing would overstate a legacy
 * row by the same factor.
 *
 * Detecting the basis per row rather than trusting the column name keeps both
 * eras correct, and keeps this in step with the care-rate conversion above so
 * street, care and variance all end up in one unit.
 */
export function normalizeCompetitorStreetRate(rate: number | null | undefined, serviceLine: string): number | null {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  if (isDailyServiceLine(serviceLine) && rate >= HC_MONTHLY_STREET_THRESHOLD) {
    return rate / DAYS_PER_MONTH;
  }
  return rate;
}
