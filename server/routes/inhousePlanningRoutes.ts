/**
 * In-House Rate Planning routes — /api/inhouse-planning/*
 *
 * Calculating a plan is read-only by construction: the calculate endpoint
 * never writes a rate. Applying a plan is a separate, authenticated POST that
 * records an immutable version before anything else happens.
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
import { invalidateRefDataCache } from "../refDataCache";

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
  allowInhouseAboveStreet: z.boolean(),
  maxStreetIncreasePct: z.number().min(0).max(100),
}).refine((d) => d.minInhouseIncreasePct <= d.maxInhouseIncreasePct, {
  message: "Minimum increase cannot exceed maximum increase",
});

const scopeSchema = z.object({
  locationId: z.string().nullable().optional(),
  serviceLine: z.string().min(1),
});

/** Rows come back snake_case from the driver; drizzle rows do not. */
function rowToAssumptions(row: any): PlanningAssumptions {
  return {
    rateGrowthTargetPct: Number(row.rateGrowthTargetPct),
    measurementMode: "quarterly_yoy",
    streetRateEffectiveDate: row.streetRateEffectiveDate || "",
    inhouseEffectiveDate: row.inhouseEffectiveDate || "",
    annualTurnoverPct: Number(row.annualTurnoverPct),
    minInhouseIncreasePct: Number(row.minInhouseIncreasePct),
    maxInhouseIncreasePct: Number(row.maxInhouseIncreasePct),
    equalizationStrength: row.equalizationStrength,
    allowInhouseAboveStreet: Boolean(row.allowInhouseAboveStreet),
    maxStreetIncreasePct: Number(row.maxStreetIncreasePct),
  };
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
      const { locationId = null, serviceLine = null, assumptions } = body.data;

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
        allowInhouseAboveStreet: assumptions.allowInhouseAboveStreet,
        maxStreetIncreasePct: assumptions.maxStreetIncreasePct,
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
      const assumptions =
        body.data.assumptions ??
        (await resolveAssumptions(clientId, locationId, body.data.serviceLine)).assumptions;

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
        .extend({ assumptions: assumptionsSchema.optional() })
        .safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ error: body.error.errors[0]?.message || "Invalid export request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const assumptions =
        body.data.assumptions ??
        (await resolveAssumptions(clientId, locationId, body.data.serviceLine)).assumptions;

      const { plan, audit } = await calculatePlanDetailed({
        clientId,
        locationId,
        location,
        serviceLine: body.data.serviceLine,
        assumptions,
      });

      const buffer = await buildRatePlanWorkbook({
        plan,
        audit,
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

  // ── Apply (records an auditable version) ─────────────────────────────────

  app.post("/api/inhouse-planning/apply", requireAuth, async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = scopeSchema.extend({ assumptions: assumptionsSchema }).safeParse(req.body);
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

      // Read-max, supersede and insert must be ONE transaction on ONE
      // connection. Two operators approving at the same moment would otherwise
      // both read the same MAX(version), both mark the other's plan superseded,
      // and leave two rows claiming to be version N. The unique index on
      // (client_id, location, service_line, version) is the backstop.
      const client = await pool.connect();
      let version = 1;
      let planId: string | undefined;
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

        // Older plans for the same scope stop being the live answer the moment
        // a new one is approved, but they are never deleted.
        await client.query(
          `UPDATE inhouse_rate_plans
              SET status = 'superseded'
            WHERE client_id = $1
              AND service_line = $2
              AND location IS NOT DISTINCT FROM $3
              AND status = 'applied'`,
          [clientId, plan.scope.serviceLine, plan.scope.location],
        );

        const inserted = await client.query<{ id: string }>(
          `INSERT INTO inhouse_rate_plans
             (client_id, location_id, location, service_line, version, status,
              assumptions, summary, quarters, residents,
              street_rate_effective_date, inhouse_effective_date,
              recommended_street_rate, applied_by)
           VALUES ($1,$2,$3,$4,$5,'applied',$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING id`,
          [
            clientId,
            locationId,
            plan.scope.location,
            plan.scope.serviceLine,
            version,
            JSON.stringify(plan.assumptions),
            JSON.stringify(plan.summary),
            JSON.stringify(plan.quarters),
            JSON.stringify(plan.residents),
            plan.assumptions.streetRateEffectiveDate,
            plan.assumptions.inhouseEffectiveDate,
            plan.recommendedStreetRateDisplay,
            req.session?.userId || null,
          ],
        );
        planId = inserted.rows[0]?.id;
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      // Reference Data now reads applied plans for its Annual Increase columns
      // and its Final rate, so a newly applied plan must drop the cached
      // responses. Without this the grid serves pre-plan numbers for the rest
      // of the 10-minute TTL.
      invalidateRefDataCache();

      res.json({ ok: true, version, planId, plan });
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] apply failed:", error);
      res.status(500).json({ error: "Failed to apply the in-house rate plan" });
    }
  });

  // ── Applied plan history ─────────────────────────────────────────────────

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
      res.status(500).json({ error: "Failed to load applied plans" });
    }
  });
}
