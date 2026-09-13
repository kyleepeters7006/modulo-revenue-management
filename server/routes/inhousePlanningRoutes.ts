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
import { invalidateRefDataCache } from "../refDataCache";
import { inhousePlanningAssumptions, inhouseRatePlans, locations } from "@shared/schema";
import {
  applyOccupancyTier,
  DEFAULT_ASSUMPTIONS,
  defaultOccupancyTierPolicy,
  tierForOccupancy,
  type InhousePlanHistoryEntry,
  type OccupancyTierPolicy,
  type PlanSummary,
  type PlanningAssumptions,
  type TargetDeviationDiagnostic,
} from "@shared/inhousePlanning";
import {
  calculatePlan,
  calculatePlanBatch,
  calculatePlanDetailed,
  calculatePlanTiers,
  calculatePlanTiersBatch,
  PlanningDataError,
} from "../services/inhouseRatePlanning";
import { buildRatePlanWorkbook } from "../services/inhouseRatePlanning/excelExport";
import { computeHistoricalTurnover } from "../services/inhouseRatePlanning/historicalTurnover";
import {
  fetchOccupancyByCampus,
  fetchOccupancyByServiceLine,
} from "../services/inhouseRatePlanning/dataAccess";

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
  minStreetIncreasePct: z.number().min(0).max(100),
  desiredVarianceToTopCompetitorPct: z.number().min(-100).max(100),
  maxYoYStreetIncreasePct: z.number().min(0).max(100),
}).refine((d) => d.minInhouseIncreasePct <= d.maxInhouseIncreasePct, {
  message: "Minimum increase cannot exceed maximum increase",
}).refine((d) => d.minStreetIncreasePct <= d.maxStreetIncreasePct, {
  message: "Minimum Street Rate increase cannot exceed maximum Street Rate increase",
});

const scopeSchema = z.object({
  locationId: z.string().nullable().optional(),
  serviceLine: z.string().min(1),
});

/**
 * The guardrails an occupancy tier is allowed to move. Everything absent here
 * — effective dates, the growth target, turnover, the measurement mode — is
 * deliberately excluded: a tier that could shift the horizon would compare
 * three plans built over different periods and label the difference "tier".
 */
const tierGuardrailsSchema = z.object({
  minInhouseIncreasePct: z.number().min(0).max(100),
  maxInhouseIncreasePct: z.number().min(0).max(100),
  minStreetIncreasePct: z.number().min(0).max(100),
  maxStreetIncreasePct: z.number().min(0).max(100),
  maxYoYStreetIncreasePct: z.number().min(0).max(100),
  desiredVarianceToTopCompetitorPct: z.number().min(-100).max(100),
  equalizationStrength: z.enum(["low", "medium", "high"]),
}).refine((d) => d.minInhouseIncreasePct <= d.maxInhouseIncreasePct, {
  message: "A tier's minimum increase cannot exceed its maximum increase",
}).refine((d) => d.minStreetIncreasePct <= d.maxStreetIncreasePct, {
  message: "A tier's minimum Street Rate increase cannot exceed its maximum",
});

const tierPolicySchema = z.object({
  lowCutoffPct: z.number().min(0).max(100),
  highCutoffPct: z.number().min(0).max(100),
  tiers: z.object({
    low: tierGuardrailsSchema,
    target: tierGuardrailsSchema,
    high: tierGuardrailsSchema,
  }),
}).refine((d) => d.lowCutoffPct <= d.highCutoffPct, {
  message: "The lower cutoff cannot sit above the upper cutoff",
});

const batchLineSchema = z.object({
  serviceLine: z.string().min(1),
  assumptions: assumptionsSchema.optional(),
  tierPolicy: tierPolicySchema.optional(),
});

const batchScopeSchema = z.object({
  locationId: z.string().nullable().optional(),
  lines: z
    .array(batchLineSchema)
    .min(1, "Select at least one service line")
    .superRefine((lines, ctx) => {
      const seen = new Set<string>();
      lines.forEach((line, index) => {
        if (seen.has(line.serviceLine)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "serviceLine"],
            message: "Service lines must be unique",
          });
        }
        seen.add(line.serviceLine);
      });
    }),
});

async function assumptionsForMeasuredTier(
  clientId: string,
  location: string | null,
  serviceLine: string,
  assumptions: PlanningAssumptions,
  tierPolicy: OccupancyTierPolicy,
): Promise<PlanningAssumptions> {
  const occupancy = await fetchOccupancyByServiceLine(clientId, location);
  const reading = occupancy.byServiceLine.get(serviceLine) ?? null;
  const tier = tierForOccupancy(tierPolicy, reading?.occupancyPct ?? null);
  return tier ? applyOccupancyTier(assumptions, tierPolicy.tiers[tier]) : assumptions;
}

/**
 * Stored policy JSON is re-validated on read, not trusted. The column is
 * nullable and predates nothing, so an unparseable or absent value falls back
 * to the shared defaults rather than failing the whole assumptions fetch.
 */
function rowToTierPolicy(row: any): OccupancyTierPolicy {
  const parsed = tierPolicySchema.safeParse(row?.occupancyTierPolicy);
  return parsed.success ? parsed.data : defaultOccupancyTierPolicy();
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
    minStreetIncreasePct: Number(
      row.minStreetIncreasePct ?? DEFAULT_ASSUMPTIONS.minStreetIncreasePct,
    ),
    desiredVarianceToTopCompetitorPct: Number(
      row.desiredVarianceToTopCompetitorPct ??
      DEFAULT_ASSUMPTIONS.desiredVarianceToTopCompetitorPct,
    ),
    maxYoYStreetIncreasePct: Number(
      row.maxYoYStreetIncreasePct ?? DEFAULT_ASSUMPTIONS.maxYoYStreetIncreasePct,
    ),
  };
}
function enforceCurrentPlanningPolicy(assumptions: PlanningAssumptions): PlanningAssumptions {
  return { ...DEFAULT_ASSUMPTIONS, ...assumptions, allowInhouseAboveStreet: true };
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
): Promise<{
  assumptions: PlanningAssumptions;
  tierPolicy: OccupancyTierPolicy;
  /**
   * False when `tierPolicy` is the shared default rather than something this
   * scope saved. The editor seeds its middle tier from the scope's own
   * guardrails in that case, so the grid's target column reproduces the plan
   * the operator already sees instead of a set of numbers nobody chose.
   */
  tierPolicyStored: boolean;
  scopeLevel: string;
}> {
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
    if (row) {
      return {
        assumptions: rowToAssumptions(row),
        // Taken from the row that won, so the tier policy and the assumptions
        // it modifies always come from the same scope.
        tierPolicy: rowToTierPolicy(row),
        tierPolicyStored: tierPolicySchema.safeParse(row?.occupancyTierPolicy).success,
        scopeLevel: tier.level,
      };
    }
  }
  return {
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    tierPolicy: defaultOccupancyTierPolicy(),
    tierPolicyStored: false,
    scopeLevel: "default",
  };
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
    .json({ error: "Login required. In-house rate plan actions are disabled in anonymous demo mode." });
}

export type InhousePlanningRouteDependencies = {
  /**
   * Test seam for the submission path. Production uses the real solver; tests
   * can provide a deterministic plan without seeding the live solver inputs.
   */
  calculatePlan?: typeof calculatePlan;
};

export function registerInhousePlanningRoutes(
  app: Express,
  dependencies: InhousePlanningRouteDependencies = {},
) {
  const calculatePlanForRoute = dependencies.calculatePlan ?? calculatePlan;

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

  app.get("/api/inhouse-planning/assumptions-batch", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const locationId = (req.query.locationId as string) || null;
      const serviceLines = String(req.query.serviceLines || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 12);
      if (serviceLines.length === 0) {
        return res.status(400).json({ error: "At least one service line is required." });
      }
      const resolvedEntries = await Promise.all(
        serviceLines.map(async (serviceLine) => [
          serviceLine,
          await resolveAssumptions(clientId, locationId, serviceLine),
        ] as const),
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({ policies: Object.fromEntries(resolvedEntries) });
    } catch (error) {
      console.error("[inhouse-planning] assumptions batch fetch failed:", error);
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
          tierPolicy: tierPolicySchema.optional(),
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
        minStreetIncreasePct: assumptions.minStreetIncreasePct,
        desiredVarianceToTopCompetitorPct: assumptions.desiredVarianceToTopCompetitorPct,
        maxYoYStreetIncreasePct: assumptions.maxYoYStreetIncreasePct,
        // Omitted rather than nulled when the caller did not send one, so a
        // save from a screen that does not edit tiers leaves the stored policy
        // alone instead of silently resetting it to the defaults.
        ...(body.data.tierPolicy ? { occupancyTierPolicy: body.data.tierPolicy } : {}),
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

  /**
   * Portfolio form of calculate. Occupancy is a scope-wide read, so resolve
   * the measured tier for every line from one snapshot before preparing the
   * independent line plans.
   */
  app.post("/api/inhouse-planning/calculate-batch", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = batchScopeSchema.safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ error: body.error.errors[0]?.message || "Invalid batch planning request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const [occupancy, stored] = await Promise.all([
        fetchOccupancyByServiceLine(clientId, location),
        Promise.all(
          body.data.lines.map((line) =>
            resolveAssumptions(clientId, locationId, line.serviceLine),
          ),
        ),
      ]);
      const inputs = body.data.lines.map((line, index) => {
        const resolved = stored[index];
        const base = enforceCurrentPlanningPolicy(line.assumptions ?? resolved.assumptions);
        const policy = line.tierPolicy ?? resolved.tierPolicy;
        const measuredTier = tierForOccupancy(
          policy,
          occupancy.byServiceLine.get(line.serviceLine)?.occupancyPct ?? null,
        );
        return {
          serviceLine: line.serviceLine,
          assumptions: measuredTier
            ? applyOccupancyTier(base, policy.tiers[measuredTier])
            : base,
        };
      });
      const result = await calculatePlanBatch({
        clientId,
        locationId,
        location,
        lines: inputs,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] batch calculate failed:", error);
      res.status(500).json({ error: "Failed to calculate the in-house rate plans" });
    }
  });

  app.post("/api/inhouse-planning/calculate", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = scopeSchema
        .extend({
          assumptions: assumptionsSchema.optional(),
          tierPolicy: tierPolicySchema.optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ error: body.error.errors[0]?.message || "Invalid planning request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const stored = await resolveAssumptions(clientId, locationId, body.data.serviceLine);
      const baseAssumptions = enforceCurrentPlanningPolicy(
        body.data.assumptions ?? stored.assumptions,
      );
      const assumptions = await assumptionsForMeasuredTier(
        clientId,
        location,
        body.data.serviceLine,
        baseAssumptions,
        body.data.tierPolicy ?? stored.tierPolicy,
      );
      const plan = await calculatePlanForRoute({
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

  // ── Occupancy-tier what-if grid (never writes a rate) ────────────────────

  app.post("/api/inhouse-planning/calculate-tiers-batch", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = batchScopeSchema.safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ error: body.error.errors[0]?.message || "Invalid tier grid request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const stored = await Promise.all(
        body.data.lines.map((line) =>
          resolveAssumptions(clientId, locationId, line.serviceLine),
        ),
      );
      const result = await calculatePlanTiersBatch({
        clientId,
        locationId,
        location,
        lines: body.data.lines.map((line, index) => {
          const resolved = stored[index];
          return {
            serviceLine: line.serviceLine,
            assumptions: enforceCurrentPlanningPolicy(
              line.assumptions ?? resolved.assumptions,
            ),
            tierPolicy: line.tierPolicy ?? resolved.tierPolicy,
          };
        }),
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] batch tier grid failed:", error);
      res.status(500).json({ error: "Failed to calculate the occupancy tier grids" });
    }
  });

  /**
   * One service line, solved under all three of its occupancy tiers. The
   * client fans out across service lines exactly as it does for single plans,
   * so the grid fills in line by line instead of behind one long request.
   */
  app.post("/api/inhouse-planning/calculate-tiers", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = scopeSchema
        .extend({
          assumptions: assumptionsSchema.optional(),
          tierPolicy: tierPolicySchema.optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ error: body.error.errors[0]?.message || "Invalid tier grid request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const stored = await resolveAssumptions(clientId, locationId, body.data.serviceLine);
      const assumptions = enforceCurrentPlanningPolicy(
        body.data.assumptions ?? stored.assumptions,
      );
      const result = await calculatePlanTiers({
        clientId,
        locationId,
        location,
        serviceLine: body.data.serviceLine,
        assumptions,
        tierPolicy: body.data.tierPolicy ?? stored.tierPolicy,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(result);
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] tier grid failed:", error);
      res.status(500).json({ error: "Failed to calculate the occupancy tier grid" });
    }
  });

  // Campus-level occupancy for the calculated-plan review charts. This is kept
  // separate from the tier endpoint because the all-campus plan needs one
  // measured reading per campus/service line, not a portfolio aggregate.
  app.get("/api/inhouse-planning/occupancy-by-campus", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const readings = await fetchOccupancyByCampus(clientId);
      res.setHeader("Cache-Control", "no-store");
      res.json({ readings });
    } catch (error) {
      console.error("[inhouse-planning] campus occupancy failed:", error);
      res.status(500).json({ error: "Failed to load campus occupancy" });
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
  app.post("/api/inhouse-planning/export", requireAuth, async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = scopeSchema
        .extend({
          assumptions: assumptionsSchema.optional(),
          tierPolicy: tierPolicySchema.optional(),
        })
        .safeParse(req.body);
      if (!body.success) {
        return res
          .status(400)
          .json({ error: body.error.errors[0]?.message || "Invalid export request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const stored = await resolveAssumptions(clientId, locationId, body.data.serviceLine);
      const baseAssumptions = enforceCurrentPlanningPolicy(
        body.data.assumptions ?? stored.assumptions,
      );
      const assumptions = await assumptionsForMeasuredTier(
        clientId,
        location,
        body.data.serviceLine,
        baseAssumptions,
        body.data.tierPolicy ?? stored.tierPolicy,
      );

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

  // ── Submit (records an auditable proposed version and linked rules) ──────

  app.post("/api/inhouse-planning/apply", requireAuth, async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const body = scopeSchema.extend({
        assumptions: assumptionsSchema,
        tierPolicy: tierPolicySchema.optional(),
      }).safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({ error: body.error.errors[0]?.message || "Invalid apply request" });
      }
      const locationId = body.data.locationId || null;
      const location = await resolveLocationName(clientId, locationId);
      const stored = await resolveAssumptions(clientId, locationId, body.data.serviceLine);
      const assumptions = await assumptionsForMeasuredTier(
        clientId,
        location,
        body.data.serviceLine,
        enforceCurrentPlanningPolicy(body.data.assumptions),
        body.data.tierPolicy ?? stored.tierPolicy,
      );

      // Recalculate server-side rather than trusting a posted plan: the client
      // must not be able to apply numbers the solver never produced.
      const plan = await calculatePlanForRoute({
        clientId,
        locationId,
        location,
        serviceLine: body.data.serviceLine,
        assumptions,
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
               assumptions, summary, quarters, residents, target_deviation_diagnostic,
              street_rate_effective_date, inhouse_effective_date,
              recommended_street_rate, applied_by)
             VALUES ($1,$2,$3,$4,$5,'proposed',$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
            plan.targetDeviationDiagnostic
              ? JSON.stringify(plan.targetDeviationDiagnostic)
              : null,
            plan.assumptions.streetRateEffectiveDate,
            plan.assumptions.inhouseEffectiveDate,
            plan.recommendedStreetRateDisplay,
            req.session?.userId || null,
          ],
        );
        planId = inserted.rows[0]?.id;
        if (!planId) throw new Error("Failed to create in-house rate plan");

        // These records deliberately bypass the generic rule-creation path:
        // plan + proposals must either all exist or none do.
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
        };
        const specialAction = {
          ...planLink,
          type: "annual_inhouse_plan",
          adjustmentType: "percentage",
          adjustmentValue: plan.summary.weightedAvgIncreasePct,
        };
        const suffix = planId.slice(0, 8);
        await client.query(
          `INSERT INTO adjustment_rules
             (client_id, location_id, service_line, service_lines, name, description,
              trigger, action, is_active, lifecycle_status, effective_date, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'proposed',$9,$10)`,
          [
            clientId, locationId, plan.scope.serviceLine, [plan.scope.serviceLine],
            `Annual plan street increase v${version} (${suffix})`,
            `${plan.streetIncreasePct.toFixed(2)}% street-rate increase proposed by annual plan`,
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

  app.post("/api/inhouse-planning/plans/:id/remove", requireAuth, async (req: any, res) => {
    const clientId = req.clientId || "demo";
    const planId = String(req.params.id || "");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string; status: string }>(
        `SELECT id, status
           FROM inhouse_rate_plans
          WHERE id = $1 AND client_id = $2
          FOR UPDATE`,
        [planId, clientId],
      );
      if (!existing.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Plan not found" });
      }
      if (!["proposed", "applied", "published"].includes(existing.rows[0].status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This plan is no longer active in Reference Data" });
      }

      const activeRuleCheck = await client.query<{ had_active_rule: boolean }>(
        `SELECT EXISTS (
           SELECT 1
             FROM adjustment_rules
            WHERE client_id = $1
              AND action->>'annualPlanId' = $2
              AND is_active = true
              AND is_historical IS NOT TRUE
         ) AS had_active_rule`,
        [clientId, planId],
      );
      await client.query(
        `UPDATE adjustment_rules
            SET is_active = false,
                lifecycle_status = 'disabled',
                is_historical = true,
                updated_at = now()
          WHERE client_id = $1
            AND action->>'annualPlanId' = $2
            AND is_historical IS NOT TRUE`,
        [clientId, planId],
      );
      await client.query(
        `UPDATE inhouse_rate_plans SET status = 'withdrawn' WHERE id = $1 AND client_id = $2`,
        [planId, clientId],
      );
      await client.query("COMMIT");

      invalidateRefDataCache();
      const { onRulesChanged, purgeRuleCaches } = await import("../routes");
      if (activeRuleCheck.rows[0]?.had_active_rule) await onRulesChanged(clientId);
      else await purgeRuleCaches(clientId);
      res.json({ ok: true, planId, status: "withdrawn" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[inhouse-planning] remove plan failed:", error);
      res.status(500).json({ error: "Failed to remove the plan from Reference Data" });
    } finally {
      client.release();
    }
  });

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
          locationId: inhouseRatePlans.locationId,
          serviceLine: inhouseRatePlans.serviceLine,
          summary: inhouseRatePlans.summary,
          assumptions: inhouseRatePlans.assumptions,
           targetDeviationDiagnostic: inhouseRatePlans.targetDeviationDiagnostic,
          recommendedStreetRate: inhouseRatePlans.recommendedStreetRate,
          inhouseEffectiveDate: inhouseRatePlans.inhouseEffectiveDate,
          appliedBy: inhouseRatePlans.appliedBy,
          createdAt: inhouseRatePlans.createdAt,
        })
        .from(inhouseRatePlans)
        .where(and(...conditions))
        .orderBy(desc(inhouseRatePlans.createdAt))
        .limit(50);

      const plans: InhousePlanHistoryEntry[] = rows.map((row) => ({
        ...row,
        summary: row.summary as PlanSummary,
        assumptions: row.assumptions as PlanningAssumptions,
        targetDeviationDiagnostic:
          (row.targetDeviationDiagnostic as TargetDeviationDiagnostic | null) ?? null,
        createdAt: row.createdAt?.toISOString?.() ?? (row.createdAt ? String(row.createdAt) : null),
      }));
      res.setHeader("Cache-Control", "no-store");
      res.json({ plans });
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] plan history failed:", error);
      res.status(500).json({ error: "Failed to load plans" });
    }
  });
}
