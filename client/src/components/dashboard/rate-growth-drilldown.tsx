import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, ChevronRight, Download, Loader2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/formatters";
import { useToast } from "@/hooks/use-toast";

type DrillLevel = "group" | "serviceLine" | "campus" | "room";
type Selection = { group?: string; serviceLine?: string; campus?: string; room?: string };
export type RateGrowthPoint = { month: string; streetRate: number | null; inHouseRate: number | null; units: number };
export type RateGrowthSeries = {
  key: string;
  label: string;
  rateBasis: "daily" | "monthly";
  next?: Selection;
  points: RateGrowthPoint[];
};
type BenchmarkPoint = {
  month: string;
  top: number | null;
  p75: number | null;
  middle: number | null;
  p25: number | null;
  bottom: number | null;
};
type Benchmark = {
  key: string;
  label: string;
  geography: string;
  propertyType: "Majority IL" | "Majority AL";
  display: "middle" | "tiers";
  appliesToKey?: string;
  matchMethod: "combined_markets" | "exact_city" | "nearby_metro";
  sourceName: string;
  sourceUrl: string;
  asOf: string;
  points: BenchmarkPoint[];
};
type RateGrowthResponse = {
  level: DrillLevel;
  selection: Selection;
  series: RateGrowthSeries[];
  benchmarks?: Benchmark[];
};

class RateGrowthError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RateGrowthError";
  }
}

const LEVEL_LABEL: Record<DrillLevel, string> = {
  group: "Portfolio",
  serviceLine: "Service line",
  campus: "Campus",
  room: "Room",
};
const NIC_MAP_SERVICE_LINES = new Set(["AL", "SL", "VIL"]);
const COLORS = ["#177e89", "#d97732", "#456990", "#9a6fb0", "#658b62", "#b24c63"];

function monthLabel(value: string) {
  const [year, month] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function benchmarkField(benchmark: Benchmark, tier: keyof Omit<BenchmarkPoint, "month">) {
  return `nic:${benchmark.key}:${tier}`;
}

function buildChartData(seriesList: RateGrowthSeries[], benchmarks: Benchmark[]) {
  const points = new Map<string, Record<string, number | string | undefined>>();
  const actualMonths = seriesList.flatMap((series) => series.points.map((point) => point.month)).sort();
  const firstMonth = actualMonths[0];
  const lastMonth = actualMonths[actualMonths.length - 1];
  seriesList.forEach((series) =>
    series.points.forEach((point) => {
      const row = points.get(point.month) ?? { month: point.month };
      row[`${series.key}-street`] = point.streetRate ?? undefined;
      row[`${series.key}-inhouse`] = point.inHouseRate ?? undefined;
      points.set(point.month, row);
    }),
  );
  benchmarks.forEach((benchmark) =>
    benchmark.points.forEach((point) => {
      if (firstMonth && point.month < firstMonth || lastMonth && point.month > lastMonth) return;
      const row = points.get(point.month) ?? { month: point.month };
      (["top", "p75", "middle", "p25", "bottom"] as const).forEach((tier) => {
        row[benchmarkField(benchmark, tier)] = point[tier] ?? undefined;
      });
      points.set(point.month, row);
    }),
  );
  return Array.from(points.values()).sort((a, b) =>
    String(a.month).localeCompare(String(b.month)),
  );
}

export function RateChart({
  series,
  benchmarks = [],
  colorOffset = 0,
  markerMonth,
  serviceLineSelector,
  headingLabel,
}: {
  series: RateGrowthSeries[];
  benchmarks?: Benchmark[];
  colorOffset?: number;
  markerMonth?: string | null;
  headingLabel?: string;
  serviceLineSelector?: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
  };
}) {
  const chartData = buildChartData(series, benchmarks);
  const daily = series[0]?.rateBasis === "daily";
  const tooltipContent = ({ active, label, payload }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload ?? {};
    const suffix = daily ? "/day" : "/mo";

    return (
      <div
        className="rounded-lg border border-[var(--dashboard-border)] bg-[var(--dashboard-surface)] p-3 text-xs shadow-md"
      >
        <p className="mb-2 font-semibold text-[var(--dashboard-text)]">{monthLabel(String(label))}</p>
        <div className="space-y-2">
          {series.map((item) => {
            const street = Number(point[`${item.key}-street`]);
            const inHouse = Number(point[`${item.key}-inhouse`]);
            const hasStreet = Number.isFinite(street);
            const hasInHouse = Number.isFinite(inHouse);
            const variance = hasStreet && hasInHouse ? street - inHouse : null;
            const variancePct = variance != null && inHouse !== 0 ? (variance / inHouse) * 100 : null;
            const sign = variance != null && variance > 0 ? "+" : "";

            return (
              <div key={item.key} className="space-y-1">
                {series.length > 1 && (
                  <p className="font-semibold text-[var(--dashboard-text)]">{item.label}</p>
                )}
                {hasStreet && (
                  <div className="flex min-w-[190px] items-center justify-between gap-5">
                    <span className="text-[var(--dashboard-muted)]">Street rate</span>
                    <span className="font-medium text-[var(--dashboard-text)]">
                      {formatCurrency(Math.round(street))}{suffix}
                    </span>
                  </div>
                )}
                {hasInHouse && (
                  <div className="flex items-center justify-between gap-5">
                    <span className="text-[var(--dashboard-muted)]">In-house rate</span>
                    <span className="font-medium text-[var(--dashboard-text)]">
                      {formatCurrency(Math.round(inHouse))}{suffix}
                    </span>
                  </div>
                )}
                {variance != null && (
                  <div className="flex items-center justify-between gap-5 border-t border-[var(--dashboard-border)] pt-1">
                    <span className="font-medium text-[var(--dashboard-muted)]">Variance</span>
                    <span className="font-semibold text-[var(--dashboard-text)]">
                      {sign}{formatCurrency(Math.round(variance))}{suffix}
                      {variancePct != null && ` (${variancePct > 0 ? "+" : ""}${variancePct.toFixed(1)}%)`}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
          {payload
            .filter((entry: any) => String(entry.name).startsWith("NIC MAP"))
            .map((entry: any) => (
              <div key={String(entry.dataKey)} className="flex items-center justify-between gap-5">
                <span className="text-[var(--dashboard-muted)]">{String(entry.name)}</span>
                <span className="font-medium text-[var(--dashboard-text)]">
                  {formatCurrency(Math.round(Number(entry.value)))}{suffix}
                </span>
              </div>
            ))}
        </div>
      </div>
    );
  };
  return (
    <div>
      {series.length === 1 && (
        <div className="mb-1 flex items-center justify-between px-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="shrink-0 text-xs font-semibold text-[var(--dashboard-text)]">
              {headingLabel ?? series[0].label}
            </p>
            {serviceLineSelector && (
              <select
                value={serviceLineSelector.value}
                onChange={(event) => serviceLineSelector.onChange(event.target.value)}
                className="h-7 min-w-0 max-w-[12rem] rounded-md border border-[var(--dashboard-border)] bg-[var(--dashboard-bg)] px-2 text-[11px] font-medium text-[var(--dashboard-text)] outline-none focus:border-[var(--trilogy-teal)]"
                aria-label={`Select service line within ${headingLabel ?? series[0].label}`}
                data-testid={`rate-growth-service-line-${headingLabel ?? series[0].key}`}
              >
                {serviceLineSelector.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
          </div>
          <p className="text-[11px] text-[var(--dashboard-muted)]">
            {daily ? "Daily rates" : "Monthly rates"}
          </p>
        </div>
      )}
      <div className="h-[230px] w-full sm:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 10, left: 4, bottom: 4 }}>
            <CartesianGrid stroke="var(--dashboard-border)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} fontSize={10} stroke="var(--dashboard-muted)" />
            <YAxis
              tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`}
              domain={[
                (dataMin: number) => Math.floor(dataMin * 0.98),
                (dataMax: number) => Math.ceil(dataMax * 1.02),
              ]}
              allowDataOverflow
              tickLine={false}
              axisLine={false}
              fontSize={10}
              width={52}
              stroke="var(--dashboard-muted)"
            />
            <RechartsTooltip
              content={tooltipContent}
            />
            {markerMonth && (
              <ReferenceLine
                x={markerMonth}
                stroke="var(--dashboard-muted)"
                strokeDasharray="3 3"
                label={{ value: "Annual Increase", position: "insideTopRight", fontSize: 10 }}
              />
            )}
            {series.flatMap((item, index) => {
              const color = COLORS[(index + colorOffset) % COLORS.length];
              return [
                <Line key={`${item.key}-street`} type="monotone" dataKey={`${item.key}-street`} name={`${item.key}-street`} stroke={color} strokeWidth={2} dot={false} connectNulls />,
                <Line key={`${item.key}-inhouse`} type="monotone" dataKey={`${item.key}-inhouse`} name={`${item.key}-inhouse`} stroke={color} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls />,
              ];
            })}
            {benchmarks.flatMap((benchmark, index) => {
              const middleColor = index === 0 ? "#b7791f" : "#805ad5";
              if (benchmark.display === "middle") {
                return [
                  <Line
                    key={benchmarkField(benchmark, "middle")}
                    type="monotone"
                    dataKey={benchmarkField(benchmark, "middle")}
                    name={`NIC MAP® ${benchmark.propertyType === "Majority IL" ? "IL" : "AL"} middle tier`}
                    stroke={middleColor}
                    strokeWidth={1.75}
                    strokeDasharray="3 3"
                    dot={{ r: 2 }}
                    connectNulls
                  />,
                ];
              }
              return [
                <Line key={benchmarkField(benchmark, "top")} type="monotone" dataKey={benchmarkField(benchmark, "top")} name="NIC MAP® top tier" stroke="#8b7355" strokeWidth={1} strokeDasharray="2 4" dot={false} connectNulls />,
                <Line key={benchmarkField(benchmark, "p75")} type="monotone" dataKey={benchmarkField(benchmark, "p75")} name="NIC MAP® 75th percentile" stroke="#a88b5e" strokeWidth={1} strokeDasharray="5 4" dot={false} connectNulls />,
                <Line key={benchmarkField(benchmark, "middle")} type="monotone" dataKey={benchmarkField(benchmark, "middle")} name="NIC MAP® middle tier" stroke="#b7791f" strokeWidth={2} dot={{ r: 2 }} connectNulls />,
                <Line key={benchmarkField(benchmark, "p25")} type="monotone" dataKey={benchmarkField(benchmark, "p25")} name="NIC MAP® 25th percentile" stroke="#a88b5e" strokeWidth={1} strokeDasharray="5 4" dot={false} connectNulls />,
                <Line key={benchmarkField(benchmark, "bottom")} type="monotone" dataKey={benchmarkField(benchmark, "bottom")} name="NIC MAP® bottom tier" stroke="#8b7355" strokeWidth={1} strokeDasharray="2 4" dot={false} connectNulls />,
              ];
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function RateGrowthDrilldown() {
  const { toast } = useToast();
  const [selection, setSelection] = useState<Selection>({});
  const [history, setHistory] = useState<Selection[]>([]);
  const [showNicMap, setShowNicMap] = useState(false);
  const [exportingRentRoll, setExportingRentRoll] = useState(false);
  const [groupServiceLines, setGroupServiceLines] = useState<Record<string, string>>({
    SNF: "all",
    "Senior Housing": "all",
  });

  const query = useQuery<RateGrowthResponse, RateGrowthError>({
    queryKey: ["/api/overview/rate-growth", selection],
    queryFn: async () => {
      const params = new URLSearchParams();
      Object.entries(selection).forEach(([key, value]) => value && params.set(key, value));
      const response = await fetch(`/api/overview/rate-growth${params.toString() ? `?${params}` : ""}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new RateGrowthError(
          payload?.error || "Unable to load rate history",
          response.status,
        );
      }
      return response.json();
    },
    retry: (failureCount, error) => error.status >= 500 && failureCount < 2,
  });
  const snfServiceLines = useQuery<RateGrowthResponse, RateGrowthError>({
    queryKey: ["/api/overview/rate-growth", "service-line-selector", "SNF"],
    queryFn: async () => {
      const response = await fetch("/api/overview/rate-growth?group=SNF", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new RateGrowthError(payload?.error || "Unable to load SNF service lines", response.status);
      }
      return response.json();
    },
    enabled: query.data?.level === "group",
    retry: (failureCount, error) => error.status >= 500 && failureCount < 2,
  });
  const seniorHousingServiceLines = useQuery<RateGrowthResponse, RateGrowthError>({
    queryKey: ["/api/overview/rate-growth", "service-line-selector", "Senior Housing"],
    queryFn: async () => {
      const response = await fetch("/api/overview/rate-growth?group=Senior%20Housing", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new RateGrowthError(payload?.error || "Unable to load Senior Housing service lines", response.status);
      }
      return response.json();
    },
    enabled: query.data?.level === "group",
    retry: (failureCount, error) => error.status >= 500 && failureCount < 2,
  });

  const data = query.data;
  const selectedNicMapServiceLine =
    data?.selection.serviceLine ??
    (data?.level === "group" ? groupServiceLines["Senior Housing"] : undefined);
  const selectedNicMapPropertyType =
    selectedNicMapServiceLine === "VIL" ? "Majority IL" : "Majority AL";
  const nicMapBenchmarks = (data?.benchmarks ?? []).filter(
    (benchmark) => benchmark.propertyType === selectedNicMapPropertyType,
  );
  const nicMapAvailable = Boolean(
    selectedNicMapServiceLine &&
      NIC_MAP_SERVICE_LINES.has(selectedNicMapServiceLine) &&
      nicMapBenchmarks.length > 0,
  );
  const visibleBenchmarks = nicMapAvailable && showNicMap
    ? nicMapBenchmarks
    : [];
  const visibleSeries = useMemo(
    () => (data?.series ?? []).slice(0, data?.level === "group" || data?.level === "serviceLine" ? 8 : 6),
    [data],
  );
  const serviceLineSeriesByGroup: Record<string, RateGrowthSeries[]> = {
    SNF: snfServiceLines.data?.series ?? [],
    "Senior Housing": seniorHousingServiceLines.data?.series ?? [],
  };
  const drillInto = (next: Selection) => {
    if (next.serviceLine !== selection.serviceLine) setShowNicMap(false);
    setHistory((current) => [...current, selection]);
    setSelection(next);
  };

  const goBack = () => {
    setHistory((current) => {
      const next = [...current];
      const previous = next.pop() ?? {};
      if (previous.serviceLine !== selection.serviceLine) setShowNicMap(false);
      setSelection(previous);
      return next;
    });
  };

  const exportRentRoll = async () => {
    setExportingRentRoll(true);
    try {
      const params = new URLSearchParams();
      Object.entries(selection).forEach(([key, value]) => value && params.set(key, value));
      const response = await fetch(
        `/api/overview/rate-growth/rent-roll.xlsx${params.toString() ? `?${params}` : ""}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Unable to export the rent roll");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/i)?.[1] ??
        "rate-growth-rent-roll.xlsx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Unable to export the rent roll",
        variant: "destructive",
      });
    } finally {
      setExportingRentRoll(false);
    }
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
          <div className="flex items-center gap-2 self-start">
            {data && (
              <Button
                variant="outline"
                size="sm"
                onClick={exportRentRoll}
                disabled={exportingRentRoll}
                data-testid="rate-growth-export-rent-roll"
                className="h-8 text-xs"
              >
                {exportingRentRoll
                  ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  : <Download className="mr-1.5 h-3.5 w-3.5" />}
                Rent roll
              </Button>
            )}
            {history.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={goBack}
                data-testid="rate-growth-back"
                className="h-8 text-xs"
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back
              </Button>
            )}
          </div>
        </div>
        {data && (
          <div className="mt-3 flex flex-wrap items-center gap-1 text-xs" data-testid="rate-growth-breadcrumbs">
            <button
              type="button"
              onClick={() => { setSelection({}); setHistory([]); setShowNicMap(false); }}
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
            <p className="mt-1 text-xs text-red-600">{query.error.message}</p>
            <div className="mt-3 flex justify-center gap-2">
              {history.length > 0 && (
                <Button type="button" variant="outline" size="sm" onClick={goBack} className="h-8 border-red-300 bg-white text-xs text-red-700 hover:bg-red-100">
                  <ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Back
                </Button>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()} className="h-8 border-red-300 bg-white text-xs text-red-700 hover:bg-red-100">
                Try again
              </Button>
            </div>
          </div>
        )}
        {!query.isLoading && !query.isError && data && data.series.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-[var(--dashboard-muted)]" data-testid="rate-growth-empty">
            No rate history is available for this selection.
          </div>
        )}
        {data && data.series.length > 0 && (
          <div className="space-y-4">
            <div
              className={data.level === "group" ? "grid gap-4 lg:grid-cols-2" : ""}
              data-testid="rate-growth-plot"
            >
              {data.level === "group"
                ? visibleSeries.map((series, index) => {
                    const selectedServiceLine = groupServiceLines[series.key] ?? "all";
                    const serviceLineSeries = serviceLineSeriesByGroup[series.key] ?? [];
                    const selectedSeries =
                      selectedServiceLine === "all"
                        ? series
                        : serviceLineSeries.find((item) => item.key === selectedServiceLine) ?? series;
                    return (
                      <RateChart
                        key={series.key}
                        series={[selectedSeries]}
                        benchmarks={
                          series.key === "Senior Housing"
                            ? visibleBenchmarks.filter(
                                (benchmark) =>
                                  !benchmark.appliesToKey || benchmark.appliesToKey === series.key,
                              )
                            : []
                        }
                        colorOffset={index}
                        headingLabel={series.label}
                        serviceLineSelector={{
                          value: selectedServiceLine,
                          options: [
                            { value: "all", label: `All ${series.label}` },
                            ...serviceLineSeries.map((item) => ({ value: item.key, label: item.label })),
                          ],
                          onChange: (value) => {
                            setShowNicMap(false);
                            setGroupServiceLines((current) => ({ ...current, [series.key]: value }));
                          },
                        }}
                      />
                    );
                  })
                : <RateChart series={visibleSeries} benchmarks={visibleBenchmarks} />}
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
              {visibleBenchmarks.length > 0 && (
                <span className="flex items-center gap-1.5"><i className="h-0.5 w-5 border-t-2 border-dashed border-amber-600" /> NIC MAP® rate tiers</span>
              )}
              {nicMapAvailable && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowNicMap((current) => !current)}
                        className="h-7 px-2 text-[11px]"
                        aria-pressed={showNicMap}
                        data-testid="rate-growth-toggle-nic-map"
                      >
                        {showNicMap ? "Hide NIC MAP®" : "Show NIC MAP®"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs leading-relaxed">
                      Shows NIC MAP® quarterly average monthly rent for the matching senior-housing
                      property profile. It is an external market benchmark for context, not a
                      Modulo pricing recommendation or cap.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <span className="ml-auto">{LEVEL_LABEL[data.level]} view</span>
            </div>
            {visibleBenchmarks.length > 0 && (
              <div className="rounded-md border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px] text-amber-950">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {visibleBenchmarks.map((benchmark) => (
                    <span key={benchmark.key}>
                      <strong>{benchmark.label}</strong>
                      {benchmark.matchMethod === "nearby_metro" ? " · nearby-metro match" : ""}
                      {benchmark.matchMethod === "combined_markets" ? " · broad-market reference" : ""}
                    </span>
                  ))}
                  <a
                    href={visibleBenchmarks[0].sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto font-medium underline decoration-amber-700/40 underline-offset-2"
                  >
                    NIC MAP® · {visibleBenchmarks[0].asOf}
                  </a>
                </div>
                <p className="mt-1 text-amber-900/80">
                  Quarterly average monthly rent benchmarks. Market tiers are reference ranges, not pricing caps.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}