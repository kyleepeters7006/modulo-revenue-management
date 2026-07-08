import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ChevronRight,
  ChevronDown,
  Download,
  TrendingUp,
  Loader2,
  ListTree,
  List,
} from "lucide-react";

interface PerfMetrics {
  unitsImpacted: number;
  unitsSold: number;
  avgDaysToSell: number | null;
  expectedDaysToSell: number | null;
  daysFasterThanExpected: number | null;
  monthlyRevenueImpact: number;
  annualRevenueImpact: number;
  realizedMonthlyImpact: number;
  dateApplied: string | null;
}

interface DetailRow extends PerfMetrics {
  location: string;
  serviceLine: string;
  roomType: string;
}

interface SummaryRow extends PerfMetrics {
  ruleName: string;
  detail: DetailRow[];
}

interface PerfResponse {
  rows: SummaryRow[];
  start: string;
  end: string;
  spotMonth?: string;
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "–";

const fmtMoney = (n: number | null | undefined) =>
  n == null ? "–" : `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString()}`;

const fmtDaysFaster = (n: number | null) => {
  if (n == null) return "–";
  if (n > 0) return `${n} days faster`;
  if (n < 0) return `${Math.abs(n)} days slower`;
  return "on pace";
};

const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

interface RulePerformanceTableProps {
  selectedServiceLine?: string;
  selectedRegions?: string[];
  selectedDivisions?: string[];
  selectedLocations?: string[];
}

export function RulePerformanceTable({
  selectedServiceLine,
  selectedRegions,
  selectedDivisions,
  selectedLocations,
}: RulePerformanceTableProps = {}) {
  const [start, setStart] = useState(() => isoDaysAgo(90));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailMode, setDetailMode] = useState(false);

  const { data, isLoading, isFetching } = useQuery<PerfResponse>({
    queryKey: ["/api/rule-performance", start, end, selectedServiceLine, selectedRegions, selectedDivisions, selectedLocations],
    queryFn: async () => {
      const params = new URLSearchParams({ start, end });
      if (selectedServiceLine && selectedServiceLine !== "All") params.append("serviceLine", selectedServiceLine);
      if (selectedRegions?.length) params.append("regions", selectedRegions.join(","));
      if (selectedDivisions?.length) params.append("divisions", selectedDivisions.join(","));
      if (selectedLocations?.length) params.append("locations", selectedLocations.join(","));
      const res = await fetch(`/api/rule-performance?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    placeholderData: keepPreviousData,
  });

  const rows = data?.rows ?? [];

  const toggleRow = (rule: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rule)) next.delete(rule);
      else next.add(rule);
      return next;
    });
  };

  const toggleDetailMode = () => {
    if (detailMode) {
      setDetailMode(false);
      setExpanded(new Set());
    } else {
      setDetailMode(true);
      setExpanded(new Set(rows.map((r) => r.ruleName)));
    }
  };

  const totals = useMemo(() => {
    const t = { unitsImpacted: 0, unitsSold: 0, monthly: 0, annual: 0 };
    for (const r of rows) {
      t.unitsImpacted += r.unitsImpacted;
      t.unitsSold += r.unitsSold;
      t.monthly += r.monthlyRevenueImpact;
      t.annual += r.annualRevenueImpact;
    }
    return t;
  }, [rows]);

  const handleExport = () => {
    const header = [
      "Rule", "Location", "Service Line", "Room Type", "Date Applied",
      "Units Impacted", "Units Sold", "Avg Days to Sell", "Expected Days to Sell",
      "Days Faster Than Expected", "Monthly Revenue Impact", "Annual Revenue Impact",
    ];
    const aoa: (string | number | null)[][] = [header];
    for (const r of rows) {
      aoa.push([
        r.ruleName, "All", "All", "All", fmtDate(r.dateApplied),
        r.unitsImpacted, r.unitsSold, r.avgDaysToSell, r.expectedDaysToSell,
        r.daysFasterThanExpected, r.monthlyRevenueImpact, r.annualRevenueImpact,
      ]);
      for (const d of r.detail) {
        aoa.push([
          r.ruleName, d.location, d.serviceLine, d.roomType, fmtDate(d.dateApplied),
          d.unitsImpacted, d.unitsSold, d.avgDaysToSell, d.expectedDaysToSell,
          d.daysFasterThanExpected, d.monthlyRevenueImpact, d.annualRevenueImpact,
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wpx: 240 }, { wpx: 140 }, { wpx: 80 }, { wpx: 110 }, { wpx: 90 },
      { wpx: 90 }, { wpx: 70 }, { wpx: 100 }, { wpx: 120 }, { wpx: 140 }, { wpx: 130 }, { wpx: 130 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rule Performance");
    XLSX.writeFile(wb, `Rule_Performance_${start}_to_${end}.xlsx`);
  };

  const thCls = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap bg-muted/60 border-b border-border";
  const tdCls = "px-3 py-2 text-sm whitespace-nowrap border-b border-border/50";

  return (
    <Card data-testid="card-rule-performance">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
              <CardTitle className="text-lg">Rule Performance Over Time</CardTitle>
              {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <CardDescription className="mt-1">
              How each pricing rule performed: units impacted, units sold, speed to sell vs. expected, and revenue impact.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={start}
                max={end}
                onChange={(e) => setStart(e.target.value)}
                className="h-8 w-[140px] text-xs"
                data-testid="input-perf-start"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
                className="h-8 w-[140px] text-xs"
                data-testid="input-perf-end"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={toggleDetailMode}
              disabled={rows.length === 0}
              data-testid="button-perf-detail-toggle"
            >
              {detailMode ? <List className="mr-1.5 h-3.5 w-3.5" /> : <ListTree className="mr-1.5 h-3.5 w-3.5" />}
              {detailMode ? "Summary View" : "View Detail"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={handleExport}
              disabled={rows.length === 0}
              data-testid="button-perf-export"
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export to Excel
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading rule performance…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground" data-testid="text-perf-empty">
            No pricing rules were applied between {fmtDate(start)} and {fmtDate(end)}.
            <div className="mt-1 text-xs">Try widening the date range, or apply rules from the Rule Designer above.</div>
          </div>
        ) : (
          <>
            {/* Leadership summary strip */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="perf-summary-strip">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Rules Applied</div>
                <div className="text-lg font-semibold">{rows.length}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Units Impacted</div>
                <div className="text-lg font-semibold">{totals.unitsImpacted.toLocaleString()}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Units Sold</div>
                <div className="text-lg font-semibold">{totals.unitsSold.toLocaleString()}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Annual Revenue Impact</div>
                <div className={`text-lg font-semibold ${totals.annual >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {fmtMoney(totals.annual)}
                </div>
              </div>
            </div>

            <div
              className="overflow-auto rounded-md border border-border"
              style={{ maxHeight: 520, WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
            >
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={thCls} style={{ minWidth: 260 }}>Rule</th>
                    <th className={thCls}>Date Applied</th>
                    <th className={`${thCls} text-right`}>Units Impacted</th>
                    <th className={`${thCls} text-right`}>Units Sold</th>
                    <th className={thCls}>Speed vs. Expected</th>
                    <th className={`${thCls} text-right`}>Monthly Impact</th>
                    <th className={`${thCls} text-right`}>Annual Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const open = expanded.has(r.ruleName);
                    return (
                      <RowGroup
                        key={r.ruleName}
                        row={r}
                        open={open}
                        onToggle={() => toggleRow(r.ruleName)}
                        tdCls={tdCls}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Speed vs. Expected compares the average days-to-sell of units sold after the rule was applied
              against the historical average days vacant for the same service line and room type. Revenue
              impact is the change from street rate to the rule-adjusted rate (shared proportionally when
              multiple rules stack on a unit), stated monthly and annualized.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RowGroup({
  row,
  open,
  onToggle,
  tdCls,
}: {
  row: SummaryRow;
  open: boolean;
  onToggle: () => void;
  tdCls: string;
}) {
  const speedBadge = (n: number | null) => {
    if (n == null) return <span className="text-muted-foreground">–</span>;
    if (n > 0)
      return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">{fmtDaysFaster(n)}</Badge>;
    if (n < 0)
      return <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400">{fmtDaysFaster(n)}</Badge>;
    return <Badge variant="outline">on pace</Badge>;
  };

  return (
    <>
      <tr
        className="cursor-pointer bg-background hover:bg-muted/40 transition-colors"
        onClick={onToggle}
        data-testid={`row-perf-${row.ruleName}`}
      >
        <td className={`${tdCls} font-medium`}>
          <span className="inline-flex items-center gap-1.5">
            {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
            <span className="whitespace-normal">{row.ruleName}</span>
          </span>
        </td>
        <td className={tdCls}>{fmtDate(row.dateApplied)}</td>
        <td className={`${tdCls} text-right tabular-nums`}>{row.unitsImpacted.toLocaleString()}</td>
        <td className={`${tdCls} text-right tabular-nums`}>{row.unitsSold.toLocaleString()}</td>
        <td className={tdCls}>{speedBadge(row.daysFasterThanExpected)}</td>
        <td className={`${tdCls} text-right tabular-nums ${row.monthlyRevenueImpact >= 0 ? "text-emerald-600" : "text-red-600"}`}>
          {fmtMoney(row.monthlyRevenueImpact)}
        </td>
        <td className={`${tdCls} text-right tabular-nums font-medium ${row.annualRevenueImpact >= 0 ? "text-emerald-600" : "text-red-600"}`}>
          {fmtMoney(row.annualRevenueImpact)}
        </td>
      </tr>
      {open &&
        row.detail.map((d) => (
          <tr key={`${row.ruleName}|${d.location}|${d.serviceLine}|${d.roomType}`} className="bg-muted/20">
            <td className={`${tdCls} pl-10 text-muted-foreground`}>
              {d.location} · {d.serviceLine} · {d.roomType}
            </td>
            <td className={tdCls}>{fmtDate(d.dateApplied)}</td>
            <td className={`${tdCls} text-right tabular-nums`}>{d.unitsImpacted.toLocaleString()}</td>
            <td className={`${tdCls} text-right tabular-nums`}>{d.unitsSold.toLocaleString()}</td>
            <td className={`${tdCls} text-xs`}>{fmtDaysFaster(d.daysFasterThanExpected)}</td>
            <td className={`${tdCls} text-right tabular-nums text-xs`}>{fmtMoney(d.monthlyRevenueImpact)}</td>
            <td className={`${tdCls} text-right tabular-nums text-xs`}>{fmtMoney(d.annualRevenueImpact)}</td>
          </tr>
        ))}
    </>
  );
}
