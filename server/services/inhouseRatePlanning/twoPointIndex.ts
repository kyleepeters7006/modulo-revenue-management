/**
 * Direct two-point matched-quarter rate comparison.
 *
 * This replaces both of the designs that came before it, and it is worth
 * recording why each failed, because the failures are what shape this one.
 *
 * Standardizing each month against whichever rooms qualified *in that month*
 * let eligibility churn masquerade as price movement. Requiring a room to
 * survive the whole twelve-month window removed the churn but kept only a
 * biased remnant of the portfolio — 27% of HC, 49% of AL/MC. Chain-linking
 * adjacent months fixed the bias but introduced a worse fragility: a level is
 * reached by multiplying through every intervening link, so one bad month
 * poisoned everything on the far side of it.
 *
 * Comparing two quarters directly has none of those properties. A room
 * qualifies on its presence in the two quarters being compared and nothing
 * else; the months in between are irrelevant, so a room that went vacant in
 * November is still evidence about the year. Measured on live data that lifts
 * matched coverage to 71%–79% across every service line, and HC from 27% to
 * 76%.
 *
 * Three rules keep the comparison honest:
 *
 * - **Eligibility is adjudicated once, at the ending quarter.** The outlier
 *   gate, base-rate exclusions and payer scope are time series in their own
 *   right; re-running them on the historical side would make the qualifying
 *   RULE part of the measurement. A matched room's base-quarter rate is used
 *   exactly as recorded, even if it would fail today's gate.
 * - **Comparison happens inside strata, never across them.** A ratio taken over
 *   a whole service line moves when the mix of room types moves. Ratios are
 *   computed within unit type x care level x price band and only then combined.
 * - **A stratum carries its full weight regardless of how many of its rooms
 *   matched.** The matched subset stands in for the stratum, so partial
 *   matching changes the confidence in a stratum, not its influence.
 */

/** One room's rate over one quarter, already averaged across its three months. */
export interface RoomQuarterObservation {
  unitKey: string;
  /** Simple average of the room's three monthly rates. No month-weighting. */
  rateMonthly: number;
  /** Observation volume — resident-months, or resident-days for HC. */
  weight: number;
  roomType: string | null;
  careLevel: string | null;
}

export interface StratumResult {
  key: string;
  unitType: string;
  careLevel: string;
  /** 0 when the stratum was coarsened past the price-band split. */
  priceBand: number;
  matchedRooms: number;
  endingRooms: number;
  /** Matched rooms / rooms priced in the ending quarter. */
  coverageByCountPct: number;
  /** The same share measured in ending-quarter revenue. */
  coverageByRevenuePct: number;
  /** Ending / base on the matched rooms. Null when suppressed. */
  ratio: number | null;
  /** Share of the aggregate this stratum carries, after redistribution. */
  endingWeightShare: number;
  baseWeightShare: number;
  suppressed: boolean;
  reasonCode: string | null;
}

export interface QuarterComparison {
  baseQuarterLabel: string;
  endingQuarterLabel: string;
  strata: StratumResult[];
  /** Primary: stratified matched ratio on ENDING-quarter stratum weights. */
  ratio: number | null;
  /** Secondary: the same stratum ratios on BASE-quarter stratum weights. */
  baseWeightedRatio: number | null;
  /**
   * The same aggregation with every stratum that produced a ratio, gates
   * ignored.
   *
   * Not for reporting. It exists so a caller left with nothing at all — a
   * seven-room service line at one campus, where a single turnover decides
   * every gate — can show the best available number and say plainly that is
   * what it is, rather than refuse to plan.
   */
  unsuppressedRatio: number | null;
  /** Spread between the two weightings — the composition effect. */
  compositionEffectPct: number | null;
  matchedRooms: number;
  endingRooms: number;
  coverageByCountPct: number;
  coverageByRevenuePct: number;
  /** Unrestricted quarter-over-quarter change, no matching, for decomposition. */
  rawChangePct: number | null;
  /** What price did, on matched rooms inside strata. */
  rateEffectPct: number | null;
  /** Raw change minus rate effect. Everything price did not do. */
  mixEffectPct: number | null;
  suppressedStrata: Array<{ key: string; reasonCode: string }>;
  /** Unit types where a suppressed stratum's weight was reassigned. */
  redistributedUnitTypes: string[];
  /** Weight that could not be rehomed inside its own unit type. */
  redistributedAcrossUnitTypes: boolean;
  usable: boolean;
  reasonCode: string | null;
}

export interface CompareQuartersInput {
  baseQuarterLabel: string;
  endingQuarterLabel: string;
  /** Adjudicated, gated, and restricted to rooms present in all three months. */
  ending: RoomQuarterObservation[];
  /** Rates as recorded. Presence only — never re-gated. */
  base: RoomQuarterObservation[];
  /** Unrestricted ending-quarter average, for the rate/mix decomposition. */
  rawEndingRate: number | null;
  /** Unrestricted base-quarter average, on the same unmatched basis. */
  rawBaseRate: number | null;
  thresholds?: Partial<CoverageThresholds>;
}

export interface CoverageThresholds {
  /**
   * Matched rooms a stratum needs before its ratio is believed at all.
   *
   * This is the primary gate, and it is a count rather than a percentage on
   * purpose. A seven-room service line at one campus cannot produce a
   * meaningful percentage — one turnover moves it fourteen points — so a
   * percentage there measures portfolio size, not data quality.
   */
  minMatchedRooms: number;
  /**
   * Coverage a stratum must reach, applied only once it is big enough for a
   * percentage to mean something.
   *
   * Deliberately not 90%. Roughly a quarter of rooms change occupant over a
   * twelve-month gap, so a room-matched comparison across that gap cannot
   * reach 90% however clean the data is; measured portfolio-wide the ceiling
   * is 79%. A floor above the ceiling suppresses everything and reports
   * nothing about quality.
   */
  coverageFloorPct: number;
  /** Ending-quarter rooms below which the percentage floor is not applied. */
  percentageGateMinRooms: number;
  /** Ending-quarter rooms a stratum needs before it is split any finer. */
  minStratumRooms: number;
}

/**
 * Set from measurement, not judgement.
 *
 * Every value was chosen by sweeping it against live data and watching what the
 * answer did. A gate is doing its job while tightening it changes only which
 * strata are named and not what the portfolio reports; once the reported growth
 * starts tracking the threshold, the gate has stopped filtering noise and
 * started BEING the measurement.
 *
 * Sweeping the coverage floor over the six service lines, the year-over-year
 * figure holds flat from 0 through 60 (AL 7.24%→7.17%, AL/MC 5.24%→5.48%) while
 * suppression stays under 12% of rooms. At 70 it breaks: AL/MC jumps to 6.81%
 * with 43% of its rooms discarded. 60 is the last stable value, so it is the
 * floor.
 *
 * `minStratumRooms` 12 keeps median stratum coverage near 75% without producing
 * strata too thin to judge; 8 leaves strata with two matched rooms, 20 coarsens
 * away real price-band structure. The count gate at 8 costs the large lines
 * almost nothing (0%–5% of rooms) and only bites on HC/MC, a 69-room line where
 * no threshold is comfortable — hence the redistribution and the warning.
 */
export const DEFAULT_THRESHOLDS: CoverageThresholds = {
  minMatchedRooms: 8,
  coverageFloorPct: 60,
  percentageGateMinRooms: 20,
  minStratumRooms: 12,
};

const UNKNOWN = "—";

function norm(value: string | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : UNKNOWN;
}

/**
 * Quartile cut points of rate within a unit type.
 *
 * The spec's preferred input is an existing set of planning price bands; there
 * are none in this product, so quartiles of the ending-quarter rate stand in.
 * They are computed per unit type because a studio's expensive end and a
 * two-bedroom's cheap end are not the same kind of room.
 */
function bandCutsForRates(rates: number[]): number[] {
  const sorted = [...rates].sort((a, b) => a - b);
  if (sorted.length < 4) return [];
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return [at(0.25), at(0.5), at(0.75)];
}

function bandOf(rate: number, cuts: number[]): number {
  if (cuts.length === 0) return 0;
  if (rate <= cuts[0]) return 1;
  if (rate <= cuts[1]) return 2;
  if (rate <= cuts[2]) return 3;
  return 4;
}

interface Assigned {
  room: RoomQuarterObservation;
  unitType: string;
  careLevel: string;
  priceBand: number;
  key: string;
}

function keyOf(unitType: string, careLevel: string, band: number): string {
  if (band > 0) return `${unitType}|${careLevel}|B${band}`;
  if (careLevel !== UNKNOWN) return `${unitType}|${careLevel}`;
  return unitType;
}

/**
 * Assign every ending-quarter room to the FINEST stratum that is still big
 * enough to be one.
 *
 * Unit type x care level x price band is the right partition for a large
 * portfolio and a catastrophic one for a single campus, where it can produce
 * more strata than rooms. Rather than pick one granularity for every scope,
 * each room takes the finest key whose group clears `minStratumRooms`, falling
 * back through unit type x care level, unit type, and finally a single pooled
 * stratum. Coarsening loses resolution; over-splitting loses the measurement.
 */
export function assignStrata(
  ending: RoomQuarterObservation[],
  minStratumRooms: number,
): Assigned[] {
  const cutsByUnitType = new Map<string, number[]>();
  const ratesByUnitType = new Map<string, number[]>();
  for (const room of ending) {
    const unitType = norm(room.roomType);
    const list = ratesByUnitType.get(unitType) ?? [];
    list.push(room.rateMonthly);
    ratesByUnitType.set(unitType, list);
  }
  for (const [unitType, rates] of Array.from(ratesByUnitType)) {
    cutsByUnitType.set(unitType, bandCutsForRates(rates));
  }

  const levels: Array<(r: RoomQuarterObservation) => Assigned> = [
    (r) => {
      const unitType = norm(r.roomType);
      const careLevel = norm(r.careLevel);
      const band = bandOf(r.rateMonthly, cutsByUnitType.get(unitType) ?? []);
      return { room: r, unitType, careLevel, priceBand: band, key: keyOf(unitType, careLevel, band) };
    },
    (r) => {
      const unitType = norm(r.roomType);
      const careLevel = norm(r.careLevel);
      return { room: r, unitType, careLevel, priceBand: 0, key: keyOf(unitType, careLevel, 0) };
    },
    (r) => {
      const unitType = norm(r.roomType);
      return { room: r, unitType, careLevel: UNKNOWN, priceBand: 0, key: unitType };
    },
    (r) => ({ room: r, unitType: "ALL", careLevel: UNKNOWN, priceBand: 0, key: "ALL" }),
  ];

  const settled: Assigned[] = [];
  let pending = ending;
  for (let level = 0; level < levels.length; level += 1) {
    const assign = levels[level];
    const assigned = pending.map(assign);
    if (level === levels.length - 1) {
      settled.push(...assigned);
      break;
    }
    const counts = new Map<string, number>();
    for (const a of assigned) counts.set(a.key, (counts.get(a.key) ?? 0) + 1);
    const next: RoomQuarterObservation[] = [];
    for (const a of assigned) {
      if ((counts.get(a.key) ?? 0) >= minStratumRooms) settled.push(a);
      else next.push(a.room);
    }
    if (next.length === 0) break;
    pending = next;
  }
  return settled;
}

/**
 * Compare two quarters on matched rooms, inside strata.
 *
 * Suppression here is local and recoverable: a stratum that cannot be believed
 * hands its weight to its siblings in the same unit type rather than taking the
 * whole comparison down with it. That is the property chain-linking lacked, and
 * it is why one thin room type no longer costs a scope its entire history.
 */
export function compareQuarters(input: CompareQuartersInput): QuarterComparison {
  const t = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const baseByKey = new Map(input.base.map((r) => [r.unitKey, r]));
  const assigned = assignStrata(input.ending, t.minStratumRooms);

  interface Acc {
    unitType: string;
    careLevel: string;
    priceBand: number;
    endingRooms: number;
    endingRevenue: number;
    matchedRooms: number;
    /** Ending weight x ending rate — the ratio numerator. */
    matchedEndingRevenue: number;
    /** Ending weight x base rate — the ratio denominator. */
    matchedBaseRevenueAtEndingWeights: number;
    /** Base weight x base rate — the secondary aggregation's weight. */
    matchedBaseRevenueAtBaseWeights: number;
  }
  const acc = new Map<string, Acc>();
  for (const a of assigned) {
    let s = acc.get(a.key);
    if (!s) {
      s = {
        unitType: a.unitType,
        careLevel: a.careLevel,
        priceBand: a.priceBand,
        endingRooms: 0,
        endingRevenue: 0,
        matchedRooms: 0,
        matchedEndingRevenue: 0,
        matchedBaseRevenueAtEndingWeights: 0,
        matchedBaseRevenueAtBaseWeights: 0,
      };
      acc.set(a.key, s);
    }
    const w = a.room.weight > 0 ? a.room.weight : 0;
    s.endingRooms += 1;
    s.endingRevenue += w * a.room.rateMonthly;

    const baseRoom = baseByKey.get(a.room.unitKey);
    if (!baseRoom || !(baseRoom.rateMonthly > 0) || w <= 0) continue;
    s.matchedRooms += 1;
    // Both sides of the RATIO use the ending weight, so the within-stratum
    // ratio is a pure price comparison and no occupancy change can leak into
    // it. The secondary aggregation is a different question — what these same
    // price movements would total on the base quarter's own composition — so
    // it must carry the base quarter's own weights, including its occupancy.
    s.matchedEndingRevenue += w * a.room.rateMonthly;
    s.matchedBaseRevenueAtEndingWeights += w * baseRoom.rateMonthly;
    s.matchedBaseRevenueAtBaseWeights +=
      (baseRoom.weight > 0 ? baseRoom.weight : 0) * baseRoom.rateMonthly;
  }

  const strata: StratumResult[] = [];
  const rawRatioByKey = new Map<string, number | null>();
  for (const [key, s] of Array.from(acc)) {
    const coverageByCountPct = s.endingRooms > 0 ? (s.matchedRooms / s.endingRooms) * 100 : 0;
    const coverageByRevenuePct =
      s.endingRevenue > 0 ? (s.matchedEndingRevenue / s.endingRevenue) * 100 : 0;
    const rawRatio =
      s.matchedBaseRevenueAtEndingWeights > 0
        ? s.matchedEndingRevenue / s.matchedBaseRevenueAtEndingWeights
        : null;
    const ratio = rawRatio;
    rawRatioByKey.set(key, rawRatio);

    let reasonCode: string | null = null;
    if (ratio == null || !(ratio > 0)) reasonCode = "NO_MATCHED_ROOMS";
    else if (s.matchedRooms < t.minMatchedRooms)
      reasonCode = `INSUFFICIENT_MATCHED_ROOMS:${s.matchedRooms}<${t.minMatchedRooms}`;
    else if (
      s.endingRooms >= t.percentageGateMinRooms &&
      coverageByCountPct < t.coverageFloorPct
    )
      reasonCode = `COVERAGE_BELOW_FLOOR:${coverageByCountPct.toFixed(0)}%<${t.coverageFloorPct}%`;

    strata.push({
      key,
      unitType: s.unitType,
      careLevel: s.careLevel,
      priceBand: s.priceBand,
      matchedRooms: s.matchedRooms,
      endingRooms: s.endingRooms,
      coverageByCountPct,
      coverageByRevenuePct,
      ratio: reasonCode ? null : ratio,
      endingWeightShare: 0,
      baseWeightShare: 0,
      suppressed: reasonCode != null,
      reasonCode,
    });
  }
  strata.sort((a, b) => a.key.localeCompare(b.key));

  // Raw weights before redistribution: ending-quarter revenue for the primary
  // weighting, matched base-quarter revenue for the secondary. The secondary is
  // necessarily matched-only — an unmatched base room has no stratum, because
  // strata are defined by ending-quarter attributes.
  const rawEndingWeight = new Map<string, number>();
  const rawBaseWeight = new Map<string, number>();
  for (const [key, s] of Array.from(acc)) {
    rawEndingWeight.set(key, s.endingRevenue);
    rawBaseWeight.set(key, s.matchedBaseRevenueAtBaseWeights);
  }

  const live = strata.filter((s) => !s.suppressed && s.ratio != null);
  const redistributedUnitTypes = new Set<string>();
  let redistributedAcrossUnitTypes = false;

  const redistribute = (raw: Map<string, number>): Map<string, number> => {
    const out = new Map<string, number>();
    for (const s of live) out.set(s.key, raw.get(s.key) ?? 0);
    for (const dead of strata.filter((s) => s.suppressed)) {
      const orphan = raw.get(dead.key) ?? 0;
      if (orphan <= 0) continue;
      const siblings = live.filter((s) => s.unitType === dead.unitType);
      const pool = siblings.length > 0 ? siblings : live;
      if (pool.length === 0) continue;
      if (siblings.length > 0) redistributedUnitTypes.add(dead.unitType);
      else redistributedAcrossUnitTypes = true;
      const poolTotal = pool.reduce((sum, s) => sum + (raw.get(s.key) ?? 0), 0);
      for (const s of pool) {
        const share = poolTotal > 0 ? (raw.get(s.key) ?? 0) / poolTotal : 1 / pool.length;
        out.set(s.key, (out.get(s.key) ?? 0) + orphan * share);
      }
    }
    return out;
  };

  const endingWeights = redistribute(rawEndingWeight);
  const baseWeights = redistribute(rawBaseWeight);
  const endingTotal = Array.from(endingWeights.values()).reduce((a, b) => a + b, 0);
  const baseTotal = Array.from(baseWeights.values()).reduce((a, b) => a + b, 0);

  let ratio: number | null = null;
  let baseWeightedRatio: number | null = null;
  if (live.length > 0 && endingTotal > 0) {
    ratio = live.reduce(
      (sum, s) => sum + ((endingWeights.get(s.key) ?? 0) / endingTotal) * s.ratio!,
      0,
    );
  }
  if (live.length > 0 && baseTotal > 0) {
    baseWeightedRatio = live.reduce(
      (sum, s) => sum + ((baseWeights.get(s.key) ?? 0) / baseTotal) * s.ratio!,
      0,
    );
  }
  for (const s of strata) {
    s.endingWeightShare = endingTotal > 0 ? (endingWeights.get(s.key) ?? 0) / endingTotal : 0;
    s.baseWeightShare = baseTotal > 0 ? (baseWeights.get(s.key) ?? 0) / baseTotal : 0;
  }

  const withAnyRatio = strata.filter((s) => (rawRatioByKey.get(s.key) ?? 0) > 0);
  const anyRatioTotal = withAnyRatio.reduce(
    (sum, s) => sum + (rawEndingWeight.get(s.key) ?? 0),
    0,
  );
  const unsuppressedRatio =
    withAnyRatio.length > 0 && anyRatioTotal > 0
      ? withAnyRatio.reduce(
          (sum, s) =>
            sum + ((rawEndingWeight.get(s.key) ?? 0) / anyRatioTotal) * rawRatioByKey.get(s.key)!,
          0,
        )
      : null;

  const matchedRooms = strata.reduce((sum, s) => sum + s.matchedRooms, 0);
  const endingRooms = strata.reduce((sum, s) => sum + s.endingRooms, 0);
  const endingRevenue = Array.from(acc.values()).reduce((sum, s) => sum + s.endingRevenue, 0);
  const matchedRevenue = Array.from(acc.values()).reduce(
    (sum, s) => sum + s.matchedEndingRevenue,
    0,
  );

  const rawChangePct =
    input.rawEndingRate != null && input.rawBaseRate != null && input.rawBaseRate > 0
      ? (input.rawEndingRate / input.rawBaseRate - 1) * 100
      : null;
  const rateEffectPct = ratio != null ? (ratio - 1) * 100 : null;
  const mixEffectPct =
    rawChangePct != null && rateEffectPct != null ? rawChangePct - rateEffectPct : null;

  return {
    baseQuarterLabel: input.baseQuarterLabel,
    endingQuarterLabel: input.endingQuarterLabel,
    strata,
    ratio,
    baseWeightedRatio,
    unsuppressedRatio,
    compositionEffectPct:
      ratio != null && baseWeightedRatio != null && baseWeightedRatio > 0
        ? (ratio / baseWeightedRatio - 1) * 100
        : null,
    matchedRooms,
    endingRooms,
    coverageByCountPct: endingRooms > 0 ? (matchedRooms / endingRooms) * 100 : 0,
    coverageByRevenuePct: endingRevenue > 0 ? (matchedRevenue / endingRevenue) * 100 : 0,
    rawChangePct,
    rateEffectPct,
    mixEffectPct,
    suppressedStrata: strata
      .filter((s) => s.suppressed)
      .map((s) => ({ key: s.key, reasonCode: s.reasonCode ?? "SUPPRESSED" })),
    redistributedUnitTypes: Array.from(redistributedUnitTypes).sort(),
    redistributedAcrossUnitTypes,
    usable: ratio != null && ratio > 0,
    reasonCode:
      ratio != null && ratio > 0
        ? null
        : endingRooms === 0
          ? "NO_ENDING_ROOMS"
          : matchedRooms === 0
            ? "NO_MATCHED_ROOMS"
            : "ALL_STRATA_SUPPRESSED",
  };
}
