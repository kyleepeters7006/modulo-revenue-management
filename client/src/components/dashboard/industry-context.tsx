import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, Info, RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Metric = {
  id: string;
  category: "senior-housing" | "costs" | "economic";
  label: string;
  value: number | string | null;
  unit: "percent" | "range" | "index";
  comparison: string;
  asOf: string;
  sourceName: string;
  sourceUrl: string;
  method: "live" | "reviewed";
  status: "current" | "stale" | "unavailable";
  note: string;
  updatedAt?: string;
  revisionCount?: number;
  previousValue?: number | null;
};

type IndustryContextRefresh = {
  provider: string;
  schedule: string;
  refreshIntervalHours: number;
  staleAfterHours: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  revisionCount: number;
};

type IndustryContextResponse = {
  metrics: Metric[];
  fetchedAt: string;
  liveSourceStatus: "current" | "partial";
  liveRefresh: IndustryContextRefresh;
};

const categoryCopy = {
  "senior-housing": {
    title: "Senior housing market",
    description: "Occupancy and rent-growth context",
  },
  costs: {
    title: "Cost pressure",
    description: "Inflation, labor, and construction inputs",
  },
  economic: {
    title: "Economic context",
    description: "Affordability and forward-looking signals",
  },
};

function formatValue(metric: Metric) {
  if (metric.value === null) return "Unavailable";
  if (metric.unit === "percent" && typeof metric.value === "number") return `${metric.value.toFixed(1)}%`;
  return String(metric.value);
}

function statusLabel(metric: Metric) {
  if (metric.status === "stale") return "Stale · last known";
  if (metric.status === "unavailable") return "Unavailable";
  if (metric.method === "reviewed") return "Reviewed snapshot";
  return "Live series";
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function ContextCard({ metric }: { metric: Metric }) {
  return (
    <div
      className="rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-bg)] p-4"
      data-testid={`industry-metric-${metric.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--dashboard-muted)]">
            {metric.label}
          </p>
          <p className="mt-2 text-2xl font-light text-[var(--dashboard-text)]">{formatValue(metric)}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${
            metric.status === "stale"
              ? "bg-amber-100 text-amber-800"
              : metric.status === "unavailable"
                ? "bg-slate-100 text-slate-700"
                : "bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)]"
          }`}
        >
          {statusLabel(metric)}
        </span>
      </div>
      <p className="mt-2 text-xs font-medium text-[var(--dashboard-text)]">{metric.comparison}</p>
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-[var(--dashboard-muted)]">
        <span>As of {metric.asOf}</span>
        <span className="inline-flex items-center gap-2">
          {metric.revisionCount ? (
            <span
              className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-800"
              title={metric.previousValue == null ? undefined : `Previous value: ${metric.previousValue.toFixed(1)}%`}
            >
              Revised {metric.revisionCount}×
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1" title={metric.note}>
            <Info className="h-3 w-3" />
            Definition
          </span>
        </span>
      </div>
      <a
        href={metric.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex max-w-full items-center gap-1 text-[11px] text-[var(--trilogy-teal)] hover:underline"
      >
        <span className="truncate">{metric.sourceName}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}

export default function IndustryContext() {
  const query = useQuery<IndustryContextResponse>({
    queryKey: ["/api/industry-context"],
    queryFn: async () => {
      const response = await fetch("/api/industry-context", { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load industry context");
      return response.json();
    },
    staleTime: 30 * 60 * 1000,
  });

  if (query.isLoading) {
    return (
      <Card className="dashboard-card" data-testid="industry-context-loading">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-xl bg-[var(--dashboard-border)]/60" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="dashboard-card" data-testid="industry-context-error">
        <CardContent className="flex items-center justify-between gap-4 p-5">
          <div>
            <p className="font-semibold text-[var(--dashboard-text)]">Industry Context unavailable</p>
            <p className="mt-1 text-sm text-[var(--dashboard-muted)]">
              The dashboard could not load the external benchmark feed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--dashboard-border)] px-3 py-2 text-sm"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </CardContent>
      </Card>
    );
  }

  const groups = (Object.keys(categoryCopy) as Array<keyof typeof categoryCopy>).map((category) => ({
    category,
    ...categoryCopy[category],
    metrics: query.data.metrics.filter((metric) => metric.category === category),
  }));

  return (
    <Card className="dashboard-card" data-testid="industry-context">
      <CardHeader className="gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-xl font-semibold text-[var(--dashboard-text)]">
            Industry Context
          </CardTitle>
          <p className="mt-1 max-w-2xl text-sm text-[var(--dashboard-muted)]">
            Start the annual rate conversation with market signals, then set our targets.
            Benchmarks are context—not an automatic recommendation.
          </p>
        </div>
        <Link href="/inhouse-increases">
          <span className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md bg-[var(--trilogy-teal)] px-3 py-2 text-sm font-medium text-white hover:opacity-90">
            Set our targets <ArrowRight className="h-4 w-4" />
          </span>
        </Link>
      </CardHeader>
      <CardContent className="space-y-5">
        {groups.map((group) => (
          <section key={group.category} aria-labelledby={`industry-${group.category}`}>
            <div className="mb-3">
              <h3 id={`industry-${group.category}`} className="text-sm font-semibold text-[var(--dashboard-text)]">
                {group.title}
              </h3>
              <p className="text-xs text-[var(--dashboard-muted)]">{group.description}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.metrics.map((metric) => (
                <ContextCard key={metric.id} metric={metric} />
              ))}
            </div>
          </section>
        ))}
        <div className="border-t border-[var(--dashboard-border)] pt-3 text-[11px] text-[var(--dashboard-muted)]">
          <p>
            Last successful source refresh{" "}
            {formatTimestamp(query.data.liveRefresh.lastSuccessAt)} ·{" "}
            {query.data.liveRefresh.schedule}. Reviewed snapshots are dated to their source publication.
          </p>
          <p className="mt-1">
            {query.data.liveRefresh.provider} · Data is marked stale after{" "}
            {query.data.liveRefresh.staleAfterHours} hours.
            {query.data.liveRefresh.revisionCount > 0
              ? ` ${query.data.liveRefresh.revisionCount} revision${query.data.liveRefresh.revisionCount === 1 ? "" : "s"} recorded.`
              : ""}
          </p>
          {query.data.liveSourceStatus === "partial" || query.data.liveRefresh.lastError ? (
            <p className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-800">
              BLS refresh issue:{" "}
              {query.data.liveRefresh.lastError ?? "one or more live series are stale or unavailable."}
              {query.data.liveRefresh.lastAttemptAt
                ? ` Last attempted ${formatTimestamp(query.data.liveRefresh.lastAttemptAt)}.`
                : ""}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}