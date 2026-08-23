/**
 * Applied in-house increase plans, indexed per unit for the Reference Data grid.
 *
 * Calculating a plan never writes; applying it inserts an immutable version into
 * `inhouse_rate_plans`. Only those applied versions are surfaced here — an
 * un-applied preview is not a rate anybody agreed to, so it must not appear
 * beside the rule rates operators price from.
 */
import { pool } from "../../db";

/** One resident's applied increase, in the same basis the rent roll stores. */
export interface AppliedPlanUnitRate {
  planId: string;
  version: number;
  /**
   * Display basis — daily for HC/HC-MC, monthly otherwise. This deliberately
   * matches `rent_roll_data.in_house_rate`, which is also daily for HC. Mixing
   * the bases puts the two roughly 30x apart.
   */
  newRate: number;
  currentRate: number;
  /**
   * Increase in the DISPLAY basis — comparable to `newRate`/`currentRate` and
   * to the in-house rate column beside them. For HC this is dollars per DAY.
   */
  increaseDollars: number;
  /**
   * Increase per MONTH, always. Revenue figures must use this: summing the
   * display delta for a daily-billed line and calling it monthly understates
   * the impact by ~30x.
   */
  increaseDollarsMonthly: number;
  /** Fraction, e.g. 0.045 for 4.5%. */
  increasePct: number;
  inhouseEffectiveDate: string | null;
  isCompanionBed: boolean;
}

export interface AppliedPlanIndex {
  /** Keyed `${location}||${serviceLine}||${roomNumber}`. */
  byUnit: Map<string, AppliedPlanUnitRate>;
  /** True when the client has no applied plans at all — callers can skip their work. */
  isEmpty: boolean;
  /** Scopes covered, so callers can narrow their own queries instead of scanning. */
  scopes: Array<{ location: string | null; serviceLine: string }>;
}

const EMPTY: AppliedPlanIndex = { byUnit: new Map(), isEmpty: true, scopes: [] };

/**
 * Identity for one resident's room.
 *
 * A room number alone is NOT unique: the same number can appear under several
 * room types at one campus, so keying on it both collapses distinct residents
 * and matches rows in the wrong room-type group. The raw (pre-grouping) room
 * type and the move-in date are included because they are the only other
 * fields present on BOTH a stored plan resident and a rent-roll row — the
 * planner builds its own resident key from room number + move-in date for the
 * same reason.
 *
 * `roomType` must be the raw `rent_roll_data.room_type`, never the branded
 * `room_type_groupings.group_name` the grid displays.
 */
export function unitKey(
  location: string,
  serviceLine: string,
  roomNumber: string,
  roomType: string | null,
  moveInDate: string | null,
): string {
  return `${location}||${serviceLine}||${roomNumber}||${roomType ?? ""}||${moveInDate ?? ""}`;
}

/**
 * Load every applied plan for a client and flatten it to one entry per unit.
 *
 * Plans are replayed oldest-first so that when two plans cover the same room —
 * a portfolio-wide plan and a later campus-specific one, say — the most
 * recently applied plan wins. `status = 'applied'` excludes superseded versions.
 */
export async function loadAppliedPlanRates(clientId: string): Promise<AppliedPlanIndex> {
  if (!clientId) return EMPTY;

  let res;
  try {
    res = await pool.query(
      `SELECT id, location, service_line, version, inhouse_effective_date, residents
         FROM inhouse_rate_plans
        WHERE client_id = $1 AND status = 'applied'
        ORDER BY created_at ASC, version ASC`,
      [clientId],
    );
  } catch (err: any) {
    // The grid must still render if this table is missing or unreadable; the
    // annual-increase columns simply stay empty.
    console.warn(`[applied-plan-rates] skipped: ${err?.message ?? err}`);
    return EMPTY;
  }

  if (res.rows.length === 0) return EMPTY;

  const byUnit = new Map<string, AppliedPlanUnitRate>();
  const scopes: Array<{ location: string | null; serviceLine: string }> = [];
  let skipped = 0;

  for (const plan of res.rows) {
    const serviceLine: string = plan.service_line;
    scopes.push({ location: plan.location ?? null, serviceLine });

    const residents = Array.isArray(plan.residents) ? plan.residents : [];
    for (const r of residents) {
      const location = r?.location;
      const roomNumber = r?.roomNumber;
      if (!location || !roomNumber) continue;

      // `*Display` is the basis the rent roll uses. `newRateMonthly` would be
      // ~30x too high for the daily-billed service lines.
      const newRate = Number(r.newRateDisplay);
      const currentRate = Number(r.currentRateDisplay);
      const increaseDollars = Number(r.increaseDollarsDisplay);
      const increaseDollarsMonthly = Number(r.increaseDollarsMonthly);
      const increasePct = Number(r.increasePct);

      // A resident is only usable if every figure we publish is genuinely
      // present. Coercing a missing rate to 0 would invent a current rate, then
      // derive a delta and a revenue impact from it — fabricated money that
      // looks plausible in the grid. Skip the resident instead.
      if (
        !Number.isFinite(newRate) || newRate <= 0 ||
        !Number.isFinite(currentRate) || currentRate <= 0 ||
        !Number.isFinite(increaseDollars) ||
        !Number.isFinite(increaseDollarsMonthly) ||
        !Number.isFinite(increasePct)
      ) {
        skipped++;
        continue;
      }

      byUnit.set(unitKey(location, serviceLine, String(roomNumber), r?.roomType ?? null, r?.moveInDate ?? null), {
        planId: plan.id,
        version: Number(plan.version),
        newRate,
        currentRate,
        increaseDollars,
        increaseDollarsMonthly,
        increasePct,
        inhouseEffectiveDate: plan.inhouse_effective_date ?? null,
        isCompanionBed: Boolean(r.isCompanionBed),
      });
    }
  }

  if (skipped > 0) {
    console.warn(`[applied-plan-rates] skipped ${skipped} resident(s) with incomplete rate figures`);
  }

  return { byUnit, isEmpty: byUnit.size === 0, scopes };
}

/** Running total for one Reference Data group. */
export interface PlanGroupAccumulator {
  residents: number;
  newRateSum: number;
  currentRateSum: number;
  /** Display basis — comparable to the rate sums above. */
  increaseDollarsSum: number;
  /** Always per month, for the revenue figure. Kept apart from the display sum. */
  increaseDollarsMonthlySum: number;
  effectiveDate: string | null;
}

export function newPlanGroupAccumulator(): PlanGroupAccumulator {
  return {
    residents: 0, newRateSum: 0, currentRateSum: 0,
    increaseDollarsSum: 0, increaseDollarsMonthlySum: 0, effectiveDate: null,
  };
}

export function addToPlanGroup(acc: PlanGroupAccumulator, rate: AppliedPlanUnitRate): void {
  acc.residents += 1;
  acc.newRateSum += rate.newRate;
  acc.currentRateSum += rate.currentRate;
  acc.increaseDollarsSum += rate.increaseDollars;
  acc.increaseDollarsMonthlySum += rate.increaseDollarsMonthly;
  if (acc.effectiveDate === null) acc.effectiveDate = rate.inhouseEffectiveDate;
}

/**
 * Collapse a group's residents into the row fields the grid renders.
 *
 * The averages are over *covered residents only*, never over the group's unit
 * count: a plan only touches occupied rooms, so a 20-unit group with 14
 * residents must report the 14-resident average. `residents` is published
 * alongside so the coverage is visible rather than implied.
 */
export function finalizePlanGroup(acc: PlanGroupAccumulator | undefined) {
  if (!acc || acc.residents === 0) {
    return {
      ihPlanNewRate: null,
      ihPlanCurrentRate: null,
      ihPlanDeltaDollar: null,
      ihPlanDeltaPct: null,
      ihPlanResidents: null,
      ihPlanMonthlyImpact: null,
      ihPlanEffectiveDate: null,
    };
  }
  const n = acc.residents;
  const currentAvg = acc.currentRateSum / n;
  return {
    ihPlanNewRate: acc.newRateSum / n,
    ihPlanCurrentRate: currentAvg,
    ihPlanDeltaDollar: acc.increaseDollarsSum / n,
    ihPlanDeltaPct: currentAvg > 0 ? acc.increaseDollarsSum / acc.currentRateSum : null,
    ihPlanResidents: n,
    // The honest impact for an in-house increase: every covered resident pays
    // the delta every month. This is NOT the move-in-based revenue impact the
    // rule columns use — that models new leases at a new street rate.
    //
    // Must be the MONTHLY sum, not the display sum: for daily-billed HC/HC-MC
    // the display delta is dollars per day, so reporting it here as a monthly
    // figure would understate the impact by roughly 30x.
    ihPlanMonthlyImpact: acc.increaseDollarsMonthlySum,
    ihPlanEffectiveDate: acc.effectiveDate,
  };
}
