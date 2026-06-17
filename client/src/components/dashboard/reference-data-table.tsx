import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
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
} from "lucide-react";

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
  w: number; // px width
}

interface GroupDef {
  id: string;
  label: string;
  cols: ColDef[];
}

const GROUPS: GroupDef[] = [
  {
    id: "campus",
    label: "Campus Information",
    cols: [
      { key: "division", label: "Division", type: "text", w: 130, frozen: true, tip: "The operating division the campus belongs to." },
      { key: "campus", label: "Campus", type: "text", w: 150, frozen: true, tip: "The community / facility name." },
      { key: "serviceLine", label: "Service Line", type: "text", w: 95, frozen: true, tip: "Care level grouping (AL, SL, HC, MC, VIL, etc.)." },
      { key: "roomType", label: "Room Type", type: "text", w: 130, frozen: true, tip: "Unit / room configuration within the service line." },
      { key: "totalUnits", label: "Total Units/Beds", type: "int", w: 80, frozen: true, tip: "Count of units (or beds) for this campus / service line / room type in the most recent month." },
    ],
  },
  {
    id: "vacant",
    label: "Vacant Units",
    cols: [
      { key: "vacantSpot", label: "Spot", type: "num1", w: 70, tip: "Vacant units right now (total units minus occupied units) in the latest month." },
      { key: "vacantT3", label: "T3", type: "num1", w: 70, tip: "Average number of vacant units across the trailing 3 months." },
      { key: "vacantT6", label: "T6", type: "num1", w: 70, tip: "Average number of vacant units across the trailing 6 months." },
      { key: "vacantT12", label: "T12", type: "num1", w: 70, tip: "Average number of vacant units across the trailing 12 months." },
    ],
  },
  {
    id: "campusOcc",
    label: "Campus Occupancy",
    cols: [
      { key: "campusOccSpot", label: "Spot", type: "pct", w: 70, tip: "Occupied units ÷ total units for the whole campus in the latest month." },
      { key: "campusOccT3", label: "T3", type: "pct", w: 70, tip: "Average campus occupancy % across the trailing 3 months." },
      { key: "campusOccT6", label: "T6", type: "pct", w: 70, tip: "Average campus occupancy % across the trailing 6 months." },
      { key: "campusOccT12", label: "T12", type: "pct", w: 70, tip: "Average campus occupancy % across the trailing 12 months." },
    ],
  },
  {
    id: "slOcc",
    label: "Service Line Occupancy",
    cols: [
      { key: "slOccSpot", label: "Spot", type: "pct", w: 70, tip: "Occupied ÷ total for this service line at this campus in the latest month." },
      { key: "slOccT3", label: "T3", type: "pct", w: 70, tip: "Average service-line occupancy % across the trailing 3 months." },
      { key: "slOccT6", label: "T6", type: "pct", w: 70, tip: "Average service-line occupancy % across the trailing 6 months." },
      { key: "slOccT12", label: "T12", type: "pct", w: 70, tip: "Average service-line occupancy % across the trailing 12 months." },
    ],
  },
  {
    id: "rtOcc",
    label: "Room Type Occupancy",
    cols: [
      { key: "rtOccSpot", label: "Spot", type: "pct", w: 70, tip: "Occupied ÷ total for this specific room type in the latest month." },
      { key: "rtOccT3", label: "T3", type: "pct", w: 70, tip: "Average room-type occupancy % across the trailing 3 months." },
      { key: "rtOccT6", label: "T6", type: "pct", w: 70, tip: "Average room-type occupancy % across the trailing 6 months." },
      { key: "rtOccT12", label: "T12", type: "pct", w: 70, tip: "Average room-type occupancy % across the trailing 12 months." },
    ],
  },
  {
    id: "daysVacant",
    label: "Days Vacant Avg by Room Type",
    cols: [
      { key: "daysVacantSpot", label: "Spot", type: "num1", w: 70, tip: "Average days vacant for currently-vacant units of this room type (latest month)." },
      { key: "daysVacantT3", label: "T3", type: "num1", w: 70, tip: "Average days vacant across the trailing 3 months." },
      { key: "daysVacantT6", label: "T6", type: "num1", w: 70, tip: "Average days vacant across the trailing 6 months." },
      { key: "daysVacantT12", label: "T12", type: "num1", w: 70, tip: "Average days vacant across the trailing 12 months." },
    ],
  },
  {
    id: "inquiries",
    label: "Inquiries",
    cols: [
      { key: "inqPrevMonth", label: "Prev Month", type: "num1", w: 80, tip: "Number of inquiries recorded in the most recent month." },
      { key: "inqVsT3", label: "Δ vs T3 Avg", type: "num1signed", w: 90, tip: "Latest month inquiries minus the trailing 3-month average (count change)." },
      { key: "inqVsT12", label: "Δ vs T12 Avg", type: "num1signed", w: 90, tip: "Latest month inquiries minus the trailing 12-month average (count change)." },
    ],
  },
  {
    id: "tours",
    label: "Tours",
    cols: [
      { key: "tourPrevMonth", label: "Prev Month", type: "num1", w: 80, tip: "Number of tours recorded in the most recent month." },
      { key: "tourVsT3", label: "Δ vs T3 Avg", type: "num1signed", w: 90, tip: "Latest month tours minus the trailing 3-month average (count change)." },
      { key: "tourVsT12", label: "Δ vs T12 Avg", type: "num1signed", w: 90, tip: "Latest month tours minus the trailing 12-month average (count change)." },
    ],
  },
  {
    id: "street",
    label: "Street Rates – Single Occupant",
    cols: [
      { key: "streetSpot", label: "Spot", type: "money", w: 85, tip: "Average published street rate for this room type in the latest month." },
      { key: "streetIncT3", label: "T3 Incr", type: "pctfracsigned", w: 80, tip: "% change of the latest street rate vs the trailing 3-month average." },
      { key: "streetIncT6", label: "T6 Incr", type: "pctfracsigned", w: 80, tip: "% change of the latest street rate vs the trailing 6-month average." },
      { key: "streetIncT12", label: "T12 Incr", type: "pctfracsigned", w: 80, tip: "% change of the latest street rate vs the trailing 12-month average." },
    ],
  },
  {
    id: "comp",
    label: "Comp Rates – Top Comp",
    cols: [
      { key: "compBase", label: "Base Rate", type: "money", w: 85, tip: "Top competitor's base (unadjusted) rate for this room type." },
      { key: "compAdjusted", label: "Adjusted", type: "money", w: 85, tip: "Competitor rate after adjusting for care-level and med-management differences." },
      { key: "compVarDollar", label: "$ Var", type: "moneysigned", w: 80, tip: "Adjusted competitor rate minus base competitor rate (dollars)." },
      { key: "compVarPct", label: "% Var", type: "pctfracsigned", w: 75, tip: "Adjusted vs base competitor rate as a percentage." },
    ],
  },
  {
    id: "inhouse",
    label: "In-House Rates",
    cols: [
      { key: "ihSpot", label: "Spot", type: "money", w: 85, tip: "Average in-house (actual paid) rate for occupied units of this room type, latest month." },
      { key: "ihVarStreetDollar", label: "$ Var to Street", type: "moneysigned", w: 95, tip: "In-house rate minus street rate (dollars)." },
      { key: "ihVarStreetPct", label: "% Var to Street", type: "pctfracsigned", w: 95, tip: "In-house rate vs street rate as a percentage." },
      { key: "ihIncT3", label: "T3 Incr", type: "pctfracsigned", w: 80, tip: "% change of latest in-house rate vs the trailing 3-month average." },
      { key: "ihIncT6", label: "T6 Incr", type: "pctfracsigned", w: 80, tip: "% change of latest in-house rate vs the trailing 6-month average." },
      { key: "ihIncT12", label: "T12 Incr", type: "pctfracsigned", w: 80, tip: "% change of latest in-house rate vs the trailing 12-month average." },
    ],
  },
  {
    id: "proposed",
    label: "Proposed Rates",
    cols: [
      { key: "proposedRule", label: "Rule", type: "money", w: 85, tip: "Proposed rate from the rules engine (falls back to Modulo suggested rate)." },
      { key: "proposedVarDollar", label: "$ Var", type: "moneysigned", w: 80, tip: "Proposed rate minus current in-house rate (dollars)." },
      { key: "proposedVarPct", label: "% Var", type: "pctfracsigned", w: 75, tip: "Proposed rate vs current in-house rate as a percentage." },
    ],
  },
  {
    id: "revenue",
    label: "Revenue Impact",
    cols: [
      { key: "revT3MoveIns", label: "T3 Move Ins", type: "num1", w: 90, tip: "Average monthly private-pay move-ins for this combo over the trailing 3 months." },
      { key: "revMonthlyImpact", label: "Monthly Impact", type: "moneysigned", w: 100, tip: "(Proposed rate − in-house rate) × total units — estimated monthly revenue change." },
      { key: "revAnnualImpact", label: "Annual Impact", type: "moneysigned", w: 100, tip: "Monthly impact × 12 — estimated annual revenue change." },
    ],
  },
];

const ALL_COLS: ColDef[] = GROUPS.flatMap((g) => g.cols);
const FROZEN_COLS = ALL_COLS.filter((c) => c.frozen);
const NUMERIC_TYPES: ColType[] = ["int", "num1", "num1signed", "pct", "pctfrac", "pctfracsigned", "money", "moneysigned"];

// cumulative left offsets for frozen columns
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);

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
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const rawRows = data?.rows ?? [];

  // ── filter + sort ──
  const processedRows = useMemo(() => {
    let rows = rawRows;
    const activeFilters = Object.entries(filters).filter(([, v]) => v.trim() !== "");
    if (activeFilters.length) {
      const colByKey = Object.fromEntries(ALL_COLS.map((c) => [c.key, c]));
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
      const col = ALL_COLS.find((c) => c.key === sortKey);
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
  }, [rawRows, filters, sortKey, sortDir]);

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
    for (const g of GROUPS) {
      headerRow1.push(g.label);
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
      ALL_COLS.map((c) => rawForExport(row[c.key], c.type))
    );
    const aoa = [headerRow1, headerRow2, ...dataRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = merges;
    ws["!cols"] = ALL_COLS.map((c) => ({ wpx: c.w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reference Data");
    const stamp = data?.spotMonth ?? new Date().toISOString().slice(0, 7);
    XLSX.writeFile(wb, `Reference_Data_${stamp}.xlsx`);
  }, [processedRows, data?.spotMonth]);

  // ── shared cell styling ──
  const groupBg = (gid: string, idx: number) =>
    idx % 2 === 0 ? "bg-muted/40" : "bg-muted/20";

  const renderHeaders = () => (
    <thead className="sticky top-0 z-30">
      {/* Group header row */}
      <tr>
        {GROUPS.map((g, gi) => (
          <th
            key={g.id}
            colSpan={g.cols.length}
            className={`sticky top-0 z-20 border-b border-r border-border px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground ${
              gi === 0 ? "left-0 z-40 bg-background" : "bg-muted"
            }`}
            style={gi === 0 ? { left: 0 } : undefined}
          >
            {g.label}
          </th>
        ))}
      </tr>
      {/* Sub-column header row */}
      <tr>
        {ALL_COLS.map((c) => {
          const isFrozen = !!c.frozen;
          const sorted = sortKey === c.key;
          const hasFilter = (filters[c.key] ?? "").trim() !== "";
          return (
            <th
              key={c.key}
              className={`sticky z-10 border-b border-r border-border bg-background px-1.5 py-1 text-[11px] font-medium align-bottom ${
                isFrozen ? "z-40" : ""
              }`}
              style={{
                top: 30,
                minWidth: c.w,
                width: c.w,
                ...(isFrozen ? { left: FROZEN_LEFT[c.key], position: "sticky" } : {}),
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
          {GROUPS.map((g, gi) =>
            g.cols.map((c) => {
              const isFrozen = !!c.frozen;
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
                    minWidth: c.w,
                    width: c.w,
                    ...(isFrozen ? { left: FROZEN_LEFT[c.key] } : {}),
                  }}
                >
                  {c.key === "campus" || c.key === "division" ? (
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
          <td colSpan={ALL_COLS.length} className="py-10 text-center text-sm text-muted-foreground">
            No reference data for the current filters.
          </td>
        </tr>
      )}
    </tbody>
  );

  const tableMaxHeight = isFullscreen ? "calc(100vh - 150px)" : "560px";

  const inner = (
    <>
      {/* Top mirror scrollbar */}
      <div
        ref={topScrollRef}
        onScroll={handleTopScroll}
        className="scroll-mirror-top overflow-x-auto overflow-y-hidden"
        style={{ height: 12 }}
      >
        <div style={{ width: tableScrollWidth, height: 1 }} />
      </div>
      {/* Main scroll container (handles both axes) */}
      <div
        ref={bottomScrollRef}
        onScroll={handleBottomScroll}
        className="scroll-track-bottom overflow-auto rounded-md border border-border"
        style={{ maxHeight: tableMaxHeight }}
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
