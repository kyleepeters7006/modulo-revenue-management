/**
 * Chain-linked matched-pair rate index.
 *
 * The problem this replaces: standardizing each historical month against
 * whichever rooms qualified *in that month* let eligibility churn masquerade as
 * price movement. Requiring survival across the whole window removed the churn
 * but kept only a biased remnant of the portfolio (27%–66% depending on service
 * line), so the cure was as suspect as the disease.
 *
 * A chain-linked index needs neither. Growth is measured between ADJACENT
 * months only, on the rooms observed in both of them, and the monthly links are
 * multiplied together. A room that goes vacant for a month drops out of two
 * links and rejoins afterwards instead of disqualifying itself for a year.
 *
 * Three rules keep the chain honest, and all three matter:
 *
 * - **Eligibility is adjudicated once, at the base period.** The outlier gate,
 *   base-rate exclusions and payer scope are time series in their own right. Re-
 *   running them every month makes the qualifying RULE part of the measurement.
 *   A room that qualifies at base stays in at its actual historical rates.
 * - **Weights are fixed at the base period (Laspeyres).** Current-period
 *   weighting reintroduces mix through the back door even on a clean matched
 *   set.
 * - **The chain re-bases annually.** Base-period eligibility and weights get
 *   less representative the further back they are carried, so each 12-month
 *   segment is adjudicated at its own base and the segments are linked at the
 *   month they share.
 */

import { addMonths } from "./dates";

/** One room's observed rate in one month, already deduplicated by room. */
export interface RoomMonthRate {
  month: string;
  unitKey: string;
  rateMonthly: number;
  /** Observation volume in that month — resident-months or resident-days. */
  weight: number;
}

/** Rooms adjudicated eligible at a segment's base month, with fixed weights. */
export interface BaseCohort {
  baseMonth: string;
  /** unitKey -> base-period weight. This is the Laspeyres weight. */
  weights: Map<string, number>;
  rows: RoomMonthRate[];
}

export interface ChainLink {
  /** The later month of the pair. */
  month: string;
  priorMonth: string;
  /** Base-weighted matched-pair rate ratio, month / priorMonth. */
  ratio: number;
  matchedRooms: number;
  /** Rooms observed in at least one of the two months. */
  observableRooms: number;
  /**
   * Matched rooms as a share of the rooms the pair could have matched. This is
   * the gate: a link is judged on how much of what it could see it did see.
   */
  coveragePct: number;
  /**
   * Matched rooms as a share of every room priced today. Reported, not gated —
   * it necessarily decays with distance from the base period, because rooms
   * occupied today were simply not all occupied a year ago, so gating on it
   * would suppress the whole series rather than the unreliable parts of it.
   */
  coverageOfCurrentPct: number;
  /** Unrestricted month-over-month change, all qualifying rows, no matching. */
  rawChangePct: number | null;
  /** The matched-cohort rate effect: what price actually did. */
  rateEffectPct: number;
  /** Raw change minus rate effect — the composition effect, a real outcome. */
  mixEffectPct: number | null;
  belowFloor: boolean;
}

export interface ChainSegment {
  baseMonth: string;
  months: string[];
}

export interface ChainIndexResult {
  /** The anchor period. Its index is 1 by construction. */
  baseMonth: string;
  segments: ChainSegment[];
  links: ChainLink[];
  /** month -> price level relative to the base period. */
  index: Map<string, number>;
  /** month -> reason code, for months whose index is not trustworthy. */
  suppressed: Map<string, string>;
  /** Base-weight volume observed in each month, for rolling months into quarters. */
  observedWeight: Map<string, number>;
  /** month -> same-unit year-over-year growth %, paired room to itself. */
  sameUnitYoyPct: Map<string, number>;
  coverageFloorPct: number;
}

/** Inclusive month range, oldest first. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  for (let guard = 0; guard < 600 && cursor <= to; guard += 1) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/**
 * Split a span into 12-month segments walking BACKWARDS from the base, so the
 * most recent year is always adjudicated against the freshest base period.
 * Consecutive segments share their boundary month, which is what lets their
 * indices be linked without a discontinuity.
 */
export function planChainSegments(baseMonth: string, earliestMonth: string): ChainSegment[] {
  const segments: ChainSegment[] = [];
  let segmentBase = baseMonth;
  for (let guard = 0; guard < 50; guard += 1) {
    const segmentStart = addMonths(segmentBase, -12);
    const from = segmentStart > earliestMonth ? segmentStart : earliestMonth;
    segments.push({ baseMonth: segmentBase, months: monthRange(from, segmentBase) });
    if (from <= earliestMonth) break;
    segmentBase = segmentStart;
  }
  return segments;
}

interface BuildChainInput {
  segments: BaseCohort[];
  /** Every room priced today, for the reported coverage-of-current metric. */
  currentRoomCount: number;
  /** Unrestricted monthly series, for the rate/mix decomposition. */
  rawMonthly: Array<{ month: string; rateMonthly: number }>;
  coverageFloorPct: number;
}

/**
 * Build the chained index.
 *
 * Suppression propagates DOWNWARD from the base: the index at month t is
 * reached by walking links from the base back to t, so one unreliable link
 * makes every month on the far side of it unreliable too. Reporting a level
 * that was computed through a link we do not trust would be worse than
 * reporting nothing, because nothing is visibly nothing.
 */
export function buildChainIndex(input: BuildChainInput): ChainIndexResult {
  const { segments, currentRoomCount, rawMonthly, coverageFloorPct } = input;
  const rawByMonth = new Map(rawMonthly.map((m) => [m.month, m.rateMonthly]));
  const baseMonth = segments[0]?.baseMonth ?? "";

  const links: ChainLink[] = [];
  const index = new Map<string, number>();
  const observedWeight = new Map<string, number>();
  const suppressed = new Map<string, string>();
  const sameUnitYoyPct = new Map<string, number>();
  // Rates keyed month -> room, across every segment, for the same-unit YoY pass.
  const ratesByMonth = new Map<string, Map<string, number>>();
  const weightForRoom = new Map<string, number>();

  index.set(baseMonth, 1);

  for (const segment of segments) {
    const byMonth = new Map<string, Map<string, RoomMonthRate>>();
    for (const row of segment.rows) {
      let month = byMonth.get(row.month);
      if (!month) {
        month = new Map();
        byMonth.set(row.month, month);
      }
      month.set(row.unitKey, row);
      let shared = ratesByMonth.get(row.month);
      if (!shared) {
        shared = new Map();
        ratesByMonth.set(row.month, shared);
      }
      // A boundary month appears in two segments; either observation is the
      // same underlying rent roll, so the first one wins.
      if (!shared.has(row.unitKey)) shared.set(row.unitKey, row.rateMonthly);
    }
    for (const [unitKey, weight] of Array.from(segment.weights)) {
      if (!weightForRoom.has(unitKey)) weightForRoom.set(unitKey, weight);
    }

    const months = Array.from(byMonth.keys()).sort();
    for (const month of months) {
      const rooms = byMonth.get(month)!;
      let volume = 0;
      for (const unitKey of Array.from(rooms.keys())) {
        volume += segment.weights.get(unitKey) ?? 0;
      }
      if (!observedWeight.has(month)) observedWeight.set(month, volume);
    }

    // Walk the segment's own months newest-first so the index is carried
    // backwards from a level that is already known.
    const ordered = monthRange(months[0] ?? segment.baseMonth, segment.baseMonth);
    for (let i = ordered.length - 1; i > 0; i -= 1) {
      const later = ordered[i];
      const earlier = ordered[i - 1];
      const laterRooms = byMonth.get(later);
      const earlierRooms = byMonth.get(earlier);
      if (!laterRooms || !earlierRooms) {
        // A month with no rows at all is a gap in the rent roll, not a link
        // failure; everything beyond it is unreachable by chaining.
        suppressed.set(earlier, `NO_ROWS:${!earlierRooms ? earlier : later}`);
        break;
      }

      let laterRevenue = 0;
      let earlierRevenue = 0;
      let matched = 0;
      for (const [unitKey, laterRow] of Array.from(laterRooms)) {
        const earlierRow = earlierRooms.get(unitKey);
        if (!earlierRow) continue;
        const weight = segment.weights.get(unitKey) ?? 0;
        if (weight <= 0) continue;
        laterRevenue += weight * laterRow.rateMonthly;
        earlierRevenue += weight * earlierRow.rateMonthly;
        matched += 1;
      }
      const observable = new Set([
        ...Array.from(laterRooms.keys()),
        ...Array.from(earlierRooms.keys()),
      ]).size;

      const ratio = earlierRevenue > 0 ? laterRevenue / earlierRevenue : 0;
      const coveragePct = observable > 0 ? (matched / observable) * 100 : 0;
      const rawLater = rawByMonth.get(later);
      const rawEarlier = rawByMonth.get(earlier);
      const rawChangePct =
        rawLater != null && rawEarlier != null && rawEarlier > 0
          ? (rawLater / rawEarlier - 1) * 100
          : null;
      const rateEffectPct = ratio > 0 ? (ratio - 1) * 100 : 0;
      const belowFloor = ratio <= 0 || coveragePct < coverageFloorPct;

      links.push({
        month: later,
        priorMonth: earlier,
        ratio,
        matchedRooms: matched,
        observableRooms: observable,
        coveragePct,
        coverageOfCurrentPct: currentRoomCount > 0 ? (matched / currentRoomCount) * 100 : 0,
        rawChangePct,
        rateEffectPct,
        mixEffectPct: rawChangePct != null ? rawChangePct - rateEffectPct : null,
        belowFloor,
      });

      // The level is always computed, even through a link we do not trust, and
      // suppression is recorded beside it rather than in place of it. Callers
      // decide what to do with an untrusted level; a caller that would
      // otherwise have nothing at all can still fall back to it and say so.
      const laterIndex = index.get(later);
      if (laterIndex == null) {
        suppressed.set(earlier, suppressed.get(later) ?? `UNREACHABLE:${later}`);
        continue;
      }
      if (ratio > 0) index.set(earlier, laterIndex / ratio);
      if (belowFloor) {
        suppressed.set(earlier, `LINK_COVERAGE_BELOW_FLOOR:${earlier}->${later}`);
      } else if (suppressed.has(later)) {
        suppressed.set(earlier, suppressed.get(later)!);
      }
    }
    // The next (older) segment starts from the level this one just set at the
    // month they share, so no explicit hand-off is needed.
  }

  // Same-unit year-over-year: pair each room to ITSELF twelve months earlier,
  // on the base weights, so the two periods rest on one cohort and one set of
  // weights rather than on two independently-built series.
  for (const [month, rooms] of Array.from(ratesByMonth)) {
    const priorRooms = ratesByMonth.get(addMonths(month, -12));
    if (!priorRooms) continue;
    let now = 0;
    let then = 0;
    for (const [unitKey, rate] of Array.from(rooms)) {
      const priorRate = priorRooms.get(unitKey);
      if (priorRate == null) continue;
      const weight = weightForRoom.get(unitKey) ?? 0;
      if (weight <= 0) continue;
      now += weight * rate;
      then += weight * priorRate;
    }
    if (then > 0) sameUnitYoyPct.set(month, (now / then - 1) * 100);
  }

  return {
    baseMonth,
    segments: segments.map((s) => ({
      baseMonth: s.baseMonth,
      months: Array.from(new Set(s.rows.map((r) => r.month))).sort(),
    })),
    links: links.sort((a, b) => a.month.localeCompare(b.month)),
    index,
    suppressed,
    observedWeight,
    sameUnitYoyPct,
    coverageFloorPct,
  };
}
