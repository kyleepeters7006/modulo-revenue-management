/**
 * In-House Rate Planning routes — /api/inhouse-planning/*
 *
 * Calculating a plan is read-only by construction: the calculate endpoint
 * never writes a rate. Submitting a plan records an immutable proposed version
 * and its linked pricing proposals; publishing is the only operation that
 * applies it to Reference Data.
 */
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { db, pool } from "../db";
import { invalidateRefDataCache } from "../refDataCache";
import {
  inhouseAnnualReportRuns,
  inhousePlanDetailSnapshots,
  inhousePlanningAssumptions,
  inhouseRatePlans,
  locations,
} from "@shared/schema";
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
import {
  generateAnnualInhouseReportPdf,
  planStatus as annualReportPlanStatus,
} from "../services/inhouseAnnualReportPdf";
import { generateCampusAnnualReports } from "../services/inhouseAnnualReportGeneration";
import { compactPlanForAnnualReport } from "@shared/inhouseAnnualReportSnapshot";
import { computeHistoricalTurnover } from "../services/inhouseRatePlanning/historicalTurnover";
import {
  fetchOccupancyByCampus,
  fetchOccupancyByServiceLine,
} from "../services/inhouseRatePlanning/dataAccess";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type RatePlanExportJob =
  | { clientId: string; status: "pending"; createdAt: number }
  | { clientId: string; status: "ready"; createdAt: number; buffer: Buffer; filename: string }
  | { clientId: string; status: "failed"; createdAt: number; error: string };

const ratePlanExportJobs = new Map<string, RatePlanExportJob>();
const RATE_PLAN_EXPORT_TTL_MS = 15 * 60 * 1000;

function purgeExpiredRatePlanExports(): void {
  const cutoff = Date.now() - RATE_PLAN_EXPORT_TTL_MS;
  for (const [id, job] of ratePlanExportJobs) {
    if (job.createdAt < cutoff) ratePlanExportJobs.delete(id);
  }
}

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
  division: z.string().trim().nullable().optional(),
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
  division: z.string().trim().nullable().optional(),
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

// These are intentionally JSON-shaped rather than tied to the UI's report
// interfaces. The report is a snapshot: saving it must not coerce, recalculate,
// or discard a calculated field that a newer client knows about.
const reportJsonSchema = z.custom<unknown>((value) => {
  if (value === undefined) return false;
  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}, { message: "Must be valid JSON" });

const annualReportRunSchema = z.object({
  scopeKey: z.string().trim().min(1).max(300),
  locationId: z.string().max(100).nullable().optional(),
  serviceLines: z.array(z.enum(["AL", "AL/MC", "SL", "VIL", "HC", "HC/MC"])).min(1).max(6),
  plans: z.array(reportJsonSchema).min(1).max(6),
  tierGrid: reportJsonSchema,
});

async function assumptionsForMeasuredTier(
  clientId: string,
  location: string | null,
  serviceLine: string,
  assumptions: PlanningAssumptions,
  tierPolicy: OccupancyTierPolicy,
  locationNames?: string[],
): Promise<PlanningAssumptions> {
  const occupancy = await fetchOccupancyByServiceLine(clientId, location, locationNames);
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
  division: string | null = null,
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
  const addTiersForDivision = (divisionValue: string | null) => {
    const divisionWhere = divisionValue
      ? eq(inhousePlanningAssumptions.division, divisionValue)
      : sql`${inhousePlanningAssumptions.division} IS NULL`;
    const level = (name: string) => divisionValue ? `division+${name}` : name;
    if (locationId && serviceLine) {
      tiers.push({
        level: level("location+serviceLine"),
        where: and(
          eq(inhousePlanningAssumptions.clientId, clientId),
          divisionWhere,
          eq(inhousePlanningAssumptions.locationId, locationId),
          eq(inhousePlanningAssumptions.serviceLine, serviceLine),
        ),
      });
    }
    if (locationId) {
      tiers.push({
        level: level("location"),
        where: and(
          eq(inhousePlanningAssumptions.clientId, clientId),
          divisionWhere,
          eq(inhousePlanningAssumptions.locationId, locationId),
          sql`${inhousePlanningAssumptions.serviceLine} IS NULL`,
        ),
      });
    }
    if (serviceLine) {
      tiers.push({
        level: level("serviceLine"),
        where: and(
          eq(inhousePlanningAssumptions.clientId, clientId),
          divisionWhere,
          sql`${inhousePlanningAssumptions.locationId} IS NULL`,
          eq(inhousePlanningAssumptions.serviceLine, serviceLine),
        ),
      });
    }
    tiers.push({
      level: level("global"),
      where: and(
        eq(inhousePlanningAssumptions.clientId, clientId),
        divisionWhere,
        sql`${inhousePlanningAssumptions.locationId} IS NULL`,
        sql`${inhousePlanningAssumptions.serviceLine} IS NULL`,
      ),
    });
  };
  addTiersForDivision(division);
  if (division) addTiersForDivision(null);

  for (const tier of tiers) {
    const [row] = await db
      .select()
      .from(inhousePlanningAssumptions)
      .where(tier.where)
      .orderBy(
        desc(inhousePlanningAssumptions.updatedAt),
        desc(inhousePlanningAssumptions.createdAt),
      )
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

/**
 * Resolve all selected service lines in one read. The single-line endpoint
 * keeps the simple most-specific lookup above, but the editor loads every
 * selected line together and should not pay for four sequential lookups per
 * line.
 */
async function resolveAssumptionsBatch(
  clientId: string,
  locationId: string | null,
  serviceLines: string[],
  division: string | null = null,
): Promise<Record<string, Awaited<ReturnType<typeof resolveAssumptions>>>> {
  const rows = await db
    .select()
    .from(inhousePlanningAssumptions)
    .where(
      and(
        eq(inhousePlanningAssumptions.clientId, clientId),
        division
          ? or(
              eq(inhousePlanningAssumptions.division, division),
              sql`${inhousePlanningAssumptions.division} IS NULL`,
            )
          : sql`${inhousePlanningAssumptions.division} IS NULL`,
        locationId
          ? or(
              eq(inhousePlanningAssumptions.locationId, locationId),
              sql`${inhousePlanningAssumptions.locationId} IS NULL`,
            )
          : sql`${inhousePlanningAssumptions.locationId} IS NULL`,
        or(
          inArray(inhousePlanningAssumptions.serviceLine, serviceLines),
          sql`${inhousePlanningAssumptions.serviceLine} IS NULL`,
        ),
      ),
    )
    .orderBy(
      desc(inhousePlanningAssumptions.updatedAt),
      desc(inhousePlanningAssumptions.createdAt),
    );

  const newest = (
    predicate: (row: typeof rows[number]) => boolean,
  ): typeof rows[number] | undefined => rows.find(predicate);

  const resolved: Record<string, Awaited<ReturnType<typeof resolveAssumptions>>> = {};
  for (const serviceLine of serviceLines) {
    const row =
      (locationId
        ? newest(
            (candidate) =>
              candidate.division === division &&
              candidate.locationId === locationId &&
              candidate.serviceLine === serviceLine,
          )
        : undefined) ??
      (locationId
        ? newest(
            (candidate) =>
              candidate.division === division &&
              candidate.locationId === locationId &&
              candidate.serviceLine === null,
          )
        : undefined) ??
      newest(
        (candidate) =>
          candidate.division === division &&
          candidate.locationId === null &&
          candidate.serviceLine === serviceLine,
      ) ??
      newest(
        (candidate) =>
          candidate.division === division &&
          candidate.locationId === null &&
          candidate.serviceLine === null,
      );
    const fallbackRow = row ?? (
      (locationId
        ? newest((candidate) =>
            candidate.division === null &&
            candidate.locationId === locationId &&
            candidate.serviceLine === serviceLine)
        : undefined) ??
      (locationId
        ? newest((candidate) =>
            candidate.division === null &&
            candidate.locationId === locationId &&
            candidate.serviceLine === null)
        : undefined) ??
      newest((candidate) =>
        candidate.division === null &&
        candidate.locationId === null &&
        candidate.serviceLine === serviceLine) ??
      newest((candidate) =>
        candidate.division === null &&
        candidate.locationId === null &&
        candidate.serviceLine === null)
    );

    resolved[serviceLine] = fallbackRow
      ? {
          assumptions: rowToAssumptions(fallbackRow),
          tierPolicy: rowToTierPolicy(fallbackRow),
          tierPolicyStored: tierPolicySchema.safeParse(fallbackRow.occupancyTierPolicy).success,
          scopeLevel:
            locationId && fallbackRow.locationId === locationId
              ? fallbackRow.serviceLine === serviceLine
                ? "location+serviceLine"
                : "location"
              : fallbackRow.serviceLine === serviceLine
                ? "serviceLine"
                : "global",
        }
      : {
          assumptions: { ...DEFAULT_ASSUMPTIONS },
          tierPolicy: defaultOccupancyTierPolicy(),
          tierPolicyStored: false,
          scopeLevel: "default",
        };
  }
  return resolved;
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

/**
 * Resolve the division once at the route boundary. The solver/data-access
 * layer receives the exact campus-name set, so every baseline, resident,
 * history, occupancy, and competitor query uses the same validated scope.
 */
async function resolvePlanningScope(
  clientId: string,
  locationId: string | null,
  division: string | null | undefined,
): Promise<{ location: string | null; locationNames?: string[] }> {
  const normalizedDivision = division?.trim() || null;
  const selected = locationId
    ? await db
      .select({ name: locations.name, division: locations.division })
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.clientId, clientId)))
      .limit(1)
    : [];
  if (locationId && !selected[0]) {
    throw new PlanningDataError("Campus not found for this client.");
  }
  if (normalizedDivision && selected[0]?.division !== normalizedDivision) {
    throw new PlanningDataError("The selected campus is not in the selected division.");
  }

  const names = normalizedDivision
    ? (await db
      .select({ name: locations.name })
      .from(locations)
      .where(and(eq(locations.clientId, clientId), eq(locations.division, normalizedDivision))))
      .map((row) => row.name)
    : undefined;

  return {
    location: selected[0]?.name ?? null,
    locationNames: locationId ? [selected[0]!.name] : names,
  };
}

function requireAuth(req: any, res: any, next: any) {
  if (req.session?.userId && req.session?.clientId) return next();
  return res
    .status(401)
    .json({ error: "Login required. In-house rate plan actions are disabled in anonymous demo mode." });
}

function planningScopeKey(
  locationId: string | null,
  serviceLines: string[],
  division: string | null,
): string {
  const lines = Array.from(new Set(serviceLines));
  return division
    ? `${division}|${locationId ?? "all"}|${lines.join(",")}`
    : `${locationId ?? "all"}|${lines.join(",")}`;
}

async function savePlanDetailSnapshot(input: {
  clientId: string;
  scopeKey: string;
  plans: unknown;
  inputSnapshot: unknown;
  generatedAt: Date;
}): Promise<void> {
  await db
    .insert(inhousePlanDetailSnapshots)
    .values(input as any)
    .onConflictDoUpdate({
      target: [
        inhousePlanDetailSnapshots.clientId,
        inhousePlanDetailSnapshots.scopeKey,
      ],
      set: {
        plans: input.plans,
        inputSnapshot: input.inputSnapshot,
        generatedAt: input.generatedAt,
      } as any,
    });
}

export type InhousePlanningRouteDependencies = {
  /**
   * Test seam for the submission path. Production uses the real solver; tests
   * can provide a deterministic plan without seeding the live solver inputs.
   */
  calculatePlan?: typeof calculatePlan;
  /**
   * Test seams for the portfolio fan-out. The route still owns location
   * discovery and report persistence; tests can make the database-heavy
   * calculation and background scheduling deterministic.
   */
  calculatePlanTiersBatch?: typeof calculatePlanTiersBatch;
  generateCampusAnnualReports?: typeof generateCampusAnnualReports;
};

export function registerInhousePlanningRoutes(
  app: Express,
  dependencies: InhousePlanningRouteDependencies = {},
) {
  const calculatePlanForRoute = dependencies.calculatePlan ?? calculatePlan;
  const calculatePlanTiersBatchForRoute =
    dependencies.calculatePlanTiersBatch ?? calculatePlanTiersBatch;
  const generateCampusAnnualReportsForRoute =
    dependencies.generateCampusAnnualReports ?? generateCampusAnnualReports;

  // ── Assumptions ──────────────────────────────────────────────────────────

  app.get("/api/inhouse-planning/assumptions", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const locationId = (req.query.locationId as string) || null;
      const serviceLine = (req.query.serviceLine as string) || null;
      const division = (req.query.division as string) || null;
      const resolved = await resolveAssumptions(clientId, locationId, serviceLine, division);
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
      const division = (req.query.division as string) || null;
      const serviceLines = String(req.query.serviceLines || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 12);
      if (serviceLines.length === 0) {
        return res.status(400).json({ error: "At least one service line is required." });
      }
       const policies = await resolveAssumptionsBatch(clientId, locationId, serviceLines, division);
      res.setHeader("Cache-Control", "no-store");
      res.json({ policies });
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
          division: z.string().trim().nullable().optional(),
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
       const { locationId = null, serviceLine = null, division = null } = body.data;
      const assumptions = enforceCurrentPlanningPolicy(body.data.assumptions);

      const values = {
        clientId,
        division: division || null,
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
      const [savedRow] = await db
        .insert(inhousePlanningAssumptions)
        .values(values)
        .onConflictDoUpdate({
          target: [
            inhousePlanningAssumptions.clientId,
             inhousePlanningAssumptions.division,
            inhousePlanningAssumptions.locationId,
            inhousePlanningAssumptions.serviceLine,
          ],
          set: values,
        })
        .returning();

       const resolved = await resolveAssumptions(
         clientId,
         locationId || null,
         serviceLine || null,
         division || null,
       );
      res.setHeader("Cache-Control", "no-store");
      // Return the row acknowledged by the write rather than relying only on
      // scope resolution. This keeps the editor aligned with exactly what the
      // database accepted, including both effective dates.
      res.json({
        ok: true,
        ...resolved,
        assumptions: savedRow ? rowToAssumptions(savedRow) : resolved.assumptions,
      });
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
      const scope = await resolvePlanningScope(
        clientId,
        locationId,
        (req.query.division as string) || null,
      );
      const result = await computeHistoricalTurnover(
        clientId,
        locationId,
        scope.location,
        scope.locationNames,
      );
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
      const scope = await resolvePlanningScope(clientId, locationId, body.data.division);
      const [occupancy, stored] = await Promise.all([
        fetchOccupancyByServiceLine(clientId, scope.location, scope.locationNames),
        Promise.all(
          body.data.lines.map((line) =>
            resolveAssumptions(clientId, locationId, line.serviceLine, body.data.division || null),
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
        location: scope.location,
        locationNames: scope.locationNames,
        division: body.data.division || null,
        lines: inputs,
      });
      if (req.session?.userId && req.session?.clientId && result.plans.length > 0) {
        const generatedAt = new Date();
        const inputSnapshot = body.data.lines;
        const detailPlans = result.plans.map(({ serviceLine, plan }) => ({
          sl: serviceLine,
          plan,
        }));
        await Promise.all([
          savePlanDetailSnapshot({
            clientId,
            scopeKey: planningScopeKey(
              locationId,
              detailPlans.map(({ sl }) => sl),
              body.data.division || null,
            ),
            plans: detailPlans,
            inputSnapshot,
            generatedAt,
          }),
          ...detailPlans.map((entry) =>
            savePlanDetailSnapshot({
              clientId,
              scopeKey: planningScopeKey(locationId, [entry.sl], body.data.division || null),
              plans: [entry],
              inputSnapshot: body.data.lines.filter(
                (line) => line.serviceLine === entry.sl,
              ),
              generatedAt,
            }),
          ),
        ]);
      }
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
      const scope = await resolvePlanningScope(clientId, locationId, body.data.division);
      const stored = await resolveAssumptions(
        clientId,
        locationId,
        body.data.serviceLine,
        body.data.division || null,
      );
      const baseAssumptions = enforceCurrentPlanningPolicy(
        body.data.assumptions ?? stored.assumptions,
      );
      const assumptions = await assumptionsForMeasuredTier(
        clientId,
        scope.location,
        body.data.serviceLine,
        baseAssumptions,
        body.data.tierPolicy ?? stored.tierPolicy,
        scope.locationNames,
      );
      const plan = await calculatePlanForRoute({
        clientId,
        locationId,
        location: scope.location,
        locationNames: scope.locationNames,
        division: body.data.division || null,
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
      const scope = await resolvePlanningScope(clientId, locationId, body.data.division);
      const stored = await Promise.all(
        body.data.lines.map((line) =>
          resolveAssumptions(clientId, locationId, line.serviceLine, body.data.division || null),
        ),
      );
      const result = await calculatePlanTiersBatchForRoute({
        clientId,
        locationId,
        location: scope.location,
        locationNames: scope.locationNames,
        division: body.data.division || null,
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
      if (req.session?.userId && req.session?.clientId && result.lines.length > 0) {
        const generatedAt = new Date();
        const detailPlans = result.lines.map((line) => ({
          sl: line.serviceLine,
          plan: line.currentPlan,
        }));
        await Promise.all([
          savePlanDetailSnapshot({
            clientId,
            scopeKey: planningScopeKey(
              locationId,
              detailPlans.map(({ sl }) => sl),
              body.data.division || null,
            ),
            plans: detailPlans,
            inputSnapshot: body.data.lines,
            generatedAt,
          }),
          ...detailPlans.map((entry) =>
            savePlanDetailSnapshot({
              clientId,
              scopeKey: planningScopeKey(locationId, [entry.sl], body.data.division || null),
              plans: [entry],
              inputSnapshot: body.data.lines.filter(
                (line) => line.serviceLine === entry.sl,
              ),
              generatedAt,
            }),
          ),
        ]);
      }
      if (locationId === null && result.lines.length > 0) {
        const campusReportBatchStartedAt = new Date();
        const reportLines = body.data.lines.map((line, index) => {
          const resolved = stored[index];
          return {
            serviceLine: line.serviceLine,
            assumptions: enforceCurrentPlanningPolicy(
              line.assumptions ?? resolved.assumptions,
            ),
            tierPolicy: line.tierPolicy ?? resolved.tierPolicy,
          };
        });
        void (async () => {
          const campusRows = await db
            .select({ id: locations.id, name: locations.name })
            .from(locations)
            .where(and(
              eq(locations.clientId, clientId),
              ...(body.data.division ? [eq(locations.division, body.data.division)] : []),
            ));
          const generated = await generateCampusAnnualReportsForRoute({
            locations: campusRows,
            lines: reportLines,
            concurrency: 2,
            calculate: (campus, lines) =>
              calculatePlanTiersBatchForRoute({
                clientId,
                locationId: campus.id,
                location: campus.name,
                division: body.data.division || null,
                lines: lines as any,
              }) as any,
            save: async ({ location: campus, serviceLines, result: campusResult }) => {
              const compactPlans = campusResult.lines.map((line) => ({
                sl: line.serviceLine,
                plan: compactPlanForAnnualReport(line.currentPlan as any),
              }));
              const scopeKey = body.data.division
                ? `${body.data.division}|${campus.id}|${serviceLines.join(",")}`
                : `${campus.id}|${serviceLines.join(",")}`;
              // One timestamp identifies the entire portfolio run. A slower
              // older fan-out must never overwrite a campus already saved by
              // a newer portfolio run.
              const generatedAt = campusReportBatchStartedAt;
              const tierGrid = {
                lines: campusResult.lines.map((line) => ({
                  serviceLine: line.serviceLine,
                  occupancyPct: line.occupancyPct,
                  occupancyMonth: line.occupancyMonth,
                  occupancySource: (line as any).occupancySource ?? null,
                  currentTier: line.currentTier,
                  cells: line.cells,
                  warnings: line.warnings,
                  currentPlan: compactPlans.find(({ sl }) => sl === line.serviceLine)?.plan
                    ?? compactPlanForAnnualReport(line.currentPlan as any),
                })),
                skipped: campusResult.skipped,
                scopeKey,
                // The generated campus report must reopen with the portfolio
                // inputs that produced it. Normal campus saves can then create
                // a more-specific override without changing the portfolio row.
                inputSnapshot: reportLines,
              };
              await db
                .insert(inhouseAnnualReportRuns)
                .values({
                  clientId,
                  scopeKey,
                  locationId: campus.id,
                  serviceLines,
                  plans: compactPlans,
                  tierGrid,
                  generatedAt,
                } as any)
                .onConflictDoUpdate({
                  target: [inhouseAnnualReportRuns.clientId, inhouseAnnualReportRuns.scopeKey],
                  set: {
                    locationId: campus.id,
                    serviceLines,
                    plans: compactPlans,
                    tierGrid,
                    generatedAt,
                  } as any,
                  setWhere: sql`${inhouseAnnualReportRuns.generatedAt} <= ${generatedAt}`,
                });
            },
            onError: (campus, error) => {
              console.error(
                `[inhouse-planning] campus annual report failed for ${campus.name}:`,
                error,
              );
            },
          });
          if (generated.failed.length > 0) {
            console.warn(
              `[inhouse-planning] ${generated.failed.length} campus annual report(s) were not saved`,
            );
          }
        })().catch((error) => {
          console.error("[inhouse-planning] campus annual report generation failed:", error);
        });
      }
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
      const scope = await resolvePlanningScope(clientId, locationId, body.data.division);
      const stored = await resolveAssumptions(
        clientId,
        locationId,
        body.data.serviceLine,
        body.data.division || null,
      );
      const assumptions = enforceCurrentPlanningPolicy(
        body.data.assumptions ?? stored.assumptions,
      );
      const result = await calculatePlanTiers({
        clientId,
        locationId,
        location: scope.location,
        locationNames: scope.locationNames,
        division: body.data.division || null,
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
      const division = (req.query.division as string) || null;
      const scope = await resolvePlanningScope(clientId, null, division);
      const readings = await fetchOccupancyByCampus(clientId, scope.locationNames);
      res.setHeader("Cache-Control", "no-store");
      res.json({ readings });
    } catch (error) {
      console.error("[inhouse-planning] campus occupancy failed:", error);
      res.status(500).json({ error: "Failed to load campus occupancy" });
    }
  });

  // Reopened portfolio reports contain compact service-line plans without the
  // resident rows used to derive campus dots in the browser. The portfolio run
  // already creates one saved calculation per campus, so expose those exact
  // campus/service-line results rather than collapsing the chart to six
  // portfolio aggregates.
  app.get("/api/inhouse-planning/campus-plan-points", async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const serviceLines = String(req.query.serviceLines ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (serviceLines.length === 0) {
        return res.status(400).json({ error: "At least one service line is required" });
      }
      const division = (req.query.division as string) || null;
      const scopeSuffix = `|${serviceLines.join(",")}`;
      const rows = await db
        .select({
          locationId: inhouseAnnualReportRuns.locationId,
          plans: inhouseAnnualReportRuns.plans,
          tierGrid: inhouseAnnualReportRuns.tierGrid,
          generatedAt: inhouseAnnualReportRuns.generatedAt,
        })
        .from(inhouseAnnualReportRuns)
        .where(and(
          eq(inhouseAnnualReportRuns.clientId, clientId),
          isNotNull(inhouseAnnualReportRuns.locationId),
          like(inhouseAnnualReportRuns.scopeKey, `%${scopeSuffix}`),
        ))
        .orderBy(desc(inhouseAnnualReportRuns.generatedAt));

      const points = rows.flatMap((row) => {
        const plans = Array.isArray(row.plans) ? row.plans : [];
        const tierLines =
          row.tierGrid &&
          typeof row.tierGrid === "object" &&
          Array.isArray((row.tierGrid as { lines?: unknown }).lines)
            ? (row.tierGrid as { lines: any[] }).lines
            : [];
        return plans.flatMap((entry: any) => {
          const sl = typeof entry?.sl === "string" ? entry.sl : null;
          const plan = entry?.plan;
          const summary = plan?.summary;
          if (
            !sl ||
            !serviceLines.includes(sl) ||
            !plan ||
            !summary ||
            !Number.isFinite(Number(summary.weightedAvgIncreasePct)) ||
            !Number.isFinite(Number(plan.streetIncreasePct))
          ) {
            return [];
          }
          const tierLine = tierLines.find((line) => line?.serviceLine === sl);
          const occupancyValue = tierLine?.occupancyPct;
          if (occupancyValue == null) return [];
          const occupancy = Number(occupancyValue);
          if (!Number.isFinite(occupancy)) return [];
          return [{
            locationId: row.locationId,
            location: plan.scope?.location ?? `Campus ${row.locationId}`,
            serviceLine: sl,
            occupancy,
            inhouseIncrease: Number(summary.weightedAvgIncreasePct),
            streetIncrease: Number(plan.streetIncreasePct),
            occupancyMonth: tierLine?.occupancyMonth ?? null,
            residents: Number(summary.residentCount) || 0,
            generatedAt: row.generatedAt?.toISOString?.() ?? String(row.generatedAt),
          }];
        });
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ points });
    } catch (error) {
      console.error("[inhouse-planning] campus plan points failed:", error);
      res.status(500).json({ error: "Failed to load campus plan points" });
    }
  });

  // ── Annual report snapshots ───────────────────────────────────────────────

  function normalizedAnnualReport(row: any) {
    const plans = row.plans;
    const status = annualReportPlanStatus(
      Array.isArray(plans)
        ? plans
        : plans && typeof plans === "object"
          ? Object.values(plans)
          : [],
    );
    return {
      id: row.id,
      scopeKey: row.scopeKey,
      locationId: row.locationId ?? null,
      serviceLines: row.serviceLines,
      plans: row.plans,
      tierGrid: row.tierGrid,
      createdAt: row.createdAt?.toISOString?.() ?? (row.createdAt ? String(row.createdAt) : null),
      generatedAt:
        row.generatedAt?.toISOString?.() ?? (row.generatedAt ? String(row.generatedAt) : null),
      status,
    };
  }

  /**
   * A portfolio tier run persists one compact annual-report snapshot per
   * campus. A division view should be able to reopen those campus results as a
   * division calculation instead of appearing empty until the operator runs
   * the solver again.
   *
   * This deliberately rolls up the saved campus snapshots rather than
   * averaging their displayed percentages. Dollar and resident metrics are
   * accumulated first, then the rates are re-derived from those totals.
   */
  function rollUpDivisionCampusReports({
    division,
    scopeKey,
    serviceLines,
    campusRows,
    reportRows,
  }: {
    division: string;
    scopeKey: string;
    serviceLines: string[];
    campusRows: Array<{ id: string; name: string }>;
    reportRows: any[];
  }): any | null {
    const campusIds = new Set(campusRows.map((campus) => campus.id));
    const campusById = new Map(campusRows.map((campus) => [campus.id, campus]));
    const requested = new Set(serviceLines);
    const latestByCampusLine = new Map<string, {
      generatedAt: number;
      isDivisionScoped: boolean;
      plan: any;
      tierLine: any;
      inputSnapshot: any[];
    }>();

    for (const row of reportRows) {
      if (!row.locationId || !campusIds.has(row.locationId)) continue;
      const rowScope = String(row.scopeKey ?? "");
      const divisionPrefix = `${division}|${row.locationId}|`;
      const portfolioPrefix = `${row.locationId}|`;
      if (!rowScope.startsWith(divisionPrefix) && !rowScope.startsWith(portfolioPrefix)) continue;
      const rowPlans = Array.isArray(row.plans) ? row.plans : [];
      const rowTierLines =
        row.tierGrid &&
        typeof row.tierGrid === "object" &&
        Array.isArray(row.tierGrid.lines)
          ? row.tierGrid.lines
          : [];
      const generatedAt = Date.parse(
        row.generatedAt?.toISOString?.() ?? String(row.generatedAt ?? ""),
      ) || 0;
      for (const entry of rowPlans) {
        const sl = typeof entry?.sl === "string" ? entry.sl : null;
        if (!sl || !requested.has(sl) || !entry.plan) continue;
        const key = `${row.locationId}::${sl}`;
        const previous = latestByCampusLine.get(key);
        // A division-specific campus snapshot wins over an older portfolio
        // snapshot at the same campus. Otherwise newest generatedAt wins.
        const isDivisionScoped = rowScope.startsWith(divisionPrefix);
        if (
          previous &&
          (
            previous.isDivisionScoped && !isDivisionScoped ||
            previous.isDivisionScoped === isDivisionScoped &&
            previous.generatedAt >= generatedAt
          )
        ) {
          continue;
        }
        latestByCampusLine.set(key, {
          generatedAt,
          isDivisionScoped,
          plan: entry.plan,
          tierLine: rowTierLines.find((line: any) => line?.serviceLine === sl) ?? null,
          inputSnapshot:
            row.tierGrid &&
            typeof row.tierGrid === "object" &&
            Array.isArray(row.tierGrid.inputSnapshot)
              ? row.tierGrid.inputSnapshot
              : [],
        });
      }
    }

    const planByLine = new Map<string, any[]>();
    for (const [key, value] of latestByCampusLine) {
      const sl = key.slice(key.indexOf("::") + 2);
      const plans = planByLine.get(sl) ?? [];
      plans.push(value.plan);
      planByLine.set(sl, plans);
    }
    if (planByLine.size === 0) return null;

    const weightedAverage = (plans: any[], selector: (plan: any) => unknown): number => {
      let total = 0;
      let weight = 0;
      for (const plan of plans) {
        const value = Number(selector(plan));
        const count = Math.max(0, Number(plan.summary?.residentCount) || 0);
        if (!Number.isFinite(value) || count <= 0) continue;
        total += value * count;
        weight += count;
      }
      return weight > 0 ? total / weight : 0;
    };
    const sum = (plans: any[], selector: (plan: any) => unknown): number =>
      plans.reduce((total, plan) => {
        const value = Number(selector(plan));
        return total + (Number.isFinite(value) ? value : 0);
      }, 0);
    const uniqueStrings = (values: unknown[]): string[] =>
      Array.from(new Set(values.filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )));

    const rollUpPlan = (serviceLine: string, plans: any[]): any => {
      const first = plans[0];
      const residentCount = sum(plans, (plan) => plan.summary?.residentCount);
      const currentRateTotal = sum(
        plans,
        (plan) => (Number(plan.summary?.currentAvgInhouseRateMonthly) || 0) *
          (Number(plan.summary?.residentCount) || 0),
      );
      const increaseTotal = sum(plans, (plan) => plan.summary?.totalMonthlyIncreaseDollars);
      const currentAvg = residentCount > 0 ? currentRateTotal / residentCount : 0;
      const newAvg = residentCount > 0 ? currentAvg + increaseTotal / residentCount : currentAvg;
      const targetPct = Number(first.assumptions?.rateGrowthTargetPct) || 0;
      const quarters = Array.from(
        new Map(
          plans.flatMap((plan) => (Array.isArray(plan.quarters) ? plan.quarters : []))
            .map((quarter: any) => [`${quarter.year}-${quarter.quarter}`, quarter]),
        ).values(),
      ).map((template: any) => {
        const matching = plans.flatMap((plan) =>
          (Array.isArray(plan.quarters) ? plan.quarters : [])
            .filter((quarter: any) => quarter.year === template.year && quarter.quarter === template.quarter),
        );
        const priorRate = weightedAverage(matching.map((quarter: any) => ({
          summary: { residentCount: plans.find((plan) =>
            plan.quarters?.some((quarter: any) =>
              quarter.year === template.year && quarter.quarter === template.quarter,
            ),
          )?.summary?.residentCount ?? 0 },
          priorYear: quarter.priorYear,
        })), (value: any) => value.priorYear?.realizedRateMonthly);
        const projectedRate = weightedAverage(
          matching.map((quarter: any) => ({
            summary: {
              residentCount: plans.find((plan) =>
                plan.quarters?.some((candidate: any) =>
                  candidate.year === template.year && candidate.quarter === template.quarter,
                ),
              )?.summary?.residentCount ?? 0,
            },
            projectedRateMonthly: quarter.projectedRateMonthly,
          })),
          (value: any) => value.projectedRateMonthly,
        );
        const yoyGrowthPct = priorRate > 0 ? (projectedRate / priorRate - 1) * 100 : 0;
        return {
          year: template.year,
          quarter: template.quarter,
          label: template.label,
          priorYear: {
            ...template.priorYear,
            realizedRateMonthly: priorRate,
          },
          requiredRateMonthly: priorRate * (1 + targetPct / 100),
          projectedRateMonthly: projectedRate,
          yoyGrowthPct,
          passes: yoyGrowthPct >= targetPct,
          shortfallPct: Math.max(0, targetPct - yoyGrowthPct),
          isBinding: false,
        };
      });
      const binding = quarters
        .filter((quarter: any) => !quarter.passes)
        .sort((a: any, b: any) => b.shortfallPct - a.shortfallPct)[0];
      if (binding) binding.isBinding = true;

      const distributions = ["increaseDistribution", "residentIncreaseDistribution"].map((field) => {
        const counts = new Map<string, number>();
        for (const plan of plans) {
          for (const entry of Array.isArray(plan[field]) ? plan[field] : []) {
            counts.set(entry.label, (counts.get(entry.label) ?? 0) + (Number(entry.count) || 0));
          }
        }
        return Array.from(counts, ([label, count]) => ({ label, count }));
      });

      const summary = {
        residentCount,
        residentsReceivingIncrease: sum(plans, (plan) => plan.summary?.residentsReceivingIncrease),
        residentsAtMin: sum(plans, (plan) => plan.summary?.residentsAtMin),
        residentsAtMax: sum(plans, (plan) => plan.summary?.residentsAtMax),
        residentsBlockedByStreet: sum(plans, (plan) => plan.summary?.residentsBlockedByStreet),
        weightedAvgIncreasePct: currentRateTotal > 0 ? (increaseTotal / currentRateTotal) * 100 : 0,
        minIncreasePct: Math.min(...plans.map((plan) => Number(plan.summary?.minIncreasePct) || 0)),
        maxIncreasePct: Math.max(...plans.map((plan) => Number(plan.summary?.maxIncreasePct) || 0)),
        totalMonthlyIncreaseDollars: increaseTotal,
        totalAnnualIncreaseDollars: sum(plans, (plan) => plan.summary?.totalAnnualIncreaseDollars),
        currentAvgInhouseRateMonthly: currentAvg,
        newAvgInhouseRateMonthly: newAvg,
      };
      return {
        ...first,
        scope: {
          ...first.scope,
          locationId: null,
          location: division,
          division,
          serviceLine,
        },
        currentStreetRateMonthly: weightedAverage(plans, (plan) => plan.currentStreetRateMonthly),
        recommendedStreetRateMonthly: weightedAverage(plans, (plan) => plan.recommendedStreetRateMonthly),
        streetIncreasePct: weightedAverage(plans, (plan) => plan.streetIncreasePct),
        streetIncreaseDollarsMonthly: sum(plans, (plan) => plan.streetIncreaseDollarsMonthly),
        currentStreetRateDisplay: weightedAverage(plans, (plan) => plan.currentStreetRateDisplay),
        recommendedStreetRateDisplay: weightedAverage(plans, (plan) => plan.recommendedStreetRateDisplay),
        requiredWeightedAvgIncreasePct: weightedAverage(plans, (plan) => plan.requiredWeightedAvgIncreasePct),
        quarters,
        monthlyRateProjection: [],
        bindingQuarterLabel: binding?.label ?? null,
        summary,
        residents: [],
        targetDeviationDiagnostic: null,
        warnings: uniqueStrings([
          ...plans.flatMap((plan) => Array.isArray(plan.warnings) ? plan.warnings : []),
          `Rolled up from ${plans.length} campus calculation${plans.length === 1 ? "" : "s"} in ${division}.`,
        ]),
        increaseDistribution: distributions[0],
        residentIncreaseDistribution: distributions[1],
      };
    };

    const plans = serviceLines.flatMap((serviceLine) => {
      const linePlans = planByLine.get(serviceLine);
      return linePlans?.length ? [{ sl: serviceLine, plan: rollUpPlan(serviceLine, linePlans) }] : [];
    });
    if (plans.length === 0) return null;
    const inputSnapshot = Array.from(latestByCampusLine.values())
      .map((value) => value.inputSnapshot)
      .find((snapshot) => snapshot.length > 0) ?? [];

    const tierLines = serviceLines.flatMap((serviceLine) => {
      const values = Array.from(latestByCampusLine.entries())
        .filter(([key]) => key.endsWith(`::${serviceLine}`))
        .map(([, value]) => value)
        .filter((value) => value.tierLine);
      const aggregate = plans.find((entry) => entry.sl === serviceLine)?.plan;
      if (!aggregate || values.length === 0) return [];
      const currentTier = values
        .map((value) => value.tierLine.currentTier)
        .filter(Boolean)[0] ?? null;
      const cells = ["low", "target", "high"].map((tier) => {
        const matching = values
          .map((value) => value.tierLine.cells?.find((cell: any) => cell.tier === tier))
          .filter(Boolean);
        return {
          serviceLine,
          tier,
          rangeLabel: matching[0]?.rangeLabel ?? tier,
          isCurrent: tier === currentTier,
          inhouseIncreasePct: matching.length
            ? matching.reduce((total: number, cell: any) => total + (Number(cell.inhouseIncreasePct) || 0), 0) / matching.length
            : null,
          streetIncreasePct: matching.length
            ? matching.reduce((total: number, cell: any) => total + (Number(cell.streetIncreasePct) || 0), 0) / matching.length
            : null,
          feasible: matching.length ? matching.every((cell: any) => cell.feasible !== false) : null,
        };
      });
      return [{
        serviceLine,
        occupancyPct: values.reduce((total, value) => total + (Number(value.tierLine.occupancyPct) || 0), 0) / values.length,
        occupancyMonth: values[0].tierLine.occupancyMonth ?? null,
        occupancySource: values[0].tierLine.occupancySource ?? null,
        currentTier,
        cells,
        warnings: uniqueStrings(values.flatMap((value) => value.tierLine.warnings ?? [])),
        currentPlan: aggregate,
      }];
    });

    return {
      id: null,
      scopeKey,
      locationId: null,
      serviceLines: plans.map(({ sl }) => sl),
      // Annual-report consumers use the same `{ sl, plan }` envelope as the
      // normal calculation snapshot. Keeping that envelope is what lets the
      // division restore select the right line from the rolled-up report.
      plans,
      tierGrid: {
        lines: tierLines,
        skipped: [],
        scopeKey,
        inputSnapshot,
      },
      generatedAt: new Date(
        Math.max(...Array.from(latestByCampusLine.values()).map((value) => value.generatedAt)),
      ).toISOString(),
      status: "campus_rollup",
      campusNames: plans.map(({ sl }) => sl).length
        ? campusRows.map((campus) => campus.name)
        : [],
    };
  }

  app.get("/api/inhouse-planning/division-rollup/latest", requireAuth, async (req: any, res) => {
    try {
      const division = String(req.query.division || "").trim();
      const scopeKey = String(req.query.scopeKey || "").trim();
      if (!division || !scopeKey) return res.json({ report: null });
      const clientId = req.clientId || "demo";
      const serviceLines = scopeKey.includes("|")
        ? scopeKey.slice(scopeKey.lastIndexOf("|") + 1).split(",").filter(Boolean)
        : [];
      if (serviceLines.length === 0) return res.json({ report: null });
      const campusRows = await db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(and(eq(locations.clientId, clientId), eq(locations.division, division)));
      if (campusRows.length === 0) return res.json({ report: null });
      const reportRows = await db
        .select()
        .from(inhouseAnnualReportRuns)
        .where(and(
          eq(inhouseAnnualReportRuns.clientId, clientId),
          inArray(inhouseAnnualReportRuns.locationId, campusRows.map((campus) => campus.id)),
        ))
        .orderBy(desc(inhouseAnnualReportRuns.generatedAt));
      const report = rollUpDivisionCampusReports({
        division,
        scopeKey,
        serviceLines,
        campusRows,
        reportRows,
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ report });
    } catch (error) {
      console.error("[inhouse-planning] division rollup failed:", error);
      return res.status(500).json({ error: "Failed to load the saved division calculation" });
    }
  });

  app.get("/api/inhouse-planning/plan-details/latest", requireAuth, async (req: any, res) => {
    try {
      const scopeKey = String(req.query.scopeKey || "").trim();
      if (!scopeKey) return res.status(400).json({ error: "A planning scope is required" });
      const clientId = req.clientId || "demo";
      const [row] = await db
        .select({
          plans: inhousePlanDetailSnapshots.plans,
          inputSnapshot: inhousePlanDetailSnapshots.inputSnapshot,
          generatedAt: inhousePlanDetailSnapshots.generatedAt,
          scopeKey: inhousePlanDetailSnapshots.scopeKey,
        })
        .from(inhousePlanDetailSnapshots)
        .where(and(
          eq(inhousePlanDetailSnapshots.clientId, clientId),
          eq(inhousePlanDetailSnapshots.scopeKey, scopeKey),
        ))
        .limit(1);
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        snapshot: row
          ? {
              scopeKey: row.scopeKey,
              plans: row.plans,
              inputSnapshot: row.inputSnapshot,
              generatedAt: row.generatedAt,
            }
          : null,
      });
    } catch (error) {
      console.error("[inhouse-planning] plan detail snapshot fetch failed:", error);
      return res.status(500).json({ error: "Failed to load saved plan details" });
    }
  });

  app.post("/api/inhouse-planning/annual-report-runs", requireAuth, async (req: any, res) => {
    try {
      const body = annualReportRunSchema.safeParse(req.body);
      if (!body.success) {
        return res.status(400).json({
          error: body.error.errors[0]?.message || "Invalid annual report payload",
        });
      }
      const clientId = req.clientId || "demo";
      const locationId = body.data.locationId || null;
      if (locationId) await resolveLocationName(clientId, locationId);

      // clientId is deliberately taken only from tenant middleware. Unknown
      // request fields are stripped by the schema and never reach this insert.
      const generatedAt = new Date();
      const values = {
        clientId,
        scopeKey: body.data.scopeKey,
        locationId,
        serviceLines: body.data.serviceLines,
        plans: body.data.plans,
        tierGrid: body.data.tierGrid,
        generatedAt,
      };
      const [row] = await db
        .insert(inhouseAnnualReportRuns)
        .values(values as any)
        .onConflictDoUpdate({
          target: [inhouseAnnualReportRuns.clientId, inhouseAnnualReportRuns.scopeKey],
          set: {
            locationId,
            serviceLines: body.data.serviceLines,
            plans: body.data.plans,
            tierGrid: body.data.tierGrid,
            generatedAt,
          } as any,
        })
        .returning();

      res.setHeader("Cache-Control", "no-store");
      return res.json({ report: normalizedAnnualReport(row) });
    } catch (error) {
      if (error instanceof PlanningDataError) {
        return res.status(422).json({ error: error.message });
      }
      console.error("[inhouse-planning] annual report save failed:", error);
      return res.status(500).json({ error: "Failed to save the annual in-house report" });
    }
  });

  app.get("/api/inhouse-planning/annual-report-runs/latest", requireAuth, async (req: any, res) => {
    try {
      const scopeKey = String(req.query.scopeKey || "").trim();
      const clientId = req.clientId || "demo";
      const conditions = [eq(inhouseAnnualReportRuns.clientId, clientId)];
      if (scopeKey) conditions.push(eq(inhouseAnnualReportRuns.scopeKey, scopeKey));
      const [row] = await db
        .select()
        .from(inhouseAnnualReportRuns)
        .where(and(...conditions))
        .orderBy(desc(inhouseAnnualReportRuns.generatedAt))
        .limit(1);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ report: row ? normalizedAnnualReport(row) : null });
    } catch (error) {
      console.error("[inhouse-planning] latest annual report fetch failed:", error);
      return res.status(500).json({ error: "Failed to load the latest annual in-house report" });
    }
  });

  app.get("/api/inhouse-planning/annual-report-runs/:id/pdf", requireAuth, async (req: any, res) => {
    try {
      const clientId = req.clientId || "demo";
      const [row] = await db
        .select()
        .from(inhouseAnnualReportRuns)
        .where(and(
          eq(inhouseAnnualReportRuns.id, String(req.params.id)),
          eq(inhouseAnnualReportRuns.clientId, clientId),
        ))
        .limit(1);
      if (!row) return res.status(404).json({ error: "Annual report not found" });

      const report = normalizedAnnualReport(row);
      const buffer = await generateAnnualInhouseReportPdf(report);
      const generatedDate = new Date(row.generatedAt ?? row.createdAt ?? Date.now());
      const datePart = Number.isNaN(generatedDate.getTime())
        ? new Date().toISOString().slice(0, 10)
        : generatedDate.toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="Annual_In-House_Rate_Plan_${datePart}.pdf"`,
      );
      res.setHeader("Content-Length", String(buffer.length));
      res.setHeader("Cache-Control", "no-store");
      return res.end(buffer);
    } catch (error) {
      console.error("[inhouse-planning] annual report PDF failed:", error);
      return res.status(500).json({ error: "Failed to build the annual in-house report PDF" });
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
    purgeExpiredRatePlanExports();
    const exportId = randomUUID();
    const createdAt = Date.now();
    const generatedBy = req.user?.username || req.user?.email || undefined;
    ratePlanExportJobs.set(exportId, { clientId, status: "pending", createdAt });
    res.status(202).json({ exportId, status: "pending" });

    void (async () => {
      try {
        const locationId = body.data.locationId || null;
        const scope = await resolvePlanningScope(clientId, locationId, body.data.division);
        const stored = await resolveAssumptions(
          clientId,
          locationId,
          body.data.serviceLine,
          body.data.division || null,
        );
        const baseAssumptions = enforceCurrentPlanningPolicy(
          body.data.assumptions ?? stored.assumptions,
        );
        const assumptions = await assumptionsForMeasuredTier(
          clientId,
          scope.location,
          body.data.serviceLine,
          baseAssumptions,
          body.data.tierPolicy ?? stored.tierPolicy,
          scope.locationNames,
        );
        const { plan, audit } = await calculatePlanDetailed({
          clientId,
          locationId,
          location: scope.location,
          locationNames: scope.locationNames,
          division: body.data.division || null,
          serviceLine: body.data.serviceLine,
          assumptions,
        });
        const buffer = await buildRatePlanWorkbook({ plan, audit, generatedBy });
        const slug = (value: string) =>
          value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "all";
        const filename = `in-house-rate-plan_${slug(scope.location ?? (body.data.division ? `division-${body.data.division}` : "all-campuses"))}_${slug(
          body.data.serviceLine,
        )}_${plan.scope.sourceMonth}.xlsx`;
        ratePlanExportJobs.set(exportId, {
          clientId,
          status: "ready",
          createdAt,
          buffer,
          filename,
        });
      } catch (error) {
        const message =
          error instanceof PlanningDataError
            ? error.message
            : "Failed to build the rate plan export";
        console.error("[inhouse-planning] background export failed:", error);
        ratePlanExportJobs.set(exportId, {
          clientId,
          status: "failed",
          createdAt,
          error: message,
        });
      }
    })();
  });

  app.get("/api/inhouse-planning/export/:exportId", requireAuth, (req: any, res) => {
    purgeExpiredRatePlanExports();
    const clientId = req.clientId || "demo";
    const job = ratePlanExportJobs.get(req.params.exportId);
    if (!job || job.clientId !== clientId) {
      return res.status(404).json({ error: "Export not found or expired" });
    }
    res.setHeader("Cache-Control", "no-store");
    if (job.status === "pending") {
      return res.status(202).json({ status: "pending" });
    }
    if (job.status === "failed") {
      ratePlanExportJobs.delete(req.params.exportId);
      return res.status(422).json({ error: job.error });
    }
    ratePlanExportJobs.delete(req.params.exportId);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${job.filename}"`);
    res.setHeader("Content-Length", String(job.buffer.length));
    return res.end(job.buffer);
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
      const scope = await resolvePlanningScope(clientId, locationId, body.data.division);
      const stored = await resolveAssumptions(
        clientId,
        locationId,
        body.data.serviceLine,
        body.data.division || null,
      );
      const assumptions = await assumptionsForMeasuredTier(
        clientId,
        scope.location,
        body.data.serviceLine,
        enforceCurrentPlanningPolicy(body.data.assumptions),
        body.data.tierPolicy ?? stored.tierPolicy,
        scope.locationNames,
      );

      // Recalculate server-side rather than trusting a posted plan: the client
      // must not be able to apply numbers the solver never produced.
      const plan = await calculatePlanForRoute({
        clientId,
        locationId,
        location: scope.location,
        locationNames: scope.locationNames,
        division: body.data.division || null,
        serviceLine: body.data.serviceLine,
        assumptions,
      });

      // Read-max, supersede and insert must be ONE transaction on ONE
      // connection. Two operators approving at the same moment would otherwise
      // both read the same MAX(version), both mark the other's plan superseded,
      // and leave two rows claiming to be version N. The unique index on
      // (client_id, location, service_line, version) is the backstop.
      const client = await pool.connect();
      let version = 1;
      let planId: string | undefined;
      let replacedImplementedProposal = false;
      const storedPlanLocation = plan.scope.location
        ?? (body.data.division ? `__division__:${body.data.division}` : null);
      try {
        await client.query("BEGIN");
        // Serialize concurrent approvals for this scope behind one advisory
        // lock, so the MAX(version) read below cannot be stale by the time the
        // insert runs.
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `inhouse_rate_plan:${clientId}:${storedPlanLocation ?? ""}:${plan.scope.serviceLine}`,
        ]);
        const versionRow = await client.query<{ next: string }>(
          `SELECT COALESCE(MAX(version), 0) + 1 AS next
             FROM inhouse_rate_plans
            WHERE client_id = $1
              AND service_line = $2
              AND location IS NOT DISTINCT FROM $3`,
          [clientId, plan.scope.serviceLine, storedPlanLocation],
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
             storedPlanLocation,
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
           filters: {
             serviceLine: [plan.scope.serviceLine],
             ...(scope.locationNames ? { location: scope.locationNames } : {}),
           },
          annualPlanId: planId,
          proposalType: "annual_plan_street_rate",
        };
        const specialAction = {
          ...planLink,
          type: "annual_inhouse_plan",
          adjustmentType: "percentage",
          adjustmentValue: plan.summary.weightedAvgIncreasePct,
          filters: {
            serviceLine: [plan.scope.serviceLine],
            ...(scope.locationNames ? { location: scope.locationNames } : {}),
          },
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

      // Reference Data reads from a server-side cache as well as the browser
      // query cache. Bust it after the plan transaction commits so a submitted
      // recommendation is visible immediately instead of waiting for the TTL.
      invalidateRefDataCache();

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

  // ── Edit proposed annual-plan street rate from Reference Data ─────────────
  // This edits the street side of the annual-plan proposal, not a live rate
  // override. The linked proposed rule is kept in sync so publishing the plan
  // later uses the manually revised target.
  app.patch("/api/inhouse-planning/plans/:id/street-rate", requireAuth, async (req: any, res) => {
    const clientId = req.clientId || "demo";
    const planId = String(req.params.id || "");
    const streetRate = Number(req.body?.streetRate);
    if (!Number.isFinite(streetRate) || streetRate <= 0) {
      return res.status(400).json({ error: "streetRate must be a positive number" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const planRes = await client.query<{
        id: string;
        status: string;
        location: string | null;
        service_line: string;
        street_rate_effective_date: string | null;
      }>(
        `SELECT id, status, location, service_line, street_rate_effective_date
           FROM inhouse_rate_plans
          WHERE id = $1 AND client_id = $2
          FOR UPDATE`,
        [planId, clientId],
      );
      const plan = planRes.rows[0];
      if (!plan) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "proposed") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Only proposed annual plans can be edited" });
      }

      const currentRes = await client.query<{ current_rate: string | null }>(
        `SELECT AVG(rr.street_rate)::text AS current_rate
           FROM rent_roll_data rr
           LEFT JOIN locations loc
             ON loc.client_id = rr.client_id AND loc.name = rr.location
          WHERE rr.client_id = $1
            AND rr.upload_month = (
              SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1
            )
            AND rr.service_line = $2
            AND rr.street_rate > 0
            AND (
              $3::text IS NULL
              OR $3 = rr.location
              OR (
                $3 LIKE '__division__:%'
                AND loc.division = substring($3 from 14)
              )
            )`,
        [clientId, plan.service_line, plan.location],
      );
      const currentRate = Number(currentRes.rows[0]?.current_rate);
      if (!Number.isFinite(currentRate) || currentRate <= 0) {
        await client.query("ROLLBACK");
        return res.status(422).json({ error: "No current street rate is available for this plan scope" });
      }
      const increasePct = ((streetRate - currentRate) / currentRate) * 100;

      await client.query(
        `UPDATE inhouse_rate_plans
            SET recommended_street_rate = $1
          WHERE id = $2 AND client_id = $3`,
        [streetRate, planId, clientId],
      );
      await client.query(
        `UPDATE adjustment_rules
            SET action = jsonb_set(action, '{adjustmentValue}', to_jsonb($1::numeric), true),
                description = $2,
                updated_at = now()
          WHERE client_id = $3
            AND action->>'annualPlanId' = $4
            AND action->>'proposalType' = 'annual_plan_street_rate'`,
        [
          increasePct,
          `${increasePct.toFixed(2)}% street-rate increase proposed by annual plan`,
          clientId,
          planId,
        ],
      );
      await client.query("COMMIT");

      invalidateRefDataCache();
      const { purgeRuleCaches } = await import("../routes");
      await purgeRuleCaches(clientId);
      return res.json({
        ok: true,
        planId,
        streetRate,
        currentRate,
        increasePct,
        effectiveDate: plan.street_rate_effective_date,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[inhouse-planning] street-rate edit failed:", error);
      return res.status(500).json({ error: "Failed to update the annual plan street rate" });
    } finally {
      client.release();
    }
  });

  // Edit the resident-level in-house allocation for one Reference Data
  // campus/service-line/room-type proposal. Unlike a manual rate override this
  // stays inside the annual plan snapshot and updates the linked proposal.
  app.patch("/api/inhouse-planning/plans/:id/inhouse-rate", requireAuth, async (req: any, res) => {
    const clientId = req.clientId || "demo";
    const planId = String(req.params.id || "");
    const increasePct = Number(req.body?.increasePct);
    const campus = String(req.body?.campus || "").trim();
    const serviceLine = String(req.body?.serviceLine || "").trim();
    const roomType = String(req.body?.roomType || "").trim();
    const sourceRoomType = String(req.body?.sourceRoomType || "").trim();
    if (!Number.isFinite(increasePct) || increasePct <= -100) {
      return res.status(400).json({ error: "increasePct must be greater than -100" });
    }
    if (!campus || !serviceLine || (!roomType && !sourceRoomType)) {
      return res.status(400).json({ error: "campus, serviceLine, and roomType are required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const planRes = await client.query<{
        id: string;
        status: string;
        service_line: string;
        residents: unknown;
        summary: unknown;
      }>(
        `SELECT id, status, service_line, residents, summary
           FROM inhouse_rate_plans
          WHERE id = $1 AND client_id = $2
          FOR UPDATE`,
        [planId, clientId],
      );
      const plan = planRes.rows[0];
      if (!plan) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Plan not found" });
      }
      if (plan.status !== "proposed") {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Only proposed annual plans can be edited" });
      }
      if (plan.service_line !== serviceLine) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "The selected service line is outside this annual plan" });
      }

      const residents = Array.isArray(plan.residents)
        ? plan.residents.map((resident: any) => ({ ...resident }))
        : [];
      const matches = residents.filter((resident: any) =>
        resident.location === campus
        && (
          !roomType
          || resident.roomType === roomType
          || (sourceRoomType && resident.roomType === sourceRoomType)
        ),
      );
      if (matches.length === 0) {
        await client.query("ROLLBACK");
        return res.status(422).json({ error: "No annual-plan residents match this Reference Data row" });
      }

      const factor = 1 + increasePct / 100;
      let updated = 0;
      for (const resident of matches) {
        const currentMonthly = Number(resident.currentRateMonthly);
        const currentDisplay = Number(resident.currentRateDisplay);
        if (!Number.isFinite(currentMonthly) || currentMonthly <= 0 ||
            !Number.isFinite(currentDisplay) || currentDisplay <= 0) {
          continue;
        }
        const newMonthly = currentMonthly * factor;
        const newDisplay = currentDisplay * factor;
        resident.increasePct = increasePct;
        resident.increaseDollarsMonthly = newMonthly - currentMonthly;
        resident.newRateMonthly = newMonthly;
        resident.newRateDisplay = newDisplay;
        resident.increaseDollarsDisplay = newDisplay - currentDisplay;
        resident.newGapToStreetPct = Number(resident.streetRateMonthly) > 0
          ? (Number(resident.streetRateMonthly) / newMonthly - 1) * 100
          : 0;
        resident.constraint = "none";
        updated++;
      }
      if (updated === 0) {
        await client.query("ROLLBACK");
        return res.status(422).json({ error: "The matched annual-plan residents have no usable current rates" });
      }

      const summary = typeof plan.summary === "string"
        ? JSON.parse(plan.summary)
        : { ...(plan.summary as Record<string, any> || {}) };
      let currentWeighted = 0;
      let newWeighted = 0;
      let weightTotal = 0;
      let totalMonthly = 0;
      let minPct = Number.POSITIVE_INFINITY;
      let maxPct = Number.NEGATIVE_INFINITY;
      let receiving = 0;
      let atMin = 0;
      let atMax = 0;
      let blocked = 0;
      for (const resident of residents) {
        const weight = Number(resident.weight);
        const current = Number(resident.currentRateMonthly);
        const next = Number(resident.newRateMonthly);
        const monthly = Number(resident.increaseDollarsMonthly);
        const pct = Number(resident.increasePct);
        if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(current) ||
            !Number.isFinite(next) || !Number.isFinite(monthly) || !Number.isFinite(pct)) {
          continue;
        }
        currentWeighted += current * weight;
        newWeighted += next * weight;
        weightTotal += weight;
        totalMonthly += monthly;
        minPct = Math.min(minPct, pct);
        maxPct = Math.max(maxPct, pct);
        if (pct > 1e-9) receiving++;
        if (resident.constraint === "min") atMin++;
        if (resident.constraint === "max") atMax++;
        if (resident.constraint === "street_cap" || resident.constraint === "at_or_above_street") blocked++;
      }
      const currentAvg = weightTotal > 0
        ? currentWeighted / weightTotal
        : Number(summary.currentAvgInhouseRateMonthly) || 0;
      summary.residentCount = residents.length;
      summary.residentsReceivingIncrease = receiving;
      summary.residentsAtMin = atMin;
      summary.residentsAtMax = atMax;
      summary.residentsBlockedByStreet = blocked;
      summary.weightedAvgIncreasePct = currentWeighted > 0
        ? (newWeighted / currentWeighted - 1) * 100
        : 0;
      summary.minIncreasePct = Number.isFinite(minPct) ? minPct : 0;
      summary.maxIncreasePct = Number.isFinite(maxPct) ? maxPct : 0;
      summary.totalMonthlyIncreaseDollars = totalMonthly;
      summary.totalAnnualIncreaseDollars = totalMonthly * 12;
      summary.currentAvgInhouseRateMonthly = currentAvg;
      summary.newAvgInhouseRateMonthly = weightTotal > 0 ? newWeighted / weightTotal : currentAvg;

      await client.query(
        `UPDATE inhouse_rate_plans
            SET residents = $1, summary = $2
          WHERE id = $3 AND client_id = $4`,
        [JSON.stringify(residents), JSON.stringify(summary), planId, clientId],
      );
      await client.query(
        `UPDATE adjustment_rules
            SET action = jsonb_set(
              jsonb_set(action, '{adjustmentValue}', to_jsonb($1::numeric), true),
              '{weightedAvgIncreasePct}', to_jsonb($1::numeric), true
            ),
                description = $2,
                updated_at = now()
          WHERE client_id = $3
            AND action->>'annualPlanId' = $4
            AND action->>'proposalType' = 'inhouse_rate_plan'`,
        [
          summary.weightedAvgIncreasePct,
          `${Number(summary.weightedAvgIncreasePct).toFixed(2)}% weighted in-house increase proposed by annual plan`,
          clientId,
          planId,
        ],
      );
      await client.query("COMMIT");

      invalidateRefDataCache();
      const { purgeRuleCaches } = await import("../routes");
      await purgeRuleCaches(clientId);
      return res.json({
        ok: true,
        planId,
        increasePct,
        matchedResidents: updated,
        summary,
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[inhouse-planning] in-house rate edit failed:", error);
      return res.status(500).json({ error: "Failed to update the annual plan in-house rate" });
    } finally {
      client.release();
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
      const division = (req.query.division as string) || null;
      const location = await resolveLocationName(clientId, locationId);

      const conditions = [eq(inhouseRatePlans.clientId, clientId)];
      if (serviceLine) conditions.push(eq(inhouseRatePlans.serviceLine, serviceLine));
      if (location) {
        conditions.push(eq(inhouseRatePlans.location, location));
      } else if (division) {
        conditions.push(or(
          eq(inhouseRatePlans.location, `__division__:${division}`),
          sql`${inhouseRatePlans.location} NOT LIKE '__division__:%'`,
        )!);
      } else {
        conditions.push(sql`${inhouseRatePlans.location} NOT LIKE '__division__:%'`);
      }

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

      const activeDivisionLines = division && !location
        ? new Set(
            rows
              .filter(
                (row) =>
                  row.location === `__division__:${division}` &&
                  ["proposed", "applied", "published"].includes(row.status),
              )
              .map((row) => row.serviceLine),
          )
        : new Set<string>();
      const visibleRows = division && !location
        ? rows.filter(
            (row) =>
              row.location?.startsWith(`__division__:${division}`) ||
              !activeDivisionLines.has(row.serviceLine),
          )
        : rows;
      const plans: InhousePlanHistoryEntry[] = visibleRows.map((row) => ({
        ...row,
        location: row.location?.startsWith("__division__:") ? null : row.location,
        inheritedFromPortfolio:
          Boolean(division && !location && !row.location?.startsWith("__division__:")),
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
