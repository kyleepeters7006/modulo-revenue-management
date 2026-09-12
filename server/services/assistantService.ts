import { z } from "zod";
import { anthropicClient } from "../aiRouter";
import { pool } from "../db";
import { privatePaySql } from "@shared/payerScope";
import { MOVE_IN_OUT_ACTIVE_VIEW } from "./moveInOutEventsView";
import { getElasticityMap } from "./elasticityService";
import { getIndustryContext } from "./industryContext";
import { getStreetRateQualityReport } from "./streetRateQualityService";
import { buildRuleSuggestionContext } from "./ruleSuggestionContext";

export const ASSISTANT_MODEL = "claude-opus-4-6";
export const ASSISTANT_MAX_ROUNDS = 6;
export const ASSISTANT_MAX_MESSAGES = 20;
export const ASSISTANT_MAX_MESSAGE_LENGTH = 8_000;
export const ASSISTANT_MAX_HISTORY_LENGTH = 24_000;
export const ASSISTANT_TIMEOUT_MS = 30_000;

export type AssistantMessage = { role: "user" | "assistant"; content: string };
export type AssistantSource = { tool: string; label: string; detail?: string };
export type AssistantContext = { clientId: string; userId: string };

const requestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(ASSISTANT_MAX_MESSAGE_LENGTH),
  }).strict()).min(1).max(ASSISTANT_MAX_MESSAGES),
  pageContext: z.object({ path: z.string().trim().min(1).max(512) }).strict().optional(),
}).strict();

export function parseAssistantRequest(body: unknown): {
  messages: AssistantMessage[];
  pageContext?: { path: string };
} {
  const parsed = requestSchema.parse(body);
  const total = parsed.messages.reduce((sum, message) => sum + message.content.length, 0);
  if (total > ASSISTANT_MAX_HISTORY_LENGTH) {
    throw new AssistantInputError("Message history is too long. Start a new conversation.");
  }
  return parsed;
}

export class AssistantInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantInputError";
  }
}

export class AssistantUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssistantUnavailableError";
  }
}

export class AssistantTimeoutError extends Error {
  constructor() {
    super("The assistant took too long to answer. Please try again.");
    this.name = "AssistantTimeoutError";
  }
}

/**
 * A deliberately small in-process limiter. The route is also protected by
 * infrastructure rate limits in production; this defense remains useful in a
 * single process and, importantly, applies independently to IP and account.
 */
export class AssistantRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  constructor(
    private readonly limit = 12,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): boolean {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.buckets.get(key) || []).filter((time) => time > cutoff);
    if (recent.length >= this.limit) {
      this.buckets.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.buckets.set(key, recent);
    return true;
  }
}

export const assistantRateLimiter = new AssistantRateLimiter();

const locationArg = z.string().trim().min(1).max(160);
const serviceLineArg = z.string().trim().min(1).max(40);
const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const domainArgs = z.object({
  location: locationArg.optional(),
  serviceLine: serviceLineArg.optional(),
  dateFrom: dateArg,
  dateTo: dateArg,
  limit: z.number().int().min(1).max(100).optional(),
}).strict();
const toolArgSchemas: Record<string, z.ZodTypeAny> = {
  portfolio_snapshot: z.object({}).strict(),
  occupancy: z.object({ location: locationArg.optional(), serviceLine: serviceLineArg.optional() }).strict(),
  rates: z.object({ location: locationArg.optional(), serviceLine: serviceLineArg.optional() }).strict(),
  competitors: z.object({ location: locationArg.optional(), serviceLine: serviceLineArg.optional() }).strict(),
  demand: z.object({ location: locationArg.optional(), serviceLine: serviceLineArg.optional() }).strict(),
  adjustment_rules: z.object({}).strict(),
  inhouse_plans: z.object({}).strict(),
  locations: z.object({}).strict(),
  recent_account_activity: z.object({}).strict(),
  recent_rule_suggestions: z.object({}).strict(),
  data_catalog: z.object({}).strict(),
  canonical_metrics: z.object({ location: locationArg.optional(), serviceLine: serviceLineArg.optional() }).strict(),
  revenue_summary: domainArgs,
  targets_trends: domainArgs,
  move_ins_outs: domainArgs,
  rate_quality: z.object({}).strict(),
  elasticity: z.object({ location: locationArg.optional(), serviceLine: serviceLineArg.optional() }).strict(),
  industry_benchmarks: z.object({}).strict(),
  rule_performance: z.object({}).strict(),
};

export const ASSISTANT_TOOLS = [
  {
    name: "portfolio_snapshot",
    description: "Read a bounded, tenant-scoped portfolio snapshot of current units, occupancy, and rates.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "occupancy",
    description: "Read current tenant-scoped occupancy by campus and service line. Optional filters narrow results.",
    input_schema: {
      type: "object",
      properties: { location: { type: "string" }, serviceLine: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "rates",
    description: "Read current tenant-scoped street and in-house rate aggregates, without resident details.",
    input_schema: {
      type: "object",
      properties: { location: { type: "string" }, serviceLine: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "competitors",
    description: "Read bounded current competitor rate summaries for this tenant.",
    input_schema: {
      type: "object",
      properties: { location: { type: "string" }, serviceLine: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "demand",
    description: "Read bounded inquiry, tour, and conversion (move-in) aggregates. No prospect names or notes.",
    input_schema: {
      type: "object",
      properties: { location: { type: "string" }, serviceLine: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "adjustment_rules",
    description: "Read active adjustment rule summaries and scopes for this tenant; notes and raw rule payloads are omitted.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "inhouse_plans",
    description: "Read recent in-house planning assumptions and plan summaries for this tenant.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "locations",
    description: "Read the tenant's portfolio locations and high-level metadata.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "recent_account_activity",
    description: "Read recent account activity event types and timestamps for this tenant, without metadata or personal data.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "recent_rule_suggestions",
    description: "Read the latest cached tenant rule-suggestion run as a safe projection, plus recent accepted, edited, and denied decisions. Cached suggestions may be removed after decisions.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "data_catalog",
    description: "Describe the safe embedded data domains, source systems, metric basis, freshness, and completeness available to this tenant.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "canonical_metrics",
    description: "Read canonical current occupancy and reference metrics by campus and service line; occupancy uses the authoritative active history when available.",
    input_schema: { type: "object", properties: { location: { type: "string" }, serviceLine: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "revenue_summary",
    description: "Read bounded revenue and RevPOR rate aggregates with daily/monthly normalization and an explicit private-pay basis.",
    input_schema: { type: "object", properties: { location: { type: "string" }, serviceLine: { type: "string" }, dateFrom: { type: "string" }, dateTo: { type: "string" }, limit: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "targets_trends",
    description: "Read current planning targets and bounded monthly rate trends; target and measured trend are labeled separately.",
    input_schema: { type: "object", properties: { location: { type: "string" }, serviceLine: { type: "string" }, dateFrom: { type: "string" }, dateTo: { type: "string" }, limit: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "move_ins_outs",
    description: "Read bounded move-in and move-out counts from the canonical active event view, without resident details.",
    input_schema: { type: "object", properties: { location: { type: "string" }, serviceLine: { type: "string" }, dateFrom: { type: "string" }, dateTo: { type: "string" }, limit: { type: "integer" } }, additionalProperties: false },
  },
  {
    name: "rate_quality",
    description: "Read safe aggregate street-rate quality and completeness diagnostics for the latest tenant month.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "elasticity",
    description: "Read measured price-elasticity summaries and confidence by segment; unavailable measurements remain unavailable.",
    input_schema: { type: "object", properties: { location: { type: "string" }, serviceLine: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "industry_benchmarks",
    description: "Read reviewed or live industry context with source and as-of metadata; these are context, not portfolio targets.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "rule_performance",
    description: "Read current pricing-rule status, execution counts, and stored impact aggregates without raw rule payloads or notes.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

type QueryResult = { rows: any[] };

async function boundedQuery(text: string, params: unknown[], signal?: AbortSignal): Promise<QueryResult> {
  if (signal?.aborted) throw new AssistantTimeoutError();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const query = pool.query(text, params);
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new AssistantTimeoutError()), ASSISTANT_TIMEOUT_MS);
    onAbort = () => reject(new AssistantTimeoutError());
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([query, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

function optionalFilters(args: { location?: string; serviceLine?: string }, start = 2): {
  sql: string;
  values: string[];
} {
  const clauses: string[] = [];
  const values: string[] = [];
  if (args.location) {
    values.push(args.location);
    clauses.push(`location = $${start + values.length - 1}`);
  }
  if (args.serviceLine) {
    values.push(args.serviceLine);
    clauses.push(`service_line = $${start + values.length - 1}`);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

function boundedLimit(value: unknown, fallback = 100): number {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(1, Math.min(100, n)) : fallback;
}

function resultMeta(asOf: unknown, source: string, returned: number, truncated = false) {
  return {
    asOf: asOf || null,
    source,
    freshness: asOf ? "latest available source period" : "unavailable",
    completeness: truncated ? "truncated at the safe row limit" : "complete within the requested safe scope",
    returnedRows: returned,
    truncated,
  };
}

function projectSuggestion(value: any): unknown {
  const serviceLines = Array.isArray(value?.serviceLines)
    ? value.serviceLines.filter((s: unknown) => typeof s === "string").slice(0, 20)
    : String(value?.serviceLine || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  const campuses = Array.isArray(value?.affectedCampuses) ? value.affectedCampuses : [];
  return {
    name: typeof value?.name === "string" ? value.name.slice(0, 200) : null,
    intent: typeof value?.intent === "string" ? value.intent.slice(0, 500) : null,
    description: typeof value?.description === "string"
      ? value.description.slice(0, 500)
      : typeof value?.ruleDetail === "string" ? value.ruleDetail.slice(0, 500) : null,
    serviceLines,
    impacts: {
      unitsImpacted: Number.isFinite(Number(value?.unitsImpacted)) ? Number(value.unitsImpacted) : null,
      monthlyImpact: Number.isFinite(Number(value?.monthlyImpact)) ? Number(value.monthlyImpact) : null,
      annualImpact: Number.isFinite(Number(value?.annualImpact)) ? Number(value.annualImpact) : null,
    },
    affectedCampusCount: campuses.length || (Number.isFinite(Number(value?.affectedCampuses)) ? Number(value.affectedCampuses) : null),
  };
}

/**
 * Tool execution is intentionally a closed switch. There is no model-provided
 * SQL, code, URL, table, column, or operation to interpret.
 */
export async function executeAssistantTool(
  tool: string,
  rawInput: unknown,
  context: AssistantContext,
  signal?: AbortSignal,
): Promise<{ data: unknown; source: AssistantSource }> {
  const schema = toolArgSchemas[tool];
  if (!schema) throw new AssistantInputError(`Tool "${tool}" is not available.`);
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) throw new AssistantInputError(`Invalid arguments for tool "${tool}".`);
  const args = parsed.data as { location?: string; serviceLine?: string };
  const { clientId } = context;
  let rows: any[] = [];

  switch (tool) {
    case "portfolio_snapshot":
      rows = (await boundedQuery(
        `SELECT COUNT(*)::int AS total_units,
                COUNT(*) FILTER (WHERE occupied_yn = true)::int AS occupied_units,
                COALESCE(AVG(street_rate), 0)::numeric AS avg_street_rate,
                COALESCE(AVG(in_house_rate) FILTER (WHERE occupied_yn = true), 0)::numeric AS avg_in_house_rate,
                MAX(upload_month) AS data_month
           FROM rent_roll_data
          WHERE client_id = $1
            AND upload_month = (SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1)
          LIMIT 1`,
        [clientId],
        signal,
      )).rows;
      return {
        data: {
          snapshot: rows[0] || null,
          meta: resultMeta(rows[0]?.data_month, "current tenant rent roll", rows.length),
        },
        source: { tool, label: "Current rent roll snapshot", detail: "Latest tenant upload month; resident fields excluded" },
      };
    case "occupancy": {
      const filters = optionalFilters(args);
      rows = (await boundedQuery(
        `SELECT location AS location, service_line AS service_line,
                COUNT(*)::int AS total_units,
                COUNT(*) FILTER (WHERE occupied_yn = true)::int AS occupied_units,
                MAX(upload_month) AS data_month
           FROM rent_roll_data
          WHERE client_id = $1
            AND upload_month = (SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1)
            ${filters.sql}
          GROUP BY location, service_line
          ORDER BY location, service_line
          LIMIT 100`,
        [clientId, ...filters.values],
        signal,
      )).rows;
      return { data: { rows, meta: resultMeta(rows[0]?.data_month, "current tenant rent roll", rows.length, rows.length >= 100) }, source: { tool, label: "Current occupancy by campus and service line" } };
    }
    case "rates": {
      const filters = optionalFilters(args);
      rows = (await boundedQuery(
        `SELECT location, service_line,
                COUNT(*)::int AS unit_count,
                ROUND(AVG(street_rate)::numeric, 2) AS avg_street_rate,
                ROUND(AVG(in_house_rate) FILTER (WHERE occupied_yn = true)::numeric, 2) AS avg_in_house_rate,
                MAX(upload_month) AS data_month
           FROM rent_roll_data
          WHERE client_id = $1
            AND upload_month = (SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1)
            ${filters.sql}
          GROUP BY location, service_line
          ORDER BY location, service_line
          LIMIT 100`,
        [clientId, ...filters.values],
        signal,
      )).rows;
      return { data: { rows, basis: "Street rates are reported on their stored daily/monthly basis; no payer conversion is implied.", meta: resultMeta(rows[0]?.data_month, "current tenant rent roll", rows.length, rows.length >= 100) }, source: { tool, label: "Current street and in-house rate aggregates" } };
    }
    case "competitors": {
      const clauses: string[] = [];
      const values: string[] = [];
      if (args.location) {
        values.push(args.location);
        clauses.push(`keystats_location = $${values.length + 1}`);
      }
      if (args.serviceLine) {
        values.push(args.serviceLine);
        clauses.push(`competitor_type = $${values.length + 1}`);
      }
      const filters = { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
      // The competitive survey is the live source used by the application.
      // Addresses, incentives, amenities, and notes are intentionally omitted.
      rows = (await boundedQuery(
        `SELECT keystats_location AS location,
                competitor_name,
                competitor_type,
                room_type,
                survey_month,
                ROUND(AVG(monthly_rate_avg)::numeric, 2) AS avg_monthly_rate,
                ROUND(AVG(total_monthly_avg)::numeric, 2) AS avg_total_monthly_rate,
                COUNT(*)::int AS observations
           FROM competitive_survey_data
          WHERE client_id = $1
            AND survey_month = (
              SELECT MAX(survey_month)
                FROM competitive_survey_data
               WHERE client_id = $1
            )
            ${filters.sql}
          GROUP BY keystats_location, competitor_name, competitor_type, room_type, survey_month
          ORDER BY keystats_location, competitor_name, competitor_type, room_type
          LIMIT 100`,
        [clientId, ...filters.values],
        signal,
      )).rows;
      return {
        data: {
          rows,
          basis: "Surveyed competitor rates as entered for the latest survey month. This tool does not calculate a premium; use the care-adjusted benchmark shown by the pricing screens for like-for-like comparisons.",
          meta: resultMeta(rows[0]?.survey_month, "competitive survey", rows.length, rows.length >= 100),
        },
        source: { tool, label: "Current competitive survey rates", detail: "Latest tenant survey month; addresses, incentives, amenities, and notes omitted" },
      };
    }
    case "demand": {
      const filters = optionalFilters({ location: args.location, serviceLine: args.serviceLine });
      rows = (await boundedQuery(
        `SELECT location, service_line,
                COALESCE(SUM(inquiry_count), 0)::int AS inquiries,
                COALESCE(SUM(tour_count), 0)::int AS tours,
                COALESCE(SUM(conversion_count), 0)::int AS move_ins,
                MAX(upload_month) AS latest_month
           FROM inquiry_metrics
          WHERE client_id = $1
            AND date >= (CURRENT_DATE - interval '24 months')::text
            ${filters.sql}
          GROUP BY location, service_line
          ORDER BY location, service_line
          LIMIT 100`,
        [clientId, ...filters.values],
        signal,
      )).rows;
      return { data: { rows, meta: resultMeta(rows[0]?.latest_month, "tenant inquiry aggregates", rows.length, rows.length >= 100) }, source: { tool, label: "Inquiry, tour, and move-in aggregates", detail: "Trailing 24 months; prospect names and notes excluded" } };
    }
    case "adjustment_rules":
      rows = (await boundedQuery(
        `SELECT name, description, location_id, service_line, service_lines,
                is_active, lifecycle_status, effective_date, priority
           FROM adjustment_rules
          WHERE client_id = $1
            AND is_historical IS NOT TRUE
          ORDER BY priority DESC NULLS LAST, updated_at DESC NULLS LAST
          LIMIT 100`,
        [clientId],
        signal,
      )).rows;
      return { data: { rows, meta: resultMeta(null, "current tenant pricing configuration", rows.length, rows.length >= 100) }, source: { tool, label: "Current adjustment rules", detail: "Historical rows and free-form notes omitted" } };
    case "inhouse_plans": {
      rows = (await boundedQuery(
        `SELECT id, location_id, location, service_line, version, status,
                summary, street_rate_effective_date, inhouse_effective_date, created_at
           FROM inhouse_rate_plans
          WHERE client_id = $1
            AND created_at >= now() - interval '24 months'
          ORDER BY created_at DESC
          LIMIT 50`,
        [clientId],
        signal,
      )).rows;
      const assumptions = (await boundedQuery(
        `SELECT location_id, service_line, rate_growth_target_pct,
                measurement_mode, street_rate_effective_date, inhouse_effective_date,
                annual_turnover_pct, min_inhouse_increase_pct, max_inhouse_increase_pct,
                equalization_strength, max_street_increase_pct, min_street_increase_pct,
                desired_variance_to_top_competitor_pct, max_yoy_street_increase_pct,
                updated_at
           FROM inhouse_planning_assumptions
          WHERE client_id = $1
            AND updated_at >= now() - interval '24 months'
          ORDER BY updated_at DESC
          LIMIT 100`,
        [clientId],
        signal,
      )).rows;
      return {
        data: { plans: rows, assumptions, meta: resultMeta(rows[0]?.created_at || assumptions[0]?.updated_at, "tenant planning data", rows.length + assumptions.length, rows.length >= 50 || assumptions.length >= 100) },
        source: { tool, label: "In-house rate plans and assumptions", detail: "Trailing 24 months; resident allocations and raw notes omitted" },
      };
    }
    case "locations":
      rows = (await boundedQuery(
        `SELECT id, name, region, division, location_class, city, state, total_units, same_store
           FROM locations
          WHERE client_id = $1
          ORDER BY name
          LIMIT 100`,
        [clientId],
        signal,
      )).rows;
      return { data: { rows, meta: resultMeta(null, "tenant portfolio locations", rows.length, rows.length >= 100) }, source: { tool, label: "Portfolio locations" } };
    case "recent_account_activity":
      rows = (await boundedQuery(
        `SELECT event_type, success, created_at
           FROM security_audit_events
          WHERE client_id = $1
            AND created_at >= now() - interval '90 days'
          ORDER BY created_at DESC
          LIMIT 100`,
        [clientId],
        signal,
      )).rows;
      return { data: { rows, meta: resultMeta(rows[0]?.created_at, "tenant account activity", rows.length, rows.length >= 100) }, source: { tool, label: "Recent account activity", detail: "Last 90 days; event metadata omitted" } };
    case "recent_rule_suggestions": {
      const [runRes, feedbackRes] = await Promise.all([
        boundedQuery(
          `SELECT payload, created_at
             FROM ai_suggestion_runs
            WHERE client_id = $1
            ORDER BY created_at DESC
            LIMIT 1`,
          [clientId],
          signal,
        ),
        boundedQuery(
          `SELECT verdict, name, description, service_line, created_at
             FROM ai_suggestion_feedback
            WHERE client_id = $1
            ORDER BY created_at DESC
            LIMIT 20`,
          [clientId],
          signal,
        ),
      ]);
      const run = runRes.rows[0];
      let stored: any = {};
      if (run) {
        try {
          stored = typeof run.payload === "string" ? JSON.parse(run.payload) : (run.payload || {});
        } catch {
          stored = {};
        }
      }
      const contextBlock = stored.context || {};
      const diagnostics = stored.diagnostics || {};
      return {
        data: {
          cachedRun: run ? {
            generatedAt: run.created_at,
            scope: contextBlock.campus || contextBlock.scope || "All campuses",
            reason: contextBlock.reasonMessage || null,
            diagnostics: {
              drafted: Number(diagnostics.drafted) || 0,
              shown: Number(diagnostics.shown) || 0,
              dropped: Number(diagnostics.dropped) || 0,
              summary: typeof diagnostics.summary === "string" ? diagnostics.summary : null,
            },
            suggestions: Array.isArray(stored.suggestions)
              ? stored.suggestions.slice(0, 10).map(projectSuggestion)
              : [],
          } : null,
          recentDecisions: feedbackRes.rows.map((row: any) => ({
            verdict: row.verdict,
            name: typeof row.name === "string" ? row.name.slice(0, 200) : null,
            description: typeof row.description === "string" ? row.description.slice(0, 400) : null,
            serviceLine: typeof row.service_line === "string" ? row.service_line.slice(0, 100) : null,
            decidedAt: row.created_at,
          })),
          semantics: "This is the most recent cached suggestion run, not a live re-analysis. Accepted, edited, or denied cards may be removed from the current cached list; decisions remain in the recent decision history.",
        },
        source: { tool, label: "Recent cached rule suggestions and decisions", detail: "Tenant-scoped safe projection; prompts, raw payloads, implementation details, and internal IDs omitted" },
      };
    }
    case "data_catalog": {
      const latest = (await boundedQuery(
        `SELECT
           (SELECT MAX(upload_month) FROM rent_roll_data WHERE client_id = $1) AS rent_roll_month,
           (SELECT MAX(survey_month) FROM competitive_survey_data WHERE client_id = $1) AS survey_month,
           (SELECT MAX(event_date) FROM ${MOVE_IN_OUT_ACTIVE_VIEW} WHERE client_id = $1) AS event_date`,
        [clientId],
        signal,
      )).rows[0] || {};
      return {
        data: {
          domains: [
            { name: "canonical portfolio/reference metrics", tool: "canonical_metrics", source: "room_type_occupancy_history and tenant rent roll", asOf: latest.rent_roll_month || null },
            { name: "revenue and RevPOR", tool: "revenue_summary", source: "tenant rent roll; private-pay basis; daily rates normalized monthly", asOf: latest.rent_roll_month || null },
            { name: "current portfolio snapshot and occupancy", tool: "portfolio_snapshot", source: "tenant rent roll", asOf: latest.rent_roll_month || null },
            { name: "competitor rates", tool: "competitors", source: "competitive survey", asOf: latest.survey_month || null },
            { name: "demand funnel", tool: "demand", source: "tenant inquiry and tour aggregates", asOf: latest.rent_roll_month || null },
            { name: "targets and trends", tool: "targets_trends", source: "planning assumptions and tenant rent roll history", asOf: latest.rent_roll_month || null },
            { name: "move-ins and move-outs", tool: "move_ins_outs", source: "canonical active move-in/out event feed", asOf: latest.event_date || null },
            { name: "rate quality", tool: "rate_quality", source: "rate-quality and completeness checks", asOf: latest.rent_roll_month || null },
            { name: "elasticity", tool: "elasticity", source: "tenant elasticity metrics", asOf: null },
            { name: "industry benchmarks/context", tool: "industry_benchmarks", source: "reviewed/live industry context", asOf: null },
            { name: "pricing/rule performance", tool: "rule_performance", source: "tenant adjustment rules", asOf: null },
            { name: "current adjustment rules", tool: "adjustment_rules", source: "tenant pricing configuration", asOf: null },
            { name: "AI rule suggestions", tool: "recent_rule_suggestions", source: "tenant cached suggestion run and feedback", asOf: null },
          ],
          policy: "Read-only, tenant-scoped aggregates only. Resident/prospect PII, raw notes, uploads, prompts, and raw JSON payloads are unavailable.",
          completeness: "Catalog lists supported safe domains; each domain response reports its own source period and truncation status.",
        },
        source: { tool, label: "Safe assistant data catalog", detail: "Tenant source periods are reported without exposing source records" },
      };
    }
    case "canonical_metrics": {
      const filters = optionalFilters(args);
      rows = (await boundedQuery(
        `WITH latest AS (
           SELECT MAX(year * 100 + month) AS ym FROM room_type_occupancy_history WHERE client_id = $1
         )
         SELECT location_name AS location, service_line,
                SUM(occ_units)::int AS occupied_units,
                SUM(available_units)::int AS available_units,
                ROUND((SUM(occ_units) * 100.0 / NULLIF(SUM(available_units), 0))::numeric, 1) AS occupancy_percent,
                MAX(year * 100 + month) AS as_of_month
           FROM room_type_occupancy_history
          WHERE client_id = $1
            AND (year * 100 + month) = (SELECT ym FROM latest)
            ${filters.sql.replaceAll("location", "location_name")}
          GROUP BY location_name, service_line
          ORDER BY location_name, service_line
          LIMIT 100`,
        [clientId, ...filters.values],
        signal,
      )).rows;
      return { data: { rows, basis: "Canonical room-type occupancy history; occupied / available weighted by units.", meta: resultMeta(rows[0]?.as_of_month, "room_type_occupancy_history", rows.length, rows.length >= 100) }, source: { tool, label: "Canonical occupancy and reference metrics" } };
    }
    case "revenue_summary": {
      const a: any = args;
      const filters = optionalFilters(a, 4);
      const from = a.dateFrom || "1900-01";
      const to = a.dateTo || "9999-12";
      rows = (await boundedQuery(
        `SELECT location, service_line, upload_month AS month,
                COUNT(*)::int AS unit_count,
                COUNT(*) FILTER (WHERE occupied_yn)::int AS occupied_units,
                ROUND(AVG(CASE WHEN service_line IN ('HC','HC/MC') THEN street_rate * 30 ELSE street_rate END)::numeric, 2) AS avg_monthly_street_rate,
                ROUND(AVG(CASE WHEN occupied_yn AND ${privatePaySql("payor_type")} THEN CASE WHEN service_line IN ('HC','HC/MC') THEN in_house_rate * 30 ELSE in_house_rate END END)::numeric, 2) AS avg_private_pay_inhouse_rate,
                ROUND(SUM(CASE WHEN occupied_yn AND ${privatePaySql("payor_type")} THEN CASE WHEN service_line IN ('HC','HC/MC') THEN in_house_rate * 30 ELSE in_house_rate END ELSE 0 END)::numeric / NULLIF(COUNT(*) FILTER (WHERE occupied_yn AND ${privatePaySql("payor_type")}), 0), 2) AS revpor_private_pay
           FROM rent_roll_data
          WHERE client_id = $1 AND upload_month >= $2 AND upload_month <= $3 ${filters.sql}
          GROUP BY location, service_line, upload_month
          ORDER BY upload_month DESC, location, service_line
          LIMIT ${boundedLimit(a.limit)}`,
        [clientId, from, to, ...filters.values],
        signal,
      )).rows;
      return { data: { rows, basis: "Private-pay occupied units for RevPOR; HC/HC-MC daily rates normalized using 30 days per month.", meta: resultMeta(rows[0]?.month, "rent_roll_data", rows.length, rows.length >= boundedLimit(a.limit)) }, source: { tool, label: "Revenue and RevPOR summaries" } };
    }
    case "targets_trends": {
      const a: any = args;
      const filters = optionalFilters(a);
      rows = (await boundedQuery(
        `SELECT service_line, rate_growth_target_pct, measurement_mode,
                street_rate_effective_date, inhouse_effective_date, updated_at
           FROM inhouse_planning_assumptions
          WHERE client_id = $1
          ORDER BY updated_at DESC
          LIMIT 100`,
        [clientId],
        signal,
      )).rows;
      const trends = (await boundedQuery(
        `SELECT location, service_line, upload_month AS month,
                ROUND(AVG(CASE WHEN service_line IN ('HC','HC/MC') THEN street_rate * 30 ELSE street_rate END)::numeric, 2) AS measured_avg_monthly_street_rate
           FROM rent_roll_data
          WHERE client_id = $1 ${filters.sql}
          GROUP BY location, service_line, upload_month
          ORDER BY upload_month DESC
          LIMIT ${boundedLimit(a.limit)}`,
        [clientId, ...filters.values],
        signal,
      )).rows;
      return { data: { targets: rows, measuredTrends: trends, semantics: "Targets are planning assumptions; trends are measured rent-roll averages and are not forecasts.", meta: resultMeta(trends[0]?.month, "inhouse_planning_assumptions and rent_roll_data", trends.length, trends.length >= boundedLimit(a.limit)) }, source: { tool, label: "Current targets and measured rate trends" } };
    }
    case "move_ins_outs": {
      const a: any = args;
      const filters = optionalFilters(a, 4);
      const from = a.dateFrom || "1900-01-01";
      const to = a.dateTo || "9999-12-31";
      rows = (await boundedQuery(
        `SELECT location, service_line, substring(event_date, 1, 7) AS month,
                COUNT(*) FILTER (WHERE event_type = 'move_in')::int AS move_ins,
                COUNT(*) FILTER (WHERE event_type = 'move_out')::int AS move_outs,
                MAX(event_date) AS as_of_date
           FROM ${MOVE_IN_OUT_ACTIVE_VIEW}
          WHERE client_id = $1 AND event_date >= $2 AND event_date <= $3
            AND counted = true ${filters.sql}
          GROUP BY location, service_line, substring(event_date, 1, 7)
          ORDER BY month DESC, location, service_line
          LIMIT ${boundedLimit(a.limit)}`,
        [clientId, from, to, ...filters.values],
        signal,
      )).rows;
      return { data: { rows, basis: "Canonical active move-in/out event feed; counted events only; no resident details.", meta: resultMeta(rows[0]?.as_of_date, "canonical move-in/out event feed", rows.length, rows.length >= boundedLimit(a.limit)) }, source: { tool, label: "Canonical move-in and move-out aggregates" } };
    }
    case "rate_quality": {
      const latest = (await boundedQuery(`SELECT MAX(upload_month) AS month FROM rent_roll_data WHERE client_id = $1`, [clientId], signal)).rows[0]?.month;
      if (!latest) return { data: { month: null, unavailable: true, meta: resultMeta(null, "streetRateQualityService", 0) }, source: { tool, label: "Street-rate quality" } };
      const report: any = await getStreetRateQualityReport(clientId, latest);
      const groups = Array.isArray(report?.campuses) ? report.campuses : [];
      const safeGroups = groups.slice(0, 100).map((g: any) => ({
        location: g.location,
        suspectCount: Number(g.suspectCount) || 0,
        proratedCount: Number(g.proratedCount) || 0,
      }));
      return {
        data: {
          month: latest,
          groups: safeGroups,
          totals: report?.totals ? {
            suspect: Number(report.totals.suspect) || 0,
            proratedMoveIn: Number(report.totals.proratedMoveIn) || 0,
            campusesAffected: Number(report.totals.campusesAffected) || 0,
          } : null,
          excludedFromAggregates: report?.excludedFromAggregates?.totals ? {
            rows: Number(report.excludedFromAggregates.totals.rows) || 0,
            groups: Number(report.excludedFromAggregates.totals.groups) || 0,
            blankedGroups: Number(report.excludedFromAggregates.totals.blankedGroups) || 0,
            campuses: Number(report.excludedFromAggregates.totals.campuses) || 0,
          } : null,
          meta: resultMeta(latest, "rate-quality and completeness checks", safeGroups.length, groups.length > 100),
        },
        source: { tool, label: "Street-rate quality and completeness" },
      };
    }
    case "elasticity": {
      const a: any = args;
      const map = await getElasticityMap(clientId);
      const values = Array.from(map.values()).filter((r: any) => (!a.location || r.locationName === a.location) && (!a.serviceLine || r.serviceLine === a.serviceLine)).slice(0, 100);
      const projected = values.map((r: any) => ({
        location: r.locationName, serviceLine: r.serviceLine, roomType: r.roomType,
        elasticity: r.elasticity, confidence: r.confidence, sampleSize: r.sampleSize,
        daysToSellBefore: r.daysToSellBefore, daysToSellAfter: r.daysToSellAfter,
        rateBefore: r.rateBefore, rateAfter: r.rateAfter,
      }));
      return { data: { rows: projected, basis: "Measured elasticity is percent change in days-to-sell divided by percent change in street rate; confidence and sample size are included.", meta: resultMeta(null, "elasticity_metrics", projected.length, values.length >= 100) }, source: { tool, label: "Measured price elasticity" } };
    }
    case "industry_benchmarks": {
      const contextData: any = await getIndustryContext(clientId);
      const metrics = Array.isArray(contextData?.metrics) ? contextData.metrics.slice(0, 100).map((m: any) => ({
        label: m.label, value: m.value, unit: m.unit, comparison: m.comparison,
        asOf: m.asOf, source: m.sourceName, method: m.method, status: m.status, note: m.note,
      })) : [];
      return { data: { metrics, fetchedAt: contextData?.fetchedAt || null, basis: "Industry context is external benchmark/context, not a portfolio target or measured portfolio result.", meta: resultMeta(contextData?.fetchedAt, "industry context service", metrics.length, Boolean(contextData?.metrics?.length > 100)) }, source: { tool, label: "Industry benchmarks and context" } };
    }
    case "rule_performance":
      rows = (await boundedQuery(
        `SELECT name, description, service_line, is_active, lifecycle_status,
                effective_date, execution_count, monthly_impact, annual_impact
           FROM adjustment_rules
          WHERE (client_id = $1 OR client_id IS NULL)
            AND is_historical IS NOT TRUE
          ORDER BY is_active DESC, effective_date DESC NULLS LAST
          LIMIT 100`,
        [clientId],
        signal,
      )).rows;
      return { data: { rows: rows.map((r: any) => ({
        name: r.name, description: r.description, serviceLine: r.service_line,
        active: r.is_active, lifecycleStatus: r.lifecycle_status, effectiveDate: r.effective_date,
        executionCount: Number(r.execution_count) || 0,
        monthlyImpact: r.monthly_impact == null ? null : Number(r.monthly_impact),
        annualImpact: r.annual_impact == null ? null : Number(r.annual_impact),
      })), basis: "Stored rule execution and impact aggregates; overlap-aware qualified impact is authoritative for projections.", meta: resultMeta(null, "adjustment_rules", rows.length, rows.length >= 100) }, source: { tool, label: "Pricing rule performance" } };
    default:
      throw new AssistantInputError(`Tool "${tool}" is not available.`);
  }
}

async function auditAssistant(
  context: AssistantContext | null,
  eventType: string,
  req: { ip?: string; get?: (name: string) => string | undefined },
  metadata: Record<string, unknown>,
  success = true,
): Promise<void> {
  await pool.query(
    `INSERT INTO security_audit_events
       (client_id, user_id, event_type, success, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      context?.clientId || null,
      context?.userId || null,
      eventType,
      success,
      req.ip || null,
      String(req.get?.("user-agent") || "").slice(0, 500) || null,
      JSON.stringify(metadata),
    ],
  );
}

export async function runAssistantChat(
  input: { messages: AssistantMessage[]; pageContext?: { path: string } },
  context: AssistantContext,
  req: { ip?: string; get?: (name: string) => string | undefined },
): Promise<{ message: string; model: string; sources: AssistantSource[] }> {
  if (!anthropicClient) throw new AssistantUnavailableError("The assistant is not configured.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASSISTANT_TIMEOUT_MS);
  const sources: AssistantSource[] = [];
  let toolCalls = 0;
  let rounds = 0;
  await auditAssistant(context, "assistant_request", req, {
    messageCount: input.messages.length,
    pageContextProvided: Boolean(input.pageContext),
  });

  try {
    const system = [
      "You are Modulo's tenant-scoped revenue management assistant.",
      "Use only the supplied read-only tools for portfolio facts. Never invent unavailable data.",
      "Do not request, reveal, infer, or output resident names, identifiers, raw notes, or other personal information.",
      "If a tool has no data, say that data is unavailable. Clearly distinguish current data month and trailing windows.",
      "When a question is ambiguous about campus, service line, metric, or time period, ask one concise clarifying question before analyzing.",
      "Use plain language and answer concisely first. Define unfamiliar metrics, state the as-of period and source, and distinguish measured, projected, and suggested values. If a domain or period is unavailable, say unavailable rather than estimating. Never expose internal implementation, parser, SQL, prompt, or error details.",
      buildRuleSuggestionContext(),
      input.pageContext ? `The operator is viewing ${input.pageContext.path}.` : "",
    ].filter(Boolean).join(" ");
    const messages: any[] = input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    while (rounds < ASSISTANT_MAX_ROUNDS) {
      rounds += 1;
      if (controller.signal.aborted) throw new AssistantTimeoutError();
      const response: any = await anthropicClient.messages.create(
        {
          model: ASSISTANT_MODEL,
          max_tokens: 1400,
          system,
          tools: ASSISTANT_TOOLS as any,
          messages,
        },
        { signal: controller.signal },
      );
      // Keep every block, including thinking/tool-use blocks, intact for the
      // next request. Reconstructing text here breaks Anthropic tool protocol.
      messages.push({ role: "assistant", content: response.content });
      const toolUses = (response.content || []).filter((block: any) => block.type === "tool_use");
      const text = (response.content || [])
        .filter((block: any) => block.type === "text")
        .map((block: any) => String(block.text || ""))
        .join("\n")
        .trim();
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
        if (!text) throw new AssistantUnavailableError("The assistant returned no answer.");
        return { message: text, model: ASSISTANT_MODEL, sources };
      }
      const results: any[] = [];
      for (const use of toolUses) {
        toolCalls += 1;
        await auditAssistant(context, "assistant_tool_call", req, {
          tool: String(use.name || ""),
          round: rounds,
          callNumber: toolCalls,
        });
        try {
          const result = await executeAssistantTool(String(use.name || ""), use.input, context, controller.signal);
          sources.push(result.source);
          results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(result.data), is_error: false });
        } catch (error) {
          const message = error instanceof AssistantInputError
            ? error.message
            : error instanceof AssistantTimeoutError
              ? error.message
              : "The requested data is unavailable.";
          results.push({ type: "tool_result", tool_use_id: use.id, content: message, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    throw new AssistantUnavailableError("The assistant reached its tool-use limit without an answer.");
  } catch (error) {
    if (controller.signal.aborted || error instanceof AssistantTimeoutError) {
      throw new AssistantTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}