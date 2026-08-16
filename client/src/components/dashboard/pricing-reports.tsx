import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Printer, X, Building2, TrendingUp, TrendingDown, Calendar, ChevronUp, ChevronDown, ChevronsUpDown, HelpCircle } from "lucide-react";
import moduloLogo from "@assets/modulo_glass_v2_1784404625887.png";

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
    street_to_comp_var: "St vs comp", ih_street_variance: "IH-to-street var",
    competitor_variance: "Comp var", inquiry_volume: "Inq vol",
  };
  // Fields whose stored value is a fraction (0–1) representing a percentage
  const pctFractionFields = new Set(["service_line_occupancy", "room_type_occupancy", "campus_occupancy", "occupancy", "ih_street_variance"]);
  return conditions.map((c: any) => {
    const field = fieldMap[c.field] || (c.field || "").replace(/_/g, " ");
    const raw = c.value;
    const val = pctFractionFields.has(c.field) && typeof raw === "number" && Math.abs(raw) <= 1
      ? `${Math.round(raw * 100)}%`
      : c.field === "street_to_comp_var"
        ? `${raw}%`
        : raw;
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
    <div className="report-header bg-slate-900 text-white px-8 py-3 flex items-center justify-between gap-4 print:bg-slate-900 print:text-white">
      <div className="flex items-center gap-5">
        {/* Logo — dark background matches the navy header */}
        <img src={moduloLogo} alt="Modulo" className="h-36 w-auto rounded-md shrink-0" />
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
          className="print:hidden border-slate-500 bg-white/10 text-slate-100 hover:bg-white hover:text-slate-900 hover:border-white gap-1.5 h-8"
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
  selectedRegions?: string[];
  selectedDivisions?: string[];
}

export function StrategyReportModal({ open, onClose, selectedServiceLine, selectedLocations, selectedLocationId, selectedRegions, selectedDivisions }: StrategyReportProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const rulesQs = (() => {
    const p = new URLSearchParams();
    if (selectedLocationId) p.set("locationId", selectedLocationId);
    if (selectedServiceLine && selectedServiceLine !== "All") p.set("serviceLine", selectedServiceLine);
    // Include location names so the server's scope-scoping logic fires and the
    // result matches exactly what Rule Administration shows for the same filter.
    (selectedLocations || []).forEach(l => p.append("locations", l));
    (selectedRegions || []).forEach(r => p.append("regions", r));
    (selectedDivisions || []).forEach(d => p.append("divisions", d));
    const s = p.toString();
    return s ? "?" + s : "";
  })();

  const commentaryQs = (() => {
    const p = new URLSearchParams();
    if (selectedLocationId) p.set("locationId", selectedLocationId);
    if (selectedServiceLine && selectedServiceLine !== "All") p.set("serviceLine", selectedServiceLine);
    (selectedLocations || []).forEach(l => p.append("locations", l));
    (selectedRegions || []).forEach(r => p.append("regions", r));
    (selectedDivisions || []).forEach(d => p.append("divisions", d));
    const s = p.toString();
    return s ? "?" + s : "";
  })();

  const { data: rulesData = [] } = useQuery<any[]>({
    queryKey: ["/api/adjustment-rules", selectedLocationId ?? "", selectedServiceLine ?? "", (selectedLocations || []).join(","), (selectedRegions || []).join(","), (selectedDivisions || []).join(",")],
    queryFn: () => fetch(`/api/adjustment-rules${rulesQs}`).then(r => r.json()),
    enabled: open,
    staleTime: 2 * 60 * 1000,
  });

  const { data: commentary } = useQuery<any>({
    queryKey: ["/api/pricing-controls/commentary", selectedLocationId ?? "", selectedServiceLine, (selectedLocations || []).join(","), (selectedRegions || []).join(","), (selectedDivisions || []).join(",")],
    queryFn: () => fetch(`/api/pricing-controls/commentary${commentaryQs}`).then(r => r.json()),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const { data: statsData } = useQuery<any>({
    queryKey: ["/api/adjustment-rules/combined-stats", selectedLocationId ?? "", selectedServiceLine ?? "", (selectedLocations || []).join(","), (selectedRegions || []).join(","), (selectedDivisions || []).join(",")],
    queryFn: () => {
      const p = new URLSearchParams();
      if (selectedLocationId) p.set("locationId", selectedLocationId);
      if (selectedServiceLine && selectedServiceLine !== "All") p.set("serviceLine", selectedServiceLine);
      (selectedLocations || []).forEach(l => p.append("locations", l));
      (selectedRegions || []).forEach(r => p.append("regions", r));
      (selectedDivisions || []).forEach(d => p.append("divisions", d));
      return fetch(`/api/adjustment-rules/combined-stats${p.toString() ? "?" + p.toString() : ""}`).then(r => r.json());
    },
    enabled: open,
    staleTime: 2 * 60 * 1000,
  });

  // Year-over-year street-rate movement + the lift the active rules will add
  const { data: yoyData } = useQuery<any>({
    queryKey: ["/api/pricing-controls/yoy-rate-analysis", selectedLocationId ?? "", selectedServiceLine ?? "", (selectedLocations || []).join(","), (selectedRegions || []).join(","), (selectedDivisions || []).join(",")],
    queryFn: () => {
      const p = new URLSearchParams();
      if (selectedLocationId) p.set("locationId", selectedLocationId);
      if (selectedServiceLine && selectedServiceLine !== "All") p.set("serviceLine", selectedServiceLine);
      (selectedLocations || []).forEach(l => p.append("locations", l));
      (selectedRegions || []).forEach(r => p.append("regions", r));
      (selectedDivisions || []).forEach(d => p.append("divisions", d));
      return fetch(`/api/pricing-controls/yoy-rate-analysis${p.toString() ? "?" + p.toString() : ""}`).then(r => r.json());
    },
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  // ── Scope-aware rule list ──
  // Portfolio-wide, every active rule is listed even at 0 units: a dormant rule
  // is real information at that level (its thresholds sit outside the range the
  // portfolio occupies), and hiding it makes the rule look deleted.
  //
  // Once the report is filtered to specific locations / service lines, that no
  // longer holds. Rules with no location scope of their own pass the list filter
  // (they apply everywhere) but qualify no units inside the filter, so the report
  // fills with "0 units / +$0" rows that say nothing about the campus being
  // reviewed. At a single campus that is most of the table. Those rows are
  // dropped here, and the count of what was dropped is surfaced above the table
  // so the reader knows the list was narrowed rather than the rules vanishing.
  const isScoped = !!(
    selectedLocationId ||
    (selectedLocations && selectedLocations.length) ||
    (selectedRegions && selectedRegions.length) ||
    (selectedDivisions && selectedDivisions.length) ||
    (selectedServiceLine && selectedServiceLine !== "All")
  );
  // Units alone counts as impact: a rule can move rates on units whose dollar
  // impact rounds to zero, and that is still a rule acting on this scope.
  const hasScopedImpact = (r: any) =>
    (r.affectedUnits ?? 0) > 0 ||
    (r.monthlyImpact ?? 0) !== 0 ||
    (r.annualImpact ?? 0) !== 0 ||
    (r.steadyStateAnnualImpact ?? 0) !== 0;

  const allActiveRules = rulesData.filter((r: any) => r.isActive && !r.isHistorical);
  const rawActiveRules = allActiveRules.filter(hasScopedImpact);
  const hiddenNoImpactCount = allActiveRules.length - rawActiveRules.length;
  // Fraction of the calendar year remaining from today through Dec 31.
  // Used for the "Rest of Year" column: same ramp assumptions as First-Year
  // impact, just prorated to the remaining months of the current year.
  const restOfYearFraction = (() => {
    const now = new Date();
    const endOfYear = new Date(now.getFullYear(), 11, 31);
    const daysLeft = Math.max(1, Math.ceil((endOfYear.getTime() - now.getTime()) / 86_400_000));
    return daysLeft / 365;
  })();

  const activeRules = sortKey
    ? [...rawActiveRules].sort((a: any, b: any) => {
        let av: any, bv: any;
        if (sortKey === "name") { av = a.name || ""; bv = b.name || ""; }
        else if (sortKey === "serviceLine") {
          av = a.serviceLine || (a.action?.filters?.serviceLine || [])[0] || "";
          bv = b.serviceLine || (b.action?.filters?.serviceLine || [])[0] || "";
        }
        else if (sortKey === "restOfYear") { av = (a.annualImpact || 0) * restOfYearFraction; bv = (b.annualImpact || 0) * restOfYearFraction; }
        else { av = a[sortKey] ?? 0; bv = b[sortKey] ?? 0; }
        const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
        return sortDir === "asc" ? cmp : -cmp;
      })
    : rawActiveRules;

  const totalNet = activeRules.reduce((s: number, r: any) => s + (r.annualImpact || 0), 0);
  const totalSteadyState = activeRules.reduce((s: number, r: any) => s + (r.steadyStateAnnualImpact || 0), 0);
  const lift = activeRules.filter((r: any) => (r.annualImpact || 0) > 0).reduce((s: number, r: any) => s + r.annualImpact, 0);
  const conc = activeRules.filter((r: any) => (r.annualImpact || 0) < 0).reduce((s: number, r: any) => s + r.annualImpact, 0);

  // Scope label for the header and the empty state. Every filter dimension has to
  // be represented: a region- or division-only report used to call itself
  // "Portfolio-wide", which is wrong in the header and actively misleading in the
  // empty state ("No active pricing rule affects Portfolio-wide").
  const scope = (() => {
    const sl = selectedServiceLine && selectedServiceLine !== "All" ? selectedServiceLine : null;
    const locs = selectedLocations || [];
    const regs = selectedRegions || [];
    const divs = selectedDivisions || [];
    const place =
      locs.length === 1 ? locs[0]
      : locs.length > 1 ? `${locs.length} locations`
      : regs.length === 1 ? `${regs[0]} region`
      : regs.length > 1 ? `${regs.length} regions`
      : divs.length === 1 ? `${divs[0]} division`
      : divs.length > 1 ? `${divs.length} divisions`
      // A bare locationId carries no name on this surface, so describe it generically
      // rather than claiming portfolio coverage.
      : selectedLocationId ? "Selected campus"
      : null;
    if (place) return sl ? `${place} · ${sl}` : place;
    return sl ? `${sl} · Portfolio-wide` : "Portfolio-wide";
  })();

  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const handlePrint = () => {
    const printable = printRef.current;
    if (!printable) return;

    // Clone the full modal (header + scrollable content) into a plain body div
    // so no Radix portal, overlay, or transform can interfere with printing.
    let printRoot = document.getElementById('modulo-print-root');
    if (!printRoot) {
      printRoot = document.createElement('div');
      printRoot.id = 'modulo-print-root';
      document.body.appendChild(printRoot);
    }

    const modal = printable.closest('.report-modal') as HTMLElement | null;
    printRoot.innerHTML = '';
    if (modal) {
      const clone = modal.cloneNode(true) as HTMLElement;
      // Strip inline styles that would carry over screen-only constraints
      clone.removeAttribute('style');
      const cloneContent = clone.querySelector('.report-printable') as HTMLElement | null;
      if (cloneContent) {
        cloneContent.style.overflow = 'visible';
        cloneContent.style.maxHeight = 'none';
        cloneContent.style.height = 'auto';
      }
      printRoot.appendChild(clone);
    }

    document.body.classList.add('report-printing');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('report-printing');
      if (printRoot) printRoot.innerHTML = '';
    }, { once: true });
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

          {/* ── Rate movement: trailing 12 months vs. what the proposal adds ── */}
          {yoyData?.available && yoyData.byServiceLine?.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm break-inside-avoid">
              <div className="px-6 py-4 bg-gradient-to-r from-slate-900 to-slate-800 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-400">Rate Movement</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Trailing 12 months ({yoyData.priorMonth} → {yoyData.currentMonth}) vs. the lift this proposal adds
                  </p>
                </div>
                {yoyData.overall && (
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">Last 12 Mo</p>
                      {yoyData.overall.yoyPct == null ? (
                        <p className="text-xl font-black leading-none text-slate-500">n/a</p>
                      ) : (
                        <p className={`text-xl font-black leading-none ${yoyData.overall.yoyPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {yoyData.overall.yoyPct >= 0 ? "+" : ""}{yoyData.overall.yoyPct}%
                        </p>
                      )}
                      {yoyData.overall.incomparableServiceLines > 0 && (
                        <p className="text-[9px] text-slate-500 mt-0.5">
                          excl. {yoyData.overall.incomparableServiceLines} line{yoyData.overall.incomparableServiceLines > 1 ? "s" : ""} w/o history
                        </p>
                      )}
                    </div>
                    <div className="text-slate-600 text-lg font-light">→</div>
                    <div className="text-right">
                      <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">Proposal Adds</p>
                      <p className={`text-xl font-black leading-none ${(yoyData.overall.proposedPct ?? 0) >= 0 ? "text-teal-300" : "text-amber-300"}`}>
                        {(yoyData.overall.proposedPct ?? 0) >= 0 ? "+" : ""}{yoyData.overall.proposedPct ?? 0}%
                      </p>
                      <p className="text-[9px] text-slate-500 mt-0.5">on {yoyData.overall.affectedUnits?.toLocaleString()} units</p>
                    </div>
                  </div>
                )}
              </div>

              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left  px-6 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Service Line</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Avg Rate<br/><span className="font-medium normal-case tracking-normal text-slate-400">a year ago</span></th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Avg Rate<br/><span className="font-medium normal-case tracking-normal text-slate-400">today</span></th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">YoY Change</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Proposal<br/><span className="font-medium normal-case tracking-normal text-slate-400">on affected</span></th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Coverage</th>
                    <th className="text-right px-6 py-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Net Effect<br/><span className="font-medium normal-case tracking-normal text-slate-400">whole line</span></th>
                  </tr>
                </thead>
                <tbody>
                  {yoyData.byServiceLine.map((r: any) => {
                    const yoyPos = (r.yoyPct ?? 0) >= 0;
                    const propPos = (r.proposedPct ?? 0) >= 0;
                    const isDaily = r.serviceLine === "HC" || r.serviceLine === "HC/MC";
                    return (
                      <tr key={r.serviceLine} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="px-6 py-3">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold"
                            style={{ background: SL_BG[r.serviceLine] || "#f1f5f9", color: SL_FG[r.serviceLine] || "#475569" }}>
                            {r.serviceLine}
                          </span>
                          <span className="ml-2 text-[10px] text-slate-400">{r.totalUnits?.toLocaleString()} units</span>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-500">
                          ${r.priorRate?.toLocaleString()}{isDaily && <span className="text-[9px] text-slate-400">/day</span>}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums font-semibold text-slate-800">
                          ${r.currentRate?.toLocaleString()}{isDaily && <span className="text-[9px] text-slate-400">/day</span>}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {r.yoyPct == null ? <span className="text-slate-300">—</span> : (
                            <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${yoyPos ? "text-emerald-600" : "text-red-600"}`}>
                              {yoyPos ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                              {yoyPos ? "+" : ""}{r.yoyPct}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {r.affectedUnits === 0 ? <span className="text-slate-300">—</span> : (
                            <span className={`font-bold tabular-nums ${propPos ? "text-teal-700" : "text-amber-700"}`}>
                              {propPos ? "+" : ""}{r.proposedPct}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {r.affectedUnits === 0 ? <span className="text-slate-300">—</span> : (
                            <div className="flex items-center justify-end gap-2">
                              <div className="w-14 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.min(100, r.coveragePct)}%` }} />
                              </div>
                              <span className="text-[11px] tabular-nums text-slate-500 w-10 text-right">{r.coveragePct}%</span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3 text-right">
                          {r.affectedUnits === 0 ? <span className="text-slate-300">—</span> : (
                            <span className={`font-bold tabular-nums ${(r.blendedPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                              {(r.blendedPct ?? 0) >= 0 ? "+" : ""}{r.blendedPct}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-6 py-3 bg-slate-50 border-t border-slate-200">
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  <span className="font-semibold text-slate-600">Reading this:</span> YoY Change is the actual movement in average street rate over the last 12 months.
                  Proposal is the weighted average increase the active rules apply to the units they claim. Net Effect scales that by coverage — the blended
                  impact across the entire service line. HC and HC/MC are daily rates.
                </p>
              </div>
            </div>
          )}

          {/* Rules table — [overflow:clip] keeps rounded corners while letting sticky thead work */}
          <div className="bg-white rounded-xl border border-slate-200 [overflow:clip] shadow-sm">
            <TooltipProvider delayDuration={200}>
            <table className="w-full text-sm border-collapse">
              <thead>
                {/* Section title row — sticky so it stays visible while scrolling */}
                <tr className="bg-slate-900 sticky top-0 z-20">
                  <td colSpan={9} className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-bold text-white tracking-tight">Active Pricing Rules</p>
                      <div className="flex items-center gap-3">
                        {hiddenNoImpactCount > 0 && (
                          <p className="text-xs font-medium text-slate-500">
                            {hiddenNoImpactCount} rule{hiddenNoImpactCount !== 1 ? "s" : ""} with no impact here hidden
                          </p>
                        )}
                        <p className="text-xs font-medium text-slate-400 bg-slate-800 rounded-full px-3 py-1">{activeRules.length} rule{activeRules.length !== 1 ? "s" : ""} currently in play</p>
                      </div>
                    </div>
                  </td>
                </tr>
                {/* Column headers — sticky just below the title row (~57 px) */}
                <tr className="bg-slate-50 text-left border-b border-slate-200 sticky top-[57px] z-20 shadow-[0_1px_0_0_#e2e8f0]">
                  {([
                    {
                      key: "name", label: "Rule", cls: "px-5 py-3 w-[22%] text-left",
                      tip: "Rule name and the rate adjustment it applies (+% increase or −% concession). Click to sort alphabetically.",
                    },
                    {
                      key: "serviceLine", label: "Service Line", cls: "px-3 py-3 w-[9%] text-left",
                      tip: "The care type this rule is scoped to (AL, HC, HC/MC, SL, VIL). Rules showing 'All' apply across every service line.",
                    },
                    {
                      key: null, label: "Condition", cls: "px-3 py-3 w-[26%] text-left",
                      tip: "The occupancy or market trigger(s) a unit must satisfy to receive this rule's adjusted rate. Multiple conditions are AND-ed — a unit must meet all of them.",
                    },
                    {
                      key: "affectedUnits", label: "Units", cls: "px-3 py-3 w-[7%] text-right",
                      tip: "Units currently meeting every trigger condition and receiving this rule's adjusted street rate. Shown with the number of distinct campuses covered.",
                    },
                    {
                      key: "monthlyImpact", label: "Monthly", cls: "px-3 py-3 w-[8%] text-right",
                      tip: "Rate delta × monthly move-in rate × affected units. Only new admissions pay the adjusted rate — existing residents' in-house rates are unaffected — so this reflects the recurring revenue earned from new move-ins each month.",
                    },
                    {
                      key: "restOfYear", label: "Rest of Year", cls: "px-3 py-3 w-[10%] text-right",
                      tip: "First-Year impact prorated to the remaining calendar days in the current year (today → Dec 31). Useful for budget planning within the current fiscal year.",
                    },
                    {
                      key: "annualImpact", label: "First-Year", cls: "px-3 py-3 w-[9%] text-right",
                      tip: "Cumulative 12-month impact using a ramp factor (×78 move-in events) that assumes the rate change reaches a full roster of new residents over the year. Concession rules reduce this.",
                    },
                    {
                      key: "steadyStateAnnualImpact", label: "Fully Ramped /yr", cls: "px-3 py-3 w-[10%] text-right",
                      tip: "Annual steady-state revenue once the full unit cohort has turned over at least once and every resident is paying the adjusted rate (×144 move-in events vs ×78 for the first year).",
                    },
                  ] as const).map(({ key, label, cls, tip }) => (
                    <th key={label}
                      className={`${cls} text-xs font-bold uppercase tracking-wider text-slate-500 select-none ${key ? "cursor-pointer hover:text-slate-700 hover:bg-slate-100" : ""}`}
                      onClick={key ? () => handleSort(key) : undefined}>
                      <span className={`inline-flex items-center gap-1 ${cls.includes("text-right") ? "justify-end w-full" : ""}`}>
                        {label}
                        {key && (sortKey === key
                          ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
                          : <ChevronsUpDown className="h-3 w-3 opacity-30" />)}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="inline-flex text-slate-300 hover:text-slate-500 transition-colors cursor-help"
                              onClick={e => e.stopPropagation()}
                            >
                              <HelpCircle className="h-3 w-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[260px] text-xs leading-relaxed text-left normal-case font-normal tracking-normal">
                            {tip}
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-3 w-[5%]"></th>
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
                        <div className="flex flex-col items-end">
                          {(rule.affectedUnits ?? 0) === 0 ? (
                            <span className="inline-block text-[10px] font-semibold text-slate-400 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5" title="Condition could not be evaluated — no matching data found">0 units</span>
                          ) : (
                            <span className="text-sm font-bold text-slate-800">{(rule.affectedUnits ?? 0).toLocaleString()}</span>
                          )}
                          <p className="text-[10px] text-slate-400 mt-0.5 h-[14px]">
                            {rule.affectedCampuses > 0 ? `${rule.affectedCampuses} campus${rule.affectedCampuses !== 1 ? "es" : ""}` : ""}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`tabular-nums text-base font-bold ${isPos ? "text-emerald-600" : "text-red-600"}`}>{fmt(rule.monthlyImpact || 0)}</span>
                          <p className="h-[14px] mt-0.5" />
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`tabular-nums text-base font-bold ${isPos ? "text-emerald-600" : "text-red-600"}`}>{fmt(Math.round((rule.annualImpact || 0) * restOfYearFraction))}</span>
                          <p className="text-[10px] text-slate-400 mt-0.5 h-[14px]">thru Dec</p>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`tabular-nums text-base font-bold ${isPos ? "text-emerald-600" : "text-red-600"}`}>{fmt(rule.annualImpact || 0)}</span>
                          <p className="h-[14px] mt-0.5" />
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="flex flex-col items-end">
                          <span className={`tabular-nums text-base font-bold ${isPos ? "text-emerald-700" : "text-red-700"}`}>{fmt(rule.steadyStateAnnualImpact || 0)}</span>
                          <p className="text-[10px] text-slate-400 mt-0.5 h-[14px]">run-rate</p>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        {isPos
                          ? <TrendingUp className="h-4 w-4 text-emerald-500 ml-auto" />
                          : <TrendingDown className="h-4 w-4 text-red-500 ml-auto" />}
                      </td>
                    </tr>
                  );
                })}
                {/* Every rule was filtered out as no-impact for this scope */}
                {activeRules.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center">
                      {hiddenNoImpactCount > 0 ? (
                        <>
                          <p className="text-sm font-semibold text-slate-700">No active pricing rule affects {scope}</p>
                          <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                            {hiddenNoImpactCount === 1
                              ? "One active rule was evaluated against this scope and qualified no units."
                              : `All ${hiddenNoImpactCount} active rules were evaluated against this scope and qualified no units.`}
                            {" "}Widen the filter, or revisit the rule thresholds if this scope should be priced.
                          </p>
                        </>
                      ) : (
                        /* Nothing was hidden — there simply are no active rules to report on. */
                        <>
                          <p className="text-sm font-semibold text-slate-700">No active pricing rules</p>
                          <p className="text-xs text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
                            Create a rule in the Rule Designer to start pricing {scope}.
                          </p>
                        </>
                      )}
                    </td>
                  </tr>
                )}
                {/* Totals row — omitted when nothing qualified, since a row of $0 reads as a finding */}
                {activeRules.length > 0 && (
                <tr className="border-t-2 border-slate-300 bg-slate-900">
                  <td className="px-5 py-4 text-sm font-bold text-white" colSpan={3}>{isScoped ? "Scope" : "Portfolio"} Total — {activeRules.length} active rule{activeRules.length !== 1 ? "s" : ""}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-base font-black text-white">{statsData?.uniqueUnits ?? activeRules.reduce((s: number, r: any) => s + (r.affectedUnits || 0), 0)}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-base font-black text-emerald-400">{fmt(activeRules.reduce((s: number, r: any) => s + (r.monthlyImpact || 0), 0))}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-base font-black text-emerald-400">{fmt(Math.round(activeRules.reduce((s: number, r: any) => s + (r.annualImpact || 0), 0) * restOfYearFraction))}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-base font-black text-emerald-400">{fmt(totalNet)}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-base font-black text-emerald-400">{fmt(totalSteadyState)}</td>
                  <td />
                </tr>
                )}
              </tbody>
            </table>
            </TooltipProvider>
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

  const handlePrint = () => {
    const modal = document.querySelector('.report-modal') as HTMLElement | null;

    let printRoot = document.getElementById('modulo-print-root');
    if (!printRoot) {
      printRoot = document.createElement('div');
      printRoot.id = 'modulo-print-root';
      document.body.appendChild(printRoot);
    }

    printRoot.innerHTML = '';
    if (modal) {
      const clone = modal.cloneNode(true) as HTMLElement;
      clone.removeAttribute('style');
      const cloneContent = clone.querySelector('.report-printable') as HTMLElement | null;
      if (cloneContent) {
        cloneContent.style.overflow = 'visible';
        cloneContent.style.maxHeight = 'none';
        cloneContent.style.height = 'auto';
      }
      printRoot.appendChild(clone);
    }

    document.body.classList.add('report-printing');
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('report-printing');
      if (printRoot) printRoot.innerHTML = '';
    }, { once: true });
    window.print();
  };

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
