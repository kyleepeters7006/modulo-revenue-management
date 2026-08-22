/**
 * Materialises annual in-house increase plans onto the rent roll.
 *
 * Adjustment rules put their output on `rent_roll_data.rule_adjusted_rate` via
 * the repricing job, and Reference Data simply reads that column. The increase
 * plan works the same way here, and for the same reason: a plan is produced by
 * a bisection solve over the whole resident population (seconds, not
 * milliseconds), so it cannot be computed inside a Reference Data request.
 *
 * Two sources feed the overlay:
 *   - **applied** — an approved plan in `inhouse_rate_plans`, replayed from the
 *     resident array that was frozen at apply time. This is the number an
 *     operator signed off on and it never silently changes.
 *   - **preview** — the plan the current saved assumptions would produce, for
 *     scopes with no applied plan yet. This is what makes an unapplied plan
 *     visible in the table, mirroring how a rule shows a preview rate before
 *     the engine has run.
 *
 * Only rooms a plan actually covers get a value: occupied, private-pay
 * residents. Other payers are on fixed rates that a street-driven increase does
 * not move, so they keep the rule rate.
 */

import type { PoolClient } from "pg";
import { pool, db } from "../../db";
import { inhousePlanningAssumptions, inhouseRatePlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import { calculatePlan, PlanningDataError } from "./index";
import type { PlanningAssumptions, ResidentRecommendation } from "@shared/inhousePlanning";

export type OverlaySource = "applied" | "preview";

export interface OverlayRoom {
  location: string;
  serviceLine: string;
  roomNumber: string;
  /** New in-house rate in the SAME basis as `in_house_rate` (daily for HC). */
  plannedRate: number;
  effectiveDate: string | null;
  source: OverlaySource;
  label: string;
  sourceMonth: string;
}

export interface OverlayResult {
  rooms: Map<string, OverlayRoom>;
  scopes: Array<{ label: string; source: OverlaySource; rooms: number; error?: string }>;
}

/** `location||serviceLine||roomNumber` — proven 1:1 against the rent roll. */
export function overlayKey(location: string, serviceLine: string, roomNumber: string): string {
  return `${location}||${serviceLine}||${roomNumber}`;
}

function rowToAssumptions(row: typeof inhousePlanningAssumptions.$inferSelect): PlanningAssumptions {
  return {
    rateGrowthTargetPct: Number(row.rateGrowthTargetPct),
    measurementMode: "quarterly_yoy",
    streetRateEffectiveDate: row.streetRateEffectiveDate || "",
    inhouseEffectiveDate: row.inhouseEffectiveDate || "",
    annualTurnoverPct: Number(row.annualTurnoverPct),
    minInhouseIncreasePct: Number(row.minInhouseIncreasePct),
    maxInhouseIncreasePct: Number(row.maxInhouseIncreasePct),
    equalizationStrength: row.equalizationStrength as PlanningAssumptions["equalizationStrength"],
    allowInhouseAboveStreet: Boolean(row.allowInhouseAboveStreet),
    maxStreetIncreasePct: Number(row.maxStreetIncreasePct),
  };
}

/**
 * A campus-scoped plan beats a portfolio-wide one for the rooms they share:
 * someone who planned a single campus deliberately meant that campus. Within
 * the same specificity an applied plan beats a preview, because approval
 * outranks intent.
 */
function precedence(scoped: boolean, source: OverlaySource): number {
  return (scoped ? 2 : 0) + (source === "applied" ? 1 : 0);
}

function claim(
  rooms: Map<string, OverlayRoom>,
  rank: Map<string, number>,
  room: OverlayRoom,
  scoped: boolean,
) {
  const key = overlayKey(room.location, room.serviceLine, room.roomNumber);
  const p = precedence(scoped, room.source);
  const existing = rank.get(key);
  if (existing !== undefined && existing >= p) return;
  rooms.set(key, room);
  rank.set(key, p);
}

function scopeLabel(location: string | null, serviceLine: string, suffix?: string): string {
  return `${location ?? "All campuses"} · ${serviceLine}${suffix ? ` ${suffix}` : ""}`;
}

/**
 * Build the overlay for a client. Applied plans are replayed from stored
 * residents (cheap); previews require a full solve per scope (seconds each), so
 * only scopes with saved assumptions and no applied plan are solved.
 */
export async function computePlanOverlay(clientId: string): Promise<OverlayResult> {
  const rooms = new Map<string, OverlayRoom>();
  const rank = new Map<string, number>();
  const scopes: OverlayResult["scopes"] = [];

  // ── applied plans ──
  const applied = await db
    .select()
    .from(inhouseRatePlans)
    .where(eq(inhouseRatePlans.clientId, clientId));

  // Latest version per scope; anything older is superseded by definition.
  const latestApplied = new Map<string, (typeof applied)[number]>();
  for (const plan of applied) {
    if (plan.status !== "applied") continue;
    const key = `${plan.locationId ?? ""}||${plan.serviceLine}`;
    const prev = latestApplied.get(key);
    if (!prev || (plan.version ?? 0) > (prev.version ?? 0)) latestApplied.set(key, plan);
  }

  const appliedScopes = new Set<string>();
  for (const plan of Array.from(latestApplied.values())) {
    appliedScopes.add(`${plan.locationId ?? ""}||${plan.serviceLine}`);
    const residents = (plan.residents ?? []) as ResidentRecommendation[];
    const label = scopeLabel(plan.location, plan.serviceLine, `v${plan.version}`);
    let n = 0;
    for (const r of residents) {
      if (!r?.location || !r?.roomNumber || !Number.isFinite(r.newRateDisplay)) continue;
      claim(
        rooms,
        rank,
        {
          location: r.location,
          serviceLine: plan.serviceLine,
          roomNumber: r.roomNumber,
          plannedRate: r.newRateDisplay,
          effectiveDate: plan.inhouseEffectiveDate ?? null,
          source: "applied",
          label,
          // An applied plan is a frozen artefact; it carries no live month.
          sourceMonth: "",
        },
        plan.locationId != null,
      );
      n += 1;
    }
    scopes.push({ label, source: "applied", rooms: n });
  }

  // ── previews for scopes with saved assumptions and no applied plan ──
  const assumptionRows = await db
    .select()
    .from(inhousePlanningAssumptions)
    .where(eq(inhousePlanningAssumptions.clientId, clientId));

  for (const row of assumptionRows) {
    if (!row.serviceLine) continue;
    const scopeKey = `${row.locationId ?? ""}||${row.serviceLine}`;
    if (appliedScopes.has(scopeKey)) continue; // approval outranks intent

    const label = scopeLabel(null, row.serviceLine, "(preview)");
    try {
      const plan = await calculatePlan({
        clientId,
        locationId: row.locationId ?? null,
        location: null,
        serviceLine: row.serviceLine,
        assumptions: rowToAssumptions(row),
      });
      let n = 0;
      for (const r of plan.residents) {
        if (!r?.location || !r?.roomNumber || !Number.isFinite(r.newRateDisplay)) continue;
        claim(
          rooms,
          rank,
          {
            location: r.location,
            serviceLine: plan.scope.serviceLine,
            roomNumber: r.roomNumber,
            plannedRate: r.newRateDisplay,
            effectiveDate: plan.assumptions.inhouseEffectiveDate || null,
            source: "preview",
            label: scopeLabel(plan.scope.location, plan.scope.serviceLine, "(preview)"),
            sourceMonth: plan.scope.sourceMonth,
          },
          row.locationId != null,
        );
        n += 1;
      }
      scopes.push({
        label: scopeLabel(plan.scope.location, plan.scope.serviceLine, "(preview)"),
        source: "preview",
        rooms: n,
      });
    } catch (error: unknown) {
      // A scope with no occupied rows, or too little history to project, is a
      // normal state rather than a failure — record it and carry on so one bad
      // scope cannot deprive every other scope of its columns.
      const message =
        error instanceof PlanningDataError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      scopes.push({ label, source: "preview", rooms: 0, error: message });
    }
  }

  return { rooms, scopes };
}

/**
 * Write the overlay onto the rent roll, replacing whatever was there.
 *
 * Cleared first so a room that has dropped out of the plan (moved out, changed
 * payer, or a narrowed scope) loses its stale rate instead of keeping a number
 * no plan stands behind any more.
 */
export async function persistPlanOverlay(
  clientId: string,
): Promise<{ covered: number; cleared: number; scopes: OverlayResult["scopes"] }> {
  const { rooms, scopes } = await computePlanOverlay(clientId);

  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");

    const cleared = await client.query(
      `UPDATE rent_roll_data
          SET inhouse_planned_rate = NULL,
              inhouse_plan_effective_date = NULL,
              inhouse_plan_source = NULL,
              inhouse_plan_label = NULL,
              inhouse_plan_calculated_at = NULL
        WHERE client_id = $1
          AND inhouse_planned_rate IS NOT NULL`,
      [clientId],
    );

    let covered = 0;
    const all = Array.from(rooms.values());
    const CHUNK = 2000;
    for (let i = 0; i < all.length; i += CHUNK) {
      const batch = all.slice(i, i + CHUNK);
      const res = await client.query(
        `UPDATE rent_roll_data rr
            SET inhouse_planned_rate = v.rate,
                inhouse_plan_effective_date = v.eff,
                inhouse_plan_source = v.src,
                inhouse_plan_label = v.label,
                inhouse_plan_calculated_at = NOW()
           FROM (
             SELECT * FROM unnest(
               $2::text[], $3::text[], $4::text[], $5::real[], $6::text[], $7::text[], $8::text[]
             ) AS t(location, service_line, room_number, rate, eff, src, label)
           ) AS v
          WHERE rr.client_id = $1
            AND rr.location = v.location
            AND rr.service_line = v.service_line
            AND rr.room_number = v.room_number
            AND rr.upload_month = (
              SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1
            )`,
        [
          clientId,
          batch.map((r) => r.location),
          batch.map((r) => r.serviceLine),
          batch.map((r) => r.roomNumber),
          batch.map((r) => r.plannedRate),
          batch.map((r) => r.effectiveDate),
          batch.map((r) => r.source),
          batch.map((r) => r.label),
        ],
      );
      covered += res.rowCount ?? 0;
    }

    await client.query("COMMIT");
    return { covered, cleared: cleared.rowCount ?? 0, scopes };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── debounced refresh ───────────────────────────────────────────────────────
//
// Saving assumptions should make the preview columns move without the operator
// doing anything, but a solve is expensive and assumptions are typically saved
// in bursts as someone tunes them. Collapse a burst into one run, the same way
// rule mutations collapse into one repricing job.

const REFRESH_DELAY_MS = 10_000;
const pending = new Map<string, NodeJS.Timeout>();
const running = new Set<string>();
const queued = new Set<string>();

async function runRefresh(clientId: string) {
  if (running.has(clientId)) {
    // Another run is mid-flight; remember that its inputs are already stale.
    queued.add(clientId);
    return;
  }
  running.add(clientId);
  try {
    const result = await persistPlanOverlay(clientId);
    console.log(
      `[plan-overlay] ${clientId}: ${result.covered} rooms covered, ${result.cleared} cleared`,
      result.scopes.map((s) => `${s.label}=${s.error ? `ERROR ${s.error}` : s.rooms}`).join("; "),
    );
  } catch (error) {
    console.error(`[plan-overlay] ${clientId}: refresh failed`, error);
  } finally {
    running.delete(clientId);
    if (queued.delete(clientId)) void runRefresh(clientId);
  }
}

/** Collapse a burst of changes into a single overlay rebuild. */
export function schedulePlanOverlayRefresh(clientId: string, delayMs = REFRESH_DELAY_MS) {
  const existing = pending.get(clientId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pending.delete(clientId);
    void runRefresh(clientId);
  }, delayMs);
  // Do not hold the process open purely to recompute an overlay.
  timer.unref?.();
  pending.set(clientId, timer);
}

/** Rebuild now and wait for it — used by the manual refresh endpoint and tests. */
export async function refreshPlanOverlayNow(clientId: string) {
  const existing = pending.get(clientId);
  if (existing) {
    clearTimeout(existing);
    pending.delete(clientId);
  }
  return persistPlanOverlay(clientId);
}
