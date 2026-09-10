import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, ChevronRight, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/formatters";

type DrillLevel = "group" | "serviceLine" | "campus" | "room";
type Selection = { group?: string; serviceLine?: string; campus?: string; room?: string };
type Point = { month: string; streetRate: number | null; inHouseRate: number | null; units: number };
type Series = { key: string; label: string; next?: Selection; points: Point[] };
type RateGrowthResponse = { level: DrillLevel; selection: Selection; series: Series[] };

const LEVEL_LABEL: Record<DrillLevel, string> = {
  group: "Portfolio",
  serviceLine: "Service line",
  campus: "Campus",
  room: "Room",
};
const COLORS = ["#177e89", "#d97732", "#456990", "#9a6fb0", "#658b62", "#b24c63"];

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export default function RateGrowthDrilldown() {
  const [selection, setSelection] = useState<Selection>({});
  const [history, setHistory] = useState<Selection[]>([]);

  const query = useQuery<RateGrowthResponse>({
    queryKey: ["/api/overview/rate-growth", selection],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(selection).forEach(([key, value]) => value && params.set(key, value));
      const response = await fetch(`/api/overview/rate-growth${params.toString() ? `?${params}` : ""}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to load rate history");
      return response.json();
    },
  });

  const data = query.data;
  const visibleSeries = useMemo(
    () => (data?.series ?? []).slice(0, data?.level === "group" || data?.level === "serviceLine" ? 8 : 6),
    [data],
  );
  const chartData = useMemo(() => {
    const points = new Map<string, Record<string, number | string | undefined>>();
    visibleSeries.forEach((series) =>
      series.points.forEach((point) => {
        const row = points.get(point.month) ?? { month: point.month };
        row[`${series.key}-street`] = point.streetRate ?? undefined;
        row[`${series.key}-inhouse`] = point.inHouseRate ?? undefined;
        points.set(point.month, row);
      }),
    );
    return Array.from(points.values()).sort((a, b) => String(a.month).localeCompare(String(b.month)));
  }, [visibleSeries]);

  const drillInto = (next: Selection) => {
    setHistory((current) => [...current, selection]);
    setSelection(next);
  };

  const goBack = () => {
    setHistory((current) => {
      const next = [...current];
      setSelection(next.pop() ?? {});
      return next;
    });
  };

  return (
    <Card className="dashboard-card overflow-hidden" data-testid="rate-growth-chart">
      <CardHeader className="border-b border-[var(--dashboard-border)] px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--trilogy-teal)]/10 text-[var(--trilogy-teal)]">
                <TrendingUp className="h-4 w-4" />
              </div>
              <CardTitle className="text-base font-semibold text-[var(--dashboard-text)]">Rate growth</CardTitle>
            </div>
            <p className="mt-1 text-xs text-[var(--dashboard-muted)]">
              Street and in-house rates, by month · select a row to continue down to the room
            </p>
          </div>
          {data && data.level !== "group" && (
            <Button
              variant="outline"
              size="sm"
              onClick={goBack}
              disabled={history.length === 0}
              data-testid="rate-growth-back"
              className="h-8 self-start text-xs"
            >
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back
            </Button>
          )}
        </div>
        {data && (
          <div className="mt-3 flex flex-wrap items-center gap-1 text-xs" data-testid="rate-growth-breadcrumbs">
            <button
              type="button"
              onClick={() => { setSelection({}); setHistory([]); }}
              className={data.level === "group" ? "font-semibold text-[var(--dashboard-text)]" : "text-[var(--dashboard-muted)] hover:text-[var(--trilogy-teal)]"}
              data-testid="rate-growth-breadcrumb-overview"
            >
              Portfolio
            </button>
            {(["group", "serviceLine", "campus", "room"] as DrillLevel[]).map((level) => {
              const value = data.selection[level];
              if (!value) return null;
              return (
                <span className="flex items-center gap-1" key={level}>
                  <ChevronRight className="h-3 w-3 text-[var(--dashboard-muted)]" />
                  <span className={data.level === level ? "font-semibold text-[var(--dashboard-text)]" : "text-[var(--dashboard-muted)]"}>
                    {value}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </CardHeader>
      <CardContent className="px-3 py-4 sm:px-5">
        {query.isLoading && (
          <div className="space-y-3" data-testid="rate-growth-loading">
            <div className="h-4 w-48 animate-pulse rounded bg-[var(--dashboard-border)]" />
            <div className="h-64 animate-pulse rounded-lg bg-[var(--dashboard-border)]/50" />
          </div>
        )}
        {query.isError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-8 text-center text-sm text-red-700" data-testid="rate-growth-error">
            <p className="font-medium">Rate history is unavailable.</p>
            <button type="button" onClick={() => query.refetch()} className="mt-1 underline underline-offset-2">Try again</button>
          </div>
        )}
        {!query.isLoading && !query.isError && data && data.series.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-[var(--dashboard-muted)]" data-testid="rate-growth-empty">
            No rate history is available for this selection.
          </div>
        )}
        {data && data.series.length > 0 && (
          <div className="space-y-4">
            <div className="h-[250px] w-full sm:h-[280px]" data-testid="rate-growth-plot">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 10, left: 4, bottom: 4 }}>
                  <CartesianGrid stroke="var(--dashboard-border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} fontSize={10} stroke="var(--dashboard-muted)" />
                  <YAxis tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`} tickLine={false} axisLine={false} fontSize={10} width={52} stroke="var(--dashboard-muted)" />
                  <Tooltip
                    labelFormatter={(label) => monthLabel(String(label))}
                    formatter={(value: unknown, name: unknown) => [
                      formatCurrency(Math.round(Number(value))),
                      String(name).endsWith("-street") ? "Street rate" : "In-house rate",
                    ]}
                    contentStyle={{ background: "var(--dashboard-surface)", border: "1px solid var(--dashboard-border)", borderRadius: 8, fontSize: 12 }}
                  />
                  {visibleSeries.flatMap((series, index) => [
                    <Line key={`${series.key}-street`} type="monotone" dataKey={`${series.key}-street`} name={`${series.key}-street`} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={false} connectNulls />,
                    <Line key={`${series.key}-inhouse`} type="monotone" dataKey={`${series.key}-inhouse`} name={`${series.key}-inhouse`} stroke={COLORS[index % COLORS.length]} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />,
                  ])}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-testid="rate-growth-drill-controls">
              {data.series.map((series, index) => (
                <button
                  type="button"
                  key={series.key}
                  disabled={!series.next}
                  onClick={() => series.next && drillInto(series.next)}
                  className="group flex items-center justify-between rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-bg)] px-3 py-2 text-left transition-colors hover:border-[var(--trilogy-teal)]/60 disabled:cursor-default disabled:hover:border-[var(--dashboard-border)]"
                  data-testid={`rate-growth-drill-${series.key}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                    <span className="truncate text-sm font-medium text-[var(--dashboard-text)]">{series.label}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--dashboard-muted)]">{LEVEL_LABEL[data.level]}</span>
                  </span>
                  {series.next && <ChevronRight className="h-4 w-4 shrink-0 text-[var(--dashboard-muted)] group-hover:text-[var(--trilogy-teal)]" />}
                </button>
              ))}
            </div>
            {data.series.length > visibleSeries.length && (
              <p className="text-xs text-[var(--dashboard-muted)]">
                The chart compares the first {visibleSeries.length.toLocaleString()} selections; all{" "}
                {data.series.length.toLocaleString()} are available below for drill-down.
              </p>
            )}
            <div className="flex flex-wrap gap-4 border-t border-[var(--dashboard-border)] pt-3 text-[11px] text-[var(--dashboard-muted)]">
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-5 bg-[var(--trilogy-teal)]" /> Street rate</span>
              <span className="flex items-center gap-1.5"><i className="h-0.5 w-5 border-t-2 border-dashed border-[var(--trilogy-teal)]" /> In-house rate</span>
              <span className="ml-auto">{LEVEL_LABEL[data.level]} view</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}