import { z } from "zod";
import { anthropicClient } from "../aiRouter";
import { pool } from "../db";

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
        data: rows[0] || null,
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
      return { data: rows, source: { tool, label: "Current occupancy by campus and service line" } };
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
      return { data: rows, source: { tool, label: "Current street and in-house rate aggregates" } };
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
      return { data: rows, source: { tool, label: "Current competitive survey rates", detail: "Latest tenant survey month; addresses, incentives, amenities, and notes omitted" } };
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
      return { data: rows, source: { tool, label: "Inquiry, tour, and move-in aggregates", detail: "Trailing 24 months; prospect names and notes excluded" } };
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
      return { data: rows, source: { tool, label: "Current adjustment rules", detail: "Historical rows and free-form notes omitted" } };
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
        data: { plans: rows, assumptions },
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
      return { data: rows, source: { tool, label: "Portfolio locations" } };
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
      return { data: rows, source: { tool, label: "Recent account activity", detail: "Last 90 days; event metadata omitted" } };
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