/**
 * Plausible annual resident-turnover bands, per service line.
 *
 * `annualTurnoverPct` drives the solver's two-cohort projection: the residents
 * here today decay at this rate and are replaced by move-ins entering at the
 * street rate. It is therefore the single lever that decides how much of next
 * year's revenue growth arrives for free from re-pricing vacated units versus
 * how much has to be pushed onto existing residents. A wrong turnover number
 * does not produce an obviously wrong plan — it produces a plausible-looking
 * plan aimed at the wrong target, which is why it needs guardrails.
 *
 * Two different ceilings apply and they must not be confused:
 *
 *   1. THE MODEL LIMIT (0–100%). The projection converts turnover into a daily
 *      survival probability, `(1 - turnover) ^ (1/365)`. At or above 100% that
 *      has no real root, so the solver clamps to 99.9%. Nothing above 100% can
 *      be represented no matter how real it is. This is a hard input bound.
 *
 *   2. THE PLAUSIBLE BAND (below), which is per service line and much tighter.
 *      Independent-living villas and a skilled-nursing health center do not
 *      turn over at remotely similar rates, so a single portfolio-wide sanity
 *      check either waves through nonsense for the slow lines or rejects
 *      normal behaviour for the fast ones. Falling outside this band is a
 *      warning, never a hard stop: an operator who knows their market may
 *      legitimately override it.
 *
 * The bands blend published senior-housing length-of-stay norms with the
 * client's own per-campus distribution. Where measured history is known to be
 * distorted by discharge mis-attribution, the published norm wins — see the
 * note on AL below.
 */

/**
 * Hard input bound, set by the solver's cohort-decay math rather than by any
 * judgement about the business. See note 1 above.
 */
export const MODEL_MAX_TURNOVER_PCT = 100;
export const MODEL_MIN_TURNOVER_PCT = 0;

export interface TurnoverBand {
  /** Below this, tenure is longer than the care level plausibly supports. */
  min: number;
  /** Above this, tenure is shorter than the care level plausibly supports. */
  max: number;
  /** Used as the starting assumption when nothing has been saved. */
  typical: number;
  /** Shown to the operator when a value falls outside the band. */
  rationale: string;
}

/**
 * Industry-standard length-of-stay ranges by care level, converted to annual
 * turnover (turnover = 1200 / LOS_months). Sources:
 *
 *   Argentum (formerly ALFA) Annual State of Seniors Housing:
 *     AL median ~22 months; Memory Care median ~15–16 months.
 *   NIC MAP Vision senior housing occupancy database:
 *     IL villas/cottages median 4–5 yr; IL apartments median 2.5–3.5 yr.
 *   Alzheimer's Association facts & figures:
 *     Memory care admission to discharge typically 12–36 months.
 *   MedPAC / CMS long-stay SNF data:
 *     Long-stay private-pay SNF median ~600–900 days; short-stay private-pay
 *     ~20–30 days. Private-pay HC is a mix of both populations.
 *
 * Conversion examples:
 *   12 months = 100%/yr (model limit)   |  22 months = 55%/yr
 *   15 months = 80%/yr                  |  36 months = 33%/yr
 *   16 months = 75%/yr                  |  48 months = 25%/yr
 *   20 months = 60%/yr                  |  60 months = 20%/yr
 *   24 months = 50%/yr                  |  96 months = 12%/yr
 *
 * Band ordering guarantee: the slowest line's ceiling (VIL 50%) must remain
 * below the fastest line's floor (HC), tested in inhouseTurnoverHistory.test.ts.
 */
export const TURNOVER_BANDS: Readonly<Record<string, TurnoverBand>> = {
  // Independent-living villas and cottages. Longest tenure in senior housing:
  // NIC MAP shows medians of 4–5 years (≈ 20–25%/yr). Some residents stay 8+
  // years; short end rarely below 18 months. Range covers a 2-year (50%) to
  // 8-year (12%) stay.
  VIL: {
    min: 10,
    max: 50,
    typical: 25,
    rationale: "villa residents typically stay four to five years (≈ 20–25%/yr)",
  },

  // Independent-living apartments. Shorter tenure than villas: NIC MAP median
  // 2.5–3.5 years (29–40%/yr). Residents move up to AL sooner on average.
  // 10th pct ≈ 15 months (80%/yr), 90th pct ≈ 6 years (17%/yr). Max of 55%
  // corresponds to an 18-month minimum stay — the short end of IL data.
  SL: {
    min: 15,
    max: 55,
    typical: 33,
    rationale: "independent-living tenure typically runs two to four years (≈ 25–50%/yr)",
  },

  // Assisted living. Argentum/NIC MAP: median ~22 months → 55%/yr. The 10th
  // percentile is ~5–6 months (above the model limit), 90th pct ≈ 48 months
  // (25%/yr). Floor of 20% = 5-year stay — realistic for long-tenured residents.
  //
  // The client's measured AL is far higher (>100%), but that figure is not
  // trustworthy: most campuses file memory-care discharges under AL rather than
  // AL/MC. The band follows the published norm so a distorted feed is flagged.
  AL: {
    min: 20,
    max: 85,
    typical: 55,
    rationale: "assisted-living tenure averages around 22 months (Argentum)",
  },

  // Assisted-living memory care. Argentum: median ~15–16 months → 75–80%/yr.
  // Alzheimer's Association: memory-care stays typically 12–36 months. Residents
  // enter later in the disease course and progress or die faster than AL.
  // Max = model limit (100%, 12-month stay). Floor of 30% = ~3.3-year stay —
  // the long end of published memory-care data.
  "AL/MC": {
    min: 30,
    max: 100,
    typical: 75,
    rationale: "memory-care tenure typically 12–20 months (Argentum, Alzheimer's Assoc.)",
  },

  // Health center / skilled nursing — private-pay. MedPAC: long-stay private-pay
  // SNF median 600–900 days (40–60%/yr); short-stay private-pay ≈ 20–30 days
  // (model-limited). The typical planning assumption of 80% reflects the mixed
  // population most private-pay SNF facilities carry. Floor of 55% (≈ 22 months)
  // is set above the VIL ceiling (50%) to maintain care-level separation.
  HC: {
    min: 55,
    max: 100,
    typical: 80,
    rationale: "private-pay SNF mixes long-stay custodial (40–60%/yr) with short-stay rehab",
  },

  // Health-center memory care. Long-stay custodial with cognitive impairment —
  // not the short-stay rehab population. MedPAC long-stay data and clinical
  // literature suggest 18–30 months typical (40–67%/yr). Floor of 25% = 4-year
  // stay, reflecting the longest-tenured HC/MC residents.
  "HC/MC": {
    min: 25,
    max: 100,
    typical: 60,
    rationale: "health-center memory care is long-stay custodial, typically 18–30 months",
  },
};

/**
 * Permissive band for a service line we have no published norm for. It still
 * rejects the two values that are always wrong — a zero-turnover resident base
 * and one that exceeds what the model can represent — without pretending to
 * know the tenure of a line that has not been characterised.
 */
const FALLBACK_BAND: TurnoverBand = {
  min: 5,
  max: MODEL_MAX_TURNOVER_PCT,
  typical: 35,
  rationale: "no published tenure norm for this service line",
};

export function turnoverBandFor(serviceLine: string | null | undefined): TurnoverBand {
  if (!serviceLine) return FALLBACK_BAND;
  return TURNOVER_BANDS[serviceLine.trim().toUpperCase()] ?? FALLBACK_BAND;
}

/** True when a turnover percent is inside the band for its service line. */
export function isTurnoverInBand(
  serviceLine: string | null | undefined,
  pct: number,
): boolean {
  if (!Number.isFinite(pct)) return false;
  const band = turnoverBandFor(serviceLine);
  return pct >= band.min && pct <= band.max;
}

/** The starting turnover for a line with nothing saved against it. */
export function defaultTurnoverFor(serviceLine: string | null | undefined): number {
  return turnoverBandFor(serviceLine).typical;
}

/** e.g. "30–85%" — for labels and validation messages. */
export function describeTurnoverBand(serviceLine: string | null | undefined): string {
  const band = turnoverBandFor(serviceLine);
  return `${band.min}\u2013${band.max}%`;
}

/**
 * Convert an annual turnover percent to an average length of stay in months.
 *
 * Derivation: if T% of the census is replaced each year, the average resident
 * stays 1/T years = 12/T months. Returns null for zero or negative inputs.
 */
export function turnoverToLosMonths(annualTurnoverPct: number): number | null {
  if (!Number.isFinite(annualTurnoverPct) || annualTurnoverPct <= 0) return null;
  return 1200 / annualTurnoverPct; // 12 months × (100 / pct)
}

/**
 * Human-readable length-of-stay label derived from an annual turnover percent.
 * Returns null for zero or non-finite input.
 *
 * Examples: 55% → "≈ 21.8 mo avg stay"   |   25% → "≈ 4.0 yr avg stay"
 */
export function formatLos(annualTurnoverPct: number): string | null {
  const months = turnoverToLosMonths(annualTurnoverPct);
  if (months === null) return null;
  if (months >= 24) return `≈ ${(months / 12).toFixed(1)} yr avg stay`;
  return `≈ ${months.toFixed(1)} mo avg stay`;
}

/**
 * Why a value sits outside its band, phrased for an operator. Returns null
 * when the value is fine. Includes the implied length-of-stay so the number
 * can be sanity-checked against intuition.
 *
 * Deliberately advisory: the caller decides whether to warn or to withhold
 * auto-application. Nothing in this module silently rewrites a number, because
 * a fabricated turnover is far more dangerous than a flagged one.
 */
export function explainTurnoverOutOfBand(
  serviceLine: string | null | undefined,
  pct: number,
): string | null {
  if (!Number.isFinite(pct)) return null;
  const band = turnoverBandFor(serviceLine);
  const los = formatLos(pct);
  const losSuffix = los ? ` (${los})` : "";
  if (pct < band.min) {
    return `${pct}%${losSuffix} implies a longer stay than ${serviceLine} normally sees (${band.rationale}); expected ${describeTurnoverBand(serviceLine)}.`;
  }
  if (pct > band.max) {
    return pct > MODEL_MAX_TURNOVER_PCT
      ? `${pct}% is beyond full replacement, which the projection cannot model; expected ${describeTurnoverBand(serviceLine)} for ${serviceLine}.`
      : `${pct}%${losSuffix} implies a shorter stay than ${serviceLine} normally sees (${band.rationale}); expected ${describeTurnoverBand(serviceLine)}.`;
  }
  return null;
}
