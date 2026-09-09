/**
 * In-House Rate Planning routes — /api/inhouse-planning/*
 *
 * Calculating a plan is read-only by construction: the calculate endpoint
 * never writes a rate. Submitting a plan records an immutable proposed version
 * and its linked pricing proposals; publishing is the only operation that
 * applies it to Reference Data.
 */
import type { Express } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { inhousePlanningAssumptions, inhouseRatePlans, locations } from "@shared/schema";
import { DEFAULT_ASSUMPTIONS, type PlanningAssumptions } from "@shared/inhousePlanning";
import {
  calculatePlan,
  calculatePlanDetailed,
  PlanningDataError,
} from "../services/inhouseRatePlanning";
import { buildRatePlanWorkbook } from "../services/inhouseRatePlanning/excelExport";
import { computeHistoricalTurnover } from "../services/inhouseRatePlanning/historicalTurnover";
import { loadCompBenchmark } from "../services/compBenchmark";
import { baseRateExclusionSql } from "@shared/baseRate";
import {
  buildStreetRateRecommendation,
  premiumCeiling,
  rebalanceStreetRateRecommendations,
  type StreetRateRecommendation,
} from "@shared/streetRateRecommendations";
import { addAiRationales } from "../services/inhouseRatePlanning/aiRecommendations";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A regex only proves the shape. "2027-02-31" passes it and then JavaScript
 * quietly rolls it forward to March 3rd, which would silently move an
 * effective date the operator never chose.
 */
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}

const isoDateField = z
  .string()
  .refine((v) => v === "" || isRealIsoDate(v), { message: "Enter a real calendar date" });

const assumptionsSchema = z.object({
  rateGrowthTargetPct: z.number().min(-20).max(50),
  measurementMode: z.literal("quarterly_yoy").default("quarterly_yoy"),
  streetRateEffectiveDate: isoDateField,
  inhouseEffectiveDate: isoDateField,
  annualTurnoverPct: z.number().min(0).max(100),
  minInhouseIncreasePct: z.number().min(0).max(100),
  maxInhouseIncreasePct: z.number().min(0).max(100),
  equalizationStrength: z.enum(["low", "medium", "high"]),
  allowInhouseAboveStreet: z.boolean().optional().default(true),
  maxStreetIncreasePct: z.number().min(0).max(100),
  maxYoYStreetIncreasePct: z.number().min(0).max(100),
}).refine((d) => d.minInhouseIncreasePct <= d.maxInhouseIncreasePct, {
  message: "Minimum increase cannot exceed maximum increase",
});

const scopeSchema = z.object({
  locationId: z.string().nullable().optional(),
  serviceLine: z.string().min(1),
});

const recommendationSchema = scopeSchema.extend({
  assumptions: assumptionsSchema.optional(),
  maximumPremiumAboveTopCompetitorPct: z.number().min(0).max(100),
  edits: z.array(z.object({
    id: z.string().min(1),
    suggestedRate: z.number().min(0),
    locked: z.boolean(),
  })).optional().default([]),
});

// Recommendations are intentionally short-lived session snapshots. They are
// advisory display state, not a second pricing source of truth; accepted
// proposals remain in the existing inhouse_rate_plans / adjustment-rules
// lifecycle.
const recommendationSnapshots = new Map<string, {
  clientId: string;
  userId: string;
  locationId: string | null;
  serviceLine: string;
  createdAt: string;
  maximumPremiumAboveTopCompetitorPct: number;
  assumptionsFingerprint: string;
  recommendations: StreetRateRecommendation[];
}>();
const RECOMMENDATION_TTL_MS = 30 * 60 * 1000;

function snapshotIsFresh(snapshot: { createdAt: string }): boolean {
  return Date.now() - Date.parse(snapshot.createdAt) <= RECOMMENDATION_TTL_MS;
}

function recommendationFingerprint(
  assumptions: PlanningAssumptions,
  maximumPremiumAboveTopCompetitorPct: number,
): string {
  return JSON.stringify({ assumptions, maximumPremiumAboveTopCompetitorPct });
}

function recommendationUserId(req: any): string {
  return String(req.session?.userId ?? req.user?.id ?? req.user?.username ?? "anonymous");
}

function recommendationSnapshotKey(
  clientId: string,
  userId: string,
  locationId: string | null,
  serviceLine: string,
): string {
  return `${clientId}::${userId}::${locationId ?? "all"}::${serviceLine}`;
}

/** Rows come back snake_case from the driver; drizzle rows do not. */
export function rowToAssumptions(row: any): PlanningAssumptions {
  return {
    rateGrowthTargetPct: Number(row.rateGrowthTargetPct),
    measurementMode: "quarterly_yoy",
    streetRateEffectiveDate: row.streetRateEffectiveDate || "",
    inhouseEffectiveDate: row.inhouseEffectiveDate || "",
    annualTurnoverPct: Number(row.annualTurnoverPct),
    minInhouseIncreasePct: Number(row.minInhouseIncreasePct),
    maxInhouseIncreasePct: Number(row.maxInhouseIncreasePct),
    equalizationStrength: row.equalizationStrength,
    allowInhouseAboveStreet: true,
    maxStreetIncreasePct: Number(row.maxStreetIncreasePct),
    maxYoYStreetIncreasePct: Number(
      row.maxYoYStreetIncreasePct ?? DEFAULT_ASSUMPTIONS.maxYoYStreetIncreasePct,
    ),
  };
}

function enforceCurrentPlanningPolicy(assumptions: PlanningAssumptions): PlanningAssumptions {
  return { ...assumptions, allowInhouseAboveStreet: true };
}

/**
 * Three-tier resolution, most specific first: campus + service line, then
 * campus, then the client-wide default. Same convention as guardrails and
 * adjustment ranges, so an operator who understands one understands all three.
 */
async function resolveAssumptions(
  clientId: string,
  locationId: string | null,
  serviceLine: string | null,
): Promise<{ assumptions: PlanningAssumptions; scopeLevel: string }> {
  const tiers: Array<{ level: string; where: any }> = [];
  if (locationId && serviceLine) {
    tiers.push({
      level: "location+serviceLine",
      where: and(
        eq(inhousePlanningAssumptions.clientId, clientId),
        eq(inhousePlanningAssumptions.locationId, locationId),
        eq(inhousePlanningAssumptions.serviceLine, serviceLine),
      ),
    });
  }
  if (locationId) {
    tiers.push({
      level: "location",
      where: and(
        eq(inhousePlanningAssumptions.clientId, clientId),
        eq(inhousePlanningAssumptions.locationId, locationId),
        sql`${inhousePlanningAssumptions.serviceLine} IS NULL`,
      ),
    });
  }
  // Portfolio-wide but service-line specific. This is what the UI writes when
  // the campus selector says "All campuses", so it has to be searched — without
  // it, saving from the default view appears to succeed and then never applies.
  if (serviceLine) {
    tiers.push({
      level: "serviceLine",
      where: and(
        eq(inhousePlanningAssumptions.clientId, clientId),
        sql`${inhousePlanningAssumptions.locationId} IS NULL`,
        eq(inhousePlanningAssumptions.serviceLine, serviceLine),
      ),
    });
  }
  tiers.push({
    level: "global",
    where: and(
      eq(inhousePlanningAssumptions.clientId, clientId),
      sql`${inhousePlanningAssumptions.locationId} IS NULL`,
      sql`${inhousePlanningAssumptions.serviceLine} IS NULL`,
    ),
  });

  for (const tier of tiers) {
    const [row] = await db
      .select()
      .from(inhousePlanningAssumptions)
      .where(tier.where)
      .limit(1);
    if (row) return { assumptions: rowToAssumptions(row), scopeLevel: tier.level };
  }
  return { assumptions: { ...DEFAULT_ASSUMPTIONS }, scopeLevel: "default" };
}

/** Campus name for a location id, scoped to the caller's client. */
async function resolveLocationName(
  clientId: string,
  locationId: string | null,
): Promise<string | null> {
  if (!locationId) return null;
  const [row] = await db
    .select({ name: locations.name })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.clientId, clientId)))
    .limit(1);
  if (!row) throw new PlanningDataError("Campus not found for this client.");
  return row.name;
}

function requireAuth(req: any, res: any, next: any) {
  if (req.session?.userId && req.session?.clientId) return next();
  return res
    .status(401)
    .json({ error: "Login required. Applying a rate plan is disabled in anonymous demo mode." });
}

export function registerInhousePlanningRoutes(app: Express) {
  // ── Assumptions ──────────────────────────────────────────────────────────

  app.get("/api/inhouse-planning/assumptions", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const locationId = (req.query.locationId as string) || null;
      const serviceLine = (req.query.serviceLine as string) || null;
      const resolved = await resolveAssumptions(clientId, locationId, serviceLine);
      res.setHeader("Cache-Control", "no-store");
      res.json(resolved);
    } catch (error) {
      console.error("[inhouse-planning] assumptions fetch failed:", error);
      res.status(500).json({ error: "Failed to load planning assumptions" });
    }
  });

  app.post("/api/inhouse-planning/assumptions", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = z
        .object({
          locationId: z.string().nullable().optional(),
          serviceLine: z.string().nullable().optional(),
          assumptions: assumptionsSchema,
        })
        .safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ error: body.error.errors[0]?.message || "Invalid planning assumptions" });
      }
      const { locationId = null, serviceLine = null } = body.data;
      const assumptions = enforceCurrentPlanningPolicy(body.data.assumptions);

      const values = {
        clientId,
        locationId: locationId || null,
        serviceLine: serviceLine || null,
        rateGrowthTargetPct: assumptions.rateGrowthTargetPct,
        measurementMode: assumptions.measurementMode,
        streetRateEffectiveDate: assumptions.streetRateEffectiveDate || null,
        inhouseEffectiveDate: assumptions.inhouseEffectiveDate || null,
        annualTurnoverPct: assumptions.annualTurnoverPct,
        minInhouseIncreasePct: assumptions.minInhouseIncreasePct,
        maxInhouseIncreasePct: assumptions.maxInhouseIncreasePct,
        equalizationStrength: assumptions.equalizationStrength,
        allowInhouseAboveStreet: true,
        maxStreetIncreasePct: assumptions.maxStreetIncreasePct,
        maxYoYStreetIncreasePct: assumptions.maxYoYStreetIncreasePct,
        updatedBy: req.session?.userId || null,
        updatedAt: new Date(),
      };

      // Upsert on the scope key. NULLS NOT DISTINCT on the index means the
      // campus-wide and client-wide rows collide with themselves instead of
      // silently accumulating duplicates.
      await db
        .insert(inhousePlanningAssumptions)
        .values(values)
        .onConflictDoUpdate({
          target: [
            inhousePlanningAssumptions.clientId,
            inhousePlanningAssumptions.locationId,
            inhousePlanningAssumptions.serviceLine,
          ],
          set: values,
        });

      const resolved = await resolveAssumptions(clientId, locationId || null, serviceLine || null);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, ...resolved });
    } catch (error) {
      console.error("[inhouse-planning] assumptions save failed:", error);
      res.status(500).json({ error: "Failed to save planning assumptions" });
    }
  });

  // ── Historical turnover (read-only, drives the turnover assumption) ──────

  app.get("/api/inhouse-planning/historical-turnover", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const locationId = (req.query.locationId as string) || null;
      const locationName = await resolveLocationName(clientId, locationId);
      const result = await computeHistoricalTurnover(clientId, locationId, locationName);
      res.setHeader("Cache-Control", "no-store");
      res.json(result ?? { windowStart: null, windowEnd: null, monthsInWindow: 0, byServiceLine: [] });
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("[inhouse-planning] historical turnover failed:", error);
      res.status(500).json({ error: "Failed to load historical turnover" });
    }
  });

  // ── Calculate (never writes a rate) ──────────────────────────────────────

  app.post("/api/inhouse-planning/calculate", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = scopeSchema
        .extend({ assumptions: assumptionsSchema.optional() })
        .safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ error: body.error.errors[0]?.message || "Invalid planning request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const assumptions = enforceCurrentPlanningPolicy(
        body.data.assumptions ??
        (await resolveAssumptions(clientId, locationId, body.data.serviceLine)).assumptions,
      );
      const plan = await calculatePlan({
        clientId,
        locationId,
        location,
        serviceLine: body.data.serviceLine,
        assumptions,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(plan);
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] calculate failed:", error);
      res.status(500).json({ error: "Failed to calculate the in-house rate plan" });
    }
  });

  /**
   * Build a one-time, advisory Street Rate recommendation set. The route
   * deliberately does not call the rule writer or change Reference Data.
   * Client edits are treated as proposals and are re-clamped against the
   * server's current benchmark and guardrails before rebalancing.
   */
  app.post("/api/inhouse-planning/recommendations", requireAuth, async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = recommendationSchema.safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({
          error: body.error.errors[0]?.message || "Invalid recommendation request",
        });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const assumptions = enforceCurrentPlanningPolicy(
        body.data.assumptions ??
        (await resolveAssumptions(clientId, locationId, body.data.serviceLine)).assumptions,
      );
      if (assumptions.rateGrowthTargetPct < 0) {
        return res.status(422).json({
          error: "Street Rate recommendations support zero or positive growth targets only.",
        });
      }

      const latest = await pool.query<{ upload_month: string }>(
        `SELECT MAX(upload_month) AS upload_month
           FROM rent_roll_data
          WHERE client_id = $1
            AND service_line = $2
            AND ($3::text IS NULL OR location_id::text = $3 OR location = $4)`,
        [clientId, body.data.serviceLine, locationId, location],
      );
      const month = latest.rows[0]?.upload_month;
      if (!month) {
        return res.status(422).json({ error: "No current rent-roll month is available for this scope." });
      }
      const proposalYear = assumptions.streetRateEffectiveDate
        ? Number(assumptions.streetRateEffectiveDate.slice(0, 4))
        : Number(month.slice(0, 4)) + 1;

      const params: any[] = [clientId, body.data.serviceLine, month];
      let locationSql = "";
      if (locationId || location) {
        params.push(locationId, location);
        locationSql = ` AND (rr.location_id::text = $${params.length - 1} OR rr.location = $${params.length})`;
      }
      const rows = await pool.query(
        `SELECT
           rr.location,
           rr.location_id,
           COALESCE(loc.name, rr.location) AS location_name,
           rr.service_line,
           COALESCE(rtg.group_name, NULLIF(rr.room_type, ''), 'Other') AS product,
           AVG(rr.street_rate) FILTER (WHERE rr.street_rate > 0) AS current_street_rate,
           COUNT(DISTINCT COALESCE(NULLIF(rr.room_number, ''), rr.id::text))
             FILTER (WHERE rr.street_rate > 0)::int AS units,
           AVG(CASE WHEN rr.occupied_yn THEN 100.0 ELSE 0.0 END) AS occupancy_pct
           FROM rent_roll_data rr
           LEFT JOIN locations loc ON loc.id = rr.location_id AND loc.client_id = $1
          LEFT JOIN room_type_groupings rtg
            ON rtg.client_id = rr.client_id AND rtg.location = rr.location
           AND rtg.service_line = rr.service_line AND rtg.source_room_type = rr.source_room_type
          WHERE rr.client_id = $1
            AND rr.service_line = $2
            AND rr.upload_month = $3
            AND rr.street_rate > 0
            AND ${baseRateExclusionSql("rr.")}
            ${locationSql}
          GROUP BY rr.location, rr.location_id, loc.name, rr.service_line, COALESCE(rtg.group_name, NULLIF(rr.room_type, ''), 'Other')
          ORDER BY rr.location, product`,
        params,
      );

      const priorMonth = `${proposalYear - 1}-01`;
      const priorParams: any[] = [clientId, body.data.serviceLine, priorMonth];
      let priorLocationSql = "";
      if (locationId || location) {
        priorParams.push(locationId, location);
        priorLocationSql = ` AND (rr.location_id::text = $${priorParams.length - 1} OR rr.location = $${priorParams.length})`;
      }
      const priorRows = await pool.query(
        `SELECT rr.location, rr.location_id,
                COALESCE(rtg.group_name, NULLIF(rr.room_type, ''), 'Other') AS product,
                AVG(rr.street_rate) AS prior_january_street_rate
           FROM rent_roll_data rr
          LEFT JOIN room_type_groupings rtg
            ON rtg.client_id = rr.client_id AND rtg.location = rr.location
           AND rtg.service_line = rr.service_line AND rtg.source_room_type = rr.source_room_type
          WHERE rr.client_id = $1
            AND rr.service_line = $2
            AND rr.upload_month = $3
            AND rr.street_rate > 0
            AND ${baseRateExclusionSql("rr.")}
            ${priorLocationSql}
          GROUP BY rr.location, rr.location_id, COALESCE(rtg.group_name, NULLIF(rr.room_type, ''), 'Other')`,
        priorParams,
      );
      const priorByKey = new Map(
        priorRows.rows.map((prior: any) => [
          `${prior.location_id ?? "all"}||${prior.location}||${prior.product}`,
          Number(prior.prior_january_street_rate) || null,
        ]),
      );
      const benchmark = await loadCompBenchmark(pool, clientId);
      const edits = new Map(body.data.edits.map((edit) => [edit.id, edit]));
      const recommendations: StreetRateRecommendation[] = rows.rows.map((row: any) => {
        const id = `${row.location_id ?? "all"}||${row.location}||${row.service_line}||${row.product}`;
        const edit = edits.get(id);
        const locationName = row.location_name || row.location;
        const top = benchmark.benchmarkForRT(locationName, row.service_line, row.product)
          ?? benchmark.benchmarkFor(locationName, row.service_line);
        return buildStreetRateRecommendation({
          id,
          location: row.location,
          benchmarkLocation: locationName,
          locationId: row.location_id,
          serviceLine: row.service_line,
          product: row.product,
          currentStreetRate: Number(row.current_street_rate) || 0,
          topCompetitorRate: top?.adjusted ?? null,
          occupancyPct: row.occupancy_pct == null ? null : Number(row.occupancy_pct),
          units: Number(row.units) || 0,
          maxStreetIncreasePct: assumptions.maxStreetIncreasePct,
          maxYoYStreetIncreasePct: assumptions.maxYoYStreetIncreasePct,
          priorJanuaryStreetRate: priorByKey.get(`${row.location_id ?? "all"}||${row.location}||${row.product}`) ?? null,
          editedRate: edit?.suggestedRate,
          locked: edit?.locked,
        }, body.data.maximumPremiumAboveTopCompetitorPct);
      });
      const result = rebalanceStreetRateRecommendations(
        recommendations,
        assumptions.rateGrowthTargetPct,
      );
      const enrichedRecommendations = await addAiRationales(result.recommendations);
      result.recommendations = enrichedRecommendations;
      const userId = recommendationUserId(req);
      recommendationSnapshots.set(
        recommendationSnapshotKey(clientId, userId, locationId, body.data.serviceLine),
        {
          clientId,
          userId,
          locationId,
          serviceLine: body.data.serviceLine,
          createdAt: new Date().toISOString(),
          maximumPremiumAboveTopCompetitorPct: body.data.maximumPremiumAboveTopCompetitorPct,
          assumptionsFingerprint: recommendationFingerprint(
            assumptions,
            body.data.maximumPremiumAboveTopCompetitorPct,
          ),
          recommendations: result.recommendations,
        },
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({
        scope: { clientId, locationId, location, serviceLine: body.data.serviceLine, sourceMonth: month },
        maximumPremiumAboveTopCompetitorPct: body.data.maximumPremiumAboveTopCompetitorPct,
        recommendations: result.recommendations,
        rebalance: result,
      });
    } catch (error) {
      console.error("[inhouse-planning] recommendations failed:", error);
      res.status(500).json({ error: "Failed to calculate Street Rate recommendations" });
    }
  });

  app.get("/api/inhouse-planning/recommendations/latest", requireAuth, async (req: any, res) => {
    const clientId = req.clientId || "demo";
    const userId = recommendationUserId(req);
    const locationId = (req.query.locationId as string) || null;
    const serviceLine = (req.query.serviceLine as string) || null;
    const requestedLocations = String(req.query.locations ?? "")
      .split(",").map((value) => value.trim()).filter(Boolean);
    const snapshots = Array.from(recommendationSnapshots.values()).filter((snapshot) =>
      snapshot.clientId === clientId &&
      snapshot.userId === userId &&
      snapshotIsFresh(snapshot) &&
      (!locationId || snapshot.locationId === locationId) &&
      (!requestedLocations.length ||
        snapshot.locationId === null ||
        requestedLocations.includes(snapshot.locationId) ||
        snapshot.recommendations.some((row) => requestedLocations.includes(row.location))) &&
      (!serviceLine || snapshot.serviceLine === serviceLine),
    );
    const newestById = new Map<string, StreetRateRecommendation>();
    for (const snapshot of snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      for (const recommendation of snapshot.recommendations) {
        if (requestedLocations.length &&
            !requestedLocations.includes(recommendation.locationId ?? "") &&
            !requestedLocations.includes(recommendation.location)) continue;
        if (!newestById.has(recommendation.id)) newestById.set(recommendation.id, recommendation);
      }
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      recommendations: Array.from(newestById.values()),
      createdAt: snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.createdAt ?? null,
    });
  });

  app.post("/api/inhouse-planning/recommendations/edit", requireAuth, async (req: any, res) => {
    const clientId = req.clientId || "demo";
    const body = z.object({
      id: z.string().min(1),
      locationId: z.string().nullable().optional(),
      serviceLine: z.string().min(1),
      suggestedRate: z.number().min(0),
      locked: z.boolean().optional(),
    }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Invalid recommendation edit" });
    let updated: StreetRateRecommendation | null = null;
    const scopedSnapshot = recommendationSnapshots.get(
      recommendationSnapshotKey(
        clientId,
        recommendationUserId(req),
        body.data.locationId ?? null,
        body.data.serviceLine,
      ),
    );
    const snapshot = scopedSnapshot && snapshotIsFresh(scopedSnapshot)
      ? scopedSnapshot
      : Array.from(recommendationSnapshots.values()).find((candidate) =>
          candidate.clientId === clientId &&
          candidate.userId === recommendationUserId(req) &&
          candidate.serviceLine === body.data.serviceLine &&
          snapshotIsFresh(candidate) &&
          candidate.recommendations.some((row) => row.id === body.data.id),
        );
    if (snapshot) {
      const row = snapshot.recommendations.find((candidate) => candidate.id === body.data.id);
      if (row) {
        const requestedRate = row.topCompetitorRate == null
          ? row.currentStreetRate
          : body.data.suggestedRate;
        row.suggestedRate = Math.round(
          Math.max(row.currentStreetRate, Math.min(row.hardCeiling, requestedRate)) * 100,
        ) / 100;
        row.suggestedIncreasePct = row.currentStreetRate > 0
          ? (row.suggestedRate / row.currentStreetRate - 1) * 100
          : 0;
        row.locked = body.data.locked ?? row.locked;
        row.growthContribution =
          row.units * row.currentStreetRate * (row.suggestedRate / Math.max(row.currentStreetRate, 1) - 1);
        updated = row;
      }
    }
    if (!updated) return res.status(404).json({ error: "Recommendation is no longer available" });
    res.setHeader("Cache-Control", "no-store");
    res.json({ recommendation: updated });
  });

  // ── Excel export ─────────────────────────────────────────────────────────

  /**
   * Builds the workbook server-side rather than in the browser. The formula
   * chain needs the solver's per-resident internals — weight, headroom, shape,
   * the effective bounds and lambda — and none of those cross the wire on the
   * normal calculate response, which is deliberately kept lean because it is
   * re-fetched on every assumption change.
   *
   * POST, not GET, because it takes the same assumptions body as /calculate:
   * the operator exports what they are currently looking at, which may be
   * unsaved edits rather than the stored defaults.
   */
  app.post("/api/inhouse-planning/export", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = scopeSchema
        .extend({
          assumptions: assumptionsSchema.optional(),
          maximumPremiumAboveTopCompetitorPct: z.number().min(0).max(100).optional(),
          recommendations: z.array(z.any()).optional().default([]),
        })
        .safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ error: body.error.errors[0]?.message || "Invalid export request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const assumptions = enforceCurrentPlanningPolicy(
        body.data.assumptions ??
        (await resolveAssumptions(clientId, locationId, body.data.serviceLine)).assumptions,
      );

      const { plan, audit } = await calculatePlanDetailed({
        clientId,
        locationId,
        location,
        serviceLine: body.data.serviceLine,
        assumptions,
      });

      const snapshot = recommendationSnapshots.get(
        recommendationSnapshotKey(
          clientId,
          recommendationUserId(req),
          locationId,
          body.data.serviceLine,
        ),
      );
      const requestedPremium = body.data.maximumPremiumAboveTopCompetitorPct ?? snapshot?.maximumPremiumAboveTopCompetitorPct;
      const snapshotMatchesRequest = Boolean(
        snapshot && snapshotIsFresh(snapshot) && requestedPremium != null &&
        recommendationFingerprint(assumptions, requestedPremium) === snapshot.assumptionsFingerprint,
      );
      if (body.data.recommendations.length > 0 && !snapshotMatchesRequest) {
        return res.status(409).json({ error: "Street Rate recommendations expired. Re-run them before exporting." });
      }
      const usableSnapshot = snapshotMatchesRequest ? snapshot : undefined;
      const exportBenchmark = await loadCompBenchmark(pool, clientId);
      const exportEdits = new Map(body.data.recommendations.map((row: any) => [row.id, row]));
      const exportRecommendations = usableSnapshot?.recommendations.map((saved) => {
        const edit = exportEdits.get(saved.id);
        if (!edit) return saved;
        const top = exportBenchmark.benchmarkForRT(
          saved.benchmarkLocation ?? saved.location,
          saved.serviceLine,
          saved.product,
        ) ?? exportBenchmark.benchmarkFor(saved.benchmarkLocation ?? saved.location, saved.serviceLine);
        const currentCap = top
          ? (premiumCeiling(top.adjusted, usableSnapshot.maximumPremiumAboveTopCompetitorPct) ?? saved.currentStreetRate)
          : saved.currentStreetRate;
        const hardCeiling = Math.min(saved.hardCeiling, currentCap);
        const suggestedRate = Math.round(
          Math.max(saved.currentStreetRate, Math.min(hardCeiling, Number(edit.suggestedRate) || saved.currentStreetRate)) * 100,
        ) / 100;
        return {
          ...saved,
          suggestedRate,
          locked: Boolean(edit.locked),
          suggestedIncreasePct: saved.currentStreetRate > 0
            ? (suggestedRate / saved.currentStreetRate - 1) * 100
            : 0,
          growthContribution: saved.units * saved.currentStreetRate *
            (suggestedRate / Math.max(saved.currentStreetRate, 1) - 1),
        };
      });
      const buffer = await buildRatePlanWorkbook({
        plan,
        audit,
        recommendations:
          body.data.recommendations.length > 0
            ? exportRecommendations
            : usableSnapshot?.recommendations,
        generatedBy: req.user?.username || req.user?.email || undefined,
      });

      const slug = (value: string) =>
        value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "all";
      const filename = `in-house-rate-plan_${slug(location ?? "all-campuses")}_${slug(
        body.data.serviceLine,
      )}_${plan.scope.sourceMonth}.xlsx`;

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Cache-Control", "no-store");
      res.end(buffer);
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] export failed:", error);
      res.status(500).json({ error: "Failed to build the rate plan export" });
    }
  });

  // ── Submit (records an auditable proposed version and linked rules) ──────

  app.post("/api/inhouse-planning/apply", requireAuth, async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = scopeSchema.extend({
        assumptions: assumptionsSchema,
        maximumPremiumAboveTopCompetitorPct: z.number().min(0).max(100).optional(),
        recommendations: z.array(z.object({
          id: z.string().min(1),
          suggestedRate: z.number().min(0),
          locked: z.boolean(),
        })).optional().default([]),
      }).safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({ error: body.error.errors[0]?.message || "Invalid apply request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);

      // Recalculate server-side rather than trusting a posted plan: the client
      // must not be able to apply numbers the solver never produced.
      const plan = await calculatePlan({
        clientId,
        locationId,
        location,
        serviceLine: body.data.serviceLine,
        assumptions: body.data.assumptions,
      });

      if (!plan.feasible) {
        return res.status(409).json({
          error:
            "This plan does not reach the growth target and cannot be applied. Adjust the assumptions first.",
          infeasibility: plan.infeasibility,
        });
      }

      const snapshot = recommendationSnapshots.get(
        recommendationSnapshotKey(
          clientId,
          recommendationUserId(req),
          locationId,
          body.data.serviceLine,
        ),
      );
      const requestedPremium = body.data.maximumPremiumAboveTopCompetitorPct ?? snapshot?.maximumPremiumAboveTopCompetitorPct;
      if (body.data.recommendations.length > 0 && (!snapshot || !snapshotIsFresh(snapshot) || requestedPremium == null ||
          recommendationFingerprint(body.data.assumptions, requestedPremium) !== snapshot.assumptionsFingerprint)) {
        throw new PlanningDataError("Street Rate recommendations expired. Re-run them before submitting.");
      }
      if (snapshot && body.data.recommendations.length > 0) {
        const currentBenchmark = await loadCompBenchmark(pool, clientId);
        for (const submitted of body.data.recommendations) {
          const saved = snapshot.recommendations.find((candidate) => candidate.id === submitted.id);
          if (!saved) throw new PlanningDataError("This Street Rate recommendation is stale. Re-run recommendations before submitting.");
          const currentTop = currentBenchmark.benchmarkForRT(
            saved.benchmarkLocation ?? saved.location,
            saved.serviceLine,
            saved.product,
          ) ?? currentBenchmark.benchmarkFor(saved.benchmarkLocation ?? saved.location, saved.serviceLine);
          const currentPremiumCap = currentTop
            ? (premiumCeiling(currentTop.adjusted, snapshot.maximumPremiumAboveTopCompetitorPct) ?? saved.currentStreetRate)
            : saved.currentStreetRate;
          const allowedCap = Math.max(saved.currentStreetRate, currentPremiumCap);
          if (submitted.suggestedRate > allowedCap + 0.01) {
            throw new PlanningDataError("A current competitor benchmark lowered a submitted Street Rate. Re-run recommendations before submitting.");
          }
        }
      }
      const submittedRecommendations = body.data.recommendations.map((submitted) => {
        const saved = snapshot?.recommendations.find((candidate) => candidate.id === submitted.id);
        if (!saved) throw new PlanningDataError("This Street Rate recommendation is stale. Re-run recommendations before submitting.");
        const suggestedRate = Math.round(
          Math.max(saved.currentStreetRate, Math.min(saved.hardCeiling, submitted.suggestedRate)) * 100,
        ) / 100;
        return {
          ...saved,
          suggestedRate,
          locked: submitted.locked,
          suggestedIncreasePct: saved.currentStreetRate > 0
            ? (suggestedRate / saved.currentStreetRate - 1) * 100
            : 0,
          growthContribution: saved.units * saved.currentStreetRate *
            (suggestedRate / Math.max(saved.currentStreetRate, 1) - 1),
        };
      });
      const persistedSummary = submittedRecommendations.length
        ? { ...plan.summary, streetRateRecommendations: submittedRecommendations }
        : plan.summary;

      // Read-max, supersede and insert must be ONE transaction on ONE
      // connection. Two operators approving at the same moment would otherwise
      // both read the same MAX(version), both mark the other's plan superseded,
      // and leave two rows claiming to be version N. The unique index on
      // (client_id, location, service_line, version) is the backstop.
      const client = await pool.connect();
      let version = 1;
      let planId: string | undefined;
      let replacedImplementedProposal = false;
      try {
        await client.query("BEGIN");
        // Serialize concurrent approvals for this scope behind one advisory
        // lock, so the MAX(version) read below cannot be stale by the time the
        // insert runs.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `inhouse_rate_plan:${clientId}:${plan.scope.location ?? ""}:${plan.scope.serviceLine}`,
        ]);
        const versionRow = await client.query<{ next: string }>(
          `SELECT COALESCE(MAX(version), 0) + 1 AS next
             FROM inhouse_rate_plans
            WHERE client_id = $1
              AND service_line = $2
              AND location IS NOT DISTINCT FROM $3`,
          [clientId, plan.scope.serviceLine, plan.scope.location],
        );
        version = Number(versionRow.rows[0]?.next) || 1;

        // Re-submitting after editing replaces the prior draft for this exact
        // scope. Keep the old plan as a superseded audit version, but remove
        // its unpublished Rule Administration envelopes so an admin cannot
        // accidentally implement both the old and new resident allocations.
        const priorDrafts = await client.query<{ id: string; was_implemented: boolean }>(
          `SELECT p.id,
                  EXISTS (
                    SELECT 1
                      FROM adjustment_rules r
                     WHERE r.client_id = p.client_id
                       AND r.action->>'annualPlanId' = p.id
                       AND r.lifecycle_status = 'implemented'
                       AND r.is_active = true
                       AND r.is_historical IS NOT TRUE
                  ) AS was_implemented
             FROM inhouse_rate_plans p
            WHERE client_id = $1
              AND location_id IS NOT DISTINCT FROM $2
              AND service_line = $3
              AND status = 'proposed'
            FOR UPDATE`,
          [clientId, locationId, plan.scope.serviceLine],
        );
        const priorDraftIds = priorDrafts.rows.map((row) => row.id);
        replacedImplementedProposal = priorDrafts.rows.some((row) => row.was_implemented);
        if (priorDraftIds.length > 0) {
          await client.query(
            `DELETE FROM adjustment_rules
              WHERE client_id = $1
                AND is_historical IS NOT TRUE
                AND action->>'annualPlanId' = ANY($2::text[])`,
            [clientId, priorDraftIds],
          );
          await client.query(
            `UPDATE inhouse_rate_plans
                SET status = 'superseded'
              WHERE id = ANY($1::varchar[])`,
            [priorDraftIds],
          );
        }

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO inhouse_rate_plans
             (client_id, location_id, location, service_line, version, status,
              assumptions, summary, quarters, residents,
              street_rate_effective_date, inhouse_effective_date,
              recommended_street_rate, applied_by)
            VALUES ($1,$2,$3,$4,$5,'proposed',$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            clientId,
            locationId,
            plan.scope.location,
            plan.scope.serviceLine,
            version,
            JSON.stringify(plan.assumptions),
            JSON.stringify(persistedSummary),
            JSON.stringify(plan.quarters),
            JSON.stringify(plan.residents),
            plan.assumptions.streetRateEffectiveDate,
            plan.assumptions.inhouseEffectiveDate,
            plan.recommendedStreetRateDisplay,
            req.session?.userId || null,
          ],
        );
        planId = inserted.rows[0]?.id;
        if (!planId) throw new Error("Failed to create in-house rate plan");

        // These records deliberately bypass the generic rule-creation path:
        // plan + proposals must either all exist or none do. Once the operator
        // explicitly submits recommendations, each positive product delta is
        // materialized as a location/product-scoped fixed rule. Without
        // recommendations, retain the legacy uniform annual-plan proposal.
        const planLink = {
          annualPlanId: planId,
          proposalType: "inhouse_rate_plan",
          weightedAvgIncreasePct: plan.summary.weightedAvgIncreasePct,
        };
        const streetAction = {
          type: "adjust_rate",
          target: "street_rate",
          adjustmentType: "percentage",
          adjustmentValue: plan.streetIncreasePct,
          isAdditive: false,
          filters: { serviceLine: [plan.scope.serviceLine] },
          annualPlanId: planId,
          proposalType: "annual_plan_street_rate",
          streetRateRecommendations: [] as Array<StreetRateRecommendation & { roomTypes?: string[] }>,
        };
        const specialAction = {
          ...planLink,
          type: "annual_inhouse_plan",
          adjustmentType: "percentage",
          adjustmentValue: plan.summary.weightedAvgIncreasePct,
        };
        const suffix = planId.slice(0, 8);
        for (const recommendation of submittedRecommendations) {
          const groupedRoomTypes = await client.query<{ room_type: string }>(
            `SELECT DISTINCT COALESCE(NULLIF(rr.room_type, ''), rtg.source_room_type) AS room_type
               FROM room_type_groupings rtg
               LEFT JOIN rent_roll_data rr
                 ON rr.client_id = rtg.client_id
                AND rr.location = rtg.location
                AND rr.service_line = rtg.service_line
                AND rr.source_room_type = rtg.source_room_type
              WHERE rtg.client_id = $1
                AND rtg.service_line = $2
                AND rtg.group_name = $3
                AND ($4::text IS NULL OR rtg.location = $4 OR rr.location_id::text = $4)`,
            [
              clientId,
              recommendation.serviceLine,
              recommendation.product,
              recommendation.locationId ?? locationId,
            ],
          );
          const roomTypes = Array.from(new Set(
            groupedRoomTypes.rows.map((row) => row.room_type).filter(Boolean),
          ));
          streetAction.streetRateRecommendations.push({
            ...recommendation,
            roomTypes: roomTypes.length > 0 ? roomTypes : [recommendation.product],
          });
        }
        await client.query(
          `INSERT INTO adjustment_rules
             (client_id, location_id, service_line, service_lines, name, description,
              trigger, action, is_active, lifecycle_status, effective_date, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'proposed',$9,$10)`,
          [
            clientId, locationId, plan.scope.serviceLine, [plan.scope.serviceLine],
            `Annual plan street increase v${version} (${suffix})`,
            submittedRecommendations.length > 0
              ? "Product-specific Street Rate recommendations proposed by annual plan"
              : `${plan.streetIncreasePct.toFixed(2)}% street-rate increase proposed by annual plan`,
            JSON.stringify({ type: "immediate" }), JSON.stringify(streetAction),
            plan.assumptions.streetRateEffectiveDate || null, req.session?.userId || null,
          ],
        );
        await client.query(
          `INSERT INTO adjustment_rules
             (client_id, location_id, service_line, service_lines, name, description,
              trigger, action, is_active, lifecycle_status, effective_date, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'proposed',$9,$10)`,
          [
            clientId, locationId, plan.scope.serviceLine, [plan.scope.serviceLine],
            `Annual plan in-house increases v${version} (${suffix})`,
            `${plan.summary.weightedAvgIncreasePct.toFixed(2)}% weighted in-house increase proposed by annual plan`,
            JSON.stringify({ type: "immediate" }), JSON.stringify(specialAction),
            plan.assumptions.inhouseEffectiveDate || null, req.session?.userId || null,
          ],
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      // The proposal list is cached by Rule Administration. This is a
      // submission only (so do not schedule a pricing recalculation), but the
      // newly-created proposals must be visible immediately.
      const { onRulesChanged, purgeRuleCaches } = await import("../routes");
      if (replacedImplementedProposal) await onRulesChanged(clientId);
      else await purgeRuleCaches(clientId);
      res.json({ ok: true, version, planId, plan });
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] apply failed:", error);
      res.status(500).json({ error: "Failed to submit the in-house rate plan proposal" });
    }
  });

  // ── Plan history ─────────────────────────────────────────────────────────

  app.get("/api/inhouse-planning/plans", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const serviceLine = (req.query.serviceLine as string) || null;
      const locationId = (req.query.locationId as string) || null;
      const location = await resolveLocationName(clientId, locationId);

      const conditions = [eq(inhouseRatePlans.clientId, clientId)];
      if (serviceLine) conditions.push(eq(inhouseRatePlans.serviceLine, serviceLine));
      if (location) conditions.push(eq(inhouseRatePlans.location, location));

      const rows = await db
        .select({
          id: inhouseRatePlans.id,
          version: inhouseRatePlans.version,
          status: inhouseRatePlans.status,
          location: inhouseRatePlans.location,
          serviceLine: inhouseRatePlans.serviceLine,
          summary: inhouseRatePlans.summary,
          assumptions: inhouseRatePlans.assumptions,
          recommendedStreetRate: inhouseRatePlans.recommendedStreetRate,
          inhouseEffectiveDate: inhouseRatePlans.inhouseEffectiveDate,
          appliedBy: inhouseRatePlans.appliedBy,
          createdAt: inhouseRatePlans.createdAt,
        })
        .from(inhouseRatePlans)
        .where(and(...conditions))
        .orderBy(desc(inhouseRatePlans.createdAt))
        .limit(50);

      res.setHeader("Cache-Control", "no-store");
      res.json({ plans: rows });
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] plan history failed:", error);
      res.status(500).json({ error: "Failed to load plans" });
    }
  });
}
