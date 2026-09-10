import cron from "node-cron";
import { db, pool } from "../db";
import { eq } from "drizzle-orm";
import {
  industryContextRefreshState,
  industryContextSnapshots,
} from "@shared/schema";

export type IndustryMetricStatus = "current" | "stale" | "unavailable";
export type IndustryMetricMethod = "live" | "reviewed";

export interface IndustryContextMetric {
  id: string;
  category: "senior-housing" | "costs" | "economic";
  label: string;
  value: number | string | null;
  unit: "percent" | "range" | "index";
  comparison: string;
  asOf: string;
  sourceName: string;
  sourceUrl: string;
  method: IndustryMetricMethod;
  status: IndustryMetricStatus;
  note: string;
  updatedAt?: string;
  revisionCount?: number;
  previousValue?: number | null;
}

export interface IndustryContextRefresh {
  provider: string;
  schedule: string;
  refreshIntervalHours: number;
  staleAfterHours: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  revisionCount: number;
}

export interface IndustryContextResponse {
  metrics: IndustryContextMetric[];
  fetchedAt: string;
  liveSourceStatus: "current" | "partial";
  liveRefresh: IndustryContextRefresh;
}

type BlsSeries = {
  seriesID: string;
  data?: Array<{
    year: string;
    period: string;
    periodName: string;
    value: string;
  }>;
};

type ReviewedMetric = IndustryContextMetric & { staleAfter: string };
type LiveMetricRecord = {
  metric: IndustryContextMetric;
  seriesId: string;
  period: string;
  periodName: string;
  observationYear: number;
};

const BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const REFRESH_STATE_ID = "bls";
const REFRESH_LOCK_KEY = "industry-context-bls-refresh";
const SCHEDULE = "17 */6 * * *";
const REFRESH_SCHEDULE_LABEL = "Every 6 hours (17 minutes past the hour)";

let refreshPromise: Promise<unknown> | null = null;
let schedulerStarted = false;

const reviewedMetrics: ReviewedMetric[] = [
  {
    id: "nic-occupancy",
    category: "senior-housing",
    label: "Senior housing occupancy",
    value: 89.9,
    unit: "percent",
    comparison: "31 NIC MAP Primary Markets",
    asOf: "Q2 2026",
    sourceName: "NIC MAP",
    sourceUrl:
      "https://www.nic.org/blog/senior-housing-occupancy-climbs-in-second-quarter-2026",
    method: "reviewed",
    status: "current",
    note: "Market occupancy; not a direct target for any one portfolio.",
    staleAfter: "2026-10-31",
  },
  {
    id: "cbre-rent-growth",
    category: "senior-housing",
    label: "Expected senior-housing rent growth",
    value: "3–7%",
    unit: "range",
    comparison: "CBRE investor expectations",
    asOf: "H1 2026 survey",
    sourceName: "CBRE",
    sourceUrl:
      "https://www.cbre.com/insights/reports/us-senior-housing-and-care-investor-survey-h1-2026",
    method: "reviewed",
    status: "current",
    note: "Investor expectation range; it is not realized revenue growth.",
    staleAfter: "2027-01-15",
  },
  {
    id: "welltower-sho-growth",
    category: "senior-housing",
    label: "Peer same-store revenue growth",
    value: 9.2,
    unit: "percent",
    comparison: "Welltower SHO organic same-store revenue",
    asOf: "Q2 2026",
    sourceName: "Welltower",
    sourceUrl:
      "https://www.sec.gov/Archives/edgar/data/766704/000076670426000026/a2q26earningsrelease991.htm",
    method: "reviewed",
    status: "current",
    note: "Operator-specific result; occupancy and RevPOR both contribute, so it is not an industry average.",
    staleAfter: "2026-11-01",
  },
  {
    id: "ssa-cola",
    category: "economic",
    label: "Social Security COLA",
    value: 2.8,
    unit: "percent",
    comparison: "U.S. resident purchasing-power context",
    asOf: "2026",
    sourceName: "Social Security Administration",
    sourceUrl: "https://www.ssa.gov/oact/cola/colasummary.html",
    method: "reviewed",
    status: "current",
    note: "A broad affordability reference, not a pricing recommendation.",
    staleAfter: "2026-12-31",
  },
  {
    id: "fed-inflation-outlook",
    category: "economic",
    label: "Federal Reserve inflation outlook",
    value: 3.6,
    unit: "percent",
    comparison: "2026 median PCE inflation projection",
    asOf: "June 2026 SEP",
    sourceName: "Federal Reserve via FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/PCECTPIMD",
    method: "reviewed",
    status: "current",
    note: "Forward macro outlook; projections can change as new estimates are published.",
    staleAfter: "2026-09-30",
  },
];

const liveSeries = [
  {
    id: "bls-cpi",
    seriesId: "CUUR0000SA0",
    category: "costs" as const,
    label: "Consumer inflation",
    comparison: "CPI-U, all items",
    sourceName: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/cpi/",
    note: "12-month change in the U.S. city average CPI-U index.",
  },
  {
    id: "bls-eci",
    seriesId: "CIU2010000000000I",
    category: "costs" as const,
    label: "Employment cost pressure",
    comparison: "ECI, private-industry compensation",
    sourceName: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/eci/",
    note: "12-month change in the private-industry employment cost index.",
  },
  {
    id: "bls-construction",
    seriesId: "WPUFD4",
    category: "costs" as const,
    label: "Construction cost pressure",
    comparison: "PPI, final demand construction",
    sourceName: "U.S. Bureau of Labor Statistics",
    sourceUrl: "https://www.bls.gov/ppi/",
    note: "12-month change; preliminary PPI values can be revised.",
  },
];

function comparisonPeriod(period: string): string | null {
  if (period.startsWith("M")) return `M${String(Number(period.slice(1))).padStart(2, "0")}`;
  if (period.startsWith("Q")) return period;
  return null;
}

function periodLabel(year: string, period: string, periodName: string): string {
  if (period.startsWith("M")) return `${periodName} ${year}`;
  if (period.startsWith("Q")) return `${periodName} ${year}`;
  return year;
}

function toLiveMetric(
  series: BlsSeries,
  definition: (latest: NonNullable<BlsSeries["data"]>[number], prior: NonNullable<BlsSeries["data"]>[number]) => IndustryContextMetric,
): IndustryContextMetric | null {
  const rows = series.data ?? [];
  const latest = rows.find((row) => row.period !== "M13" && row.period !== "M14");
  if (!latest) return null;
  const priorYear = String(Number(latest.year) - (latest.period.startsWith("Q") ? 1 : 1));
  const prior = rows.find(
    (row) => row.year === priorYear && row.period === comparisonPeriod(latest.period),
  );
  return prior ? definition(latest, prior) : null;
}

async function fetchLiveMetrics(): Promise<LiveMetricRecord[]> {
  const year = new Date().getUTCFullYear();
  const registrationKey = process.env.BLS_API_KEY || process.env.BLS_REGISTRATION_KEY;
  const response = await fetch(BLS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      seriesid: liveSeries.map((series) => series.seriesId),
      startyear: String(year - 2),
      endyear: String(year),
      ...(registrationKey ? { registrationkey: registrationKey } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`BLS returned ${response.status}`);
  const payload = (await response.json()) as {
    status?: string;
    message?: string[];
    Results?: { series?: BlsSeries[] };
  };
  if (payload.status !== "REQUEST_SUCCEEDED") {
    throw new Error(payload.message?.[0] || "BLS request was not processed");
  }
  const seriesById = new Map((payload.Results?.series ?? []).map((series) => [series.seriesID, series]));

  const observedAt = new Date().toISOString();
  return liveSeries.flatMap((config) => {
    const metric = toLiveMetric(seriesById.get(config.seriesId) ?? { seriesID: config.seriesId }, (latest, prior) => {
      const percent = ((Number(latest.value) / Number(prior.value)) - 1) * 100;
      if (!Number.isFinite(percent)) return null as never;
      return {
        id: config.id,
        category: config.category,
        label: config.label,
        value: Number(percent.toFixed(1)),
        unit: "percent",
        comparison: config.comparison,
        asOf: periodLabel(latest.year, latest.period, latest.periodName),
        sourceName: config.sourceName,
        sourceUrl: config.sourceUrl,
        method: "live",
        status: "current",
        note: config.note,
        updatedAt: observedAt,
      };
    });
    const series = seriesById.get(config.seriesId);
    const latest = (series?.data ?? []).find((row) => row.period !== "M13" && row.period !== "M14");
    return metric && latest
      ? [{
          metric,
          seriesId: config.seriesId,
          period: latest.period,
          periodName: latest.periodName,
          observationYear: Number(latest.year),
        }]
      : [];
  });
}

function reviewedForToday(): IndustryContextMetric[] {
  const now = Date.now();
  return reviewedMetrics.map(({ staleAfter, ...metric }) => ({
    ...metric,
    status: now > new Date(`${staleAfter}T23:59:59Z`).getTime() ? "stale" : "current",
  }));
}

type RefreshState = typeof industryContextRefreshState.$inferSelect;
type Snapshot = typeof industryContextSnapshots.$inferSelect;

export function isBlsRevision(
  previous: { period: string; observationYear: number | null; value: number } | null,
  current: { period: string; observationYear: number; value: number },
): boolean {
  return Boolean(
    previous &&
      previous.period === current.period &&
      previous.observationYear !== null &&
      previous.observationYear === current.observationYear &&
      previous.value !== current.value,
  );
}

function toIso(value: Date | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

async function readPersistedContext(): Promise<{ state: RefreshState | null; snapshots: Snapshot[] }> {
  const [stateRows, snapshots] = await Promise.all([
    db
      .select()
      .from(industryContextRefreshState)
      .where(eq(industryContextRefreshState.id, REFRESH_STATE_ID))
      .limit(1),
    db.select().from(industryContextSnapshots),
  ]);
  return { state: stateRows[0] ?? null, snapshots };
}

export function buildResponse(
  state: RefreshState | null,
  snapshots: Snapshot[],
  now = Date.now(),
): IndustryContextResponse {
  const snapshotsByMetric = new Map(snapshots.map((snapshot) => [snapshot.metricId, snapshot]));
  let hasMissingMetric = false;
  let hasStaleMetric = false;
  const liveMetrics = liveSeries.map((config) => {
    const snapshot = snapshotsByMetric.get(config.id);
    if (!snapshot) {
      hasMissingMetric = true;
      return {
        id: config.id,
        category: config.category,
        label: config.label,
        value: null,
        unit: "percent" as const,
        comparison: config.comparison,
        asOf: "Unavailable",
        sourceName: config.sourceName,
        sourceUrl: config.sourceUrl,
        method: "live" as const,
        status: "unavailable" as const,
        note: config.note,
      };
    }

    const observedAt = new Date(snapshot.observedAt).getTime();
    const stale = !Number.isFinite(observedAt) || now - observedAt > STALE_AFTER_MS;
    if (stale) hasStaleMetric = true;
    return {
      id: config.id,
      category: config.category,
      label: config.label,
      value: snapshot.value,
      unit: "percent" as const,
      comparison: config.comparison,
      asOf: snapshot.asOf,
      sourceName: config.sourceName,
      sourceUrl: config.sourceUrl,
      method: "live" as const,
      status: stale ? ("stale" as const) : ("current" as const),
      note: config.note,
      updatedAt: toIso(snapshot.observedAt) ?? undefined,
      revisionCount: snapshot.revisionCount,
      previousValue: snapshot.previousValue,
    };
  });

  const lastSuccessAt = toIso(state?.lastSuccessAt);
  const lastAttemptAt = toIso(state?.lastAttemptAt);
  const hasUnresolvedError =
    Boolean(state?.lastError) &&
    (!state?.lastSuccessAt ||
      !state.lastAttemptAt ||
      state.lastAttemptAt.getTime() >= state.lastSuccessAt.getTime());

  return {
    metrics: [...reviewedForToday(), ...liveMetrics],
    fetchedAt: new Date(now).toISOString(),
    liveSourceStatus: hasMissingMetric || hasStaleMetric || hasUnresolvedError ? "partial" : "current",
    liveRefresh: {
      provider: "U.S. Bureau of Labor Statistics Public Data API",
      schedule: REFRESH_SCHEDULE_LABEL,
      refreshIntervalHours: REFRESH_INTERVAL_MS / (60 * 60 * 1000),
      staleAfterHours: STALE_AFTER_MS / (60 * 60 * 1000),
      lastAttemptAt,
      lastSuccessAt,
      lastError: state?.lastError ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      revisionCount: snapshots.reduce((total, snapshot) => total + snapshot.revisionCount, 0),
    },
  };
}

type PoolClient = {
  query: <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: T[] }>;
  release: () => void;
};

async function withRefreshLock<T>(work: (client: PoolClient) => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const lockResult = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [REFRESH_LOCK_KEY],
    );
    if (!lockResult.rows[0]?.locked) return null;
    try {
      return await work(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [REFRESH_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function recordRefreshFailure(error: unknown, attemptAt: Date): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[industry-context] scheduled BLS refresh failed:", message);
  const current = await db
    .select()
    .from(industryContextRefreshState)
    .where(eq(industryContextRefreshState.id, REFRESH_STATE_ID))
    .limit(1);
  const failures = (current[0]?.consecutiveFailures ?? 0) + 1;
  await db
    .insert(industryContextRefreshState)
    .values({
      id: REFRESH_STATE_ID,
      lastAttemptAt: attemptAt,
      lastError: message.slice(0, 1000),
      consecutiveFailures: failures,
      updatedAt: attemptAt,
    })
    .onConflictDoUpdate({
      target: industryContextRefreshState.id,
      set: {
        lastAttemptAt: attemptAt,
        lastError: message.slice(0, 1000),
        consecutiveFailures: failures,
        updatedAt: attemptAt,
      },
    });
}

async function persistRefresh(records: LiveMetricRecord[], observedAt: Date): Promise<void> {
  const existing = await db.select().from(industryContextSnapshots);
  const existingByMetric = new Map(existing.map((snapshot) => [snapshot.metricId, snapshot]));

  await db.transaction(async (tx) => {
    for (const record of records) {
      const previous = existingByMetric.get(record.metric.id);
      const value = Number(record.metric.value);
      const revised = isBlsRevision(
        previous
          ? {
              period: previous.period,
              observationYear: previous.observationYear,
              value: previous.value,
            }
          : null,
        { period: record.period, observationYear: record.observationYear, value },
      );
      await tx
        .insert(industryContextSnapshots)
        .values({
          metricId: record.metric.id,
          seriesId: record.seriesId,
          value,
          asOf: record.metric.asOf,
          period: record.period,
          periodName: record.periodName,
          observationYear: record.observationYear,
          observedAt,
          revisionCount: (previous?.revisionCount ?? 0) + (revised ? 1 : 0),
          previousValue: revised ? previous?.value : (previous?.previousValue ?? null),
          lastRevisionAt: revised ? observedAt : (previous?.lastRevisionAt ?? null),
        })
        .onConflictDoUpdate({
          target: industryContextSnapshots.metricId,
          set: {
            seriesId: record.seriesId,
            value,
            asOf: record.metric.asOf,
            period: record.period,
            periodName: record.periodName,
            observationYear: record.observationYear,
            observedAt,
            revisionCount: (previous?.revisionCount ?? 0) + (revised ? 1 : 0),
            previousValue: revised ? previous?.value : (previous?.previousValue ?? null),
            lastRevisionAt: revised ? observedAt : (previous?.lastRevisionAt ?? null),
          },
        });
    }
  });

  await db
    .insert(industryContextRefreshState)
    .values({
      id: REFRESH_STATE_ID,
      lastAttemptAt: observedAt,
      lastSuccessAt: observedAt,
      lastError: null,
      consecutiveFailures: 0,
      updatedAt: observedAt,
    })
    .onConflictDoUpdate({
      target: industryContextRefreshState.id,
      set: {
        lastAttemptAt: observedAt,
        lastSuccessAt: observedAt,
        lastError: null,
        consecutiveFailures: 0,
        updatedAt: observedAt,
      },
    });
}

export async function refreshIndustryContext(options: { force?: boolean } = {}): Promise<void> {
  if (refreshPromise) {
    await refreshPromise;
    return;
  }

  const current = await readPersistedContext();
  if (
    !options.force &&
    current.state?.lastSuccessAt &&
    Date.now() - current.state.lastSuccessAt.getTime() < REFRESH_INTERVAL_MS
  ) {
    return;
  }

  const run = withRefreshLock(async () => {
    const attemptAt = new Date();
    await db
      .insert(industryContextRefreshState)
      .values({
        id: REFRESH_STATE_ID,
        lastAttemptAt: attemptAt,
        consecutiveFailures: current.state?.consecutiveFailures ?? 0,
        updatedAt: attemptAt,
      })
      .onConflictDoUpdate({
        target: industryContextRefreshState.id,
        set: { lastAttemptAt: attemptAt, updatedAt: attemptAt },
      });
    try {
      const records = await fetchLiveMetrics();
      if (records.length !== liveSeries.length) {
        throw new Error(`BLS returned ${records.length} of ${liveSeries.length} configured series`);
      }
      await persistRefresh(records, attemptAt);
    } catch (error) {
      await recordRefreshFailure(error, attemptAt);
    }
  });
  refreshPromise = run;
  try {
    await run;
  } finally {
    refreshPromise = null;
  }
}

export function startIndustryContextRefreshLoop(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  void refreshIndustryContext().catch((error) => {
    console.error("[industry-context] initial scheduled refresh failed:", error);
  });
  cron.schedule(SCHEDULE, () => {
    void refreshIndustryContext({ force: true }).catch((error) => {
      console.error("[industry-context] cron refresh failed:", error);
    });
  });
  console.log(`[industry-context] BLS refresh scheduler started: ${REFRESH_SCHEDULE_LABEL}`);
}

export async function getIndustryContext(clientId = "demo"): Promise<IndustryContextResponse> {
  const { state, snapshots } = await readPersistedContext();
  const response = buildResponse(state, snapshots);
  const overrides = await pool.query(
    `SELECT metric_id, payload, updated_at
       FROM industry_context_overrides
      WHERE client_id = $1`,
    [clientId],
  );
  const byId = new Map(overrides.rows.map((row: any) => [row.metric_id, row]));
  response.metrics = response.metrics.map((metric) => {
    const override = byId.get(metric.id);
    if (!override) return metric;
    const payload = typeof override.payload === "string" ? JSON.parse(override.payload) : override.payload;
    return {
      ...metric,
      ...payload,
      method: "reviewed",
      status: "current",
      updatedAt: new Date(override.updated_at).toISOString(),
    };
  });
  return response;
}