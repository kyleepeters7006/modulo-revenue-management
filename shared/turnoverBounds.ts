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

export const TURNOVER_BANDS: Readonly<Record<string, TurnoverBand>> = {
  // Independent-living villas and cottages. The longest tenure in the
  // portfolio — residents arrive independent and stay for years, often only
  // leaving by moving up a care level. Client median is ~25%.
  VIL: {
    min: 10,
    max: 50,
    typical: 25,
    rationale: "villa residents typically stay three to five years",
  },

  // Independent-living apartments. Shorter tenure than the villas: residents
  // tend to arrive slightly older and move up to assisted living sooner.
  // Client median is ~40%.
  SL: {
    min: 15,
    max: 65,
    typical: 40,
    rationale: "independent-living tenure typically runs two to four years",
  },

  // Assisted living. Published median length of stay is around 22 months,
  // which is ~55% a year.
  //
  // The client's measured AL turnover is far higher (median ~141%), but that
  // figure is not trustworthy: AL records more move-ins than move-outs on a
  // flat census, and most campuses file their memory-care discharges under AL
  // rather than AL/MC. The band deliberately follows the published norm so a
  // distorted feed is flagged rather than adopted.
  AL: {
    min: 30,
    max: 85,
    typical: 55,
    rationale: "assisted-living tenure averages under two years",
  },

  // Assisted-living memory care. Shorter tenure than AL: residents enter later
  // in the disease course and progress to skilled nursing or die in place.
  // Among the campuses that actually file AL/MC discharges the median is ~62%,
  // which agrees closely with the published norm.
  "AL/MC": {
    min: 35,
    max: 95,
    typical: 60,
    rationale: "memory-care tenure is shorter than assisted living",
  },

  // Health center / skilled nursing. Genuinely the fastest line in the
  // portfolio: even private-pay skilled nursing mixes long-stay custodial
  // residents with short-stay rehab, and the client measures several hundred
  // percent a year. The band ceiling is the model limit rather than a business
  // judgement — the projection cannot express faster than full replacement.
  HC: {
    min: 60,
    max: 100,
    typical: 90,
    rationale: "skilled nursing mixes long-stay residents with short-stay rehab",
  },

  // Health-center memory care. Long-stay custodial rather than rehab, so
  // slower than the rest of the health center but faster than assisted living.
  "HC/MC": {
    min: 40,
    max: 100,
    typical: 75,
    rationale: "health-center memory care is long-stay rather than rehab",
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
 * Why a value sits outside its band, phrased for an operator. Returns null
 * when the value is fine.
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
  if (pct < band.min) {
    return `${pct}% implies a longer stay than ${serviceLine} normally sees (${band.rationale}); expected ${describeTurnoverBand(serviceLine)}.`;
  }
  if (pct > band.max) {
    return pct > MODEL_MAX_TURNOVER_PCT
      ? `${pct}% is beyond full replacement, which the projection cannot model; expected ${describeTurnoverBand(serviceLine)} for ${serviceLine}.`
      : `${pct}% implies a shorter stay than ${serviceLine} normally sees (${band.rationale}); expected ${describeTurnoverBand(serviceLine)}.`;
  }
  return null;
}
