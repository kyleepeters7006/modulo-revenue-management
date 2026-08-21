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

/**
 * Canonical days-per-month conversion factor: exactly 365 / 12 = 30.4166…
 *
 * Every daily <-> monthly conversion in the app MUST use this constant so that
 * the same underlying rate reads identically on every surface. Do not redefine
 * it locally — divergent local copies (30, 30.4, 30.44, 30.5) previously made
 * the same HC room differ by ~$170/month between screens.
 */
export const DAYS_PER_MONTH = 365 / 12;

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
 * Basis and plausibility bounds for a competitor care rate on an HC line.
 *
 * Our own HC Level-2 care is $33/day (~$1,004/mo), so the plausible *daily*
 * band is narrow and the monthly band starts far below the $500 that a street
 * rate would need to look monthly. The HC care column mixes both bases —
 * a single survey month carries values of 2, 8, 31, 33, 100, 200 and 1050 —
 * so the cutoff has to be calibrated against our own care rate, not reused
 * from the street-rate logic.
 *
 * At $150/day a competitor would be charging 4.5x our care rate and roughly as
 * much for care alone as their entire daily street rate; every observed value
 * at or above this reads correctly as monthly (200 -> $6.57, 1050 -> $34.50,
 * 1196 -> $39.29). The previous $500 cutoff passed 100 and 200 straight
 * through as daily, inflating the adjustment on those rows ~30x.
 */
const HC_MONTHLY_CARE_THRESHOLD = 150;

/**
 * Plausible band for an HC Level-2 care rate once expressed per day.
 *
 * Our own HC care is $33/day at every campus, so this brackets it at roughly
 * 1/6x to 2.5x. The band is applied *after* the basis decision above and exists
 * to reject values that cannot be a care schedule on either reading:
 *
 *   $100 -> as daily it is 3x our rate and a quarter of a whole daily street
 *           rate; as monthly it is $3.29/day. Neither is credible, so the row
 *           reports no adjustment instead of a fabricated +$67/day.
 *   $2/$4 -> import noise on any basis.
 *
 * A competitor whose genuine care is above ~$2,400/mo is also dropped here.
 * That trade is deliberate: for a benchmark that feeds pricing, omitting an
 * adjustment is far safer than publishing one that is wrong by ~30x.
 */
const MIN_PLAUSIBLE_DAILY_CARE = 5;
const MAX_PLAUSIBLE_DAILY_CARE = 80;

/**
 * Convert a competitor Level-2 care rate into the service line's native basis.
 *
 * Survey imports record care rates monthly regardless of service line (an HC
 * competitor shows $1,196/mo), while our own HC care rate is stored daily ($33).
 * Differencing them without this conversion overstates an HC care adjustment by
 * roughly 30x. Values already small enough to be daily are passed through so
 * re-normalising an already-converted figure is a no-op.
 *
 * Returns null when the value cannot be read as a credible care rate on either
 * basis, so callers fall through to "no adjustment" instead of publishing a
 * number derived from junk.
 */
export function normalizeCompetitorCareRate(rate: number | null | undefined, serviceLine: string): number | null {
  // rate === 0 is a valid signal: the competitor charges no separate care fee
  // (care is bundled in their daily/monthly room rate). Only null, undefined,
  // non-finite, and negative values indicate missing or junk data.
  if (rate == null || !Number.isFinite(rate) || rate < 0) return null;
  // An exact zero is basis-independent — $0/day and $0/month are the same
  // charge — so it must skip the plausibility band below, which would
  // otherwise reject it as "below the minimum credible daily care rate" and
  // silently turn an all-inclusive HC competitor back into "no data". The
  // whole HC survey era that records these zeros also records real street
  // rates on the same rows, so they are surveyed, not defaulted.
  if (rate === 0) return 0;
  if (isDailyServiceLine(serviceLine)) {
    const daily = rate >= HC_MONTHLY_CARE_THRESHOLD ? rate / DAYS_PER_MONTH : rate;
    if (daily < MIN_PLAUSIBLE_DAILY_CARE || daily > MAX_PLAUSIBLE_DAILY_CARE) return null;
    return daily;
  }
  return rate;
}

/**
 * The same care rate expressed per month, for the paths that do their
 * arithmetic in monthly dollars (the bulk rate job, the recalculation writer,
 * the rate-comparison endpoint and the benchmark aggregator).
 *
 * Those paths must not re-implement the basis test: doing so is what allowed a
 * monthly $200 to be read as daily on one surface and multiplied to $6,088/mo
 * on another for the very same survey row. Deciding the basis once here and
 * scaling afterwards keeps every surface on one answer, including the
 * rejection of values that are not credible on either basis.
 *
 * `serviceLine` selects the basis only — HC and HC/MC are the daily lines. For
 * a survey type without its own service line (SMC rows are daily), pass the
 * line it maps to.
 */
export function normalizeCompetitorCareRateMonthly(
  rate: number | null | undefined,
  serviceLine: string,
): number | null {
  const native = normalizeCompetitorCareRate(rate, serviceLine);
  if (native == null) return null;
  return isDailyServiceLine(serviceLine) ? native * DAYS_PER_MONTH : native;
}

export interface CompetitorCareAdjustment {
  /** Their Level-2 rate in the line's native basis; null when absent or unusable. */
  theirCare: number | null;
  /** Our Level-2 rate for the line, possibly inherited; null when we have none. */
  ourCare: number | null;
  /** True when our figure came from the base service line rather than an explicit row. */
  ourCareInherited: boolean;
  /**
   * `theirCare − ourCare`, or null when either side is unknown.
   *
   * null and 0 mean different things and must stay distinguishable all the way
   * to the UI: null is "we cannot compare", 0 is "we charge the same". A
   * competitor who bundles care into their room rate surveys as 0, which is a
   * real comparison (`careAdj = −ourCare`), not a missing one.
   */
  careAdj: number | null;
}

/**
 * The competitor-vs-us Level-2 care comparison for one service line.
 *
 * Every surface that shows a care adjustment must call this rather than
 * differencing the two rates itself: the comparison has three separate gates
 * (is the line care-bearing at all, is their surveyed value usable and on the
 * right basis, do we even have a rate of our own) and re-implementing them per
 * call site is what previously let one screen show an adjustment where another
 * showed nothing for the very same competitor.
 *
 * `ourRatesByServiceLine` is the campus's service-line → Level-2 rate map;
 * memory-care lines inherit from their base line via resolveCareLevel2.
 */
export function computeCompetitorCareAdj(
  theirRawCare: number | null | undefined,
  ourRatesByServiceLine: Map<string, number> | undefined,
  serviceLine: string,
): CompetitorCareAdjustment {
  const careApplies = CARE_ELIGIBLE_SERVICE_LINES.has(serviceLine);
  const theirCare = careApplies ? normalizeCompetitorCareRate(theirRawCare, serviceLine) : null;
  const ourResolved = careApplies ? resolveCareLevel2(ourRatesByServiceLine, serviceLine) : null;
  return {
    theirCare,
    ourCare: ourResolved ? ourResolved.rate : null,
    ourCareInherited: ourResolved ? ourResolved.inherited : false,
    careAdj: theirCare != null && ourResolved != null ? theirCare - ourResolved.rate : null,
  };
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
