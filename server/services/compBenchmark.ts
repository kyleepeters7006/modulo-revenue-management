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

export interface SurveyRow {
  keystats_location: string;
  competitor_type: string;
  monthly_rate_avg: number | string | null;
  care_level_2_rate: number | string | null;
  medication_management_fee: number | string | null;
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
}

/** Load survey + care-rate data for a client and return a CompBenchmark. */
export async function loadCompBenchmark(pool: Pool, clientId: string): Promise<CompBenchmark> {
  const [surveyRes, careRes] = await Promise.all([
    pool.query(
      `SELECT keystats_location, competitor_type,
              monthly_rate_avg, care_level_2_rate, medication_management_fee
       FROM competitive_survey_data
       WHERE client_id = $1 AND monthly_rate_avg > 0`,
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
  return new CompBenchmark(aggregateSurveyRows(surveyRes.rows as SurveyRow[]), ourCareMap);
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
 * Studio-only, per-competitor care-adjusted benchmark. Same normalization and
 * care-adjustment methodology as CompBenchmark, but restricted to Studio survey
 * rows and resolved per competitor so callers can compare against the
 * top-priced competitor as well as the market average.
 */
export class StudioCompBenchmark {
  constructor(
    /** `${location}|||${compType}|||${competitorName}` → entry */
    private compMap: Map<string, CompBenchmarkEntry>,
    private ourCareMap: Map<string, number>,
  ) {}

  benchmarkFor(location: string, serviceLine: string): StudioCompResult | null {
    // Collect candidates across ALL mapped competitor types (e.g. HC/MC + legacy
    // SMC) before picking top/average — a first-type-wins early return would hide
    // higher-priced competitors recorded under a legacy type. If the same
    // competitor name appears under multiple types, keep its highest adjusted rate.
    const byName = new Map<string, { name: string; base: number; careAdj: number; adjusted: number; compType: string }>();
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
        };
        const existing = byName.get(cand.name);
        if (!existing || cand.adjusted > existing.adjusted) byName.set(cand.name, cand);
      }
    }
    const comps = Array.from(byName.values());
    if (!comps.length) return null;
    const top = comps.reduce((a, b) => (b.adjusted > a.adjusted ? b : a));
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

/** Load Studio-only survey rows keyed per competitor plus our care rates. */
export async function loadStudioCompBenchmark(pool: Pool, clientId: string): Promise<StudioCompBenchmark> {
  const [surveyRes, careRes] = await Promise.all([
    pool.query(
      `SELECT keystats_location, competitor_type, competitor_name,
              monthly_rate_avg, care_level_2_rate, medication_management_fee
       FROM competitive_survey_data
       WHERE client_id = $1 AND monthly_rate_avg > 0 AND room_type ILIKE 'studio%'`,
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
  // Reuse aggregateSurveyRows by folding the competitor name into the
  // keystats_location key, then unfolding into the per-competitor map.
  const folded = surveyRes.rows.map((r: any) => ({
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
  return new StudioCompBenchmark(compMap, ourCareMap);
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
