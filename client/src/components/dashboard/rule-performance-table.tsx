import { useMemo, useState, useRef } from "react";
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
  ChartScatter,
  Trophy,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from "lucide-react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

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
    id: "ih-below-street",
    label: "High Occ — In-House Below Street",
    description: "High occupancy with in-house rates below street rates → raise street to grow the spread",
    Icon: ArrowUpRight,
    accent: "#16a34a",
    rowBg: "bg-green-500/5 border-l-2 border-green-500/40",
    amtCls: "text-emerald-600",
  },
  {
    id: "ensure",
    label: "Street Rate Catch-Up — Below In-House",
    description: "High occupancy but street rates below in-house rates → raise street 1–10% to close the gap",
    Icon: ArrowUpRight,
    accent: "#0891b2",
    rowBg: "bg-cyan-500/5 border-l-2 border-cyan-500/40",
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
  // April 2026 cycle — different strategy taxonomy (April workbook Logic tab)
  {
    id: "apr-push",
    label: "Apr: 95%+ Occ — $500+ Below Competitor",
    description: "Senior Housing at 95%+ occupancy since Jan 1 (5+ units), priced $500 or more below comps → +5%",
    Icon: TrendingUp,
    accent: "#0d9488",
    rowBg: "bg-teal-500/5 border-l-2 border-teal-500/40",
    amtCls: "text-emerald-600",
  },
  {
    id: "apr-hold",
    label: "Apr: 95%+ Occ — Near/Above Competitor",
    description: "Senior Housing at 95%+ occupancy since Jan 1 (5+ units), within $500 of or above comps → +2.5%",
    Icon: ArrowUpRight,
    accent: "#0284c7",
    rowBg: "bg-blue-500/5 border-l-2 border-blue-500/40",
    amtCls: "text-emerald-600",
  },
  {
    id: "apr-qmix",
    label: "Apr: Health Center — Strong Q-Mix",
    description: "Q-Mix above 40%, at/above Q-Mix ADC budget, HC occupancy above 92%, room type avg above 90% → +2.5%",
    Icon: ArrowUpRight,
    accent: "#0891b2",
    rowBg: "bg-cyan-500/5 border-l-2 border-cyan-500/40",
    amtCls: "text-emerald-600",
  },
  {
    id: "apr-decrease",
    label: "Apr: Low / Falling Occupancy — Decrease",
    description: "Below 80% occupancy since Jan 1, or lost 10% occupancy in March vs Jan/Feb average → −5%",
    Icon: TrendingDown,
    accent: "#dc2626",
    rowBg: "bg-red-500/5 border-l-2 border-red-500/40",
    amtCls: "text-red-600",
  },
  {
    id: "apr-custom",
    label: "Apr: Targeted Adjustments",
    description: "Campus-specific rate tuning outside the standard April strategy tiers",
    Icon: ArrowUpRight,
    accent: "#64748b",
    rowBg: "bg-slate-500/5 border-l-2 border-slate-500/40",
    amtCls: "text-emerald-600",
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
  moveInsPerMonth?: number;
  rateDeltaBefore?: number | null;
  rateDeltaAfter?: number | null;
  projected?: boolean;
  dateApplied: string | null;
  method?: "t3" | "rate-delta";
  calc?: {
    t3Before: number;
    t3After: number;
    occBefore: number;
    occAfter: number;
    monthsBefore: number;
    monthsAfter: number;
    extrapolated: boolean;
    moveInsT3Before?: number | null;
    moveInsT3After?: number | null;
    occPctBefore?: number | null;
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
  isHistorical?: boolean;
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
  agg: { units: number; sold: number; monthly: number; annual: number; miDelta: number | null };
}

// Increase in T3 move-ins/month (after − before) from the calc payload
const miDeltaOf = (m: { calc?: PerfMetrics["calc"] }): number | null => {
  const c = m.calc;
  if (!c || c.moveInsT3Before == null || c.moveInsT3After == null) return null;
  return c.moveInsT3After - c.moveInsT3Before;
};

const fmtMiDelta = (v: number | null): JSX.Element => {
  if (v == null) return <span className="text-muted-foreground">—</span>;
  const r = Math.round(v * 10) / 10;
  const cls = r > 0 ? "text-emerald-600" : r < 0 ? "text-red-600" : "text-muted-foreground";
  return <span className={cls}>{r > 0 ? "+" : ""}{r.toFixed(1)}</span>;
};

// ── RoomVerification: occupied-room drill-down for the T3 calc dialog ────────
interface RoomDetailMonth {
  month: string;
  units: { roomNumber: string; roomType: string; monthlyRate: number }[];
  occupiedCount: number;
  totalRevenue: number;
  excludedNonPrivatePay: number;
}
interface RoomDetailResponse {
  before: RoomDetailMonth[];
  after: RoomDetailMonth[];
}
type CalcGroup = { location: string; serviceLine: string; roomTypes: string[] };

// Derive verification groups from a calc-dialog metrics object: a detail row
// carries its own location/serviceLine/roomType; a summary row carries a
// detail[] breakdown — merge room types per (location, serviceLine).
const calcGroupsOf = (m: PerfMetrics): CalcGroup[] => {
  const anyM = m as any;
  if (anyM.location && anyM.serviceLine) {
    return [{ location: anyM.location, serviceLine: anyM.serviceLine, roomTypes: anyM.roomType ? [anyM.roomType] : [] }];
  }
  if (Array.isArray(anyM.detail) && anyM.detail.length) {
    const map = new Map<string, CalcGroup>();
    for (const d of anyM.detail) {
      const k = `${d.location}|${d.serviceLine}`;
      if (!map.has(k)) map.set(k, { location: d.location, serviceLine: d.serviceLine, roomTypes: [] });
      if (d.roomType && !map.get(k)!.roomTypes.includes(d.roomType)) map.get(k)!.roomTypes.push(d.roomType);
    }
    return Array.from(map.values());
  }
  return [];
};

const fmtMonthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

function RoomVerification({ groups, month, calcT3Before }: { groups: CalcGroup[]; month: string; calcT3Before?: number | null }) {
  const [open, setOpen] = useState(false);
  const [groupIdx, setGroupIdx] = useState(0);
  const g = groups[Math.min(groupIdx, groups.length - 1)];

  const { data, isLoading } = useQuery<RoomDetailResponse>({
    queryKey: ["/api/rule-performance/room-detail", g?.location, g?.serviceLine, g?.roomTypes.join(","), month],
    queryFn: async () => {
      const p = new URLSearchParams({ location: g.location, serviceLine: g.serviceLine, month });
      if (g.roomTypes.length) p.set("roomTypes", g.roomTypes.join(","));
      const r = await fetch(`/api/rule-performance/room-detail?${p.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load room detail");
      return r.json();
    },
    enabled: open && !!g,
  });

  if (!groups.length || !month) return null;

  const monthBlock = (m: RoomDetailMonth) => (
    <div key={m.month} className="rounded border border-border bg-background">
      <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-muted/40 text-[11px]">
        <span className="font-semibold">{fmtMonthLabel(m.month)}</span>
        <span className="text-muted-foreground tabular-nums">{m.occupiedCount} occ · {fmtMoney(m.totalRevenue)}</span>
      </div>
      <div className="max-h-40 overflow-y-auto">
        <table className="w-full text-[11px]">
          <tbody>
            {m.units.map((u, i) => (
              <tr key={i} className="border-b border-border/40 last:border-0">
                <td className="px-2 py-0.5">{u.roomNumber}</td>
                <td className="px-2 py-0.5 text-muted-foreground">{u.roomType}</td>
                <td className="px-2 py-0.5 text-right tabular-nums">{fmtMoney(u.monthlyRate)}</td>
              </tr>
            ))}
            {m.units.length === 0 && (
              <tr><td className="px-2 py-1 text-muted-foreground" colSpan={3}>No occupied rooms</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {m.excludedNonPrivatePay > 0 && (
        <div className="px-2 py-1 text-[10px] text-muted-foreground border-t border-border/40">
          {m.excludedNonPrivatePay} occupied non-private-pay room{m.excludedNonPrivatePay === 1 ? "" : "s"} excluded
        </div>
      )}
    </div>
  );

  const avgOf = (arr: RoomDetailMonth[] | undefined, f: (m: RoomDetailMonth) => number) =>
    arr && arr.length ? arr.reduce((s, m) => s + f(m), 0) / arr.length : null;

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
        onClick={() => setOpen(o => !o)}
        data-testid="button-room-verification"
      >
        <span className="font-medium">Occupied rooms behind these numbers</span>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {groups.length > 1 && (
            <select
              className="w-full text-xs border border-border rounded px-2 py-1 bg-background"
              value={groupIdx}
              onChange={(e) => setGroupIdx(Number(e.target.value))}
              data-testid="select-room-group"
            >
              {groups.map((gr, i) => (
                <option key={i} value={i}>{gr.location} · {gr.serviceLine}{gr.roomTypes.length ? ` · ${gr.roomTypes.join(", ")}` : ""}</option>
              ))}
            </select>
          )}
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading rooms…</div>
          ) : data ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Before</div>
                  {data.before.map(monthBlock)}
                  {data.before.length > 0 && (
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      Avg: {avgOf(data.before, m => m.occupiedCount)!.toFixed(1)} occ · {fmtMoney(avgOf(data.before, m => m.totalRevenue)!)}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">After</div>
                  {data.after.map(monthBlock)}
                  {data.after.length > 0 && (
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      Avg: {avgOf(data.after, m => m.occupiedCount)!.toFixed(1)} occ · {fmtMoney(avgOf(data.after, m => m.totalRevenue)!)}
                    </div>
                  )}
                </div>
              </div>
              {(() => {
                const avgB = avgOf(data.before, m => m.totalRevenue);
                const shared = groups.length === 1 && calcT3Before != null && avgB != null && avgB > 0 && Math.abs(calcT3Before - avgB) / avgB > 0.02;
                const sharePct = shared ? Math.round((calcT3Before! / avgB!) * 100) : null;
                return (
                  <p className="text-[10px] text-muted-foreground">
                    Each month lists the occupied rooms counted in the revenue average (HC / HC-MC: private-pay only, daily rate × 30.4).{" "}
                    {shared
                      ? `Multiple pricing changes share these rooms, so the calculation credits this change with its proportional share (~${sharePct}% of the totals shown here).`
                      : "The before/after averages above match the figures in the calculation."}
                  </p>
                );
              })()}
            </>
          ) : (
            <p className="text-xs text-muted-foreground py-1">Could not load room detail.</p>
          )}
        </div>
      )}
    </div>
  );
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

  // Rule-level Δ move-ins: use the rule's own calc when present (real rules),
  // otherwise aggregate from its detail rows (synthetic rows in SL/campus grouping).
  const ruleMi = (r: SummaryRow): number | null => {
    const v = miDeltaOf(r);
    if (v != null) return v;
    let s: number | null = null;
    for (const d of r.detail) {
      const m = miDeltaOf(d);
      if (m != null) s = (s ?? 0) + m;
    }
    return s;
  };

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
          {g.id === "push" ? <span className="text-muted-foreground">—</span> : agg.sold.toLocaleString()}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums font-medium text-sm border-b border-border/70">
          {fmtMiDelta(agg.miDelta)}
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
                <span className="whitespace-normal text-sm">
                  {r.isHistorical && !/^Historical:/i.test(r.ruleName) ? `Historical: ${r.ruleName}` : r.ruleName}
                </span>
              </span>
            </td>
            <td className={tdCls}>{fmtDate(r.dateApplied)}</td>
            <td className={`${tdCls} text-right tabular-nums`}>{r.unitsImpacted.toLocaleString()}</td>
            <td className={`${tdCls} text-right tabular-nums`}>{r.unitsSold.toLocaleString()}</td>
            <td className={`${tdCls} text-right tabular-nums`}>{fmtMiDelta(ruleMi(r))}</td>
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
                <td className={`${tdCls} text-right tabular-nums text-xs`}>{fmtMiDelta(miDeltaOf(d))}</td>
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

// ── Scatter range slider ─────────────────────────────────────────────────────
// Two-thumb slider with a draggable centre bar for panning.
// All values are in %, matching the x-axis (0–100).
interface ScatterRangeSliderProps {
  value: [number, number];
  onChange: (v: [number, number]) => void;
}
function ScatterRangeSlider({ value, onChange }: ScatterRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: "left" | "right" | "pan"; startX: number; startVal: [number, number] } | null>(null);

  const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

  const onMouseDown = (mode: "left" | "right" | "pan") => (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { mode, startX: e.clientX, startVal: value };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current!;
      const rect = trackRef.current!.getBoundingClientRect();
      const delta = ((ev.clientX - d.startX) / rect.width) * 100;
      let [lo, hi] = d.startVal;
      const span = hi - lo;
      if (d.mode === "left") {
        lo = clamp(lo + delta, 0, hi - 5);
      } else if (d.mode === "right") {
        hi = clamp(hi + delta, lo + 5, 100);
      } else {
        lo = clamp(lo + delta, 0, 100 - span);
        hi = lo + span;
      }
      onChange([Math.round(lo), Math.round(hi)]);
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const [lo, hi] = value;
  return (
    <div className="relative h-5 w-full select-none" ref={trackRef} data-testid="scatter-range-slider">
      {/* Full track */}
      <div className="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
      {/* Selected range bar (draggable pan) */}
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/60 cursor-grab active:cursor-grabbing"
        style={{ left: `${lo}%`, width: `${hi - lo}%` }}
        onMouseDown={onMouseDown("pan")}
      />
      {/* Left thumb */}
      <div
        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow cursor-ew-resize"
        style={{ left: `${lo}%` }}
        onMouseDown={onMouseDown("left")}
        title={`Min: ${lo}%`}
      />
      {/* Right thumb */}
      <div
        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow cursor-ew-resize"
        style={{ left: `${hi}%` }}
        onMouseDown={onMouseDown("right")}
        title={`Max: ${hi}%`}
      />
    </div>
  );
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
  const [viewMode, setViewMode] = useState<"summary" | "detail" | "scatter">("summary");
  const [groupBy, setGroupBy] = useState<"strategy" | "rule" | "serviceLine" | "campus">("strategy");
  const [calcOpen, setCalcOpen] = useState<{ title: string; metrics: PerfMetrics } | null>(null);

  // Scattergram controls: highlight + filters + zoom
  const [scatterHighlightSL, setScatterHighlightSL] = useState<string>("All");
  const [scatterRegion, setScatterRegion] = useState<string>("All");
  const [scatterDivision, setScatterDivision] = useState<string>("All");
  const [scatterClass, setScatterClass] = useState<string>("All");
  const [scatterXRange, setScatterXRange] = useState<[number, number]>([0, 100]);

  // Location metadata (region / division / class) for scattergram filtering
  type LocMetaRow = { name: string; region: string | null; division: string | null; locationClass: string | null };
  const { data: locMetaData } = useQuery<{ locations: LocMetaRow[] } | LocMetaRow[]>({
    queryKey: ["/api/locations"],
  });
  const locMeta = useMemo(() => {
    const m = new Map<string, { region: string; division: string; cls: string }>();
    const list = Array.isArray(locMetaData) ? locMetaData : locMetaData?.locations ?? [];
    for (const l of list) {
      m.set(l.name, { region: l.region || "", division: l.division || "", cls: l.locationClass || "" });
    }
    return m;
  }, [locMetaData]);

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

  const aggOf = (rs: { unitsImpacted: number; unitsSold: number; monthlyRevenueImpact: number | null; annualRevenueImpact: number | null; calc?: PerfMetrics["calc"] }[]) => {
    const a = { units: 0, sold: 0, monthly: 0, annual: 0, miDelta: null as number | null };
    for (const r of rs) {
      a.units += r.unitsImpacted;
      a.sold += r.unitsSold;
      a.monthly += r.monthlyRevenueImpact ?? 0;
      a.annual += r.annualRevenueImpact ?? 0;
      const mi = miDeltaOf(r);
      if (mi != null) a.miDelta = (a.miDelta ?? 0) + mi;
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
    const ruleHist = new Map<string, boolean>();
    for (const r of rows) {
      ruleDate.set(r.ruleName, r.dateApplied);
      ruleHist.set(r.ruleName, !!r.isHistorical);
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
      { accent: "#0369a1", rowBg: "bg-blue-700/5 border-l-2 border-blue-700/40" },
      { accent: "#d97706", rowBg: "bg-amber-500/5 border-l-2 border-amber-500/40" },
      { accent: "#475569", rowBg: "bg-slate-500/5 border-l-2 border-slate-500/40" },
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
          isHistorical: ruleHist.get(ruleName) ?? false,
        };
      });
      const c = palette[i % palette.length];
      return { id: key, label: key, accent: c.accent, rowBg: c.rowBg, rules: synthRules, agg: aggOf(synthRules) };
    });
  }, [rows, groupBy]);

  const totals = useMemo(() => {
    const t = { unitsImpacted: 0, unitsSold: 0, monthly: 0, annual: 0, miDelta: null as number | null };
    for (const r of rows) {
      t.unitsImpacted += r.unitsImpacted;
      t.unitsSold += r.unitsSold;
      t.monthly += r.monthlyRevenueImpact ?? 0;
      t.annual += r.annualRevenueImpact ?? 0;
      const mi = miDeltaOf(r);
      if (mi != null) t.miDelta = (t.miDelta ?? 0) + mi;
    }
    return t;
  }, [rows]);

  // Occupancy-adjusted pricing result: holds occupancy constant at the
  // pre-change level (revenue-per-occupied-unit after × occupied units before)
  // so a rule isn't blamed or credited for occupancy swings unrelated to the
  // pricing change itself. Falls back to raw monthly impact when the T3
  // occupancy breakdown isn't available.
  const occAdjustedDelta = (r: PerfMetrics): number | null => {
    const c = r.calc;
    if (c && c.occBefore > 0 && c.occAfter > 0) {
      return (c.t3After / c.occAfter) * c.occBefore - c.t3Before;
    }
    return r.monthlyRevenueImpact;
  };

  // Win Rate — % of historical applied rules whose occupancy-adjusted revenue grew
  const winRate = useMemo(() => {
    const hist = rows.filter((r) => r.isHistorical && r.monthlyRevenueImpact != null);
    if (hist.length === 0) return null;
    const wins = hist.filter((r) => (occAdjustedDelta(r) ?? 0) > 0).length;
    return { pct: Math.round((wins / hist.length) * 100), wins, total: hist.length };
  }, [rows]);

  const [winRateOpen, setWinRateOpen] = useState(false);

  // Historical rules sorted by date for the drill-down dialog
  const historicalRules = useMemo(() => {
    return rows
      .filter((r) => r.isHistorical)
      .slice()
      .sort((a, b) => {
        if (!a.dateApplied && !b.dateApplied) return 0;
        if (!a.dateApplied) return 1;
        if (!b.dateApplied) return -1;
        return b.dateApplied.localeCompare(a.dateApplied);
      });
  }, [rows]);

  // ── Scattergram data: one point per rule breakdown row with T3 move-in data ──
  // x = occupancy % before the change, y = Δ move-ins/mo (T3 after − T3 before),
  // grouped by date applied so each pricing change gets its own color.
  interface ScatterPoint {
    x: number; y: number;
    ruleName: string; location: string; serviceLine: string; roomType: string;
    dateApplied: string | null; miBefore: number; miAfter: number;
  }
  const SCATTER_PALETTE = ["#0d9488", "#0284c7", "#d97706", "#7c3aed", "#db2777", "#059669", "#dc2626", "#475569", "#ca8a04", "#0891b2"];
  const scatterSeries = useMemo(() => {
    const byDate = new Map<string, ScatterPoint[]>();
    const push = (m: PerfMetrics, meta: { ruleName: string; location: string; serviceLine: string; roomType: string }) => {
      const c = m.calc;
      if (!c || c.moveInsT3Before == null || c.moveInsT3After == null || c.occPctBefore == null) return;
      const occPct = c.occPctBefore;
      const dateKey = m.dateApplied ? m.dateApplied.slice(0, 10) : "unknown";
      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey)!.push({
        x: Math.round(occPct * 10) / 10,
        y: Math.round((c.moveInsT3After - c.moveInsT3Before) * 10) / 10,
        ...meta,
        dateApplied: m.dateApplied,
        miBefore: c.moveInsT3Before,
        miAfter: c.moveInsT3After,
      });
    };
    for (const r of rows) {
      if (r.detail.length > 0) {
        for (const d of r.detail) push(d, { ruleName: r.ruleName, location: d.location, serviceLine: d.serviceLine, roomType: d.roomType });
      } else {
        push(r, { ruleName: r.ruleName, location: "All", serviceLine: "All", roomType: "All" });
      }
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, points], i) => ({
        dateKey,
        label: dateKey === "unknown" ? "Unknown date" : fmtDate(dateKey),
        color: SCATTER_PALETTE[i % SCATTER_PALETTE.length],
        points,
      }));
  }, [rows]);
  const scatterPointCount = scatterSeries.reduce((s, g) => s + g.points.length, 0);

  // Scattergram filter options (from the points + location metadata)
  const scatterOptions = useMemo(() => {
    const sls = new Set<string>(), regions = new Set<string>(), divisions = new Set<string>(), classes = new Set<string>();
    for (const g of scatterSeries) {
      for (const p of g.points) {
        if (p.serviceLine && p.serviceLine !== "All") sls.add(p.serviceLine);
        const meta = locMeta.get(p.location);
        if (meta?.region) regions.add(meta.region);
        if (meta?.division) divisions.add(meta.division);
        if (meta?.cls) classes.add(meta.cls);
      }
    }
    const sort = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
    return { serviceLines: sort(sls), regions: sort(regions), divisions: sort(divisions), classes: sort(classes) };
  }, [scatterSeries, locMeta]);

  // Filtered + zoomed series actually rendered
  const scatterXDomain: [number, number] = scatterXRange;
  const isZoomed = scatterXRange[0] > 0 || scatterXRange[1] < 100;
  const visibleScatterSeries = useMemo(() => {
    const [lo, hi] = scatterXRange;
    return scatterSeries
      .map((g) => ({
        ...g,
        points: g.points.filter((p) => {
          const meta = locMeta.get(p.location);
          if (scatterRegion !== "All" && (meta?.region || "") !== scatterRegion) return false;
          if (scatterDivision !== "All" && (meta?.division || "") !== scatterDivision) return false;
          if (scatterClass !== "All" && (meta?.cls || "") !== scatterClass) return false;
          if (p.x < lo || p.x > hi) return false;
          return true;
        }),
      }))
      .filter((g) => g.points.length > 0);
  }, [scatterSeries, locMeta, scatterRegion, scatterDivision, scatterClass, scatterXRange]);
  const visibleScatterCount = visibleScatterSeries.reduce((s, g) => s + g.points.length, 0);
  // Show campus labels once zoomed in (and the point count is manageable)
  const showScatterLabels = isZoomed && visibleScatterCount <= 150;
  const shortCampus = (loc: string) => loc.replace(/\s*-\s*\d+.*$/, "").trim();

  const handleExport = () => {
    const groupHeader = groupBy === "strategy" ? "Strategy" : groupBy === "rule" ? "Group" : groupBy === "serviceLine" ? "Service Line" : "Campus";
    const header = [groupHeader, "Rule", "Location", "Service Line", "Room Type", "Date Applied",
      "Units Impacted", "New Move-ins", "Monthly Impact", "Annual Impact"];
    const aoa: (string | number | null)[][] = [header];
    for (const g of displayGroups) {
      for (const r of g.rules) {
        if (r.detail.length === 0) {
          // No breakdown rows — emit the rule-level summary so it isn't lost
          aoa.push([g.label, r.ruleName, "All", "All", "All", fmtDate(r.dateApplied),
            r.unitsImpacted, r.unitsSold, r.monthlyRevenueImpact, r.annualRevenueImpact]);
        } else {
          // Detail rows only: an "All" summary row would double-count totals
          for (const d of r.detail) {
            aoa.push([g.label, r.ruleName, d.location, d.serviceLine, d.roomType, fmtDate(d.dateApplied),
              d.unitsImpacted, d.unitsSold, d.monthlyRevenueImpact, d.annualRevenueImpact]);
          }
        }
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rule Performance");
    XLSX.writeFile(wb, `Rule_Performance_${start}_to_${end}.xlsx`);
  };

  const thCls = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap bg-muted border-b border-border";
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
              <Input type="date" value={start}
                onChange={(e) => {
                  const v = e.target.value;
                  setStart(v);
                  if (v && end && v > end) setEnd(v);
                }}
                className="h-8 w-[140px] text-xs" data-testid="input-perf-start" />
              <span className="text-xs text-muted-foreground">to</span>
              <Input type="date" value={end}
                onChange={(e) => {
                  const v = e.target.value;
                  setEnd(v);
                  if (v && start && v < start) setStart(v);
                }}
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
              <button
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors border-l border-border ${viewMode === "scatter" ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"}`}
                onClick={() => setViewMode("scatter")}
                disabled={rows.length === 0}
                data-testid="button-perf-scatter"
              >
                <ChartScatter className="h-3.5 w-3.5" />Scattergram
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
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
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
              <button
                className="rounded-md border border-border bg-muted/30 px-3 py-2 text-left w-full hover:bg-muted/60 hover:border-primary/40 transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-muted/30 disabled:hover:border-border"
                data-testid="stat-perf-win-rate"
                onClick={() => winRate != null && historicalRules.length > 0 && setWinRateOpen(true)}
                disabled={winRate == null || historicalRules.length === 0}
                title={winRate != null ? "Click to see rule-by-rule breakdown" : undefined}
              >
                <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                  <Trophy className="h-3 w-3" />Win Rate
                </div>
                <div className={`text-4xl font-black leading-none tabular-nums ${winRate == null ? "text-muted-foreground" : winRate.pct >= 50 ? "text-emerald-600" : "text-red-600"}`}>
                  {winRate == null ? "–" : `${winRate.pct}%`}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1">
                  {winRate == null ? "no historical rules in range" : `${winRate.wins} of ${winRate.total} rules grew revenue (occupancy-adjusted)`}
                  {winRate != null && <span className="ml-1 text-primary/60">↗ see detail</span>}
                </div>
              </button>
            </div>

            {viewMode === "scatter" ? (
              scatterPointCount === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground" data-testid="text-scatter-empty">
                  No pricing changes in this range have 3-month before/after move-in data yet.
                  <div className="mt-1 text-xs">Points appear once a pricing change has rent roll snapshots both before and after its applied date.</div>
                </div>
              ) : (
                <div className="rounded-md border border-border p-3" data-testid="chart-perf-scatter">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold" data-testid="text-scatter-title">Change in Move Ins By Occupancy Level</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                        value={scatterHighlightSL}
                        onChange={(e) => setScatterHighlightSL(e.target.value)}
                        data-testid="select-scatter-highlight-sl"
                      >
                        <option value="All">Highlight: All Service Lines</option>
                        {scatterOptions.serviceLines.map((sl) => (
                          <option key={sl} value={sl}>Highlight: {sl}</option>
                        ))}
                      </select>
                      <select
                        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                        value={scatterRegion}
                        onChange={(e) => setScatterRegion(e.target.value)}
                        data-testid="select-scatter-region"
                      >
                        <option value="All">All Regions</option>
                        {scatterOptions.regions.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <select
                        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                        value={scatterDivision}
                        onChange={(e) => setScatterDivision(e.target.value)}
                        data-testid="select-scatter-division"
                      >
                        <option value="All">All Divisions</option>
                        {scatterOptions.divisions.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <select
                        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                        value={scatterClass}
                        onChange={(e) => setScatterClass(e.target.value)}
                        data-testid="select-scatter-class"
                      >
                        <option value="All">All Classes</option>
                        {scatterOptions.classes.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button
                        className="px-2 py-1 text-xs font-medium rounded-md border border-border bg-background text-muted-foreground hover:bg-muted disabled:opacity-40"
                        onClick={() => setScatterXRange([0, 100])}
                        disabled={!isZoomed}
                        title="Reset view to full range"
                        data-testid="button-scatter-reset"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  {/* Drag-to-zoom / pan slider */}
                  <div className="mb-3 px-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] text-muted-foreground">
                        Occupancy range: <span className="font-medium text-foreground">{scatterXRange[0]}%</span> – <span className="font-medium text-foreground">{scatterXRange[1]}%</span>
                        {" "}· {visibleScatterCount} point{visibleScatterCount === 1 ? "" : "s"}
                        {showScatterLabels ? " · campus names shown" : (isZoomed && visibleScatterCount > 0 && visibleScatterCount <= 150) ? " · campus names shown" : ""}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">Drag thumbs or bar to zoom &amp; pan</span>
                    </div>
                    <ScatterRangeSlider value={scatterXRange} onChange={setScatterXRange} />
                    <div className="flex justify-between mt-0.5 text-[10px] text-muted-foreground/60">
                      <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
                    </div>
                  </div>
                  {visibleScatterCount === 0 && (
                    <div className="py-8 text-center text-xs text-muted-foreground" data-testid="text-scatter-filtered-empty">
                      No points match the current filters{isZoomed ? " in this zoom range" : ""}. Adjust the filters or drag the slider to widen the range.
                    </div>
                  )}
                  <ResponsiveContainer width="100%" height={420}>
                    <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis
                        type="number" dataKey="x" name="Occupancy" unit="%" domain={scatterXDomain}
                        tick={{ fontSize: 11 }}
                        label={{ value: "Occupancy before change (%)", position: "insideBottom", offset: -2, fontSize: 11 }}
                      />
                      <YAxis
                        type="number" dataKey="y" name="Change in Move-ins"
                        tick={{ fontSize: 11 }}
                        label={{ value: "Change in move-ins/mo (T3 after − T3 before)", angle: -90, position: "insideLeft", fontSize: 11, style: { textAnchor: "middle" } }}
                      />
                      <ZAxis range={[70, 70]} />
                      <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="4 4" />
                      <RechartsTooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as ScatterPoint;
                          return (
                            <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
                              <div className="font-semibold mb-1">{p.ruleName}</div>
                              <div>{p.location} · {p.serviceLine} · {p.roomType}</div>
                              <div className="text-muted-foreground">Applied {fmtDate(p.dateApplied)}</div>
                              <div className="mt-1">Occupancy before: <span className="font-medium">{p.x}%</span></div>
                              <div>Move-ins/mo: {p.miBefore} → {p.miAfter} (<span className={`font-medium ${p.y > 0 ? "text-emerald-600" : p.y < 0 ? "text-red-600" : ""}`}>{p.y > 0 ? "+" : ""}{p.y}</span>)</div>
                            </div>
                          );
                        }}
                      />
                      <RechartsLegend
                        wrapperStyle={{ fontSize: 11 }}
                        payload={visibleScatterSeries.map((g) => ({ value: g.label, type: "circle" as const, color: g.color, id: g.dateKey }))}
                      />
                      {visibleScatterSeries.map((g) => (
                        <Scatter
                          key={g.dateKey}
                          name={g.label}
                          data={g.points}
                          fill={g.color}
                          shape={(props: any) => {
                            const { cx, cy, payload } = props;
                            if (cx == null || cy == null) return <g />;
                            const up = payload.y > 0;
                            const dimmed = scatterHighlightSL !== "All" && payload.serviceLine !== scatterHighlightSL;
                            const opacity = dimmed ? 0.15 : 1;
                            const label = showScatterLabels && !dimmed ? (
                              <text x={cx + 8} y={cy + 3} fontSize={9} fill="currentColor" className="fill-muted-foreground">
                                {shortCampus(payload.location)}
                              </text>
                            ) : null;
                            return (
                              <g opacity={opacity}>
                                {up ? (
                                  <circle cx={cx} cy={cy} r={6} fill={g.color} stroke="#059669" strokeWidth={2} />
                                ) : (
                                  <circle cx={cx} cy={cy} r={5} fill="transparent" stroke={g.color} strokeWidth={2} opacity={0.85} />
                                )}
                                {label}
                              </g>
                            );
                          }}
                        />
                      ))}
                    </ScatterChart>
                  </ResponsiveContainer>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Each point is one pricing change applied to a location / service line / room type group — colors distinguish the date the change was applied.{" "}
                    <span className="font-medium text-emerald-600">Solid dots with a green ring</span> = move-ins increased after the change;{" "}
                    <span className="font-medium">hollow dots</span> = move-ins stayed flat or declined. Move-ins compare the average per month over the 3 months before vs. after each change.
                  </p>
                </div>
              )
            ) : (
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
                    <th className={`${thCls} text-right`}>Δ Move-ins/Mo</th>
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
                <tfoot className="sticky bottom-0 z-10">
                  <tr className="bg-muted font-semibold border-t-2 border-border">
                    <td className="px-3 py-2.5 text-sm">Total</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">—</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sm" data-testid="text-total-units-impacted">
                      {totals.unitsImpacted.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sm">
                      {totals.unitsSold.toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-sm" data-testid="text-total-mi-delta">
                      {fmtMiDelta(totals.miDelta)}
                    </td>
                    <td className="px-3 py-2.5" />
                    <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${totals.monthly >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtMoney(totals.monthly)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums text-sm ${totals.annual >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmtMoney(totals.annual)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            )}

            {viewMode !== "scatter" && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {groupBy === "rule"
                ? "Click a rule row to see the breakdown by location, service line, and room type."
                : "Click any group row to expand and see individual rules. Click a rule row to see the breakdown by location, service line, and room type."}{" "}
              Switch to <span className="font-medium">Detail</span> to expand all groups at once.{" "}
              <span className="font-medium">Revenue impact</span>: historical pricing changes compare actual occupied-room revenue for the 3 months before vs. after the change; active rules project impact based on expected new move-ins only (existing residents keep their current rates). Click any impact value for the full calculation.
            </p>
            )}
          </>
        )}
      </CardContent>

      {/* Calculation explanation dialog */}
      <Dialog open={!!calcOpen} onOpenChange={(o) => !o && setCalcOpen(null)}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto" data-testid="dialog-perf-calc">
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
                      <span className="block text-[10px]">{calcOpen.metrics.calc.monthsBefore} month{calcOpen.metrics.calc.monthsBefore === 1 ? "" : "s"} before · avg {calcOpen.metrics.calc.occBefore.toFixed(1)} occupied units</span>
                    </span>
                    <span className="font-medium tabular-nums">{fmtMoney(calcOpen.metrics.calc.t3Before)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Avg monthly revenue after
                      <span className="block text-[10px]">{calcOpen.metrics.calc.monthsAfter} month{calcOpen.metrics.calc.monthsAfter === 1 ? "" : "s"} after{calcOpen.metrics.calc.extrapolated ? " (all available so far)" : ""} · avg {calcOpen.metrics.calc.occAfter.toFixed(1)} occupied units</span>
                    </span>
                    <span className="font-medium tabular-nums">{fmtMoney(calcOpen.metrics.calc.t3After)}</span>
                  </div>
                  {calcOpen.metrics.calc.occBefore !== calcOpen.metrics.calc.occAfter && (
                    <div className="flex items-start gap-1.5 rounded bg-sky-50 border border-sky-200 px-2 py-1.5 text-[11px] text-sky-800">
                      <span className="shrink-0">ℹ</span>
                      <span>
                        Occupied units changed from <span className="font-semibold">{calcOpen.metrics.calc.occBefore.toFixed(1)}</span> → <span className="font-semibold">{calcOpen.metrics.calc.occAfter.toFixed(1)}</span> ({calcOpen.metrics.calc.occAfter > calcOpen.metrics.calc.occBefore ? "+" : ""}{(calcOpen.metrics.calc.occAfter - calcOpen.metrics.calc.occBefore).toFixed(1)} units). {calcOpen.metrics.calc.occAfter < calcOpen.metrics.calc.occBefore ? "The revenue decline is likely driven by occupancy loss, not the rate change." : "Occupancy improved alongside the pricing change."}
                      </span>
                    </div>
                  )}
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
                {calcOpen.metrics.dateApplied && (
                  <RoomVerification
                    groups={calcGroupsOf(calcOpen.metrics)}
                    month={String(calcOpen.metrics.dateApplied).slice(0, 7)}
                    calcT3Before={calcOpen.metrics.calc.t3Before}
                  />
                )}
              </div>
            ) : (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Units impacted</span>
                  <span className="font-medium tabular-nums">{calcOpen.metrics.unitsImpacted.toLocaleString()}</span>
                </div>
                {calcOpen.metrics.moveInsPerMonth != null && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Expected new move-ins / mo
                      <span className="block text-[10px]">units × service-line T3 move-in rate</span>
                    </span>
                    <span className="font-medium tabular-nums">{calcOpen.metrics.moveInsPerMonth.toFixed(1)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-muted-foreground">
                    Projected monthly revenue before
                    <span className="block text-[10px]">new move-ins × street rate</span>
                  </span>
                  <span className="font-medium tabular-nums">{fmtMoney(calcOpen.metrics.rateDeltaBefore ?? null)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    Projected monthly revenue after
                    <span className="block text-[10px]">new move-ins × rule-adjusted rate</span>
                  </span>
                  <span className="font-medium tabular-nums">{fmtMoney(calcOpen.metrics.rateDeltaAfter ?? null)}</span>
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
                <p>Only new admissions pay the adjusted rate — existing residents' rates are not changed. Projected revenue = expected move-ins/mo × rate. HC and HC/MC daily rates are converted to monthly (× 30.4).</p>
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

      {/* ── Win Rate drill-down dialog ─────────────────────────────────── */}
      <Dialog open={winRateOpen} onOpenChange={setWinRateOpen}>
        <DialogContent className="max-w-2xl w-full max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-5 pb-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              <DialogTitle className="text-base font-semibold">Win Rate Detail</DialogTitle>
            </div>
            <DialogDescription className="mt-0.5">
              Historical rules ordered by date — whether each one grew or reduced revenue after being applied, holding occupancy constant so the result reflects the pricing change itself.
            </DialogDescription>
            {winRate != null && (
              <div className="flex items-center gap-4 mt-3 p-3 rounded-md bg-muted/40 border border-border">
                <div className="text-center">
                  <div className={`text-3xl font-black tabular-nums ${winRate.pct >= 50 ? "text-emerald-600" : "text-red-600"}`}>{winRate.pct}%</div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Win Rate</div>
                </div>
                <div className="h-10 w-px bg-border" />
                <div className="flex gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                    <CheckCircle2 className="h-4 w-4" />{winRate.wins} wins
                  </div>
                  <div className="flex items-center gap-1.5 text-red-500 font-semibold">
                    <XCircle className="h-4 w-4" />{winRate.total - winRate.wins} losses
                  </div>
                </div>
              </div>
            )}
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted border-b border-border whitespace-nowrap">Rule</th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted border-b border-border whitespace-nowrap">Date Applied</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted border-b border-border whitespace-nowrap">Monthly Impact</th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted border-b border-border whitespace-nowrap">Result</th>
                </tr>
              </thead>
              <tbody>
                {historicalRules.map((r, i) => {
                  const impact = r.monthlyRevenueImpact;
                  const adj = impact != null ? occAdjustedDelta(r) : null;
                  const isWin = adj != null && adj > 0;
                  const isLoss = adj != null && adj <= 0;
                  const cleanName = r.ruleName.replace(/^Historical:\s*/i, '');
                  return (
                    <tr
                      key={i}
                      className="hover:bg-muted/40 transition-colors border-b border-border/50 last:border-0 cursor-pointer"
                      onClick={() => { setCalcOpen({ title: cleanName, metrics: r }); }}
                    >
                      <td className="px-4 py-2.5 text-sm text-foreground max-w-[280px]">
                        <span className="line-clamp-2 leading-snug">{cleanName}</span>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground whitespace-nowrap">{r.dateApplied ? fmtDate(r.dateApplied) : '—'}</td>
                      <td className={`px-4 py-2.5 text-sm font-semibold tabular-nums text-right whitespace-nowrap ${isWin ? 'text-emerald-600' : isLoss ? 'text-red-500' : 'text-muted-foreground'}`}>
                        {impact != null ? fmtMoney(impact) + '/mo' : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isWin ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5" />Win
                          </span>
                        ) : isLoss ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-500 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded-full border border-red-200 dark:border-red-800">
                            <XCircle className="h-3.5 w-3.5" />Loss
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
