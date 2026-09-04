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
}

export interface IndustryContextResponse {
  metrics: IndustryContextMetric[];
  fetchedAt: string;
  liveSourceStatus: "current" | "partial";
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

const BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
const CACHE_MS = 30 * 60 * 1000;

let cachedLiveMetrics: IndustryContextMetric[] | null = null;
let cachedAt = 0;
let refreshPromise: Promise<IndustryContextMetric[]> | null = null;

const reviewedMetrics: ReviewedMetric[] = [
  {
    id: "nic-occupancy",
    category: "senior-housing",
    label: "Senior housing occupancy",
    value: 89.5,
    unit: "percent",
    comparison: "NIC MAP Primary Markets",
    asOf: "Q1 2026",
    sourceName: "NIC MAP",
    sourceUrl:
      "https://www.nicmap.com/news/senior-living-occupancy-grows-amid-construction-slowdown-limiting-options-for-older-adults/",
    method: "reviewed",
    status: "current",
    note: "Market occupancy; not a direct target for any one portfolio.",
    staleAfter: "2026-07-31",
  },
  {
    id: "cbre-rent-growth",
    category: "senior-housing",
    label: "Expected senior-housing rent growth",
    value: "3–7%",
    unit: "range",
    comparison: "CBRE investor expectations",
    asOf: "H1 2025 survey",
    sourceName: "CBRE",
    sourceUrl:
      "https://www.cbre.com/insights/reports/us-senior-housing-and-care-investor-survey-h1-2025",
    method: "reviewed",
    status: "current",
    note: "Investor expectation range; it is not realized revenue growth.",
    staleAfter: "2026-07-01",
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
    sourceUrl: "https://welltower.com/investors/press-release-details?id=808",
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
    sourceUrl: "https://www.ssa.gov/cola/",
    method: "reviewed",
    status: "current",
    note: "A broad affordability reference, not a pricing recommendation.",
    staleAfter: "2026-12-31",
  },
  {
    id: "fed-inflation-outlook",
    category: "economic",
    label: "Federal Reserve inflation outlook",
    value: 2.6,
    unit: "percent",
    comparison: "PCE inflation projection",
    asOf: "2026 planning reference",
    sourceName: "Federal Reserve",
    sourceUrl:
      "https://www.federalreserve.gov/monetarypolicy/fomcprojtabl2026.htm",
    method: "reviewed",
    status: "current",
    note: "Forward macro outlook; projections can change as new estimates are published.",
    staleAfter: "2026-12-31",
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

async function fetchLiveMetrics(): Promise<IndustryContextMetric[]> {
  const year = new Date().getUTCFullYear();
  const response = await fetch(BLS_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      seriesid: liveSeries.map((series) => series.seriesId),
      startyear: String(year - 2),
      endyear: String(year),
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

  return liveSeries.flatMap((config) => {
    const metric = toLiveMetric(seriesById.get(config.seriesId) ?? { seriesID: config.seriesId }, (latest, prior) => {
      const percent = ((Number(latest.value) / Number(prior.value)) - 1) * 100;
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
        updatedAt: new Date().toISOString(),
      };
    });
    return metric ? [metric] : [];
  });
}

function reviewedForToday(): IndustryContextMetric[] {
  const now = Date.now();
  return reviewedMetrics.map(({ staleAfter, ...metric }) => ({
    ...metric,
    status: now > new Date(`${staleAfter}T23:59:59Z`).getTime() ? "stale" : "current",
  }));
}

function unavailableLiveMetrics(): IndustryContextMetric[] {
  return liveSeries.map((config) => ({
    id: config.id,
    category: config.category,
    label: config.label,
    value: null,
    unit: "percent",
    comparison: config.comparison,
    asOf: "Unavailable",
    sourceName: config.sourceName,
    sourceUrl: config.sourceUrl,
    method: "live",
    status: "unavailable",
    note: config.note,
  }));
}

export async function getIndustryContext(): Promise<IndustryContextResponse> {
  const now = Date.now();
  if (cachedLiveMetrics && now - cachedAt < CACHE_MS) {
    return {
      metrics: [...reviewedForToday(), ...cachedLiveMetrics],
      fetchedAt: new Date(cachedAt).toISOString(),
      liveSourceStatus: "current",
    };
  }

  if (!refreshPromise) {
    refreshPromise = fetchLiveMetrics()
      .then((metrics) => {
        cachedLiveMetrics = metrics;
        cachedAt = Date.now();
        return metrics;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  try {
    const metrics = await refreshPromise;
    return {
      metrics: [...reviewedForToday(), ...metrics],
      fetchedAt: new Date(cachedAt).toISOString(),
      liveSourceStatus: "current",
    };
  } catch (error) {
    console.error("[industry-context] live source refresh failed:", error);
    const fallbackLive = cachedLiveMetrics?.length
      ? cachedLiveMetrics.map((metric) => ({ ...metric, status: "stale" as const }))
      : unavailableLiveMetrics();
    return {
      metrics: [...reviewedForToday(), ...fallbackLive],
      fetchedAt: new Date(cachedAt || now).toISOString(),
      liveSourceStatus: "partial",
    };
  }
}