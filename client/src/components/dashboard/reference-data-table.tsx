import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Loader2,
  Maximize2,
  Minimize2,
  Filter,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Download,
  X,
  Table2,
  Play,
  CheckCircle2,
  Info,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ── Column metadata ────────────────────────────────────────────────
type ColType =
  | "text"
  | "int"
  | "num1"
  | "num1signed"
  | "pct"
  | "pctfrac"
  | "pctfracsigned"
  | "money"
  | "moneysigned";

interface ColDef {
  key: string;
  label: string;
  type: ColType;
  tip: string;
  frozen?: boolean;
  /** Freeze this column on mobile too (narrower set than desktop frozen) */
  mobileFreeze?: boolean;
  w: number; // px width (desktop)
  /** Narrower width to use on mobile when mobileFreeze is true */
  wMobile?: number;
}

type ActiveRule = { id: string; name: string; description: string; priority: number; action: any; trigger: any };

interface GroupDef {
  id: string;
  label: string;
  cols: ColDef[];
  ruleInfo?: ActiveRule;
  /** Groups marked expandable show a +/- toggle that reveals per-month columns */
  expandable?: boolean;
  /** Key on each row that holds the { [YYYY-MM]: number|null } history map */
  historyKey?: string;
  /** ColType for the dynamic monthly columns */
  historyColType?: ColType;
}

// ── month label helper ─────────────────────────────────────────────
function fmtMonthLabel(ym: string): string {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [y, m] = ym.split("-");
  return `${MONTHS[parseInt(m, 10) - 1]} '${y.slice(2)}`;
}

const GROUPS: GroupDef[] = [
  {
    id: "campus",
    label: "Campus Information",
    cols: [
      { key: "division", label: "Division", type: "text", w: 120, frozen: true, mobileFreeze: true, wMobile: 95, tip: "The operating division the campus belongs to." },
      { key: "campus", label: "Campus", type: "text", w: 140, frozen: true, mobileFreeze: true, wMobile: 110, tip: "The community / facility name." },
      { key: "serviceLine", label: "SL", type: "text", w: 80, frozen: true, tip: "Care level grouping (AL, SL, HC, MC, VIL, etc.)." },
      { key: "roomType", label: "Room Type", type: "text", w: 120, frozen: true, tip: "Unit / room configuration within the service line." },
      { key: "totalUnits", label: "Units", type: "int", w: 50, frozen: true, tip: "Count of units (or beds) for this campus / service line / room type in the most recent month." },
    ],
  },
  {
    id: "vacant",
    label: "Vacant Units",
    cols: [
      { key: "vacantSpot", label: "Spot", type: "num1", w: 65, tip: "Vacant units right now (total units minus occupied units) in the latest month." },
      { key: "vacantT3", label: "T3", type: "num1", w: 65, tip: "Average number of vacant units across the trailing 3 months." },
      { key: "vacantT12", label: "T12", type: "num1", w: 65, tip: "Average number of vacant units across the trailing 12 months." },
    ],
  },
  {
    id: "campusOcc",
    label: "Campus Occ.",
    expandable: true,
    historyKey: "campusOccHistory",
    historyColType: "pct",
    cols: [
      { key: "campusOccSpot", label: "Spot", type: "pct", w: 65, tip: "Occupied units ÷ total units for the whole campus in the latest month." },
      { key: "campusOccT3", label: "T3", type: "pct", w: 65, tip: "Average campus occupancy % across the trailing 3 months." },
      { key: "campusOccT12", label: "T12", type: "pct", w: 65, tip: "Average campus occupancy % across the trailing 12 months." },
    ],
  },
  {
    id: "slOcc",
    label: "SL Occupancy",
    expandable: true,
    historyKey: "slOccHistory",
    historyColType: "pct",
    cols: [
      { key: "slOccSpot", label: "Spot", type: "pct", w: 65, tip: "Occupied ÷ total for this service line at this campus in the latest month." },
      { key: "slOccT3", label: "T3", type: "pct", w: 65, tip: "Average service-line occupancy % across the trailing 3 months." },
      { key: "slOccT12", label: "T12", type: "pct", w: 65, tip: "Average service-line occupancy % across the trailing 12 months." },
    ],
  },
  {
    id: "rtOcc",
    label: "Room Type Occ.",
    expandable: true,
    historyKey: "rtOccHistory",
    historyColType: "pct",
    cols: [
      { key: "rtOccSpot", label: "Spot", type: "pct", w: 65, tip: "Occupied ÷ total for this specific room type in the latest month." },
      { key: "rtOccT3", label: "T3", type: "pct", w: 65, tip: "Average room-type occupancy % across the trailing 3 months." },
      { key: "rtOccT12", label: "T12", type: "pct", w: 65, tip: "Average room-type occupancy % across the trailing 12 months." },
    ],
  },
  {
    id: "daysVacant",
    label: "Days Vacant (Avg)",
    cols: [
      { key: "daysVacantSpot", label: "Spot", type: "num1", w: 65, tip: "Average days vacant for currently-vacant units of this room type (latest month)." },
      { key: "daysVacantT3", label: "T3", type: "num1", w: 65, tip: "Average days vacant across the trailing 3 months." },
    ],
  },
  {
    id: "hcCensus",
    label: "HC Private Pay",
    cols: [
      { key: "hcPrivatePaySpot", label: "Pvt Pay", type: "int", w: 70, tip: "Count of occupied HC / HC/MC beds with a private-pay payor type in the latest month. Blank for non-HC service lines." },
    ],
  },
  {
    id: "inquiries",
    label: "Inquiries",
    cols: [
      { key: "inqPrevMonth", label: "Latest", type: "num1", w: 70, tip: "Number of inquiries recorded in the most recent month." },
      { key: "inqVsT3", label: "Δ T3", type: "num1signed", w: 75, tip: "Latest month inquiries minus the trailing 3-month average (count change)." },
    ],
  },
  {
    id: "tours",
    label: "Tours",
    cols: [
      { key: "tourPrevMonth", label: "Latest", type: "num1", w: 70, tip: "Number of tours recorded in the most recent month." },
      { key: "tourVsT3", label: "Δ T3", type: "num1signed", w: 75, tip: "Latest month tours minus the trailing 3-month average (count change)." },
    ],
  },
  {
    id: "street",
    label: "Street Rates",
    expandable: true,
    historyKey: "streetHistory",
    historyColType: "money",
    cols: [
      { key: "streetSpot", label: "Spot", type: "money", w: 80, tip: "Average published street rate for this room type in the latest month." },
      { key: "streetIncT3", label: "T3 Δ", type: "pctfracsigned", w: 70, tip: "% change of the latest street rate vs the trailing 3-month average." },
      { key: "streetIncT12", label: "T12 Δ", type: "pctfracsigned", w: 70, tip: "% change of the latest street rate vs the trailing 12-month average." },
    ],
  },
  {
    id: "comp",
    label: "Comp Rates",
    cols: [
      { key: "compBase", label: "Base", type: "money", w: 80, tip: "Top competitor's base (unadjusted) rate for this room type." },
      { key: "compAdjusted", label: "Adjusted", type: "money", w: 80, tip: "Competitor rate after adjusting for care-level and med-management differences." },
      { key: "compVarPct", label: "Δ%", type: "pctfracsigned", w: 65, tip: "Adjusted vs base competitor rate as a percentage." },
    ],
  },
  {
    id: "inhouse",
    label: "In-House Rates",
    cols: [
      { key: "ihSpot", label: "Spot", type: "money", w: 80, tip: "Average in-house (actual paid) rate for occupied units of this room type, latest month." },
      { key: "ihVarStreetPct", label: "Δ% Street", type: "pctfracsigned", w: 80, tip: "In-house rate vs street rate as a percentage." },
      { key: "ihIncT3", label: "T3 Δ", type: "pctfracsigned", w: 70, tip: "% change of latest in-house rate vs the trailing 3-month average." },
      { key: "ihIncT12", label: "T12 Δ", type: "pctfracsigned", w: 70, tip: "% change of latest in-house rate vs the trailing 12-month average." },
    ],
  },
  {
    id: "proposed",
    label: "Proposed Rates",
    cols: [
      { key: "proposedRule", label: "Rule", type: "money", w: 80, tip: "Proposed rate from the rules engine. Blank when no adjustment rule applies to this combo." },
      { key: "proposedVarDollar", label: "$ Var", type: "moneysigned", w: 75, tip: "Proposed rate minus current in-house rate (dollars)." },
      { key: "proposedVarPct", label: "% Var", type: "pctfracsigned", w: 65, tip: "Proposed rate vs current in-house rate as a percentage." },
    ],
  },
  {
    id: "revenue",
    label: "Revenue Impact",
    cols: [
      { key: "revMonthlyImpact", label: "Monthly", type: "moneysigned", w: 90, tip: "(Proposed rate − in-house rate) × total units — estimated monthly revenue change." },
      { key: "revAnnualImpact", label: "Annual", type: "moneysigned", w: 90, tip: "Monthly impact × 12 — estimated annual revenue change." },
    ],
  },
  {
    id: "growthTarget",
    label: "Growth Target",
    cols: [
      { key: "revenueGrowthTarget", label: "Target", type: "pct", w: 70, tip: "Target annual revenue growth % set for this campus / service line on the Pricing Controls page." },
    ],
  },
  {
    id: "elasticity",
    label: "Elasticity & DTS",
    cols: [
      { key: "elasticity", label: "Elast.", type: "num1", w: 65, tip: "Estimated price elasticity for this combo — how sensitive demand (days to sell) is to a rate change." },
      { key: "daysToSellBefore", label: "DTS Now", type: "num1", w: 75, tip: "Estimated days to sell at the current in-house rate." },
      { key: "daysToSellAfter", label: "DTS New", type: "num1", w: 75, tip: "Estimated days to sell at the proposed rule rate." },
      { key: "daysToSellChange", label: "DTS Δ", type: "num1signed", w: 65, tip: "Change in estimated days to sell (after − before). Positive means slower to sell." },
    ],
  },
  {
    id: "elasticityImpact",
    label: "Elast. Rev. Impact",
    cols: [
      { key: "elasticityMonthlyImpact", label: "Monthly", type: "moneysigned", w: 90, tip: "Elasticity-adjusted estimated monthly revenue change, accounting for the demand response to the proposed rate." },
      { key: "elasticityAnnualImpact", label: "Annual", type: "moneysigned", w: 90, tip: "Elasticity-adjusted estimated annual revenue change (monthly × 12)." },
    ],
  },
];

const ALL_COLS: ColDef[] = GROUPS.flatMap((g) => g.cols);
const FROZEN_COLS = ALL_COLS.filter((c) => c.frozen);
const MOBILE_FROZEN_COLS = ALL_COLS.filter((c) => c.mobileFreeze);
const NUMERIC_TYPES: ColType[] = ["int", "num1", "num1signed", "pct", "pctfrac", "pctfracsigned", "money", "moneysigned"];

// cumulative left offsets for frozen columns (desktop)
const FROZEN_LEFT: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  let acc = 0;
  for (const c of FROZEN_COLS) {
    map[c.key] = acc;
    acc += c.w;
  }
  return map;
})();
const FROZEN_TOTAL_WIDTH = FROZEN_COLS.reduce((s, c) => s + c.w, 0);

// cumulative left offsets for mobile-frozen columns (use wMobile if set)
const MOBILE_FROZEN_LEFT: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  let acc = 0;
  for (const c of MOBILE_FROZEN_COLS) {
    map[c.key] = acc;
    acc += c.wMobile ?? c.w;
  }
  return map;
})();

// ── value formatting ───────────────────────────────────────────────
function fmt(value: any, type: ColType): string {
  if (type === "text") return value ?? "";
  if (value === null || value === undefined || Number.isNaN(value)) return "–";
  const v = Number(value);
  switch (type) {
    case "int":
      return Math.round(v).toLocaleString();
    case "num1":
      return v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case "num1signed":
      return `${v > 0 ? "+" : ""}${v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
    case "pct":
      return `${v.toFixed(1)}%`;
    case "pctfrac":
      return `${(v * 100).toFixed(1)}%`;
    case "pctfracsigned":
      return `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
    case "money":
      return `$${Math.round(v).toLocaleString()}`;
    case "moneysigned":
      return `${v < 0 ? "-" : "+"}$${Math.abs(Math.round(v)).toLocaleString()}`;
    default:
      return String(v);
  }
}

// for the Excel export – raw numeric where possible
function rawForExport(value: any, type: ColType): any {
  if (type === "text") return value ?? "";
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value);
}

function signClass(value: any, type: ColType): string {
  if (!["num1signed", "pctfracsigned", "moneysigned"].includes(type)) return "";
  if (value === null || value === undefined) return "";
  const v = Number(value);
  if (v > 0) return "text-emerald-600 dark:text-emerald-400";
  if (v < 0) return "text-rose-600 dark:text-rose-400";
  return "text-muted-foreground";
}

interface ReferenceDataResponse {
  rows: Record<string, any>[];
  months: string[];
  spotMonth: string | null;
  calculatedAt: string | null;
  rules?: ActiveRule[];
  // Each row also carries history maps (populated by the backend)
  // campusOccHistory / slOccHistory / rtOccHistory / streetHistory: { [YYYY-MM]: number|null }
}

interface ReferenceDataTableProps {
  selectedServiceLine?: string;
  selectedRegions?: string[];
  selectedDivisions?: string[];
  selectedLocations?: string[];
}

export default function ReferenceDataTable({
  selectedServiceLine,
  selectedRegions,
  selectedDivisions,
  selectedLocations,
}: ReferenceDataTableProps) {
  const queryClient = useQueryClient();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  // groups that are currently expanded to show per-month columns
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (id: string) =>
    setExpandedGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // On small screens, frozen-column pinning covers the whole viewport —
  // disable it so users can scroll the table horizontally.
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // ── Calculate Rates job state ───────────────────────────────────
  const [calcJobId, setCalcJobId] = useState<string | null>(null);
  const [calcProgress, setCalcProgress] = useState<number>(0);
  const [calcDone, setCalcDone] = useState(false);

  // ── Manual override popover state ────────────────────────────────
  const [overridePop, setOverridePop] = useState<{
    key: string; campus: string; serviceLine: string; roomType: string; locationId: string | null;
  } | null>(null);
  const [overrideInput, setOverrideInput] = useState('');

  const overrideSaveMutation = useMutation({
    mutationFn: async (payload: { campus: string; serviceLine: string; roomType: string; locationId: string | null; overrideRate: number }) =>
      apiRequest('/api/manual-rate-override', {
        method: 'POST',
        body: JSON.stringify({ locationName: payload.campus, serviceLine: payload.serviceLine, roomType: payload.roomType, locationId: payload.locationId, overrideRate: payload.overrideRate }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/reference-data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manual-rate-overrides'] });
      setOverridePop(null);
    },
  });

  const overrideClearMutation = useMutation({
    mutationFn: async (payload: { campus: string; serviceLine: string; roomType: string }) =>
      apiRequest(`/api/manual-rate-override/${encodeURIComponent(payload.campus)}/${encodeURIComponent(payload.serviceLine)}/${encodeURIComponent(payload.roomType)}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/reference-data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manual-rate-overrides'] });
      setOverridePop(null);
    },
  });

  const calcMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/pricing/scheduled-calculation", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<{ jobId: string }>;
    },
    onSuccess: (data) => {
      setCalcJobId(data.jobId);
      setCalcProgress(0);
      setCalcDone(false);
    },
  });

  // Poll job status while a job is running
  useQuery({
    queryKey: ["/api/pricing/job-status", calcJobId],
    enabled: !!calcJobId && !calcDone,
    refetchInterval: 2000,
    queryFn: async () => {
      const res = await fetch(`/api/pricing/job-status/${calcJobId}`);
      const data = await res.json();
      setCalcProgress(data.progress?.percentage ?? 0);
      if (data.status === "completed" || data.status === "failed") {
        setCalcDone(true);
        setCalcJobId(null);
        // Refresh the reference data to show newly calculated rates
        queryClient.invalidateQueries({ queryKey: ["/api/reference-data"] });
      }
      return data;
    },
  });

  // scroll sync refs — the bottom div is itself the scroll container
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const isSyncing = useRef(false);
  const [tableScrollWidth, setTableScrollWidth] = useState(0);

  useEffect(() => {
    const update = () => {
      if (tableRef.current) setTableScrollWidth(tableRef.current.offsetWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    if (tableRef.current) ro.observe(tableRef.current);
    if (bottomScrollRef.current) ro.observe(bottomScrollRef.current);
    return () => ro.disconnect();
  });

  const handleTopScroll = useCallback(() => {
    if (isSyncing.current) return;
    const top = topScrollRef.current;
    const bottom = bottomScrollRef.current;
    if (!top || !bottom) return;
    isSyncing.current = true;
    bottom.scrollLeft = top.scrollLeft;
    isSyncing.current = false;
  }, []);

  const handleBottomScroll = useCallback(() => {
    if (isSyncing.current) return;
    const top = topScrollRef.current;
    const bottom = bottomScrollRef.current;
    if (!top || !bottom) return;
    isSyncing.current = true;
    top.scrollLeft = bottom.scrollLeft;
    isSyncing.current = false;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── query ──
  const queryKey = ["/api/reference-data", selectedServiceLine, selectedRegions, selectedDivisions, selectedLocations];
  const { data, isLoading, isFetching } = useQuery<ReferenceDataResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedServiceLine && selectedServiceLine !== "All") params.append("serviceLine", selectedServiceLine);
      if (selectedRegions?.length) params.append("regions", selectedRegions.join(","));
      if (selectedDivisions?.length) params.append("divisions", selectedDivisions.join(","));
      if (selectedLocations?.length) params.append("locations", selectedLocations.join(","));
      const res = await fetch(`/api/reference-data?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load reference data");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const rawRows = data?.rows ?? [];

  // ── dynamic rule column groups ──
  const dynGroups = useMemo((): GroupDef[] => {
    const rules = data?.rules ?? [];
    const allMonths = data?.months ?? [];

    // Build base groups (with rule groups injected after "inhouse")
    let base: GroupDef[];
    if (!rules.length) {
      base = GROUPS;
    } else {
      const ruleGroups: GroupDef[] = rules.map((r, i) => ({
        id: `rule_${r.id}`,
        label: `Rule ${i + 1}`,
        ruleInfo: r,
        cols: [{
          key: `__rule_${r.id}`,
          label: "Rate",
          type: "money" as ColType,
          w: 85,
          tip: `Avg proposed rate for units where the "${r.name}" rule was applied (spot month).`,
        }],
      }));
      const insertAt = GROUPS.findIndex(g => g.id === "inhouse") + 1;
      base = [...GROUPS.slice(0, insertAt), ...ruleGroups, ...GROUPS.slice(insertAt)];
    }

    // For expandable groups that are currently open, inject per-month columns
    if (!allMonths.length) return base;
    return base.map(g => {
      if (!g.expandable || !expandedGroups.has(g.id)) return g;
      const histKey = g.historyKey!;
      const colType = g.historyColType ?? "pct";
      const monthCols: ColDef[] = allMonths.map(mm => ({
        key: `__hist_${histKey}_${mm}`,
        label: fmtMonthLabel(mm),
        type: colType,
        w: colType === "money" ? 80 : 65,
        tip: `${g.label} — ${mm}`,
      }));
      return { ...g, cols: [...g.cols, ...monthCols] };
    });
  }, [data?.rules, data?.months, expandedGroups]);

  const dynAllCols = useMemo(() => dynGroups.flatMap(g => g.cols), [dynGroups]);

  // ── filter + sort ──
  const processedRows = useMemo(() => {
    const rules = data?.rules ?? [];
    const allMonths = data?.months ?? [];
    let rows: Record<string, any>[] = rawRows.map(row => {
      const extra: Record<string, any> = {};
      // Flatten rule rates
      for (const r of rules) extra[`__rule_${r.id}`] = (row.ruleRates as any)?.[r.id] ?? null;
      // Flatten monthly history for expandable groups
      for (const mm of allMonths) {
        extra[`__hist_campusOccHistory_${mm}`] = (row.campusOccHistory as any)?.[mm] ?? null;
        extra[`__hist_slOccHistory_${mm}`]     = (row.slOccHistory     as any)?.[mm] ?? null;
        extra[`__hist_rtOccHistory_${mm}`]     = (row.rtOccHistory     as any)?.[mm] ?? null;
        extra[`__hist_streetHistory_${mm}`]    = (row.streetHistory    as any)?.[mm] ?? null;
      }
      return { ...row, ...extra };
    });
    const activeFilters = Object.entries(filters).filter(([, v]) => v.trim() !== "");
    if (activeFilters.length) {
      const colByKey = Object.fromEntries(dynAllCols.map((c) => [c.key, c]));
      rows = rows.filter((row) =>
        activeFilters.every(([key, term]) => {
          const col = colByKey[key];
          if (!col) return true;
          const display = fmt(row[key], col.type).toLowerCase();
          return display.includes(term.trim().toLowerCase());
        })
      );
    }
    if (sortKey) {
      const col = dynAllCols.find((c) => c.key === sortKey);
      const numeric = col ? NUMERIC_TYPES.includes(col.type) : false;
      rows = [...rows].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        let cmp: number;
        if (numeric) cmp = Number(av) - Number(bv);
        else cmp = String(av).localeCompare(String(bv));
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [rawRows, filters, sortKey, sortDir, dynAllCols, data?.rules]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const activeFilterCount = Object.values(filters).filter((v) => v.trim() !== "").length;

  // ── export ──
  const handleExport = useCallback(() => {
    const headerRow1: string[] = [];
    const headerRow2: string[] = [];
    const merges: XLSX.Range[] = [];
    let colIdx = 0;
    for (const g of dynGroups) {
      const groupLabel = g.ruleInfo ? `${g.label} – ${g.ruleInfo.name}` : g.label;
      headerRow1.push(groupLabel);
      headerRow2.push(g.cols[0].label);
      for (let i = 1; i < g.cols.length; i++) {
        headerRow1.push("");
        headerRow2.push(g.cols[i].label);
      }
      if (g.cols.length > 1) {
        merges.push({ s: { r: 0, c: colIdx }, e: { r: 0, c: colIdx + g.cols.length - 1 } });
      }
      colIdx += g.cols.length;
    }
    const dataRows = processedRows.map((row) =>
      dynAllCols.map((c) => rawForExport(row[c.key], c.type))
    );
    const aoa = [headerRow1, headerRow2, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    ws["!cols"] = dynAllCols.map((c) => ({ wpx: c.w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reference Data");
    const stamp = data?.spotMonth ?? new Date().toISOString().slice(0, 7);
    XLSX.writeFile(wb, `Reference_Data_${stamp}.xlsx`);
  }, [processedRows, data?.spotMonth, dynGroups, dynAllCols]);

  // ── shared cell styling ──
  const groupBg = (gid: string, idx: number) =>
    idx % 2 === 0 ? "bg-muted/40" : "bg-muted/20";

  const renderHeaders = () => (
    <thead className="sticky top-0 z-30">
      {/* Group header row */}
      <tr>
        {dynGroups.map((g, gi) => {
          const isExpanded = expandedGroups.has(g.id);
          return (
            <th
              key={g.id}
              colSpan={g.cols.length}
              className={`sticky top-0 z-20 border-b border-r border-border px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-white ${
                gi === 0 ? "left-0 z-40 bg-blue-900" : g.ruleInfo ? "bg-teal-700" : gi % 2 === 0 ? "bg-blue-900" : "bg-blue-700"
              }`}
              style={gi === 0 ? { left: 0 } : undefined}
            >
              {g.ruleInfo ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full flex-col items-center gap-0.5 hover:text-primary focus:outline-none"
                      title={g.ruleInfo.description}
                    >
                      <span className="flex items-center gap-1">
                        {g.label}
                        <Info className="h-2.5 w-2.5 opacity-60" />
                      </span>
                      <span className="max-w-[120px] truncate text-[9px] font-normal normal-case tracking-normal text-white/80">
                        {g.ruleInfo.name}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-3" align="center">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold leading-tight">{g.ruleInfo.name}</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">{g.ruleInfo.description}</p>
                      {g.ruleInfo.action && (
                        <div className="rounded bg-muted px-2 py-1.5 text-xs space-y-0.5">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Type</span>
                            <span className="font-medium capitalize">{(g.ruleInfo.action as any).adjustmentType ?? '—'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Adjustment</span>
                            <span className="font-medium">
                              {(g.ruleInfo.action as any).adjustmentType === 'percentage'
                                ? `${(g.ruleInfo.action as any).adjustmentValue ?? 0}%`
                                : `$${(g.ruleInfo.action as any).adjustmentValue ?? 0}`}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Priority</span>
                            <span className="font-medium">{g.ruleInfo.priority ?? 0}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              ) : g.expandable ? (
                /* Expandable group: label + +/- toggle button */
                <div className="flex items-center justify-center gap-1">
                  <span>{g.label}</span>
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    title={isExpanded ? "Hide monthly history" : "Show monthly history"}
                    className="flex items-center justify-center rounded border border-white/40 bg-white/10 hover:bg-white/25 transition-colors"
                    style={{ width: 16, height: 16, minWidth: 16, flexShrink: 0 }}
                  >
                    {isExpanded
                      ? <ChevronDown className="h-2.5 w-2.5" />
                      : <ChevronRight className="h-2.5 w-2.5" />}
                  </button>
                </div>
              ) : (
                g.label
              )}
            </th>
          );
        })}
      </tr>
      {/* Sub-column header row */}
      <tr>
        {dynAllCols.map((c) => {
          const isFrozen = isMobile ? !!c.mobileFreeze : !!c.frozen;
          const colW = isMobile && c.mobileFreeze ? (c.wMobile ?? c.w) : c.w;
          const frozenLeft = isMobile ? MOBILE_FROZEN_LEFT[c.key] : FROZEN_LEFT[c.key];
          const sorted = sortKey === c.key;
          const hasFilter = (filters[c.key] ?? "").trim() !== "";
          return (
            <th
              key={c.key}
              className={`sticky z-10 border-b border-r border-border bg-blue-100 px-1.5 py-1 text-[11px] font-bold text-black align-bottom ${
                isFrozen ? "z-40" : ""
              }`}
              style={{
                top: 30,
                minWidth: colW,
                width: colW,
                ...(isFrozen ? { left: frozenLeft, position: "sticky" } : {}),
              }}
            >
              <div className="flex items-center justify-between gap-1">
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className="flex items-center gap-1 text-left hover:text-primary"
                        data-testid={`refdata-sort-${c.key}`}
                      >
                        <span className="leading-tight">{c.label}</span>
                        {sorted ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3 shrink-0" />
                          ) : (
                            <ArrowDown className="h-3 w-3 shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[240px]">
                      <p className="text-xs">{c.tip}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Popover
                  open={openFilter === c.key}
                  onOpenChange={(o) => setOpenFilter(o ? c.key : null)}
                >
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={`shrink-0 rounded p-0.5 hover:bg-muted ${hasFilter ? "text-primary" : "opacity-40"}`}
                      data-testid={`refdata-filter-${c.key}`}
                    >
                      <Filter className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-2" align="start">
                    <div className="space-y-2">
                      <p className="text-xs font-medium">Filter {c.label}</p>
                      <Input
                        autoFocus
                        value={filters[c.key] ?? ""}
                        onChange={(e) =>
                          setFilters((f) => ({ ...f, [c.key]: e.target.value }))
                        }
                        placeholder="Contains…"
                        className="h-8 text-xs"
                        data-testid={`refdata-filter-input-${c.key}`}
                      />
                      {hasFilter && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-full text-xs"
                          onClick={() =>
                            setFilters((f) => ({ ...f, [c.key]: "" }))
                          }
                        >
                          <X className="mr-1 h-3 w-3" /> Clear
                        </Button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </th>
          );
        })}
      </tr>
    </thead>
  );

  const renderBody = () => (
    <tbody>
      {processedRows.map((row, ri) => (
        <tr key={ri} className="hover:bg-muted/30" data-testid={`refdata-row-${ri}`}>
          {dynGroups.map((g, gi) =>
            g.cols.map((c) => {
              const isFrozen = isMobile ? !!c.mobileFreeze : !!c.frozen;
              const colW = isMobile && c.mobileFreeze ? (c.wMobile ?? c.w) : c.w;
              const frozenLeft = isMobile ? MOBILE_FROZEN_LEFT[c.key] : FROZEN_LEFT[c.key];
              const display = fmt(row[c.key], c.type);
              const colorCls = signClass(row[c.key], c.type);
              return (
                <td
                  key={c.key}
                  className={`border-b border-r border-border px-1.5 py-1 text-[11px] ${
                    c.type === "text" ? "text-left" : "text-right tabular-nums"
                  } ${colorCls} ${
                    isFrozen
                      ? "sticky z-10 bg-background"
                      : groupBg(g.id, gi)
                  }`}
                  style={{
                    minWidth: colW,
                    width: colW,
                    ...(isFrozen ? { left: frozenLeft } : {}),
                  }}
                >
                  {c.key === "proposedRule" ? (() => {
                    const popKey = `${row.campus}||${row.serviceLine}||${row.roomType}`;
                    const isOpen = overridePop?.key === popKey;
                    return (
                      <div className="flex items-center gap-0.5 justify-end group">
                        {row.hasManualOverride && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 flex-none" title="Manual override active" />
                        )}
                        <span className={colorCls}>{display || "—"}</span>
                        <Popover open={isOpen} onOpenChange={(open) => {
                          if (open) {
                            setOverridePop({ key: popKey, campus: row.campus, serviceLine: row.serviceLine, roomType: row.roomType, locationId: row.locationId ?? null });
                            setOverrideInput(row.proposedRule ? String(Math.round(Number(row.proposedRule))) : '');
                          } else {
                            setOverridePop(null);
                          }
                        }}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5 hover:bg-muted text-muted-foreground hover:text-primary focus:outline-none focus:opacity-100"
                              title="Set manual override rate"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-60 p-3" align="end">
                            <p className="text-xs font-semibold mb-0.5">Manual Override Rate</p>
                            <p className="text-[10px] text-muted-foreground mb-2 leading-tight">{row.campus} · {row.serviceLine} · {row.roomType}</p>
                            <Input
                              type="number"
                              step="1"
                              min="0"
                              value={overrideInput}
                              onChange={e => setOverrideInput(e.target.value)}
                              placeholder="Enter rate…"
                              className="h-8 text-xs mb-2"
                              autoFocus
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const rate = parseFloat(overrideInput);
                                  if (!isNaN(rate) && rate > 0 && overridePop) {
                                    overrideSaveMutation.mutate({ campus: overridePop.campus, serviceLine: overridePop.serviceLine, roomType: overridePop.roomType, locationId: overridePop.locationId, overrideRate: rate });
                                  }
                                }
                              }}
                            />
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                className="h-7 flex-1 text-xs"
                                disabled={overrideSaveMutation.isPending || !overrideInput}
                                onClick={() => {
                                  const rate = parseFloat(overrideInput);
                                  if (!isNaN(rate) && rate > 0 && overridePop) {
                                    overrideSaveMutation.mutate({ campus: overridePop.campus, serviceLine: overridePop.serviceLine, roomType: overridePop.roomType, locationId: overridePop.locationId, overrideRate: rate });
                                  }
                                }}
                              >Save</Button>
                              {row.hasManualOverride && overridePop && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                  disabled={overrideClearMutation.isPending}
                                  onClick={() => overrideClearMutation.mutate({ campus: overridePop.campus, serviceLine: overridePop.serviceLine, roomType: overridePop.roomType })}
                                  title="Remove override"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    );
                  })() : c.key === "campus" || c.key === "division" ? (
                    <span className="block truncate" title={display}>
                      {display}
                    </span>
                  ) : (
                    display
                  )}
                </td>
              );
            })
          )}
        </tr>
      ))}
      {processedRows.length === 0 && (
        <tr>
          <td colSpan={dynAllCols.length} className="py-10 text-center text-sm text-muted-foreground">
            No reference data for the current filters.
          </td>
        </tr>
      )}
    </tbody>
  );

  const tableMaxHeight = isFullscreen ? "calc(100vh - 150px)" : "560px";

  const inner = (
    <>
      {/* Top mirror scrollbar — hidden on mobile (touch scroll covers it) */}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="scroll-mirror-top overflow-x-auto overflow-y-hidden hidden sm:block"
        style={{ height: 12 }}
      >
        <div style={{ width: tableScrollWidth, height: 1 }} />
      </div>
      {/* Main scroll container (handles both axes). touch-action enables horizontal
          swipe on iOS/Android without the browser intercepting the gesture. */}
      <div
        ref={bottomScrollRef}
        onScroll={handleBottomScroll}
        className="scroll-track-bottom overflow-auto rounded-md border border-border"
        style={{
          maxHeight: tableMaxHeight,
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x pan-y',
        }}
      >
        <table ref={tableRef} className="border-collapse" style={{ borderSpacing: 0 }}>
          {renderHeaders()}
          {renderBody()}
        </table>
      </div>
    </>
  );

  const headerBar = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Table2 className="h-4 w-4 text-primary" />
        <CardTitle className="text-base">Reference Data</CardTitle>
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {data?.spotMonth && (
          <span className="text-xs text-muted-foreground">
            Spot month: {data.spotMonth} · {processedRows.length} rows
          </span>
        )}
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFilters({})}
            data-testid="refdata-clear-all-filters"
          >
            <X className="mr-1 h-3 w-3" /> Clear {activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {/* Calculate Rates button */}
        {calcDone ? (
          <Button variant="outline" size="sm" className="h-8 text-emerald-600 border-emerald-500" disabled>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Rates Calculated
          </Button>
        ) : calcJobId ? (
          <Button variant="outline" size="sm" className="h-8" disabled>
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            Calculating… {calcProgress > 0 ? `${Math.round(calcProgress)}%` : ""}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => calcMutation.mutate()}
            disabled={calcMutation.isPending}
            title="Manually run the pricing engine now. Rates also recalculate automatically every day at 6 AM EST."
          >
            {calcMutation.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="mr-1.5 h-3.5 w-3.5" />
            )}
            Recalculate Rates
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={handleExport}
          disabled={processedRows.length === 0}
          data-testid="refdata-export"
        >
          <Download className="mr-1.5 h-3.5 w-3.5" /> Export to Excel
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setIsFullscreen((v) => !v)}
          data-testid="refdata-fullscreen"
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="mr-1.5 h-3.5 w-3.5" /> Exit
            </>
          ) : (
            <>
              <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Fullscreen
            </>
          )}
        </Button>
      </div>
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col gap-2 bg-background p-4">
        {headerBar}
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          inner
        )}
      </div>
    );
  }

  return (
    <Card data-testid="reference-data-card">
      <CardHeader className="pb-3">{headerBar}</CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          inner
        )}
      </CardContent>
    </Card>
  );
}
