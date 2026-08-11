import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
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
  Plus,
  Upload,
  StickyNote,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

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

type ActiveRule = { id: string; name: string; description: string; priority: number; action: any; trigger: any; notes?: string | null };

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
    id: "moves",
    label: "Move-Ins / Outs",
    cols: [
      { key: "moveInsLatest", label: "Ins", type: "int", w: 60, tip: "Move-ins recorded in the most recent month with data (all payers — census counts, not pricing-impact counts)." },
      { key: "moveOutsLatest", label: "Outs", type: "int", w: 60, tip: "Move-outs recorded in the most recent month with data. Blank when no move-out data source is available." },
      { key: "moveNetLatest", label: "Net", type: "num1signed", w: 65, tip: "Move-ins minus move-outs for the most recent month (positive = net gain in residents)." },
    ],
  },
  {
    id: "inhouse",
    label: "In-House Rates",
    expandable: true,
    historyKey: "ihHistory",
    historyColType: "money",
    cols: [
      { key: "ihSpot", label: "Spot", type: "money", w: 80, tip: "Average in-house (actual paid) rate for occupied units of this room type, latest month." },
      { key: "ihVarStreetPct", label: "Δ% Street", type: "pctfracsigned", w: 80, tip: "In-house rate vs street rate as a percentage." },
      { key: "ihIncT3", label: "T3 Δ", type: "pctfracsigned", w: 70, tip: "% change of latest in-house rate vs the trailing 3-month average." },
      { key: "ihIncT12", label: "T12 Δ", type: "pctfracsigned", w: 70, tip: "% change of latest in-house rate vs the trailing 12-month average." },
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
      { key: "compVarDollar", label: "Δ$", type: "moneysigned", w: 75, tip: "Adjusted competitor rate vs your street rate (dollars) — positive means comp is priced above your street rate." },
      { key: "compVarPct", label: "Δ%", type: "pctfracsigned", w: 65, tip: "Adjusted competitor rate vs your street rate — positive means comp is above your street rate." },
    ],
  },
  {
    id: "proposed",
    label: "Final Rate (Rules Applied)",
    cols: [
      { key: "proposedRule", label: "Final", type: "money", w: 80, tip: "Final proposed rate after all active rules (and any manual override) are applied. Blank when no adjustment rule applies to this combo." },
      { key: "proposedVarDollar", label: "Δ$ vs Current", type: "moneysigned", w: 90, tip: "Final rules-applied rate minus the current street (spot) rate, in dollars." },
      { key: "proposedVarPct", label: "Δ% vs Current", type: "pctfracsigned", w: 90, tip: "Final rules-applied rate vs the current street (spot) rate, as a percentage." },
    ],
  },
  {
    id: "revenue",
    label: "Revenue Impact",
    cols: [
      { key: "revMonthlyImpact", label: "Monthly", type: "moneysigned", w: 90, tip: "(Proposed rate − current street rate) × expected move-ins per month (trailing 3-month average) — estimated monthly revenue change from new residents leasing at the proposed rate." },
      { key: "revAnnualImpact", label: "First-Year", type: "moneysigned", w: 90, tip: "Monthly impact × 78 — first-year cumulative revenue change: each month's move-in cohort keeps paying the new rate (12+11+…+1 = 78 delta-months). Matches the rules' First-Year Impact." },
      { key: "revSteadyStateImpact", label: "Fully Ramped", type: "moneysigned", w: 100, tip: "Monthly impact × 144 — fully-ramped annual run-rate once 12 full cohorts are paying the new rate year-round (12×12 = 144 delta-months). The steady-state ceiling for this rule." },
      { key: "revImpactPct", label: "% Impact", type: "pctfracsigned", w: 75, tip: "Annual revenue impact as a % of current in-house revenue — directly comparable to the Growth Target column." },
    ],
  },
  {
    id: "growthTarget",
    label: "Growth Target",
    cols: [
      { key: "revenueGrowthTarget", label: "Target", type: "pct", w: 70, tip: "Target annual revenue growth % set for this campus / service line on the Pricing Controls page." },
      { key: "revYtdGrowth", label: "YTD", type: "pctfracsigned", w: 70, tip: "Year-to-date in-house revenue growth: latest month in-house revenue (rate × occupied units) vs the first month of this year." },
    ],
  },
  {
    id: "elasticity",
    label: "Elasticity & DTS",
    cols: [
      { key: "elasticity", label: "Elast.", type: "num1", w: 65, tip: "Estimated price elasticity for this combo — how sensitive demand (days to sell) is to a rate change." },
      { key: "daysToSellBefore", label: "DTS Before", type: "num1", w: 75, tip: "Historical avg days to stabilize before pricing change (EMA of past cohorts)." },
      { key: "daysToSellAfter", label: "DTS After", type: "num1", w: 75, tip: "Historical avg days to stabilize after pricing change (EMA of past cohorts)." },
      { key: "daysToSellChange", label: "DTS Δ", type: "num1signed", w: 65, tip: "Change in estimated days to sell (after − before). Positive means slower to sell." },
    ],
  },
  {
    id: "elasticityImpact",
    label: "Elast. Rev. Impact",
    cols: [
      { key: "elasticityMonthlyImpact", label: "Monthly", type: "moneysigned", w: 90, tip: "Elasticity-adjusted estimated monthly revenue change, accounting for the demand response to the proposed rate." },
      { key: "elasticityAnnualImpact", label: "First-Year", type: "moneysigned", w: 90, tip: "Elasticity-adjusted first-year revenue change (monthly × 78, stacked move-in cohorts)." },
      { key: "elasticitySteadyStateImpact", label: "Fully Ramped", type: "moneysigned", w: 100, tip: "Elasticity-adjusted fully-ramped annual run-rate (monthly × 144) — the steady-state ceiling once demand has fully adjusted to the new rate." },
    ],
  },
  {
    id: "importCols",
    label: "Import Columns",
    cols: [
      { key: "importRuleDesc", label: "Import Rule Desc", type: "text", w: 170, tip: "Fill this in on an exported Excel file, then use Import from Excel to create a new adjustment rule (e.g. \"Increase street rate by 5%\"). Rows with the same description are combined into one rule scoped to those rows." },
      { key: "importRate", label: "Import Rate", type: "money", w: 90, tip: "Fill this in on an exported Excel file, then use Import from Excel to set an exact proposed rate for this campus / service line / room type." },
    ],
  },
];

const NUMERIC_TYPES: ColType[] = ["int", "num1", "num1signed", "pct", "pctfrac", "pctfracsigned", "money", "moneysigned"];

// ── Excel-like column filters ────────────────────────────────────────────────
type NumericOp = '>' | '>=' | '=' | '!=' | '<=' | '<';
type ColFilter =
  | { mode: 'numeric'; op: NumericOp; value: string }
  | { mode: 'select'; selected: string[]; search: string };

function filterIsActive(f: ColFilter): boolean {
  return f.mode === 'numeric' ? f.value.trim() !== '' : f.selected.length > 0;
}
/** Scale a raw row value to the "user-visible" unit for numeric comparison */
function toDisplayNum(raw: any, type: ColType): number {
  const v = Number(raw);
  if (type === 'pctfrac' || type === 'pctfracsigned') return v * 100;
  return v;
}

// ── Grouping levels ────────────────────────────────────────────────
type GroupLevel = "serviceLine" | "region" | "division" | "location" | "locationSL" | "roomType" | "roomDetail";
const GROUP_LEVELS: { id: GroupLevel; label: string }[] = [
  { id: "serviceLine", label: "Service Line" },
  { id: "region", label: "Region" },
  { id: "division", label: "Division" },
  { id: "location", label: "Location" },
  { id: "locationSL", label: "Location + SL" },
  { id: "roomType", label: "Room Type" },
  { id: "roomDetail", label: "Room Detail" },
];

const COL_DIVISION = GROUPS[0].cols[0];
const COL_CAMPUS = GROUPS[0].cols[1];
const COL_SL = GROUPS[0].cols[2];
const COL_RT = GROUPS[0].cols[3];
const COL_UNITS = GROUPS[0].cols[4];
const COL_REGION: ColDef = { key: "region", label: "Region", type: "text", w: 110, frozen: true, mobileFreeze: true, wMobile: 95, tip: "The operating region the campus belongs to." };
const COL_ROOMNUM: ColDef = { key: "roomNumber", label: "Room #", type: "text", w: 70, frozen: true, tip: "Unit / room number." };
const COL_STATUS: ColDef = { key: "occupiedStatus", label: "Status", type: "text", w: 75, frozen: true, tip: "Occupied or vacant status of this unit in the latest month." };

function campusColsForLevel(level: GroupLevel): ColDef[] {
  switch (level) {
    case "serviceLine": return [COL_SL, COL_UNITS];
    case "region": return [COL_REGION, COL_UNITS];
    case "division": return [COL_DIVISION, COL_UNITS];
    case "location": return [COL_DIVISION, COL_REGION, COL_CAMPUS, COL_UNITS];
    case "locationSL": return [COL_DIVISION, COL_CAMPUS, COL_SL, COL_UNITS];
    case "roomDetail": return [COL_DIVISION, COL_CAMPUS, COL_SL, COL_RT, COL_ROOMNUM, COL_STATUS, COL_UNITS];
    default: return GROUPS[0].cols;
  }
}

// ── client-side aggregation for higher grouping levels ─────────────
const AGG_SUM_KEYS = [
  "totalUnits", "vacantSpot", "vacantT3", "vacantT12", "hcPrivatePaySpot",
  "revT3MoveIns", "moveInsLatest", "moveOutsLatest", "moveNetLatest",
  "revMonthlyImpact", "revAnnualImpact", "revSteadyStateImpact",
  "elasticityMonthlyImpact", "elasticityAnnualImpact", "elasticitySteadyStateImpact",
];
// Inquiry/tour counts live at the campus+SL level and are duplicated on every
// room-type row — sum them once per unique campus||SL, not per row.
const AGG_CAMPUS_SL_SUM_KEYS = ["inqPrevMonth", "inqVsT3", "tourPrevMonth", "tourVsT3"];
// Campus- and SL-level occupancy values are repeated on every room-type row;
// they must be deduped to one value per campus (or campus||SL) and weighted
// by that entity's units — a per-row unit-weighted average double-counts.
const AGG_CAMPUS_WAVG_KEYS = ["campusOccSpot", "campusOccT3", "campusOccT12"];
const AGG_CAMPUS_SL_WAVG_KEYS = ["slOccSpot", "slOccT3", "slOccT12"];
const AGG_WAVG_KEYS = [
  "rtOccSpot", "rtOccT3", "rtOccT12", "daysVacantSpot", "daysVacantT3",
  "streetSpot", "streetIncT3", "streetIncT12", "compBase", "compAdjusted",
  "ihSpot", "ihIncT3", "ihIncT12", "proposedRule",
  "elasticity", "daysToSellBefore", "daysToSellAfter", "daysToSellChange", "predictedDaysToSellChange",
  "revenueGrowthTarget", "revYtdGrowth",
  "ihT3avg", "ihT12avg", "streetT3avg", "streetT12avg",
];
const HISTORY_KEYS = ["campusOccHistory", "slOccHistory", "rtOccHistory", "streetHistory", "ihHistory"];

function keyForLevel(r: Record<string, any>, level: GroupLevel): string {
  switch (level) {
    case "serviceLine": return String(r.serviceLine ?? "—");
    case "region": return String(r.region ?? "—");
    case "division": return String(r.division ?? "—");
    case "location": return `${r.locationId ?? ""}||${r.division}||${r.campus}`;
    default: return `${r.locationId ?? ""}||${r.division}||${r.campus}||${r.serviceLine}`;
  }
}

function aggregateRows(
  rows: Record<string, any>[],
  level: GroupLevel,
  ruleIds: string[],
  monthsList: string[],
): Record<string, any>[] {
  const keyOf = (r: Record<string, any>) => keyForLevel(r, level);

  const groups = new Map<string, Record<string, any>[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }

  return Array.from(groups.values()).map((rs) => {
    const first = rs[0];
    const out: Record<string, any> = {
      division: ["division", "location", "locationSL"].includes(level) ? first.division : "All",
      region: ["region", "location"].includes(level) ? (first.region ?? "—") : "All",
      campus: ["location", "locationSL"].includes(level) ? first.campus : "All",
      serviceLine: ["serviceLine", "locationSL"].includes(level) ? first.serviceLine : "All",
      roomType: "All",
      locationId: ["location", "locationSL"].includes(level) ? first.locationId : null,
      hasManualOverride: false,
    };
    for (const k of AGG_SUM_KEYS) {
      let sum = 0, any = false;
      for (const r of rs) { const v = r[k]; if (v !== null && v !== undefined) { sum += Number(v); any = true; } }
      out[k] = any ? sum : null;
    }
    const wavg = (get: (r: Record<string, any>) => any) => {
      let n = 0, d = 0;
      for (const r of rs) {
        const v = get(r);
        if (v !== null && v !== undefined) { const w = Number(r.totalUnits) || 1; n += Number(v) * w; d += w; }
      }
      return d ? n / d : null;
    };
    for (const k of AGG_WAVG_KEYS) out[k] = wavg((r) => r[k]);
    // Subgroups for values that live above the room-type level
    const subGroups = (subKey: (r: Record<string, any>) => string) => {
      const m = new Map<string, { first: Record<string, any>; units: number }>();
      for (const r of rs) {
        const k = subKey(r);
        const g = m.get(k);
        if (!g) m.set(k, { first: r, units: Number(r.totalUnits) || 0 });
        else g.units += Number(r.totalUnits) || 0;
      }
      return m;
    };
    const byCampus = subGroups((r) => `${r.locationId ?? ""}||${r.campus}`);
    const byCampusSL = subGroups((r) => `${r.locationId ?? ""}||${r.campus}||${r.serviceLine}`);
    // Inquiry/tour counts: one value per campus||SL — sum deduped
    for (const k of AGG_CAMPUS_SL_SUM_KEYS) {
      let sum = 0, any = false;
      for (const g of Array.from(byCampusSL.values())) {
        const v = g.first[k];
        if (v !== null && v !== undefined) { sum += Number(v); any = true; }
      }
      out[k] = any ? sum : null;
    }
    // Occupancy: dedupe to one value per campus (or campus||SL), weight by that entity's units
    const dedupeWavg = (m: Map<string, { first: Record<string, any>; units: number }>, get: (r: Record<string, any>) => any) => {
      let n = 0, d = 0;
      for (const g of Array.from(m.values())) {
        const v = get(g.first);
        if (v !== null && v !== undefined) { const w = g.units || 1; n += Number(v) * w; d += w; }
      }
      return d ? n / d : null;
    };
    for (const k of AGG_CAMPUS_WAVG_KEYS) out[k] = dedupeWavg(byCampus, (r) => r[k]);
    for (const k of AGG_CAMPUS_SL_WAVG_KEYS) out[k] = dedupeWavg(byCampusSL, (r) => r[k]);
    // % impact recomputed from summed components (never average %s): summed
    // move-ins-based monthly impact ÷ summed current in-house revenue
    // (ihSpot × occupied units per detail row) — same basis as the server's
    // per-room-type revImpactPct.
    {
      let denom = 0;
      for (const r of rs) {
        const ih = r.ihSpot;
        const tu = Number(r.totalUnits ?? 0);
        const vac = Number(r.vacantSpot ?? 0);
        if (ih !== null && ih !== undefined && Number(ih) > 0 && tu > 0) {
          denom += Number(ih) * Math.max(tu - vac, 0);
        }
      }
      out.revImpactPct = (out.revMonthlyImpact !== null && denom > 0)
        ? Number(out.revMonthlyImpact) / denom
        : null;
    }
    // YTD growth recomputed from summed revenue components (not averaged %s)
    {
      let spotSum = 0, baseSum = 0, anyYtd = false;
      for (const r of rs) {
        if (r.ytdRevSpot != null && r.ytdRevBase != null) {
          spotSum += Number(r.ytdRevSpot); baseSum += Number(r.ytdRevBase); anyYtd = true;
        }
      }
      out.revYtdGrowth = anyYtd && baseSum > 0 ? (spotSum - baseSum) / baseSum : null;
    }
    // Derived variances recomputed from aggregates
    out.compVarDollar = (out.compAdjusted !== null && out.streetSpot !== null) ? out.compAdjusted - out.streetSpot : null;
    out.compVarPct = (out.compAdjusted !== null && out.streetSpot !== null && out.streetSpot !== 0) ? (out.compAdjusted - out.streetSpot) / out.streetSpot : null;
    out.ihVarStreetDollar = (out.ihSpot !== null && out.streetSpot !== null) ? out.ihSpot - out.streetSpot : null;
    out.ihVarStreetPct = (out.ihSpot !== null && out.streetSpot !== null && out.streetSpot !== 0) ? (out.ihSpot - out.streetSpot) / out.streetSpot : null;
    // proposed Δ: computed as wavg of per-RT deltas over only rows where a rule fires.
    // Computing (wavg_proposed − wavg_street) / wavg_street is wrong because proposedRule
    // wavg excludes null entries (rooms with no active rule) while streetSpot covers all rooms,
    // making the denominator artificially small and inflating the apparent %.
    out.proposedVarDollar = wavg((r) =>
      r.proposedRule !== null && r.streetSpot !== null ? Number(r.proposedRule) - Number(r.streetSpot) : null
    );
    out.proposedVarPct = wavg((r) =>
      r.proposedRule !== null && r.streetSpot !== null && Number(r.streetSpot) !== 0
        ? (Number(r.proposedRule) - Number(r.streetSpot)) / Number(r.streetSpot) : null
    );
    // Rule rate columns (weighted avg of matching rows)
    const rr: Record<string, number | null> = {};
    for (const id of ruleIds) rr[id] = wavg((r) => (r.ruleRates as any)?.[id]);
    out.ruleRates = rr;
    // Monthly histories (weighted avg per month; campus/SL occ histories deduped)
    for (const hk of HISTORY_KEYS) {
      const hist: Record<string, number | null> = {};
      for (const mm of monthsList) {
        if (hk === "campusOccHistory") hist[mm] = dedupeWavg(byCampus, (r) => (r[hk] as any)?.[mm]);
        else if (hk === "slOccHistory") hist[mm] = dedupeWavg(byCampusSL, (r) => (r[hk] as any)?.[mm]);
        else hist[mm] = wavg((r) => (r[hk] as any)?.[mm]);
      }
      out[hk] = hist;
    }
    return out;
  });
}

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
  const [sectionOpen, setSectionOpen] = useState(false);
  const [groupLevel, setGroupLevel] = useState<GroupLevel>("roomType");
  const { toast } = useToast();
  // Create-rule-from-view dialog state
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [ruleAdjType, setRuleAdjType] = useState<"percentage" | "absolute">("percentage");
  const [ruleAdjValue, setRuleAdjValue] = useState("");
  const [ruleEffDate, setRuleEffDate] = useState("");
  const [ruleNote, setRuleNote] = useState("");
  // Inline note editing in the rule-column header popover
  const [noteDraft, setNoteDraft] = useState<{ ruleId: string; text: string } | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filters, setFilters] = useState<Record<string, ColFilter>>({});
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

  // ── Import from Excel state ──────────────────────────────────────
  const importFileRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<{
    rulesCreated: { name: string; rowCount: number; annualImpact: number | null }[];
    overridesApplied: number;
    errors: string[];
  } | null>(null);

  // ── Manual override popover state ────────────────────────────────
  const [overridePop, setOverridePop] = useState<{
    key: string; campus: string; serviceLine: string; roomType: string; locationId: string | null;
  } | null>(null);
  const [overrideInput, setOverrideInput] = useState('');

  const overrideSaveMutation = useMutation({
    mutationFn: async (payload: { campus: string; serviceLine: string; roomType: string; locationId: string | null; overrideRate: number }) =>
      apiRequest('/api/manual-rate-override', 'POST', { locationName: payload.campus, serviceLine: payload.serviceLine, roomType: payload.roomType, locationId: payload.locationId, overrideRate: payload.overrideRate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/reference-data'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rate-card'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manual-rate-overrides'] });
      setOverridePop(null);
    },
  });

  const overrideClearMutation = useMutation({
    mutationFn: async (payload: { campus: string; serviceLine: string; roomType: string }) =>
      apiRequest(`/api/manual-rate-override/${encodeURIComponent(payload.campus)}/${encodeURIComponent(payload.serviceLine)}/${encodeURIComponent(payload.roomType)}`, 'DELETE'),
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

  // ── Room Detail (per-unit) query — only fetched at that grouping level ──
  const unitQueryKey = ["/api/reference-data/units", selectedServiceLine, selectedRegions, selectedDivisions, selectedLocations];
  const { data: unitData, isLoading: unitLoading, isFetching: unitFetching } = useQuery<{ rows: Record<string, any>[]; spotMonth: string | null }>({
    queryKey: unitQueryKey,
    enabled: groupLevel === "roomDetail",
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedServiceLine && selectedServiceLine !== "All") params.append("serviceLine", selectedServiceLine);
      if (selectedRegions?.length) params.append("regions", selectedRegions.join(","));
      if (selectedDivisions?.length) params.append("divisions", selectedDivisions.join(","));
      if (selectedLocations?.length) params.append("locations", selectedLocations.join(","));
      const res = await fetch(`/api/reference-data/units?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load unit detail data");
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  });

  const rawRows = useMemo(() => {
    const detail = data?.rows ?? [];
    if (groupLevel === "roomDetail") return unitData?.rows ?? [];

    const base = groupLevel === "roomType" ? detail
      : aggregateRows(detail, groupLevel, (data?.rules ?? []).map(r => r.id), data?.months ?? []);

    // At aggregation levels above roomType, recompute rate-delta and revenue impact columns
    // from the weighted-average rates × total units. The per-row sum only captures units with an
    // active rule (sparse for HC), so the aggregated view shows (wavg proposed − wavg street) × all units.
    return base.map(row => {
      const out: Record<string, any> = { ...row };

      // Rate-change deltas recomputed from wavg base values at aggregation levels.
      // Averaging per-row percentage deltas introduces a mix-effect when unit counts shift
      // between months (new buildings, census changes). Computing from aggregated rates is correct.
      if (groupLevel !== "roomType" && groupLevel !== "roomDetail") {
        const ih    = row.ihSpot      as number | null;
        const ihT3  = row.ihT3avg     as number | null;
        const ihT12 = row.ihT12avg    as number | null;
        const st    = row.streetSpot  as number | null;
        const stT3  = row.streetT3avg as number | null;
        const stT12 = row.streetT12avg as number | null;
        if (ih !== null && ihT3  !== null && ihT3  > 0) out.ihIncT3   = (ih - ihT3)  / ihT3;
        if (ih !== null && ihT12 !== null && ihT12 > 0) out.ihIncT12  = (ih - ihT12) / ihT12;
        if (st !== null && stT3  !== null && stT3  > 0) out.streetIncT3  = (st - stT3)  / stT3;
        if (st !== null && stT12 !== null && stT12 > 0) out.streetIncT12 = (st - stT12) / stT12;
      }

      // Revenue impact at aggregation levels: the summed per-room-type values
      // (from AGG_SUM_KEYS / the % recompute in aggregateRows) are already
      // move-ins-based — (proposed − street) × T3 move-ins/mo per row — so no
      // units-based recompute here. Impact must reflect expected move-ins at
      // the new rate, never "all units repriced".

      return out;
    });
  }, [data?.rows, data?.rules, data?.months, groupLevel, unitData?.rows]);

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
      // Inject rule columns after "inhouse", then place the Final Rate group
      // (rules-applied rate + Δ vs current street rate) immediately after the
      // rule columns so the outcome of the rules sits right beside them.
      const proposedGroup = GROUPS.find(g => g.id === "proposed")!;
      const withoutProposed = GROUPS.filter(g => g.id !== "proposed");
      const insertAt = withoutProposed.findIndex(g => g.id === "inhouse") + 1;
      base = [
        ...withoutProposed.slice(0, insertAt),
        ...ruleGroups,
        proposedGroup,
        ...withoutProposed.slice(insertAt),
      ];
    }

    // Swap the leading identity columns to match the active grouping level
    if (groupLevel !== "roomType") {
      base = base.map(g => g.id === "campus" ? { ...g, cols: campusColsForLevel(groupLevel) } : g);
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
  }, [data?.rules, data?.months, expandedGroups, groupLevel]);

  const dynAllCols = useMemo(() => dynGroups.flatMap(g => g.cols), [dynGroups]);

  // Unique formatted values for the currently-open filter column (for checkbox list).
  // Must be after both rawRows and dynAllCols.
  const openFilterMeta = useMemo(() => {
    if (!openFilter) return null;
    const col = dynAllCols.find(c => c.key === openFilter);
    if (!col) return null;
    const isNumeric = NUMERIC_TYPES.includes(col.type);
    if (isNumeric) return { col, isNumeric: true, vals: [] as string[] };
    const seen = new Map<string, number>();
    for (const row of rawRows) {
      const v = fmt(row[openFilter], col.type);
      if (v && v !== '–') seen.set(v, (seen.get(v) ?? 0) + 1);
    }
    const vals = Array.from(seen.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([v]) => v);
    return { col, isNumeric: false, vals };
  }, [openFilter, rawRows, dynAllCols]);

  // Frozen column left offsets — recomputed because the frozen set changes with grouping level
  const frozenOffsets = useMemo(() => {
    const fl: Record<string, number> = {};
    let acc = 0;
    for (const c of dynAllCols) if (c.frozen) { fl[c.key] = acc; acc += c.w; }
    const ml: Record<string, number> = {};
    let macc = 0;
    for (const c of dynAllCols) if (c.mobileFreeze) { ml[c.key] = macc; macc += c.wMobile ?? c.w; }
    return { fl, ml };
  }, [dynAllCols]);

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
        extra[`__hist_ihHistory_${mm}`]        = (row.ihHistory        as any)?.[mm] ?? null;
      }
      return { ...row, ...extra };
    });
    const activeFilters = Object.entries(filters).filter(([, f]) => filterIsActive(f));
    if (activeFilters.length) {
      const colByKey = Object.fromEntries(dynAllCols.map((c) => [c.key, c]));
      rows = rows.filter((row) =>
        activeFilters.every(([key, f]) => {
          const col = colByKey[key];
          if (!col) return true;
          if (f.mode === 'numeric') {
            const raw = row[key];
            if (raw === null || raw === undefined) return false;
            const v = toDisplayNum(raw, col.type);
            const threshold = parseFloat(f.value);
            if (isNaN(threshold)) return true;
            if (f.op === '>') return v > threshold;
            if (f.op === '>=') return v >= threshold;
            if (f.op === '=') return Math.abs(v - threshold) < 0.0001;
            if (f.op === '!=') return Math.abs(v - threshold) >= 0.0001;
            if (f.op === '<=') return v <= threshold;
            if (f.op === '<') return v < threshold;
            return true;
          } else {
            const display = fmt(row[key], col.type);
            return f.selected.includes(display);
          }
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
    } else if (groupLevel === "serviceLine") {
      // Default service-line order: HC and HC/MC first, then others alphabetically.
      const SL_PRIORITY: Record<string, number> = { HC: 0, "HC/MC": 1 };
      rows = [...rows].sort((a, b) => {
        const pa = SL_PRIORITY[a.serviceLine] ?? 2;
        const pb = SL_PRIORITY[b.serviceLine] ?? 2;
        if (pa !== pb) return pa - pb;
        return String(a.serviceLine ?? "").localeCompare(String(b.serviceLine ?? ""));
      });
    }
    return rows;
  }, [rawRows, filters, sortKey, sortDir, dynAllCols, data?.rules]);

  // ── Totals row — shown when >1 row is visible (not on Room Detail) ──
  const totalRow = useMemo(() => {
    if (processedRows.length <= 1 || groupLevel === "roomDetail") return null;
    const out: Record<string, any> = {};
    for (const k of AGG_SUM_KEYS) {
      let sum = 0, any = false;
      for (const r of processedRows) {
        const v = r[k]; if (v !== null && v !== undefined) { sum += Number(v); any = true; }
      }
      out[k] = any ? sum : null;
    }
    for (const k of [...AGG_WAVG_KEYS, ...AGG_CAMPUS_WAVG_KEYS, ...AGG_CAMPUS_SL_WAVG_KEYS]) {
      let n = 0, d = 0;
      for (const r of processedRows) {
        const v = r[k];
        if (v !== null && v !== undefined) { const w = Number(r.totalUnits) || 1; n += Number(v) * w; d += w; }
      }
      out[k] = d ? n / d : null;
    }
    for (const k of [...AGG_CAMPUS_SL_SUM_KEYS]) {
      let sum = 0, any = false;
      for (const r of processedRows) {
        const v = r[k]; if (v !== null && v !== undefined) { sum += Number(v); any = true; }
      }
      out[k] = any ? sum : null;
    }
    // Derived variance columns
    if (out.compAdjusted != null && out.streetSpot != null)
      out.compVarDollar = out.compAdjusted - out.streetSpot;
    if (out.compAdjusted != null && out.streetSpot != null && out.streetSpot !== 0)
      out.compVarPct = (out.compAdjusted - out.streetSpot) / out.streetSpot;
    if (out.ihSpot != null && out.streetSpot != null) {
      out.ihVarStreetDollar = out.ihSpot - out.streetSpot;
      if (out.streetSpot !== 0) out.ihVarStreetPct = (out.ihSpot - out.streetSpot) / out.streetSpot;
    }
    if (out.proposedRule != null && out.streetSpot != null) {
      out.proposedVarDollar = out.proposedRule - out.streetSpot;
      if (out.streetSpot !== 0) out.proposedVarPct = (out.proposedRule - out.streetSpot) / out.streetSpot;
    }
    return out;
  }, [processedRows, groupLevel]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const activeFilterCount = Object.values(filters).filter(filterIsActive).length;

  // ── scope of the current view (used by "Create Rule from View") ──
  // At aggregated levels the visible rows show "All" for collapsed dimensions,
  // so we map visible group rows back to the underlying detail rows to derive
  // concrete campus / service line / room type filters.
  const viewScope = useMemo(() => {
    const aggregated = !["roomType", "roomDetail"].includes(groupLevel);
    let sourceRows: Record<string, any>[];
    if (!aggregated) {
      sourceRows = processedRows;
    } else {
      const visibleKeys = new Set(processedRows.map((r) => keyForLevel(r, groupLevel)));
      sourceRows = (data?.rows ?? []).filter((r) => visibleKeys.has(keyForLevel(r, groupLevel)));
    }
    const collect = (key: string) => {
      const s = new Set<string>();
      for (const r of sourceRows) {
        const v = r[key];
        if (v && v !== "All" && v !== "—") s.add(String(v));
      }
      return Array.from(s);
    };
    return {
      serviceLines: collect("serviceLine"),
      locations: collect("campus"),
      roomTypes: collect("roomType"),
    };
  }, [processedRows, groupLevel, data?.rows]);

  const createRuleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/adjustment-rules/from-filters", "POST", {
        adjustmentType: ruleAdjType,
        adjustmentValue: parseFloat(ruleAdjValue),
        effectiveDate: ruleEffDate || undefined,
        notes: ruleNote.trim() || undefined,
        scope: viewScope,
      });
      return res.json();
    },
    onSuccess: (result: any) => {
      setRuleDialogOpen(false);
      setRuleAdjValue("");
      setRuleEffDate("");
      setRuleNote("");
      queryClient.invalidateQueries({ queryKey: ["/api/reference-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rule-performance"] });
      toast({
        title: "Rule created",
        description: `${result?.rule?.name ?? "New rule"} — est. ${result?.annualImpact != null ? `$${Math.round(result.annualImpact).toLocaleString()}/yr impact` : "impact pending"}`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create rule", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ ruleId, notes }: { ruleId: string; notes: string }) => {
      const res = await apiRequest(`/api/adjustment-rules/${ruleId}/notes`, "PATCH", { notes });
      return res.json();
    },
    onSuccess: () => {
      setNoteDraft(null);
      queryClient.invalidateQueries({ queryKey: ["/api/reference-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-rules"] });
      toast({ title: "Note saved" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save note", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  // ── export (ExcelJS — preserves table formatting: colored group headers,
  // number formats with % / $ / +− colors, banded rows, frozen headers) ──
  const handleExport = useCallback(async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Reference Data", {
      views: [{ state: "frozen", ySplit: 2 }],
    });

    const numFmtFor = (t: ColType): string | null => {
      switch (t) {
        case "int": return "#,##0";
        case "num1": return "0.0";
        case "num1signed": return '[Color 17]+0.0;[Red]-0.0;0.0';
        case "pct": return '0.0"%"';
        case "pctfrac": return "0.0%";
        case "pctfracsigned": return '[Color 17]+0.0%;[Red]-0.0%;0.0%';
        case "money": return '"$"#,##0';
        case "moneysigned": return '[Color 17]+"$"#,##0;[Red]-"$"#,##0;"$"0';
        default: return null;
      }
    };

    const thin = { style: "thin" as const, color: { argb: "FFD1D5DB" } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    // Alternate group header colors like the UI (dark blue / brighter blue)
    const groupFills = ["FF1E3A8A", "FF2563EB"];

    // Row 1: merged group headers; Row 2: column labels
    const row1 = ws.getRow(1);
    const row2 = ws.getRow(2);
    let col = 1;
    dynGroups.forEach((g, gi) => {
      const groupLabel = g.ruleInfo ? `${g.label} – ${g.ruleInfo.name}` : g.label;
      const start = col;
      const end = col + g.cols.length - 1;
      if (end > start) ws.mergeCells(1, start, 1, end);
      const gc = row1.getCell(start);
      gc.value = groupLabel;
      if (g.ruleInfo?.notes) {
        gc.note = {
          texts: [{ text: `Note: ${g.ruleInfo.notes}` }],
          margins: { insetmode: "auto" },
        } as any;
      }
      gc.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      gc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: groupFills[gi % groupFills.length] } };
      gc.alignment = { horizontal: "center", vertical: "middle" };
      for (let c = start; c <= end; c++) {
        row1.getCell(c).border = border;
        const hc = row2.getCell(c);
        hc.value = g.cols[c - start].label;
        hc.font = { bold: true, size: 9, color: { argb: "FF1E293B" } };
        hc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
        hc.alignment = { horizontal: c - start === 0 && g.cols[0].type === "text" ? "left" : "center", vertical: "middle" };
        hc.border = border;
      }
      col = end + 1;
    });
    row1.height = 20;
    row2.height = 18;

    // Column widths (px → approx char width) and number formats
    dynAllCols.forEach((c, i) => {
      const column = ws.getColumn(i + 1);
      column.width = Math.max(8, Math.round(c.w / 7));
      const fmt = numFmtFor(c.type);
      if (fmt) column.numFmt = fmt;
      column.alignment = c.type === "text" ? { horizontal: "left" } : { horizontal: "right" };
    });

    // Column-level alignment overwrites cell alignment, so re-center the header rows
    let hc = 1;
    dynGroups.forEach((g) => {
      row1.getCell(hc).alignment = { horizontal: "center", vertical: "middle" };
      g.cols.forEach((c, ci) => {
        row2.getCell(hc + ci).alignment = {
          horizontal: ci === 0 && c.type === "text" ? "left" : "center",
          vertical: "middle",
        };
      });
      hc += g.cols.length;
    });

    // Data rows with light banding
    processedRows.forEach((row, ri) => {
      const r = ws.getRow(ri + 3);
      dynAllCols.forEach((c, ci) => {
        const cell = r.getCell(ci + 1);
        cell.value = rawForExport(row[c.key], c.type);
        cell.border = border;
        if (ri % 2 === 1) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        }
      });
    });

    ws.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: dynAllCols.length },
    };

    const stamp = data?.spotMonth ?? new Date().toISOString().slice(0, 7);
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Reference_Data_${stamp}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [processedRows, data?.spotMonth, dynGroups, dynAllCols]);

  // ── import from Excel (round-trip of the export: reads the "Import Rule
  // Desc" and "Import Rate" columns and creates rules / rate overrides) ──
  const handleImportFile = useCallback(async (file: File) => {
    setImportBusy(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      if (!ws) throw new Error("No worksheet found in the file.");

      // Header labels are on row 2 (row 1 holds merged group headers)
      const headerRow = ws.getRow(2);
      const colIdx: Record<string, number> = {};
      headerRow.eachCell((cell, col) => {
        const label = String(cell.value ?? "").trim();
        if (label) colIdx[label] = col;
      });

      const descCol = colIdx["Import Rule Desc"];
      const rateCol = colIdx["Import Rate"];
      if (!descCol && !rateCol) {
        throw new Error('Could not find the "Import Rule Desc" or "Import Rate" columns. Use a file created by Export to Excel.');
      }
      const campusCol = colIdx["Campus"];
      const slCol = colIdx["SL"];
      const rtCol = colIdx["Room Type"];

      const cellText = (row: import("exceljs").Row, col?: number): string => {
        if (!col) return "";
        const v = row.getCell(col).value;
        if (v == null) return "";
        if (typeof v === "object" && "result" in (v as any)) return String((v as any).result ?? "").trim();
        if (typeof v === "object" && "richText" in (v as any)) return (v as any).richText.map((t: any) => t.text).join("").trim();
        return String(v).trim();
      };

      const rows: { campus?: string; serviceLine?: string; roomType?: string; importRuleDesc?: string; importRate?: number }[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber < 3) return;
        const desc = cellText(row, descCol);
        const rateStr = cellText(row, rateCol).replace(/[$,\s]/g, "");
        const rate = rateStr ? Number(rateStr) : NaN;
        if (!desc && !(Number.isFinite(rate) && rate > 0)) return;
        const campus = cellText(row, campusCol);
        rows.push({
          campus: campus && campus !== "All" && campus !== "—" ? campus : undefined,
          serviceLine: cellText(row, slCol) || undefined,
          roomType: cellText(row, rtCol) || undefined,
          importRuleDesc: desc || undefined,
          importRate: Number.isFinite(rate) && rate > 0 ? rate : undefined,
        });
      });

      if (!rows.length) {
        throw new Error('No rows had a value in "Import Rule Desc" or "Import Rate". Fill in those columns and try again.');
      }

      const res = await apiRequest("/api/reference-data/import-rules", "POST", { rows });
      const result = await res.json();
      setImportResult(result);
      queryClient.invalidateQueries({ queryKey: ["/api/reference-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-rules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rule-performance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/manual-rate-overrides"] });
    } catch (err: any) {
      toast({ title: "Import failed", description: err?.message ?? "Could not read the file.", variant: "destructive" });
    } finally {
      setImportBusy(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }, [queryClient, toast]);

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
                        {g.ruleInfo.notes && (
                          <StickyNote className="h-2.5 w-2.5 text-amber-300" data-testid={`rule-note-indicator-${g.ruleInfo.id}`} />
                        )}
                      </span>
                      <span className="max-w-[120px] truncate text-[9px] font-normal normal-case tracking-normal text-white/80">
                        {g.ruleInfo.name}
                      </span>
                      {g.ruleInfo.notes && (
                        <span className="max-w-[120px] truncate text-[9px] font-normal normal-case italic tracking-normal text-amber-200" title={g.ruleInfo.notes}>
                          {g.ruleInfo.notes}
                        </span>
                      )}
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
                      <div className="space-y-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Note</p>
                        {noteDraft?.ruleId === g.ruleInfo.id ? (
                          <div className="space-y-1.5">
                            <Textarea
                              value={noteDraft.text}
                              onChange={(e) => setNoteDraft({ ruleId: g.ruleInfo!.id, text: e.target.value })}
                              className="min-h-[56px] text-xs"
                              maxLength={500}
                              autoFocus
                              data-testid={`rule-note-edit-${g.ruleInfo.id}`}
                            />
                            <div className="flex justify-end gap-1.5">
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setNoteDraft(null)}>
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs"
                                disabled={updateNoteMutation.isPending}
                                onClick={() => updateNoteMutation.mutate({ ruleId: g.ruleInfo!.id, notes: noteDraft.text })}
                                data-testid={`rule-note-save-${g.ruleInfo.id}`}
                              >
                                {updateNoteMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                Save
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="w-full rounded border border-dashed border-border px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted"
                            onClick={() => setNoteDraft({ ruleId: g.ruleInfo!.id, text: g.ruleInfo!.notes ?? "" })}
                            data-testid={`rule-note-display-${g.ruleInfo.id}`}
                          >
                            {g.ruleInfo.notes ? (
                              <span className="text-foreground whitespace-pre-wrap">{g.ruleInfo.notes}</span>
                            ) : (
                              "Add a note…"
                            )}
                          </button>
                        )}
                      </div>
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
          const frozenLeft = isMobile ? frozenOffsets.ml[c.key] : frozenOffsets.fl[c.key];
          const sorted = sortKey === c.key;
          const hasFilter = !!filters[c.key] && filterIsActive(filters[c.key]);
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
                  onOpenChange={(o) => {
                    setOpenFilter(o ? c.key : null);
                    if (o && !filters[c.key]) {
                      const isNum = NUMERIC_TYPES.includes(c.type);
                      setFilters(f => ({
                        ...f,
                        [c.key]: isNum
                          ? { mode: 'numeric' as const, op: '>=' as NumericOp, value: '' }
                          : { mode: 'select' as const, selected: [], search: '' },
                      }));
                    }
                  }}
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
                  {openFilterMeta && openFilter === c.key && (
                    <PopoverContent
                      className={`p-2 ${openFilterMeta.isNumeric ? 'w-60' : 'w-64'}`}
                      align="start"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold truncate max-w-[160px]">Filter: {c.label}</p>
                          {hasFilter && (
                            <button
                              className="text-[10px] text-primary hover:underline"
                              onClick={() => setFilters(f => { const n = { ...f }; delete n[c.key]; return n; })}
                            >Clear</button>
                          )}
                        </div>

                        {openFilterMeta.isNumeric ? (
                          <div className="flex gap-1">
                            <select
                              className="h-8 w-24 shrink-0 rounded border border-border bg-background px-1 text-xs"
                              value={(filters[c.key] as any)?.op ?? '>='}
                              onChange={e => setFilters(f => ({
                                ...f,
                                [c.key]: { mode: 'numeric' as const, op: e.target.value as NumericOp, value: (f[c.key] as any)?.value ?? '' },
                              }))}
                            >
                              <option value=">">{'>'} greater</option>
                              <option value=">=">{'>='} at least</option>
                              <option value="=">{'='} equals</option>
                              <option value="!=">{'≠'} not equal</option>
                              <option value="<=">{'<='} at most</option>
                              <option value="<">{'<'} less</option>
                            </select>
                            <Input
                              autoFocus
                              type="number"
                              className="h-8 text-xs"
                              placeholder="Value…"
                              value={(filters[c.key] as any)?.value ?? ''}
                              onChange={e => setFilters(f => ({
                                ...f,
                                [c.key]: { mode: 'numeric' as const, op: (f[c.key] as any)?.op ?? '>=' as NumericOp, value: e.target.value },
                              }))}
                              data-testid={`refdata-filter-input-${c.key}`}
                            />
                          </div>
                        ) : (
                          <>
                            <Input
                              autoFocus
                              className="h-7 text-xs"
                              placeholder="Search values…"
                              value={(filters[c.key] as any)?.search ?? ''}
                              onChange={e => setFilters(f => ({
                                ...f,
                                [c.key]: { mode: 'select' as const, selected: (f[c.key] as any)?.selected ?? [], search: e.target.value },
                              }))}
                              data-testid={`refdata-filter-input-${c.key}`}
                            />
                            <div className="flex gap-2 text-[10px]">
                              <button className="text-primary hover:underline"
                                onClick={() => setFilters(f => ({
                                  ...f,
                                  [c.key]: { mode: 'select' as const, selected: openFilterMeta.vals, search: (f[c.key] as any)?.search ?? '' },
                                }))}>Select all</button>
                              <button className="text-muted-foreground hover:underline"
                                onClick={() => setFilters(f => ({
                                  ...f,
                                  [c.key]: { mode: 'select' as const, selected: [], search: (f[c.key] as any)?.search ?? '' },
                                }))}>Deselect all</button>
                            </div>
                            <div className="max-h-52 overflow-y-auto space-y-0.5 border border-border rounded p-1">
                              {(() => {
                                const search = ((filters[c.key] as any)?.search ?? '').toLowerCase();
                                const selected: string[] = (filters[c.key] as any)?.selected ?? [];
                                const visible = search
                                  ? openFilterMeta.vals.filter(v => v.toLowerCase().includes(search))
                                  : openFilterMeta.vals;
                                if (visible.length === 0) return (
                                  <p className="text-[11px] text-muted-foreground py-1 px-1">No values match</p>
                                );
                                return visible.map(val => {
                                  const checked = selected.includes(val);
                                  return (
                                    <label key={val} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-muted cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        className="h-3 w-3 accent-primary"
                                        onChange={() => setFilters(f => {
                                          const cur: string[] = (f[c.key] as any)?.selected ?? [];
                                          const next = checked ? cur.filter(v => v !== val) : [...cur, val];
                                          return { ...f, [c.key]: { mode: 'select' as const, selected: next, search: (f[c.key] as any)?.search ?? '' } };
                                        })}
                                      />
                                      <span className="text-xs truncate">{val}</span>
                                    </label>
                                  );
                                });
                              })()}
                            </div>
                            {((filters[c.key] as any)?.selected?.length ?? 0) > 0 && (
                              <p className="text-[10px] text-muted-foreground">
                                {(filters[c.key] as any).selected.length} of {openFilterMeta.vals.length} selected
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </PopoverContent>
                  )}
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
              const frozenLeft = isMobile ? frozenOffsets.ml[c.key] : frozenOffsets.fl[c.key];
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
                  {c.key === "proposedRule" && groupLevel === "roomType" ? (() => {
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
      {totalRow && (
        <tr className="border-t-2 border-border font-semibold">
          {dynGroups.map((g, gi) =>
            g.cols.map((c, ci) => {
              const isFrozen = isMobile ? !!c.mobileFreeze : !!c.frozen;
              const colW = isMobile && c.mobileFreeze ? (c.wMobile ?? c.w) : c.w;
              const frozenLeft = isMobile ? frozenOffsets.ml[c.key] : frozenOffsets.fl[c.key];
              const isLabelCell = gi === 0 && ci === 0;
              const val = isLabelCell ? null : totalRow[c.key];
              const display = isLabelCell ? "Total" : (fmt(val, c.type) || "—");
              const colorCls = isLabelCell ? "" : signClass(val, c.type);
              return (
                <td
                  key={c.key}
                  className={`border-r border-border px-1.5 py-1.5 text-[11px] ${
                    isLabelCell || c.type === "text" ? "text-left" : "text-right tabular-nums"
                  } ${colorCls} ${
                    isFrozen
                      ? "sticky z-10 bg-muted"
                      : `${groupBg(g.id, gi)} bg-muted/30`
                  }`}
                  style={{
                    minWidth: colW,
                    width: colW,
                    ...(isFrozen ? { left: frozenLeft } : {}),
                  }}
                >
                  {display}
                </td>
              );
            })
          )}
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
        <button
          onClick={() => setSectionOpen(o => !o)}
          className="flex items-center gap-2 group"
          aria-expanded={sectionOpen}
          data-testid="refdata-section-toggle"
        >
          <Table2 className="h-4 w-4 text-primary" />
          <CardTitle className="text-base group-hover:text-slate-600 transition-colors">Reference Data</CardTitle>
          {!isFullscreen && (
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${sectionOpen ? '' : '-rotate-90'}`} />
          )}
        </button>
        {(isFetching || (groupLevel === "roomDetail" && unitFetching)) && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
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
      <div className="flex items-center gap-2 flex-wrap">
        {/* Grouping level toggle */}
        <div className="flex items-center rounded-md border border-border p-0.5" data-testid="refdata-group-toggle">
          {GROUP_LEVELS.map((lv) => (
            <button
              key={lv.id}
              type="button"
              onClick={() => setGroupLevel(lv.id)}
              className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                groupLevel === lv.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              data-testid={`refdata-group-${lv.id}`}
            >
              {lv.label}
            </button>
          ))}
        </div>
        {/* Create rule from current view */}
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => setRuleDialogOpen(true)}
          disabled={processedRows.length === 0}
          data-testid="refdata-create-rule"
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Create Rule from View
        </Button>
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
        <input
          ref={importFileRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImportFile(f);
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => importFileRef.current?.click()}
          disabled={importBusy}
          title='Upload an exported Reference Data Excel file with the "Import Rule Desc" and/or "Import Rate" columns filled in to create new rules. Export at the Room Type view for the most precise results — Import Rate rows need Campus, SL and Room Type.'
          data-testid="refdata-import"
        >
          {importBusy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-3.5 w-3.5" />
          )}
          Import from Excel
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

  const showLoading = isLoading || (groupLevel === "roomDetail" && unitLoading);

  const ruleDialog = (
    <Dialog open={ruleDialogOpen} onOpenChange={setRuleDialogOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Rule from Current View</DialogTitle>
          <DialogDescription>
            Applies a street-rate adjustment to everything currently shown in the table.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md bg-muted/50 p-2.5 text-xs space-y-1">
            <p><span className="font-medium">Service lines:</span> {viewScope.serviceLines.length ? viewScope.serviceLines.join(", ") : "All"}</p>
            <p><span className="font-medium">Locations:</span> {viewScope.locations.length > 8 ? `${viewScope.locations.length} locations` : viewScope.locations.length ? viewScope.locations.join(", ") : "All"}</p>
            <p><span className="font-medium">Room types:</span> {viewScope.roomTypes.length > 8 ? `${viewScope.roomTypes.length} room types` : viewScope.roomTypes.length ? viewScope.roomTypes.join(", ") : "All"}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Adjustment type</Label>
              <Select value={ruleAdjType} onValueChange={(v) => setRuleAdjType(v as "percentage" | "absolute")}>
                <SelectTrigger className="h-9" data-testid="rule-adj-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percent (%)</SelectItem>
                  <SelectItem value="absolute">Dollar ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Amount {ruleAdjType === "percentage" ? "(%)" : "($)"}</Label>
              <Input
                type="number"
                step={ruleAdjType === "percentage" ? "0.5" : "10"}
                value={ruleAdjValue}
                onChange={(e) => setRuleAdjValue(e.target.value)}
                placeholder={ruleAdjType === "percentage" ? "e.g. 3 or -2" : "e.g. 100 or -50"}
                className="h-9"
                data-testid="rule-adj-value"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Effective date (optional)</Label>
            <Input
              type="date"
              value={ruleEffDate}
              onChange={(e) => setRuleEffDate(e.target.value)}
              className="h-9"
              data-testid="rule-eff-date"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Note (optional)</Label>
            <Textarea
              value={ruleNote}
              onChange={(e) => setRuleNote(e.target.value)}
              placeholder="e.g. Q3 market repositioning — approved by pricing committee"
              className="min-h-[60px] text-sm"
              maxLength={500}
              data-testid="rule-note"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setRuleDialogOpen(false)}>Cancel</Button>
          <Button
            size="sm"
            disabled={createRuleMutation.isPending || !ruleAdjValue || !parseFloat(ruleAdjValue)}
            onClick={() => createRuleMutation.mutate()}
            data-testid="rule-create-submit"
          >
            {createRuleMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Create Rule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const importResultDialog = (
    <Dialog open={importResult != null} onOpenChange={(open) => { if (!open) setImportResult(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Results</DialogTitle>
          <DialogDescription>
            Rules and rate overrides created from the imported Excel file.
          </DialogDescription>
        </DialogHeader>
        {importResult && (
          <div className="space-y-3 text-sm">
            {importResult.rulesCreated.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">
                  New rules ({importResult.rulesCreated.length})
                </p>
                <ul className="space-y-1">
                  {importResult.rulesCreated.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>
                        {r.name}
                        <span className="text-muted-foreground text-xs">
                          {" "}— {r.rowCount} row{r.rowCount === 1 ? "" : "s"}
                          {r.annualImpact != null ? ` · est. $${Math.round(r.annualImpact).toLocaleString()}/yr` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {importResult.overridesApplied > 0 && (
              <p className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                {importResult.overridesApplied} exact rate{importResult.overridesApplied === 1 ? "" : "s"} set from the Import Rate column.
              </p>
            )}
            {importResult.errors.length > 0 && (
              <div className="space-y-1.5">
                <p className="font-medium text-xs uppercase tracking-wide text-destructive">
                  Skipped ({importResult.errors.length})
                </p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {importResult.errors.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              </div>
            )}
            {importResult.rulesCreated.length === 0 && importResult.overridesApplied === 0 && importResult.errors.length === 0 && (
              <p className="text-muted-foreground">Nothing to import.</p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button size="sm" onClick={() => setImportResult(null)} data-testid="import-result-close">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col gap-2 bg-background p-4">
        {ruleDialog}
        {importResultDialog}
        {headerBar}
        {showLoading ? (
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
      {ruleDialog}
      {importResultDialog}
      <CardHeader className="pb-3">{headerBar}</CardHeader>
      {sectionOpen && (
        <CardContent>
          {showLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            inner
          )}
        </CardContent>
      )}
    </Card>
  );
}
