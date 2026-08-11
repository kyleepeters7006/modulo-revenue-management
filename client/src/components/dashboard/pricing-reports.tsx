import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X, Building2, TrendingUp, TrendingDown, Calendar } from "lucide-react";
import inflectLogo from "@assets/Inflect_Logo_-_No_Text_Below_1781618481726.png";

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt = (v: number) => {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "−";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${Math.round(abs).toLocaleString()}`;
};

const fmtAdj = (rule: any) => {
  const val = Number(rule.action?.adjustmentValue ?? 0);
  const pct = rule.action?.adjustmentType === "percentage";
  const sign = val >= 0 ? "+" : "";
  return pct ? `${sign}${val}%` : `${sign}$${Math.abs(val)}`;
};

const fmtTrigger = (rule: any) => {
  const trigger = rule.trigger || {};
  if (trigger.type === "immediate" || trigger.type === "always") return "Always";
  const conditions = trigger.conditions || (trigger.condition ? [trigger.condition] : []);
  if (!conditions.length) return "Conditional";
  const fieldMap: Record<string, string> = {
    service_line_occupancy: "SL occ", room_type_occupancy: "RT occ",
    campus_occupancy: "Campus occ", days_vacant: "Days vacant",
  };
  return conditions.map((c: any) => {
    const field = fieldMap[c.field] || (c.field || "").replace(/_/g, " ");
    const val = c.field?.includes("occupancy") ? `${Math.round((c.value || 0) * 100)}%` : c.value;
    const op = { ">=": "≥", "<=": "≤", "<": "<", ">": ">" }[c.operator as string] ?? c.operator;
    return `${field} ${op} ${val}`;
  }).join(" & ");
};

const SL_BG: Record<string, string> = {
  AL: "#ccfbf1", "AL/MC": "#ede9fe", HC: "#ffedd5",
  "HC/MC": "#dbeafe", SL: "#d1fae5", VIL: "#f3e8ff",
};
const SL_FG: Record<string, string> = {
  AL: "#0f766e", "AL/MC": "#6d28d9", HC: "#c2410c",
  "HC/MC": "#1d4ed8", SL: "#15803d", VIL: "#7e22ce",
};

// ─── ReportHeader (shared) ────────────────────────────────────────────────────
function ReportHeader({ title, scope, onClose, onPrint }: {
  title: string; scope: string; onClose: () => void; onPrint: () => void;
}) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return (
    <div className="report-header bg-slate-900 text-white px-8 py-6 flex items-center justify-between gap-4 print:bg-slate-900 print:text-white">
      <div className="flex items-center gap-5">
        {/* Logo — dark background matches the navy header */}
        <img src={inflectLogo} alt="Inflect" className="h-10 w-auto rounded-md shrink-0" />
        <div className="border-l border-slate-700 pl-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400 mb-0.5">Revenue Management</p>
          <h1 className="text-2xl font-black tracking-tight leading-none">{title}</h1>
          <p className="text-sm text-slate-400 mt-1">{scope}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-right mr-3 hidden print:block">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider">Generated</p>
          <p className="text-sm font-semibold">{today}</p>
        </div>
        <Button size="sm" variant="outline"
          className="print:hidden border-slate-600 text-slate-200 hover:bg-slate-800 hover:text-white gap-1.5 h-8"
          onClick={onPrint}>
          <Printer className="h-3.5 w-3.5" /> Export PDF
        </Button>
        <Button size="sm" variant="ghost"
          className="print:hidden text-slate-400 hover:text-white hover:bg-slate-800 h-8 w-8 p-0"
          onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── KPI strip ────────────────────────────────────────────────────────────────
// Render **bold** markers from AI text as <strong> elements
function renderBold(text: string) {
  return String(text).split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-bold text-slate-900">{part}</strong> : part
  );
}

function KpiCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="flex-1 min-w-[110px] bg-white rounded-xl border border-slate-200 px-4 py-4 shadow-sm">
      <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 mb-1.5 leading-tight">{label}</p>
      <p className={`text-2xl font-black leading-none whitespace-nowrap ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">{sub}</p>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Strategy Report Modal
// ══════════════════════════════════════════════════════════════════════════════
interface StrategyReportProps {
  open: boolean;
  onClose: () => void;
  selectedServiceLine?: string;
  selectedLocations?: string[];
  selectedLocationId?: string;
}

export function StrategyReportModal({ open, onClose, selectedServiceLine, selectedLocations, selectedLocationId }: StrategyReportProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const rulesQs = (() => {
    const p = new URLSearchParams();
    if (selectedLocationId) p.set("locationId", selectedLocationId);
    if (selectedServiceLine && selectedServiceLine !== "All") p.set("serviceLine", selectedServiceLine);
    const s = p.toString();
    return s ? "?" + s : "";
  })();

  const commentaryQs = (() => {
    const p = new URLSearchParams();
    if (selectedServiceLine && selectedServiceLine !== "All") p.set("serviceLine", selectedServiceLine);
    (selectedLocations || []).forEach(l => p.append("locations", l));
    const s = p.toString();
    return s ? "?" + s : "";
  })();

  const { data: rulesData = [] } = useQuery<any[]>({
    queryKey: ["/api/adjustment-rules", selectedLocationId ?? "", selectedServiceLine ?? ""],
    queryFn: () => fetch(`/api/adjustment-rules${rulesQs}`).then(r => r.json()),
    enabled: open,
    staleTime: 2 * 60 * 1000,
  });

  const { data: commentary } = useQuery<any>({
    queryKey: ["/api/pricing-controls/commentary", selectedServiceLine, (selectedLocations || []).join(",")],
    queryFn: () => fetch(`/api/pricing-controls/commentary${commentaryQs}`).then(r => r.json()),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const { data: statsData } = useQuery<any>({
    queryKey: ["/api/adjustment-rules/combined-stats", selectedLocationId ?? "", selectedServiceLine ?? ""],
    queryFn: () => {
      const p = new URLSearchParams();
      if (selectedLocationId) p.set("locationId", selectedLocationId);
      if (selectedServiceLine && selectedServiceLine !== "All") p.set("serviceLine", selectedServiceLine);
      return fetch(`/api/adjustment-rules/combined-stats${p.toString() ? "?" + p.toString() : ""}`).then(r => r.json());
    },
    enabled: open,
    staleTime: 2 * 60 * 1000,
  });

  const activeRules = rulesData.filter((r: any) => r.isActive && !r.isHistorical);
  const totalNet = activeRules.reduce((s: number, r: any) => s + (r.annualImpact || 0), 0);
  const totalSteadyState = activeRules.reduce((s: number, r: any) => s + (r.steadyStateAnnualImpact || 0), 0);
  const lift = activeRules.filter((r: any) => (r.annualImpact || 0) > 0).reduce((s: number, r: any) => s + r.annualImpact, 0);
  const conc = activeRules.filter((r: any) => (r.annualImpact || 0) < 0).reduce((s: number, r: any) => s + r.annualImpact, 0);

  const scope = selectedLocations?.length === 1
    ? selectedLocations[0] + (selectedServiceLine && selectedServiceLine !== "All" ? ` · ${selectedServiceLine}` : "")
    : selectedLocations && selectedLocations.length > 1
      ? `${selectedLocations.length} locations${selectedServiceLine && selectedServiceLine !== "All" ? ` · ${selectedServiceLine}` : ""}`
      : selectedServiceLine && selectedServiceLine !== "All"
        ? `${selectedServiceLine} · Portfolio-wide`
        : "Portfolio-wide";

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[95vh] p-0 overflow-hidden flex flex-col bg-slate-50 print:max-w-none print:w-full print:max-h-none print:overflow-visible report-modal">
        <ReportHeader title="Pricing Strategy Report" scope={scope} onClose={onClose} onPrint={handlePrint} />

        <div ref={printRef} className="report-printable flex-1 overflow-y-auto print:overflow-visible px-8 py-6 space-y-6">
          {/* Date line (screen only) */}
          <p className="text-[11px] text-slate-400 print:hidden">Generated {today}</p>

          {/* AI Summary — strategy of the upcoming pricing changes */}
          {commentary?.summary && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-slate-800 flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-400">Pricing Strategy Summary</p>
              </div>
              <div className="px-6 py-5">
                <p className="text-base font-semibold text-slate-800 leading-relaxed">{renderBold(commentary.summary)}</p>
                {commentary.rulesSummary && (
                  <p className="text-sm text-slate-600 mt-4 leading-relaxed border-t border-slate-100 pt-4">
                    <span className="font-bold text-slate-700">Rule Strategy: </span>{renderBold(commentary.rulesSummary)}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* KPI strip */}
          <div className="flex flex-wrap gap-3">
            <KpiCard label="First-Year Net Impact" value={fmt(totalNet)} color={totalNet >= 0 ? "text-emerald-600" : "text-red-600"} sub="Yr 1 cumulative (× 78)" />
            <KpiCard label="Fully Ramped /yr" value={fmt(totalSteadyState)} color={totalSteadyState >= 0 ? "text-emerald-600" : "text-red-600"} sub="Steady-state run-rate (× 144)" />
            <KpiCard label="Concessions" value={fmt(conc)} color="text-red-600" />
            {statsData?.uniqueCampuses != null && (
              <KpiCard label="Campuses" value={String(statsData.uniqueCampuses)} color="text-slate-800" />
            )}
            {statsData?.uniqueUnits != null && (
              <KpiCard label="Units Impacted" value={String(statsData.uniqueUnits)} color="text-slate-800" />
            )}
            <KpiCard label="Active Rules" value={String(activeRules.length)} color="text-slate-800" />
          </div>

          {/* Rules table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm border-collapse">
              <thead>
                {/* Section title row — lives in thead so it repeats on every printed page */}
                <tr className="bg-slate-900">
                  <td colSpan={8} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-bold text-white tracking-tight">Active Pricing Rules</p>
                      <p className="text-xs font-medium text-slate-400 bg-slate-800 rounded-full px-3 py-1">{activeRules.length} rule{activeRules.length !== 1 ? "s" : ""} currently in play</p>
                    </div>
                  </td>
                </tr>
                <tr className="bg-slate-50 text-left border-b border-slate-200">
                  <th className="px-5 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 w-[22%]">Rule</th>
                  <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 w-[9%]">Service Line</th>
                  <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 w-[26%]">Condition</th>
                  <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-right w-[9%]">Units</th>
                  <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-right w-[11%]">Monthly Impact</th>
                  <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-right w-[11%]">First-Year Impact</th>
                  <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 text-right w-[12%]">Fully Ramped /yr</th>
                  <th className="px-3 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 w-[5%]"></th>
                </tr>
              </thead>
              <tbody>
                {activeRules.map((rule: any, i: number) => {
                  const adj = fmtAdj(rule);
                  const isPos = (rule.annualImpact || 0) >= 0;
                  const sl = rule.serviceLine || (rule.action?.filters?.serviceLine || [])[0] || "—";
                  const aiStrategy = (commentary?.rules || []).find((cr: any) => cr.name === rule.name)?.strategy;
                  return (
                    <tr key={rule.id} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-sm font-black ${isPos ? "text-emerald-600" : "text-red-600"}`}>{adj}</span>
                          <span className="text-sm text-slate-800 font-semibold leading-tight">
                            {rule.name?.replace(/^[+-][^-]+ - /, "").split(" when ")[0] || rule.name}
                          </span>
                        </div>
                        {rule.effectiveDate && (
                          <p className="text-[10px] text-slate-400 mt-0.5">Since {new Date(rule.effectiveDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                        )}
                        {aiStrategy && (
                          <p className="text-xs text-slate-500 mt-1 leading-snug" data-testid={`report-strategy-${rule.id}`}>
                            {renderBold(aiStrategy)}
                          </p>
                        )}
                        {rule.notes && (
                          <p className="text-[10px] italic text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 mt-1 leading-snug whitespace-pre-wrap" data-testid={`report-note-${rule.id}`}>
                            {rule.notes}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        {sl !== "—" ? (
                          <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: SL_BG[sl] || "#f1f5f9", color: SL_FG[sl] || "#475569" }}>{sl}</span>
                        ) : <span className="text-slate-400 text-xs">All</span>}
                      </td>
                      <td className="px-3 py-4 text-xs text-slate-500 leading-snug">{fmtTrigger(rule)}</td>
                      <td className="px-3 py-4 text-right">
                        <span className="text-sm font-bold text-slate-800">{(rule.affectedUnits ?? 0).toLocaleString()}</span>
                        {rule.affectedCampuses > 0 && <p className="text-[10px] text-slate-400 mt-0.5">{rule.affectedCampuses} campus{rule.affectedCampuses !== 1 ? "es" : ""}</p>}
                      </td>
                      <td className="px-3 py-4 text-right">
                        <span className={`text-base font-bold ${isPos ? "text-emerald-600" : "text-red-600"}`}>{fmt(rule.monthlyImpact || 0)}</span>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <span className={`text-base font-bold ${isPos ? "text-emerald-600" : "text-red-600"}`}>{fmt(rule.annualImpact || 0)}</span>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <span className={`text-base font-bold ${isPos ? "text-emerald-700" : "text-red-700"}`}>{fmt(rule.steadyStateAnnualImpact || 0)}</span>
                        <p className="text-[10px] text-slate-400 mt-0.5">run-rate</p>
                      </td>
                      <td className="px-3 py-4">
                        {isPos
                          ? <TrendingUp className="h-4 w-4 text-emerald-500 ml-auto" />
                          : <TrendingDown className="h-4 w-4 text-red-500 ml-auto" />}
                      </td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="border-t-2 border-slate-300 bg-slate-900">
                  <td className="px-5 py-4 text-sm font-bold text-white" colSpan={3}>Portfolio Total — {activeRules.length} active rule{activeRules.length !== 1 ? "s" : ""}</td>
                  <td className="px-3 py-4 text-right text-base font-black text-white">{statsData?.uniqueUnits ?? activeRules.reduce((s: number, r: any) => s + (r.affectedUnits || 0), 0)}</td>
                  <td className="px-3 py-4 text-right text-base font-black text-emerald-400">{fmt(activeRules.reduce((s: number, r: any) => s + (r.monthlyImpact || 0), 0))}</td>
                  <td className="px-3 py-4 text-right text-base font-black text-emerald-400">{fmt(totalNet)}</td>
                  <td className="px-3 py-4 text-right text-base font-black text-emerald-400">{fmt(totalSteadyState)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <p className="text-[10px] text-slate-400 text-center pb-2 print:block hidden">
            Modulo Revenue Management · Confidential · Generated {today}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// History Report Modal
// ══════════════════════════════════════════════════════════════════════════════
interface HistoryReportProps {
  open: boolean;
  onClose: () => void;
  locationId?: string;
  locationName?: string;
  serviceLine?: string;
}

export function HistoryReportModal({ open, onClose, locationId, locationName, serviceLine }: HistoryReportProps) {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [historyRules, setHistoryRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("from", from);
      if (locationId) p.set("locationId", locationId);
      if (serviceLine && serviceLine !== "All") p.set("serviceLine", serviceLine);
      const res = await fetch(`/api/adjustment-rules/history?${p}`);
      if (res.ok) setHistoryRules(await res.json());
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, [from, locationId, serviceLine]);

  useEffect(() => { if (open) fetchHistory(); }, [open, fetchHistory]);

  const scope = locationName
    ? locationName + (serviceLine && serviceLine !== "All" ? ` · ${serviceLine}` : "")
    : serviceLine && serviceLine !== "All" ? `${serviceLine} · Portfolio-wide` : "Portfolio-wide";

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Group by effective date
  const byDate = new Map<string, any[]>();
  for (const r of historyRules) {
    const d = r.effectiveDate ? String(r.effectiveDate).slice(0, 10) : "Unknown";
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(r);
  }
  const sortedDates = Array.from(byDate.entries()).sort(([a], [b]) => b.localeCompare(a));

  // Parse description for display
  const parseDesc = (r: any) => {
    const adj = r.action?.adjustmentValue;
    const adjType = r.action?.adjustmentType;
    const pct = adjType === "percentage";
    const val = adj != null ? `${Number(adj) >= 0 ? "+" : ""}${adj}${pct ? "%" : ""}` : "";
    const rts = (r.action?.filters?.roomType || []).join(", ");
    const campus = r.description?.match(/at (.+?) \(room/)?.[1] || locationName || "";
    return { val, rts, campus };
  };

  const handlePrint = () => window.print();

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-[95vw] w-[1100px] max-h-[95vh] p-0 overflow-hidden flex flex-col bg-slate-50 print:max-w-none print:w-full print:max-h-none print:overflow-visible report-modal">
        <ReportHeader title="Pricing History Report" scope={scope} onClose={onClose} onPrint={handlePrint} />

        <div className="report-printable flex-1 overflow-y-auto print:overflow-visible px-8 py-6 space-y-6">
          {/* Date filter */}
          <div className="flex items-center justify-between print:hidden">
            <p className="text-xs text-slate-400">Generated {today}</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-medium">Show changes since:</span>
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                className="h-8 text-xs px-2.5 border border-slate-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
              {loading && <span className="text-xs text-slate-400">Loading…</span>}
            </div>
          </div>

          {/* KPI summary */}
          <div className="flex flex-wrap gap-3">
            <KpiCard label="Total Changes" value={String(historyRules.length)} color="text-slate-800" />
            <KpiCard label="Effective Dates" value={String(sortedDates.length)} color="text-slate-800" />
            <KpiCard label="Period Start" value={new Date(from + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} color="text-slate-800" />
          </div>

          {/* History table by date */}
          {sortedDates.length === 0 && !loading && (
            <div className="bg-white rounded-xl border border-slate-200 px-6 py-10 text-center">
              <Calendar className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No pricing changes since {new Date(from + "T00:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>
            </div>
          )}

          {sortedDates.map(([date, rules]) => {
            const label = date === "Unknown"
              ? "Unknown date"
              : new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

            return (
              <div key={date} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 bg-slate-900 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-slate-400" />
                    <p className="text-sm font-bold text-white">Effective {label}</p>
                  </div>
                  <span className="text-xs font-semibold text-slate-400 bg-slate-800 rounded-full px-2.5 py-0.5">
                    {rules.length} change{rules.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500 w-[30%]">Campus</th>
                      <th className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500 w-[10%]">Service Line</th>
                      <th className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500 w-[12%]">Adjustment</th>
                      <th className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-500">Room Types</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.map((r: any, i: number) => {
                      const { val, rts, campus } = parseDesc(r);
                      const sl = r.serviceLine || (r.action?.filters?.serviceLine || [])[0] || "";
                      const isPos = Number(r.action?.adjustmentValue ?? 0) >= 0;
                      return (
                        <tr key={r.id} className={`border-t border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/40"}`}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
                              <span className="text-xs text-slate-700 font-medium">{campus}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            {sl ? (
                              <span className="inline-block text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: SL_BG[sl] || "#f1f5f9", color: SL_FG[sl] || "#475569" }}>{sl}</span>
                            ) : <span className="text-slate-400 text-xs">All</span>}
                          </td>
                          <td className="px-3 py-3">
                            <span className={`text-sm font-black ${isPos ? "text-emerald-600" : "text-red-600"}`}>{val}</span>
                          </td>
                          <td className="px-3 py-3 text-xs text-slate-500 leading-snug">{rts || "All room types"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}

          <p className="text-xs text-slate-400 text-center pb-2">
            Modulo Revenue Management · Confidential · Generated {today}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
