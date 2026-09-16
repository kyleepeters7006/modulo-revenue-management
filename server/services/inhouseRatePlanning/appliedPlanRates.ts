/**
 * In-house increase plans, indexed per unit for the Reference Data grid.
 *
 * Calculating a plan never writes; applying it inserts an immutable version into
 * `inhouse_rate_plans`. Applied and proposed versions are loaded separately so
 * Reference Data can show recommendations without treating them as served rates.
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
  streetRate: number | null;
  streetEffectiveDate: string | null;
  isCompanionBed: boolean;
}

export interface AppliedPlanIndex {
  /** Exact identity, including the raw room type. */
  byUnit: Map<string, AppliedPlanUnitRate>;
  /**
   * Safe fallback when a room type was renamed or re-normalized after the plan
   * was saved. Move-in date remains part of the identity so an old resident's
   * increase can never be assigned to a replacement resident.
   */
  byResidentRoom: Map<string, AppliedPlanUnitRate>;
  /** True when the client has no applied plans at all — callers can skip their work. */
  isEmpty: boolean;
  /** Scopes covered, so callers can narrow their own queries instead of scanning. */
  scopes: Array<{ location: string | null; serviceLine: string }>;
  /** One entry per stored plan, including its street-rate recommendation. */
  planScopes?: Array<{
    planId: string;
    status: "applied" | "proposed";
    editable: boolean;
    location: string | null;
    serviceLine: string;
    /** Percentage applied to each room group's current Street Rate. */
    streetIncreasePct: number | null;
    streetRate: number | null;
    streetEffectiveDate: string | null;
  }>;
}

const EMPTY: AppliedPlanIndex = {
  byUnit: new Map(),
  byResidentRoom: new Map(),
  isEmpty: true,
  scopes: [],
  planScopes: [],
};

export type AppliedPlanScope = NonNullable<AppliedPlanIndex["planScopes"]>[number];

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

export function residentRoomKey(
  location: string,
  serviceLine: string,
  roomNumber: string,
  moveInDate: string | null,
): string {
  return `${location}||${serviceLine}||${roomNumber}||${moveInDate ?? ""}`;
}

export function findPlanUnit(
  index: AppliedPlanIndex,
  location: string,
  serviceLine: string,
  roomNumber: string,
  roomType: string | null,
  moveInDate: string | null,
): AppliedPlanUnitRate | null {
  return index.byUnit.get(unitKey(location, serviceLine, roomNumber, roomType, moveInDate))
    ?? index.byResidentRoom.get(residentRoomKey(location, serviceLine, roomNumber, moveInDate))
    ?? null;
}

/**
 * Load plans in one lifecycle status and flatten them to one entry per unit.
 *
 * Plans are replayed oldest-first so that when two plans cover the same room —
 * a portfolio-wide plan and a later campus-specific one, say — the most
 * recently applied plan wins. `status = 'applied'` excludes superseded versions.
 */
async function loadPlanRates(
  clientId: string,
  status: "applied" | "proposed",
): Promise<AppliedPlanIndex> {
  if (!clientId) return EMPTY;

  let res;
  try {
    res = await pool.query(
      `SELECT id, location, service_line, version, inhouse_effective_date,
               street_rate_effective_date, recommended_street_rate, residents,
               (
                 status = 'proposed'
                 AND (
                   SELECT COUNT(DISTINCT action->>'proposalType')
                     FROM adjustment_rules ar
                    WHERE ar.client_id = inhouse_rate_plans.client_id
                      AND ar.action->>'annualPlanId' = inhouse_rate_plans.id::text
                      AND ar.action->>'proposalType' IN ('annual_plan_street_rate', 'inhouse_rate_plan')
                      AND ar.lifecycle_status = 'proposed'
                      AND ar.is_historical IS NOT TRUE
                 ) = 2
                ) AS proposal_editable,
                (
                  SELECT NULLIF(ar.action->>'adjustmentValue', '')::double precision
                    FROM adjustment_rules ar
                   WHERE ar.client_id = inhouse_rate_plans.client_id
                     AND ar.action->>'annualPlanId' = inhouse_rate_plans.id::text
                     AND ar.action->>'proposalType' = 'annual_plan_street_rate'
                     AND ar.is_historical IS NOT TRUE
                   ORDER BY ar.created_at DESC NULLS LAST
                   LIMIT 1
                ) AS street_increase_pct
          FROM inhouse_rate_plans
        WHERE client_id = $1 AND status = $2
        ORDER BY created_at ASC, version ASC`,
      [clientId, status],
    );
  } catch (err: any) {
    // The grid must still render if this table is missing or unreadable; the
    // annual-increase columns simply stay empty.
    console.warn(`[${status}-plan-rates] skipped: ${err?.message ?? err}`);
    return EMPTY;
  }

  if (res.rows.length === 0) return EMPTY;

  const byUnit = new Map<string, AppliedPlanUnitRate>();
  const byResidentRoom = new Map<string, AppliedPlanUnitRate>();
  const scopes: Array<{ location: string | null; serviceLine: string }> = [];
  const planScopes: AppliedPlanScope[] = [];
  let skipped = 0;

  for (const plan of res.rows) {
    const serviceLine: string = plan.service_line;
    scopes.push({ location: plan.location ?? null, serviceLine });
    planScopes.push({
      planId: String(plan.id),
      status,
      editable: Boolean(plan.proposal_editable),
      location: plan.location ?? null,
      serviceLine,
      streetIncreasePct: Number.isFinite(Number(plan.street_increase_pct))
        ? Number(plan.street_increase_pct)
        : null,
      streetRate: Number.isFinite(Number(plan.recommended_street_rate))
        ? Number(plan.recommended_street_rate)
        : null,
      streetEffectiveDate: plan.street_rate_effective_date ?? null,
    });

    const residents = Array.isArray(plan.residents) ? plan.residents : [];
    const planRoomFallbacks = new Map<string, AppliedPlanUnitRate>();
    const ambiguousPlanRooms = new Set<string>();
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

      const rate: AppliedPlanUnitRate = {
        planId: plan.id,
        version: Number(plan.version),
        newRate,
        currentRate,
        increaseDollars,
        increaseDollarsMonthly,
        increasePct,
        inhouseEffectiveDate: plan.inhouse_effective_date ?? null,
        streetRate: Number.isFinite(Number(plan.recommended_street_rate))
          ? Number(plan.recommended_street_rate)
          : null,
        streetEffectiveDate: plan.street_rate_effective_date ?? null,
        isCompanionBed: Boolean(r.isCompanionBed),
      };
      byUnit.set(unitKey(location, serviceLine, String(roomNumber), r?.roomType ?? null, r?.moveInDate ?? null), rate);

      const fallbackKey = residentRoomKey(
        location,
        serviceLine,
        String(roomNumber),
        r?.moveInDate ?? null,
      );
      if (planRoomFallbacks.has(fallbackKey)) {
        planRoomFallbacks.delete(fallbackKey);
        ambiguousPlanRooms.add(fallbackKey);
      } else if (!ambiguousPlanRooms.has(fallbackKey)) {
        planRoomFallbacks.set(fallbackKey, rate);
      }
    }
    for (const [key, rate] of planRoomFallbacks) byResidentRoom.set(key, rate);
  }

  if (skipped > 0) {
    console.warn(`[${status}-plan-rates] skipped ${skipped} resident(s) with incomplete rate figures`);
  }

  return { byUnit, byResidentRoom, isEmpty: byUnit.size === 0, scopes, planScopes };
}

export async function loadAppliedPlanRates(clientId: string): Promise<AppliedPlanIndex> {
  return loadPlanRates(clientId, "applied");
}

/** Submitted recommendations that are not yet live. */
export async function loadRecommendedPlanRates(clientId: string): Promise<AppliedPlanIndex> {
  return loadPlanRates(clientId, "proposed");
}

/**
 * Find the latest plan whose scope covers a Reference Data campus. A null
 * location is portfolio-wide; division plans use the persisted
 * `__division__:<name>` marker. The loader orders plans oldest-first, so the
 * last matching entry is the current one.
 */
export function findPlanScope(
  index: AppliedPlanIndex,
  campus: string,
  division: string | null | undefined,
  serviceLine: string,
): AppliedPlanScope | null {
  const scopes = index.planScopes ?? [];
  let match: AppliedPlanScope | null = null;
  for (const scope of scopes) {
    if (scope.serviceLine !== serviceLine) continue;
    const applies = scope.location === null
      || scope.location === campus
      || (scope.location?.startsWith("__division__:") &&
        scope.location.slice("__division__:".length) === (division ?? ""));
    if (applies) match = scope;
  }
  return match;
}

/**
 * Annual plans store one absolute portfolio/campus target, but the linked
 * street rule is a percentage adjustment. Reference Data groups can have
 * different current Street Rates, so the visible target must be projected
 * from each group's own spot rate. Keep the absolute target as a compatibility
 * fallback for old plans whose linked rule is unavailable.
 */
export function projectPlanStreetRate(
  scope: AppliedPlanScope | null | undefined,
  currentStreetRate: number | null,
): number | null {
  if (!scope) return null;
  if (
    scope.streetIncreasePct !== null
    && currentStreetRate !== null
    && Number.isFinite(currentStreetRate)
    && currentStreetRate > 0
  ) {
    return currentStreetRate * (1 + scope.streetIncreasePct / 100);
  }
  return scope.streetRate;
}

/** Running total for one Reference Data group. */
export interface PlanGroupAccumulator {
  planId: string | null;
  residents: number;
  newRateSum: number;
  currentRateSum: number;
  /** Display basis — comparable to the rate sums above. */
  increaseDollarsSum: number;
  /** Always per month, for the revenue figure. Kept apart from the display sum. */
  increaseDollarsMonthlySum: number;
  effectiveDate: string | null;
  streetRateSum: number;
  streetRateCount: number;
  streetEffectiveDate: string | null;
}

export function newPlanGroupAccumulator(): PlanGroupAccumulator {
  return {
    planId: null,
    residents: 0, newRateSum: 0, currentRateSum: 0,
    increaseDollarsSum: 0, increaseDollarsMonthlySum: 0, effectiveDate: null,
    streetRateSum: 0, streetRateCount: 0, streetEffectiveDate: null,
  };
}

export function addToPlanGroup(acc: PlanGroupAccumulator, rate: AppliedPlanUnitRate): void {
  if (acc.planId === null) acc.planId = rate.planId;
  acc.residents += 1;
  acc.newRateSum += rate.newRate;
  acc.currentRateSum += rate.currentRate;
  acc.increaseDollarsSum += rate.increaseDollars;
  acc.increaseDollarsMonthlySum += rate.increaseDollarsMonthly;
  if (acc.effectiveDate === null) acc.effectiveDate = rate.inhouseEffectiveDate;
  if (rate.streetRate !== null) {
    acc.streetRateSum += rate.streetRate;
    acc.streetRateCount += 1;
  }
  if (acc.streetEffectiveDate === null) acc.streetEffectiveDate = rate.streetEffectiveDate;
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
      ihPlanId: null,
      ihPlanNewRate: null,
      ihPlanCurrentRate: null,
      ihPlanDeltaDollar: null,
      ihPlanDeltaPct: null,
      ihPlanResidents: null,
      ihPlanMonthlyImpact: null,
      ihPlanEffectiveDate: null,
      ihPlanStreetRate: null,
      ihPlanStreetEffectiveDate: null,
    };
  }
  const n = acc.residents;
  const currentAvg = acc.currentRateSum / n;
  return {
    ihPlanId: acc.planId,
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
    ihPlanStreetRate: acc.streetRateCount ? acc.streetRateSum / acc.streetRateCount : null,
    ihPlanStreetEffectiveDate: acc.streetEffectiveDate,
  };
}
