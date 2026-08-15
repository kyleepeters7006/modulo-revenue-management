/**
 * Shared care-adjusted competitor benchmark service.
 *
 * Every page that displays a street-vs-competitor premium must use this one
 * methodology so premiums never contradict each other:
 *
 *  - Survey `monthly_rate_avg` averaged per keystats location + competitor type
 *  - HC/HC-MC/SMC values are daily: entered-as-monthly mistakes are normalized
 *    (base >800 → /30; care/med >200 → /30), implausible values discarded
 *  - Service line → competitor type mapping (SL→IL_IL, VIL→IL_Villa,
 *    HC/MC→[HC/MC, SMC legacy])
 *  - Care adjustment = (their care L2 − our care L2) + their med mgmt fee,
 *    with the care-L2 differential gated to care-bearing service lines
 *    (HC, HC/MC, AL, AL/MC) — never SL/VIL
 *  - For multi-location scopes, unit-weight per location and fall back
 *    PER LOCATION (not globally) to stored competitor_final_rate averages
 *    where survey coverage is missing
 *
 * Never present a premium computed as a raw average of
 * rent_roll_data.competitor_final_rate — it is a blended, room-mix-distorted
 * number (it once showed AL at a false 34.7% premium when the care-adjusted
 * market benchmark put AL at parity).
 */

import type { Pool } from "pg";

// Service line → survey competitor types, in fallback order.
// HC/MC falls back to the legacy SMC type for older survey imports.
// AL/MC and AL are distinct service lines with separate survey entries.
export const SL_TO_COMP: Record<string, string[]> = {
  AL: ["AL"],
  "AL/MC": ["AL/MC"],
  HC: ["HC"],
  "HC/MC": ["HC/MC", "SMC"],
  SL: ["IL_IL"],
  VIL: ["IL_Villa"],
};

// Care-L2 differential applies only to care-bearing service lines.
export const CARE_L2_APPLIES: Record<string, boolean> = {
  HC: true,
  "HC/MC": true,
  AL: true,
  "AL/MC": true,
  SL: false,
  VIL: false,
};

// Competitor types whose survey values are quoted daily.
export const DAILY_COMP_TYPES = new Set(["HC", "HC/MC", "SMC"]);

/**
 * Picks which of our rates to compare against a competitor benchmark, so every
 * surface that reports "position vs top competitor" uses one rule.
 *
 * Studio is the like-for-like unit: it is the product nearly every competitor
 * publishes, so comparing Studio to Studio keeps room mix out of the number.
 * Two cases fall back to an all-room-type average instead:
 *
 *  - VIL always. Villa/independent-living stock is not a Studio product, and the
 *    handful of Studio rows surveyed against it carry implausible values (they
 *    appear to be entrance fees rather than monthly rent).
 *  - Any location/service line with no Studio units of our own — patio-home style
 *    SL campuses, for instance, where both we and the competitors publish only
 *    1BR/2BR. Without this the location would drop out of the comparison entirely.
 *
 * The competitor side of StudioCompBenchmark is already all-room-type whenever a
 * competitor has no Studio rows, so both sides degrade together.
 */
export function pickComparisonRate(
  serviceLine: string,
  studioRate: number,
  allRoomRate: number,
): number {
  if (serviceLine !== 'VIL' && studioRate > 0) return studioRate;
  return allRoomRate;
}

export interface SurveyRow {
  keystats_location: string;
  competitor_type: string;
  monthly_rate_avg: number | string | null;
  care_level_2_rate: number | string | null;
  medication_management_fee: number | string | null;
  /** Optional room type for room-type-specific benchmark lookups. */
  room_type?: string | null;
}

export interface CompBenchmarkEntry {
  baseRate: number;
  careL2: number;
  medMgmt: number;
}

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Normalize a survey base rate; null when implausible/unusable. */
export function normalizeBaseRate(compType: string, value: number | string | null): number | null {
  const v = num(value);
  if (v === null || v <= 0) return null;
  if (DAILY_COMP_TYPES.has(compType)) {
    if (v > 800) return v / 30.0; // monthly entered by mistake
    if (v < 50) return null;
    return v;
  }
  if (v < 500 || v > 25000) return null;
  return v;
}

/** Normalize a survey care-L2 rate; null when implausible/unusable. */
export function normalizeCareL2(compType: string, value: number | string | null): number | null {
  const v = num(value);
  if (v === null || v <= 0) return null;
  if (DAILY_COMP_TYPES.has(compType)) {
    return v > 200 ? v / 30.0 : v;
  }
  return v >= 1 && v <= 5000 ? v : null;
}

/** Normalize a survey med-mgmt fee; null when implausible/unusable. */
export function normalizeMedMgmt(compType: string, value: number | string | null): number | null {
  const v = num(value);
  if (v === null || v <= 0) return null;
  if (DAILY_COMP_TYPES.has(compType)) {
    return v > 200 ? v / 30.0 : v;
  }
  return v >= 1 && v <= 2000 ? v : null;
}

/**
 * Aggregate raw survey rows into per-(location, competitor type) benchmark
 * entries. Averages are rounded to whole dollars (matching the historical SQL
 * ROUND(AVG(...), 0)). Groups without a usable base rate are dropped.
 */
export function aggregateSurveyRows(rows: SurveyRow[]): Map<string, CompBenchmarkEntry> {
  const acc = new Map<string, { base: number[]; care: number[]; med: number[] }>();
  for (const r of rows) {
    const key = `${r.keystats_location}|||${r.competitor_type}`;
    let e = acc.get(key);
    if (!e) { e = { base: [], care: [], med: [] }; acc.set(key, e); }
    const b = normalizeBaseRate(r.competitor_type, r.monthly_rate_avg);
    const c = normalizeCareL2(r.competitor_type, r.care_level_2_rate);
    const m = normalizeMedMgmt(r.competitor_type, r.medication_management_fee);
    if (b !== null) e.base.push(b);
    if (c !== null) e.care.push(c);
    if (m !== null) e.med.push(m);
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);
  const out = new Map<string, CompBenchmarkEntry>();
  for (const [key, e] of acc) {
    if (!e.base.length) continue;
    const baseRate = avg(e.base);
    if (baseRate <= 0) continue;
    out.set(key, { baseRate, careL2: avg(e.care), medMgmt: avg(e.med) });
  }
  return out;
}

/**
 * Aggregate raw survey rows into per-(location, competitor type, room type)
 * benchmark entries for room-type-specific lookups. Only rows that carry a
 * non-empty room_type are included; rows without one are skipped (they
 * contribute to the SL-level blended benchmark via aggregateSurveyRows).
 */
export function aggregateSurveyRowsByRT(rows: SurveyRow[]): Map<string, CompBenchmarkEntry> {
  const acc = new Map<string, { base: number[]; care: number[]; med: number[] }>();
  for (const r of rows) {
    if (!r.room_type) continue; // no RT — goes into the SL-level map only
    const key = `${r.keystats_location}|||${r.competitor_type}|||${r.room_type}`;
    let e = acc.get(key);
    if (!e) { e = { base: [], care: [], med: [] }; acc.set(key, e); }
    const b = normalizeBaseRate(r.competitor_type, r.monthly_rate_avg);
    const c = normalizeCareL2(r.competitor_type, r.care_level_2_rate);
    const m = normalizeMedMgmt(r.competitor_type, r.medication_management_fee);
    if (b !== null) e.base.push(b);
    if (c !== null) e.care.push(c);
    if (m !== null) e.med.push(m);
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);
  const out = new Map<string, CompBenchmarkEntry>();
  for (const [key, e] of acc) {
    if (!e.base.length) continue;
    const baseRate = avg(e.base);
    if (baseRate <= 0) continue;
    out.set(key, { baseRate, careL2: avg(e.care), medMgmt: avg(e.med) });
  }
  return out;
}

export interface CompBenchmarkResult {
  /** Care-adjusted benchmark (>= 1). */
  adjusted: number;
  /** Raw averaged survey base rate before care adjustment. */
  base: number;
  /** (their care L2 − ours, if applicable) + their med mgmt. */
  careAdj: number;
  /** Competitor type the benchmark came from. */
  compType: string;
}

/**
 * Loaded benchmark data for one client: survey averages plus our care rates.
 * Construct via loadCompBenchmark() or directly in tests.
 */
export class CompBenchmark {
  constructor(
    private compMap: Map<string, CompBenchmarkEntry>,
    private ourCareMap: Map<string, number>,
    /** Optional: per-(location, compType, roomType) entries for RT-specific lookups. */
    private compRTMap?: Map<string, CompBenchmarkEntry>,
  ) {}

  /**
   * Care-adjusted comp benchmark for one location + service line, or null
   * when there is no survey coverage.
   */
  benchmarkFor(location: string, serviceLine: string): CompBenchmarkResult | null {
    for (const ct of SL_TO_COMP[serviceLine] || [serviceLine]) {
      const v = this.compMap.get(`${location}|||${ct}`);
      if (v && v.baseRate > 0) {
        const careDiff = CARE_L2_APPLIES[serviceLine]
          ? v.careL2 - (this.ourCareMap.get(`${location}|||${serviceLine}`) || 0)
          : 0;
        const careAdj = careDiff + v.medMgmt;
        return {
          adjusted: Math.max(v.baseRate + careAdj, 1),
          base: v.baseRate,
          careAdj,
          compType: ct,
        };
      }
    }
    return null;
  }

  /**
   * Room-type-specific care-adjusted benchmark. Returns a result ONLY when
   * the survey has data for the exact room type — never falls back to the
   * SL-level blended benchmark, so callers can reliably distinguish
   * "survey covers this room type" from "survey has no RT-specific data".
   *
   * If you need the SL-level fallback use:
   *   benchmarkForRT(...) ?? benchmarkFor(...)
   */
  benchmarkForRT(location: string, serviceLine: string, roomType: string): CompBenchmarkResult | null {
    if (this.compRTMap) {
      for (const ct of SL_TO_COMP[serviceLine] || [serviceLine]) {
        const v = this.compRTMap.get(`${location}|||${ct}|||${roomType}`);
        if (v && v.baseRate > 0) {
          const careDiff = CARE_L2_APPLIES[serviceLine]
            ? v.careL2 - (this.ourCareMap.get(`${location}|||${serviceLine}`) || 0)
            : 0;
          const careAdj = careDiff + v.medMgmt;
          return {
            adjusted: Math.max(v.baseRate + careAdj, 1),
            base: v.baseRate,
            careAdj,
            compType: ct,
          };
        }
      }
    }
    return null;
  }
}

/** Load survey + care-rate data for a client and return a CompBenchmark. */
export async function loadCompBenchmark(pool: Pool, clientId: string): Promise<CompBenchmark> {
  const [surveyRes, careRes] = await Promise.all([
    pool.query(
      `SELECT keystats_location, competitor_type, room_type,
              monthly_rate_avg, care_level_2_rate, medication_management_fee
       FROM competitive_survey_data
       WHERE (client_id = $1 OR client_id IS NULL) AND monthly_rate_avg > 0`,
      [clientId],
    ),
    pool.query(
      `SELECT l.name AS location_name, clr.service_line, clr.level2_rate
       FROM care_level_rates clr
       JOIN locations l ON clr.location_id = l.id
       WHERE clr.client_id = $1`,
      [clientId],
    ),
  ]);
  const ourCareMap = new Map<string, number>();
  for (const row of careRes.rows) {
    ourCareMap.set(`${row.location_name}|||${row.service_line}`, Number(row.level2_rate) || 0);
  }
  const rows = surveyRes.rows as SurveyRow[];
  return new CompBenchmark(
    aggregateSurveyRows(rows),
    ourCareMap,
    aggregateSurveyRowsByRT(rows),
  );
}

export interface StudioCompResult {
  /** Highest care-adjusted Studio rate among surveyed competitors. */
  topAdjusted: number;
  /** Name of that competitor. */
  topName: string;
  /** That competitor's raw (unadjusted) averaged Studio base rate. */
  topBase: number;
  /** Care adjustment applied to the top competitor's base. */
  topCareAdj: number;
  /** Average care-adjusted Studio rate across all surveyed competitors. */
  avgAdjusted: number;
  /** Number of competitors with usable Studio rates. */
  compCount: number;
  /** Competitor type the rates came from. */
  compType: string;
}

/**
 * Per-competitor care-adjusted benchmark used for the Competitive Position
 * scatter chart. Loads from the LATEST survey month per location (matching the
 * Competitors tab) using ALL room types for the competitor's rate, so that any
 * competitor visible in the Competitors tab can appear as a benchmark even if
 * that competitor has no Studio-specific survey rows. Our rate on the Y-axis
 * remains Studio-only (computed in the route); only the competitor benchmark
 * side is all-room-type.
 *
 * Top competitor selection mirrors the Competitors tab: highest-weight
 * competitor wins (weight > 0 required); ties broken by nearest distance.
 * When no competitor has a positive weight for a location/SL, falls back to
 * the 5 nearest unique competitors by distance_miles.
 */
export class StudioCompBenchmark {
  constructor(
    /** `${location}|||${compType}|||${competitorName}` → entry */
    private compMap: Map<string, CompBenchmarkEntry>,
    private ourCareMap: Map<string, number>,
    /**
     * `${location}|||${compType}|||${competitorName}` → { weight, distanceMiles }
     * Weight parsed from notes JSON; first occurrence per competitor name wins.
     */
    private weightDistMap: Map<string, { weight: number; distanceMiles: number | null }>,
  ) {}

  /** All unique location names that have any survey coverage. */
  allLocations(): Set<string> {
    const locs = new Set<string>();
    for (const key of Array.from(this.compMap.keys())) {
      const parts = key.split('|||');
      if (parts[0]) locs.add(parts[0]);
    }
    return locs;
  }

  benchmarkFor(location: string, serviceLine: string): StudioCompResult | null {
    // Collect candidates across ALL mapped competitor types (e.g. HC/MC + legacy
    // SMC) before picking top/average — a first-type-wins early return would hide
    // higher-priced competitors recorded under a legacy type. If the same
    // competitor name appears under multiple types, keep its highest adjusted rate.
    const byName = new Map<string, { name: string; base: number; careAdj: number; adjusted: number; compType: string; weightDistKey: string }>();
    for (const ct of SL_TO_COMP[serviceLine] || [serviceLine]) {
      const prefix = `${location}|||${ct}|||`;
      for (const [key, v] of this.compMap) {
        if (!key.startsWith(prefix) || v.baseRate <= 0) continue;
        const careDiff = CARE_L2_APPLIES[serviceLine]
          ? v.careL2 - (this.ourCareMap.get(`${location}|||${serviceLine}`) || 0)
          : 0;
        const careAdj = careDiff + v.medMgmt;
        const cand = {
          name: key.slice(prefix.length),
          base: v.baseRate,
          careAdj,
          adjusted: Math.max(v.baseRate + careAdj, 1),
          compType: ct,
          weightDistKey: key, // full `loc|||ct|||name` key for weight lookup
        };
        const existing = byName.get(cand.name);
        if (!existing || cand.adjusted > existing.adjusted) byName.set(cand.name, cand);
      }
    }
    const comps = Array.from(byName.values());
    if (!comps.length) return null;

    // Select top competitor by highest weight; break ties by nearest distance.
    // This mirrors server/storage.ts:1907-1918 (the weight-pass used by the
    // individual rate-card endpoint). Rate is still used for the market average
    // across all competitors; only the "which one is top" decision uses weight.
    const getWD = (key: string) =>
      this.weightDistMap.get(key) ?? { weight: 0, distanceMiles: null };
    const top = comps.reduce((a, b) => {
      const wa = getWD(a.weightDistKey);
      const wb = getWD(b.weightDistKey);
      if (wb.weight !== wa.weight) return wb.weight > wa.weight ? b : a;
      const da = wa.distanceMiles ?? Infinity;
      const db = wb.distanceMiles ?? Infinity;
      return db < da ? b : a;
    });

    const avgAdjusted = comps.reduce((s, c) => s + c.adjusted, 0) / comps.length;
    return {
      topAdjusted: top.adjusted,
      topName: top.name,
      topBase: top.base,
      topCareAdj: top.careAdj,
      avgAdjusted,
      compCount: comps.length,
      compType: top.compType,
    };
  }
}

/**
 * Load per-competitor benchmark data for the Competitive Position chart.
 *
 * Key differences from the generic loadCompBenchmark:
 * - Keyed per competitor name (not just location+type) so callers can identify
 *   the top competitor and compute an average across all competitors.
 * - Restricted to the LATEST survey month per keystats_location, matching the
 *   data the Competitors tab shows. This prevents stale competitor rows from
 *   older months from winning the "top competitor" ranking.
 * - Loads ALL room types (not Studio-only). Our rate on the chart Y-axis is
 *   Studio-only (computed in the route); the competitor benchmark uses all room
 *   types so that any competitor visible in the Competitors tab can appear as a
 *   benchmark even when that competitor has no Studio-specific survey rows.
 */
/** Parse the weight value stored as JSON in the `notes` column. */
function parseNoteWeight(notes: string | null): number {
  if (!notes) return 0;
  try {
    const parsed = typeof notes === 'string' ? JSON.parse(notes) : notes;
    return parseFloat(String(parsed?.weight ?? '0')) || 0;
  } catch { return 0; }
}

export async function loadStudioCompBenchmark(pool: Pool, clientId: string): Promise<StudioCompBenchmark> {
  const [surveyRes, careRes] = await Promise.all([
    // Use a CTE to restrict to the latest survey month per keystats_location,
    // matching the filtering the Competitors tab applies. Rows from older months
    // are excluded so that a competitor recorded in November but absent (or with
    // an implausible rate) in December cannot win the "top competitor" ranking.
    pool.query(
      `WITH latest_months AS (
         -- Determine the latest survey month per location from ALL client-scoped rows
         -- (no rate filter here) so that a newest upload with no positive rates still
         -- marks that month as the latest, preventing older months from silently
         -- winning. The rate filter is applied in the outer query only.
         SELECT keystats_location, MAX(survey_month) AS latest_month
         FROM competitive_survey_data
         WHERE (client_id = $1 OR client_id IS NULL)
         GROUP BY keystats_location
       ),
       studio_presence AS (
         -- Flag whether each competitor has at least one Studio-type row in the
         -- latest month. "Studio%" matches Studio, Studio Dlx, Studio Suite, etc.
         -- This drives Studio-preference: when a competitor has Studio rows we use
         -- only those (so the chart matches the Competitors tab rate); when they
         -- have none we fall back to all room types so the competitor still appears.
         SELECT csd.keystats_location, csd.competitor_name, csd.competitor_type,
                MAX(CASE WHEN csd.room_type ILIKE 'studio%' THEN 1 ELSE 0 END) AS has_studio
         FROM competitive_survey_data csd
         JOIN latest_months lm
           ON lm.keystats_location = csd.keystats_location
          AND lm.latest_month      = csd.survey_month
         WHERE (csd.client_id = $1 OR csd.client_id IS NULL) AND csd.monthly_rate_avg > 0
         GROUP BY csd.keystats_location, csd.competitor_name, csd.competitor_type
       )
       SELECT csd.keystats_location, csd.competitor_type, csd.competitor_name,
              csd.monthly_rate_avg, csd.care_level_2_rate, csd.medication_management_fee,
              csd.notes, csd.distance_miles
       FROM competitive_survey_data csd
       JOIN latest_months lm
         ON lm.keystats_location = csd.keystats_location
        AND lm.latest_month      = csd.survey_month
       JOIN studio_presence sp
         ON sp.keystats_location = csd.keystats_location
        AND sp.competitor_name   = csd.competitor_name
        AND sp.competitor_type   = csd.competitor_type
       WHERE (csd.client_id = $1 OR csd.client_id IS NULL) AND csd.monthly_rate_avg > 0
         AND (
           -- Prefer Studio-type rows when available — these match the Competitors tab
           (sp.has_studio = 1 AND csd.room_type ILIKE 'studio%')
           OR
           -- Fall back to all room types only when the competitor has no Studio rows
           (sp.has_studio = 0)
         )`,
      [clientId],
    ),
    pool.query(
      `SELECT l.name AS location_name, clr.service_line, clr.level2_rate
       FROM care_level_rates clr
       JOIN locations l ON clr.location_id = l.id
       WHERE clr.client_id = $1`,
      [clientId],
    ),
  ]);

  // ── Weight + distance metadata ────────────────────────────────────────────
  // Build per-competitor weight/distance map (first occurrence per unique
  // loc|||type|||name key wins, mirroring storage.ts:1870-1888).
  // Key: `${keystats_location}|||${competitor_type}|||${competitor_name}`
  const weightDistMap = new Map<string, { weight: number; distanceMiles: number | null }>();
  for (const r of surveyRes.rows as any[]) {
    const key = `${r.keystats_location}|||${r.competitor_type}|||${r.competitor_name}`;
    if (!weightDistMap.has(key)) {
      weightDistMap.set(key, {
        weight: parseNoteWeight(r.notes),
        distanceMiles: r.distance_miles != null ? Number(r.distance_miles) : null,
      });
    }
  }

  // ── Weight-based filtering per (keystats_location, competitor_type) group ──
  // Mirrors the Competitors tab logic (server/routes.ts:12389-12403):
  //   • Keep only competitors with weight > 0 when any exist for the group.
  //   • Fall back to the 5 nearest unique competitors by distance when none
  //     have a positive weight.
  const keepCompetitor = new Set<string>(); // `loc|||type|||name` keys to retain

  // Group unique competitor names by (location, type)
  const groupToNames = new Map<string, Set<string>>(); // `loc|||type` → names
  for (const [key] of weightDistMap) {
    const parts = key.split('|||');
    const groupKey = `${parts[0]}|||${parts[1]}`;
    if (!groupToNames.has(groupKey)) groupToNames.set(groupKey, new Set());
    groupToNames.get(groupKey)!.add(parts[2]);
  }

  for (const [groupKey, names] of groupToNames) {
    const weightedNames = [...names].filter(name => {
      const meta = weightDistMap.get(`${groupKey}|||${name}`);
      return meta && meta.weight > 0;
    });

    if (weightedNames.length > 0) {
      // Retain only positive-weight competitors for this group
      for (const name of weightedNames) {
        keepCompetitor.add(`${groupKey}|||${name}`);
      }
    } else {
      // Fallback: 5 nearest unique competitors by distance_miles
      const sorted = [...names].sort((a, b) => {
        const da = weightDistMap.get(`${groupKey}|||${a}`)?.distanceMiles ?? 999;
        const db = weightDistMap.get(`${groupKey}|||${b}`)?.distanceMiles ?? 999;
        return da - db;
      });
      for (const name of sorted.slice(0, 5)) {
        keepCompetitor.add(`${groupKey}|||${name}`);
      }
    }
  }

  // Filter survey rows to only the retained competitors before rate aggregation
  const filteredRows = (surveyRes.rows as any[]).filter(r =>
    keepCompetitor.has(`${r.keystats_location}|||${r.competitor_type}|||${r.competitor_name}`)
  );

  // ── Rate aggregation ─────────────────────────────────────────────────────
  // Reuse aggregateSurveyRows by folding the competitor name into the
  // keystats_location key, then unfolding into the per-competitor map.
  const folded = filteredRows.map((r: any) => ({
    ...r,
    keystats_location: `${r.keystats_location}|||${r.competitor_type}|||${r.competitor_name}`,
    competitor_type: r.competitor_type,
  }));
  const aggregated = aggregateSurveyRows(folded as SurveyRow[]);
  const compMap = new Map<string, CompBenchmarkEntry>();
  for (const [key, v] of aggregated) {
    // key = loc|||type|||name|||type — drop the trailing duplicate type segment
    const parts = key.split("|||");
    compMap.set(parts.slice(0, 3).join("|||"), v);
  }
  const ourCareMap = new Map<string, number>();
  for (const row of careRes.rows) {
    ourCareMap.set(`${row.location_name}|||${row.service_line}`, Number(row.level2_rate) || 0);
  }
  return new StudioCompBenchmark(compMap, ourCareMap, weightDistMap);
}

export interface LocationUnits {
  location: string;
  unitCount: number;
  /** Per-unit stored competitor_final_rate values (fallback only). */
  competitorFinalRates: number[];
}

/**
 * Unit-weighted benchmark across locations. Where a location has no survey
 * coverage, falls back PER LOCATION to the average of its stored
 * competitor_final_rate values so multi-location scopes are not biased toward
 * survey-covered campuses. Returns null when no location yields a value.
 */
export function unitWeightedBenchmark(
  benchmark: CompBenchmark,
  serviceLine: string,
  locations: LocationUnits[],
): number | null {
  let weighted = 0;
  let weight = 0;
  for (const loc of locations) {
    if (!loc.location || loc.unitCount <= 0) continue;
    let comp: number | null = benchmark.benchmarkFor(loc.location, serviceLine)?.adjusted ?? null;
    if (comp === null) {
      const rates = loc.competitorFinalRates.filter((r) => r > 0);
      comp = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
    }
    if (comp !== null) {
      weighted += comp * loc.unitCount;
      weight += loc.unitCount;
    }
  }
  return weight > 0 ? weighted / weight : null;
}
