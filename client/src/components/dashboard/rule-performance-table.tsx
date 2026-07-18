import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ChevronRight,
  ChevronDown,
  Download,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
  Info,
  LayoutList,
  Rows3,
} from "lucide-react";

// ── Strategy groups ─────────────────────────────────────────────────────────
const PERF_RULE_GROUPS = [
  {
    id: "push",
    label: "High Occ — Below Market",
    description: "Street rate trails comps → push aggressively to close the gap",
    Icon: TrendingUp,
    accent: "#0d9488",
    rowBg: "bg-teal-500/5 border-l-2 border-teal-500/40",
    amtCls: "text-emerald-600",
  },
  {
    id: "hold",
    label: "High Occ — Above Market",
    description: "Leading comps with strong occupancy → hold and protect the premium",
    Icon: ArrowUpRight,
    accent: "#0284c7",
    rowBg: "bg-blue-500/5 border-l-2 border-blue-500/40",
    amtCls: "text-emerald-600",
  },
  {
    id: "concession-al",
    label: "Low AL/MC Occ — Rate Concession",
    description: "Low occupancy → reduce rates to drive AL/MC move-ins",
    Icon: TrendingDown,
    accent: "#dc2626",
    rowBg: "bg-red-500/5 border-l-2 border-red-500/40",
    amtCls: "text-red-600",
  },
  {
    id: "concession-sl",
    label: "Low SL/VIL Occ — Market Align",
    description: "SL/Villas soft on occupancy, above market → align rates down",
    Icon: ArrowDownRight,
    accent: "#d97706",
    rowBg: "bg-amber-500/5 border-l-2 border-amber-500/40",
    amtCls: "text-red-600",
  },
] as const;

interface PerfMetrics {
  unitsImpacted: number;
  unitsSold: number;
  avgDaysToSell: number | null;
  expectedDaysToSell: number | null;
  daysFasterThanExpected: number | null;
  monthlyRevenueImpact: number | null;
  annualRevenueImpact: number | null;
  projected?: boolean;
  dateApplied: string | null;
  method?: "t3" | "rate-delta";
  calc?: {
    t3Before: number;
    t3After: number;
    monthsBefore: number;
    monthsAfter: number;
    extrapolated: boolean;
  } | null;
}

interface DetailRow extends PerfMetrics {
  location: string;
  serviceLine: string;
  roomType: string;
}

interface SummaryRow extends PerfMetrics {
  ruleName: string;
  category: string;
  detail: DetailRow[];
}

interface PerfResponse {
  rows: SummaryRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmtDate = (d: string | null) => {
  if (!d) return "–";
  // Parse as local date to avoid UTC-to-local timezone shift (e.g. 2026-07-01 UTC → Jun 30 local)
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

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

const speedBadge = (n: number | null) => {
  if (n == null) return <span className="text-muted-foreground text-xs">–</span>;
  if (n > 0) return <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 text-[11px]">{fmtDaysFaster(n)}</Badge>;
  if (n < 0) return <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-600 text-[11px]">{fmtDaysFaster(n)}</Badge>;
  return <Badge variant="outline" className="text-[11px]">on pace</Badge>;
};

// ── Display group: one collapsible section of the table, for any grouping ────
interface DisplayGroup {
  id: string;
  label: string;
  accent: string;
  rowBg: string;
  rules: SummaryRow[];
  agg: { units: number; sold: number; monthly: number; annual: number };
}

// ── buildTableRows: flat <tr> array to avoid Fragment injection issues ───────
function buildTableRows({
  groups, showGroupHeaders, groupExpanded,
  expanded, tdCls, onToggleGroup, onToggleRow, onCalcClick,
}: {
  groups: DisplayGroup[];
  showGroupHeaders: boolean;
  groupExpanded: Set<string>;
  expanded: Set<string>;
  tdCls: string;
  onToggleGroup: (id: string) => void;
  onToggleRow: (rowKey: string) => void;
  onCalcClick: (title: string, metrics: PerfMetrics) => void;
}): JSX.Element[] {
  const rows: JSX.Element[] = [];

  for (const g of groups) {
    const gRows = g.rules;
    if (gRows.length === 0) continue;
    const agg = g.agg;
    const isGroupOpen = !showGroupHeaders || groupExpanded.has(g.id);

    // Group header row — clickable in both modes
    if (showGroupHeaders) rows.push(
      <tr
        key={`group-${g.id}`}
        className={`transition-colors hover:brightness-95 cursor-pointer ${g.rowBg}`}
        onClick={() => onToggleGroup(g.id)}
      >
        <td className="px-3 py-2.5 font-semibold text-sm border-b border-border/70" style={{ minWidth: 260 }}>
          <span className="inline-flex items-center gap-2">
            {isGroupOpen
              ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: g.accent }} />
              : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: g.accent }} />
            }
            <span style={{ color: g.accent }}>{g.label}</span>
            <span className="text-[11px] font-normal text-muted-foreground ml-1">
              {gRows.length} rule{gRows.length !== 1 ? "s" : ""}
            </span>
          </span>
        </td>
        <td className="px-3 py-2.5 text-xs text-muted-foreground border-b border-border/70">—</td>
        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-sm border-b border-border/70">
          {agg.units.toLocaleString()}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-sm border-b border-border/70">
          {agg.sold.toLocaleString()}
        </td>
        <td className="px-3 py-2.5 border-b border-border/70" />
        <td className={`px-3 py-2.5 text-right tabular-nums font-medium text-sm border-b border-border/70 ${agg.monthly >= 0 ? "text-emerald-600" : "text-red-600"}`}>
          {fmtMoney(agg.monthly)}
        </td>
        <td className={`px-3 py-2.5 text-right tabular-nums font-semibold text-sm border-b border-border/70 ${agg.annual >= 0 ? "text-emerald-600" : "text-red-600"}`}>
          {fmtMoney(agg.annual)}
        </td>
      </tr>
    );

    // Individual rules — shown when group is expanded (both summary and detail mode)
    if (isGroupOpen) {
      for (const r of gRows) {
        const rowKey = `${g.id}|${r.ruleName}`;
        const open = expanded.has(rowKey);

        rows.push(
          <tr
            key={`rule-${rowKey}`}
            className="cursor-pointer bg-background hover:bg-muted/40 transition-colors"
            onClick={() => onToggleRow(rowKey)}
          >
            <td className={`${tdCls} font-medium pl-8`}>
              <span className="inline-flex items-center gap-1.5">
                {open
                  ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                <span className="whitespace-normal text-sm">{r.ruleName}</span>
              </span>
            </td>
            <td className={tdCls}>{fmtDate(r.dateApplied)}</td>
            <td className={`${tdCls} text-right tabular-nums`}>{r.unitsImpacted.toLocaleString()}</td>
            <td className={`${tdCls} text-right tabular-nums`}>{r.unitsSold.toLocaleString()}</td>
            <td className={tdCls}>{speedBadge(r.daysFasterThanExpected)}</td>
            <td
              className={`${tdCls} text-right tabular-nums cursor-pointer underline decoration-dotted underline-offset-2 ${(r.monthlyRevenueImpact ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}
              onClick={(e) => { e.stopPropagation(); onCalcClick(r.ruleName, r); }}
            >
              {fmtMoney(r.monthlyRevenueImpact)}
            </td>
            <td
              className={`${tdCls} text-right tabular-nums font-medium cursor-pointer underline decoration-dotted underline-offset-2 ${(r.annualRevenueImpact ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}
              onClick={(e) => { e.stopPropagation(); onCalcClick(r.ruleName, r); }}
            >
              {fmtMoney(r.annualRevenueImpact)}
            </td>
          </tr>
        );

        // Location / SL / RT detail rows
        if (open) {
          for (const d of r.detail) {
            const dKey = `detail-${r.ruleName}|${d.location}|${d.serviceLine}|${d.roomType}`;
            rows.push(
              <tr key={dKey} className="bg-muted/20">
                <td className={`${tdCls} pl-14 text-muted-foreground text-xs`}>
                  {d.location} · {d.serviceLine} · {d.roomType}
                </td>
                <td className={`${tdCls} text-xs`}>{fmtDate(d.dateApplied)}</td>
                <td className={`${tdCls} text-right tabular-nums text-xs`}>{d.unitsImpacted.toLocaleString()}</td>
                <td className={`${tdCls} text-right tabular-nums text-xs`}>{d.unitsSold.toLocaleString()}</td>
                <td className={`${tdCls} text-xs`}>{fmtDaysFaster(d.daysFasterThanExpected)}</td>
                <td
                  className={`${tdCls} text-right tabular-nums text-xs cursor-pointer underline decoration-dotted underline-offset-2`}
                  onClick={() => onCalcClick(`${r.ruleName} — ${d.location} · ${d.serviceLine} · ${d.roomType}`, d)}
                >
                  {fmtMoney(d.monthlyRevenueImpact)}
                </td>
                <td
                  className={`${tdCls} text-right tabular-nums text-xs cursor-pointer underline decoration-dotted underline-offset-2`}
                  onClick={() => onCalcClick(`${r.ruleName} — ${d.location} · ${d.serviceLine} · ${d.roomType}`, d)}
                >
                  {fmtMoney(d.annualRevenueImpact)}
                </td>
              </tr>
            );
          }
        }
      }
    }
  }

  return rows;
}

// ── Props ────────────────────────────────────────────────────────────────────
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
  const [start, setStart] = useState(() => isoDaysAgo(180));
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [groupExpanded, setGroupExpanded] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"summary" | "detail">("summary");
  const [groupBy, setGroupBy] = useState<"strategy" | "rule" | "serviceLine" | "campus">("strategy");
  const [calcOpen, setCalcOpen] = useState<{ title: string; metrics: PerfMetrics } | null>(null);

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

  const toggleRow = (rule: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(rule) ? next.delete(rule) : next.add(rule);
      return next;
    });

  const toggleGroup = (id: string) =>
    setGroupExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const aggOf = (rs: { unitsImpacted: number; unitsSold: number; monthlyRevenueImpact: number | null; annualRevenueImpact: number | null }[]) => {
    const a = { units: 0, sold: 0, monthly: 0, annual: 0 };
    for (const r of rs) {
      a.units += r.unitsImpacted;
      a.sold += r.unitsSold;
      a.monthly += r.monthlyRevenueImpact ?? 0;
      a.annual += r.annualRevenueImpact ?? 0;
    }
    return a;
  };

  // Build display groups for the selected grouping
  const displayGroups = useMemo<DisplayGroup[]>(() => {
    if (groupBy === "strategy") {
      return PERF_RULE_GROUPS.map((g) => {
        const gRows = rows.filter((r) => (r.category || "hold") === g.id);
        return { id: g.id, label: g.label, accent: g.accent, rowBg: g.rowBg, rules: gRows, agg: aggOf(gRows) };
      });
    }
    if (groupBy === "rule") {
      return [{ id: "all", label: "All Rules", accent: "#334155", rowBg: "", rules: rows, agg: aggOf(rows) }];
    }
    // serviceLine / campus — regroup detail rows by key, then re-aggregate per rule within each key
    const byKey = new Map<string, Map<string, DetailRow[]>>();
    const ruleDate = new Map<string, string | null>();
    for (const r of rows) {
      ruleDate.set(r.ruleName, r.dateApplied);
      for (const d of r.detail) {
        const key = groupBy === "serviceLine" ? d.serviceLine : d.location;
        if (!byKey.has(key)) byKey.set(key, new Map());
        const ruleMap = byKey.get(key)!;
        if (!ruleMap.has(r.ruleName)) ruleMap.set(r.ruleName, []);
        ruleMap.get(r.ruleName)!.push(d);
      }
    }
    const palette = [
      { accent: "#0d9488", rowBg: "bg-teal-500/5 border-l-2 border-teal-500/40" },
      { accent: "#0284c7", rowBg: "bg-blue-500/5 border-l-2 border-blue-500/40" },
      { accent: "#7c3aed", rowBg: "bg-violet-500/5 border-l-2 border-violet-500/40" },
      { accent: "#d97706", rowBg: "bg-amber-500/5 border-l-2 border-amber-500/40" },
      { accent: "#db2777", rowBg: "bg-pink-500/5 border-l-2 border-pink-500/40" },
      { accent: "#059669", rowBg: "bg-emerald-500/5 border-l-2 border-emerald-500/40" },
    ];
    return Array.from(byKey.keys()).sort((a, b) => a.localeCompare(b)).map((key, i) => {
      const ruleMap = byKey.get(key)!;
      const synthRules: SummaryRow[] = Array.from(ruleMap.entries()).map(([ruleName, details]) => {
        const a = aggOf(details);
        return {
          ruleName,
          category: key,
          detail: details,
          unitsImpacted: a.units,
          unitsSold: a.sold,
          avgDaysToSell: null,
          expectedDaysToSell: null,
          daysFasterThanExpected: null,
          monthlyRevenueImpact: a.monthly,
          annualRevenueImpact: a.annual,
          dateApplied: ruleDate.get(ruleName) ?? null,
        };
      });
      const c = palette[i % palette.length];
      return { id: key, label: key, accent: c.accent, rowBg: c.rowBg, rules: synthRules, agg: aggOf(synthRules) };
    });
  }, [rows, groupBy]);

  const totals = useMemo(() => {
    const t = { unitsImpacted: 0, unitsSold: 0, monthly: 0, annual: 0 };
    for (const r of rows) {
      t.unitsImpacted += r.unitsImpacted;
      t.unitsSold += r.unitsSold;
      t.monthly += r.monthlyRevenueImpact ?? 0;
      t.annual += r.annualRevenueImpact ?? 0;
    }
    return t;
  }, [rows]);

  const handleExport = () => {
    const groupHeader = groupBy === "strategy" ? "Strategy" : groupBy === "rule" ? "Group" : groupBy === "serviceLine" ? "Service Line" : "Campus";
    const header = [groupHeader, "Rule", "Location", "Service Line", "Room Type", "Date Applied",
      "Units Impacted", "New Move-ins", "Monthly Impact", "Annual Impact"];
    const aoa: (string | number | null)[][] = [header];
    for (const g of displayGroups) {
      for (const r of g.rules) {
        aoa.push([g.label, r.ruleName, "All", "All", "All", fmtDate(r.dateApplied),
          r.unitsImpacted, r.unitsSold, r.monthlyRevenueImpact, r.annualRevenueImpact]);
        for (const d of r.detail) {
          aoa.push([g.label, r.ruleName, d.location, d.serviceLine, d.roomType, fmtDate(d.dateApplied),
            d.unitsImpacted, d.unitsSold, d.monthlyRevenueImpact, d.annualRevenueImpact]);
        }
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
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
              Pricing rule results grouped by {groupBy === "strategy" ? "strategy" : groupBy === "rule" ? "rule" : groupBy === "serviceLine" ? "service line" : "campus"} — units impacted, move-ins, and revenue impact.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)}
                className="h-8 w-[140px] text-xs" data-testid="input-perf-start" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)}
                className="h-8 w-[140px] text-xs" data-testid="input-perf-end" />
            </div>
            {/* Group-by selector */}
            <div className="flex rounded-md border border-border overflow-hidden" data-testid="group-perf-groupby">
              {([
                { id: "strategy", label: "Strategy" },
                { id: "rule", label: "Rule" },
                { id: "serviceLine", label: "Service Line" },
                { id: "campus", label: "Campus" },
              ] as const).map((opt, i) => (
                <button
                  key={opt.id}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${i > 0 ? "border-l border-border" : ""} ${groupBy === opt.id ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                  onClick={() => { setGroupBy(opt.id); setViewMode("summary"); setGroupExpanded(new Set()); setExpanded(new Set()); }}
                  disabled={rows.length === 0}
                  data-testid={`button-perf-groupby-${opt.id}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {/* Summary / Detail toggle */}
            <div className="flex rounded-md border border-border overflow-hidden">
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "summary" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                onClick={() => { setViewMode("summary"); setGroupExpanded(new Set()); setExpanded(new Set()); }}
                disabled={rows.length === 0}
              >
                <Rows3 className="h-3.5 w-3.5" />Summary
              </button>
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${viewMode === "detail" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                onClick={() => {
                  setViewMode("detail");
                  setGroupExpanded(new Set(displayGroups.map((g) => g.id)));
                  if (groupBy === "rule") setExpanded(new Set(rows.map((r) => `all|${r.ruleName}`)));
                }}
                disabled={rows.length === 0}
              >
                <LayoutList className="h-3.5 w-3.5" />Detail
              </button>
            </div>
            <Button variant="outline" size="sm" className="h-8" onClick={handleExport}
              disabled={rows.length === 0} data-testid="button-perf-export">
              <Download className="mr-1.5 h-3.5 w-3.5" />Export
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading rule performance…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground" data-testid="text-perf-empty">
            No pricing rules were applied between {fmtDate(start)} and {fmtDate(end)}.
            <div className="mt-1 text-xs">Try widening the date range, or apply rules from the Rule Designer above.</div>
          </div>
        ) : (
          <>
            {/* Summary strip */}
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Rules Applied</div>
                <div className="text-lg font-semibold">{rows.length}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Units Impacted</div>
                <div className="text-lg font-semibold">{totals.unitsImpacted.toLocaleString()}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">New Move-ins</div>
                <div className="text-lg font-semibold">{totals.unitsSold.toLocaleString()}</div>
                <div className="text-[10px] text-muted-foreground">admitted after rule applied</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Est. Annual Rate Impact</div>
                <div className={`text-lg font-semibold ${totals.annual >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {fmtMoney(totals.annual)}
                </div>
                <div className="text-[10px] text-muted-foreground">rate adj. to all impacted units</div>
              </div>
            </div>

            <div className="overflow-auto rounded-md border border-border" style={{ maxHeight: 560 }}>
              <table className="w-full border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className={thCls} style={{ minWidth: 260 }}>
                      {groupBy === "strategy" ? "Strategy / Rule" : groupBy === "rule" ? "Rule" : groupBy === "serviceLine" ? "Service Line / Rule" : "Campus / Rule"}
                    </th>
                    <th className={thCls}>Date Applied</th>
                    <th className={`${thCls} text-right`}>Units Impacted</th>
                    <th className={`${thCls} text-right`}>New Move-ins</th>
                    <th className={thCls}>Speed vs. Expected</th>
                    <th className={`${thCls} text-right`}>Monthly Impact</th>
                    <th className={`${thCls} text-right`}>Annual Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {buildTableRows({
                    groups: displayGroups,
                    showGroupHeaders: groupBy !== "rule",
                    groupExpanded,
                    expanded,
                    tdCls,
                    onToggleGroup: toggleGroup,
                    onToggleRow: toggleRow,
                    onCalcClick: (title, metrics) => setCalcOpen({ title, metrics }),
                  })}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
              {groupBy === "rule"
                ? "Click a rule row to see the breakdown by location, service line, and room type."
                : "Click any group row to expand and see individual rules. Click a rule row to see the breakdown by location, service line, and room type."}{" "}
              Switch to <span className="font-medium">Detail</span> to expand all groups at once.{" "}
              <span className="font-medium">Revenue impact</span>: historical pricing changes compare actual occupied-room revenue for the 3 months before vs. after the change; active rules sum the rate adjustment across impacted units. Click any impact value for the full calculation.
            </p>
          </>
        )}
      </CardContent>

      {/* Calculation explanation dialog */}
      <Dialog open={!!calcOpen} onOpenChange={(o) => !o && setCalcOpen(null)}>
        <DialogContent className="max-w-md" data-testid="dialog-perf-calc">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-4 w-4 text-emerald-600" />
              How this impact is calculated
            </DialogTitle>
            <DialogDescription className="whitespace-normal break-words">{calcOpen?.title}</DialogDescription>
          </DialogHeader>
          {calcOpen?.metrics.monthlyRevenueImpact != null ? (
            calcOpen.metrics.method === "t3" && calcOpen.metrics.calc ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Units impacted</span>
                    <span className="font-medium tabular-nums">{calcOpen.metrics.unitsImpacted.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="text-muted-foreground">
                      Avg monthly revenue before
                      <span className="block text-[10px]">occupied rooms, {calcOpen.metrics.calc.monthsBefore} month{calcOpen.metrics.calc.monthsBefore === 1 ? "" : "s"} before the change</span>
                    </span>
                    <span className="font-medium tabular-nums">{fmtMoney(calcOpen.metrics.calc.t3Before)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Avg monthly revenue after
                      <span className="block text-[10px]">occupied rooms, {calcOpen.metrics.calc.monthsAfter} month{calcOpen.metrics.calc.monthsAfter === 1 ? "" : "s"} after the change{calcOpen.metrics.calc.extrapolated ? " (all available so far)" : ""}</span>
                    </span>
                    <span className="font-medium tabular-nums">{fmtMoney(calcOpen.metrics.calc.t3After)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <span className="font-medium">Monthly revenue impact (after − before)</span>
                    <span className={`font-semibold tabular-nums ${(calcOpen.metrics.monthlyRevenueImpact ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtMoney(calcOpen.metrics.monthlyRevenueImpact)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Annual revenue impact (monthly × 12)</span>
                    <span className={`font-semibold tabular-nums ${(calcOpen.metrics.annualRevenueImpact ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtMoney(calcOpen.metrics.annualRevenueImpact)}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p>For historical pricing changes, impact is measured from actual results: the average monthly revenue of occupied rooms in the matching location, service line, and room type for the 3 months before the change, compared to the 3 months after. HC and HC/MC daily rates are converted to monthly (× 30.4).</p>
                  {calcOpen.metrics.calc.extrapolated && (
                    <p>Fewer than 3 months have passed since this change, so the average of the months available so far is used as the monthly run-rate and extrapolated to annual.</p>
                  )}
                </div>
              </div>
            ) : (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Units impacted</span>
                  <span className="font-medium tabular-nums">{calcOpen.metrics.unitsImpacted.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="font-medium">Monthly rate impact</span>
                  <span className={`font-semibold tabular-nums ${(calcOpen.metrics.monthlyRevenueImpact ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtMoney(calcOpen.metrics.monthlyRevenueImpact)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Annual rate impact (monthly × 12)</span>
                  <span className={`font-semibold tabular-nums ${(calcOpen.metrics.annualRevenueImpact ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {fmtMoney(calcOpen.metrics.annualRevenueImpact)}
                  </span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground space-y-1.5">
                <p>Impact = sum of the rate adjustment applied to each impacted unit (rule-adjusted rate − street rate). HC and HC/MC daily rates are converted to monthly (× 30.4) before summing.</p>
                <p>When multiple rules stack on a unit, each rule is credited with its proportional share of the combined adjustment so nothing is double-counted.</p>
              </div>
            </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              No rate adjustment data available for this rule in the selected date range.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
