/**
 * In-House Rate Planning.
 *
 * The page answers one question: what street rate and what per-resident
 * in-house increases are needed to hit a quarterly YoY realized-rate target?
 *
 * Everything is presented as a derivation rather than an answer. A number an
 * operator cannot explain to a family member is a number they will not send,
 * so every recommendation carries the arithmetic that produced it, and an
 * unreachable target is shown as unreachable with the smallest change that
 * would fix it — never quietly rounded down to something achievable.
 */
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Line,
  LineChart,
  Scatter,
  ScatterChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  ExternalLink,
  Info,
  Loader2,
  Save,
  Trash2,
  TrendingUp,
} from "lucide-react";
import {
  clearInhousePlanStorage,
  readInhousePlan,
  writeInhousePlanBundle,
} from "@/lib/inhousePlanStorage";
import {
  compactPlanForAnnualReport,
  hydrateAnnualReportPlanSnapshot,
} from "@/lib/inhouseAnnualReportSnapshot";
import { RATE_PRODUCT_LABEL } from "@shared/rateProduct";
import { DAYS_PER_MONTH } from "@shared/careRates";
import {
  DEFAULT_ASSUMPTIONS,
  combinePlanningInputSnapshots,
  formatMoney,
  formatPct,
  planningInputSnapshotKey,
  selectPlansForSubmission,
  type CalcExplanation,
  type EqualizationStrength,
  type PlanResult,
  type PlanningAssumptions,
  type ResidentRecommendation,
  type TargetDeviationDiagnostic,
  defaultOccupancyTierPolicy,
  guardrailsFromAssumptions,
  OCCUPANCY_TIER_IDS,
  OCCUPANCY_TIER_LABELS,
  type OccupancyTierGuardrails,
  type OccupancyTierId,
  type OccupancyTierPlanCell,
  type OccupancyTierPolicy,
  type PlanningInputSnapshotEntry,
} from "@shared/inhousePlanning";
import type {
  AnnualReportPlanSnapshot,
  AnnualReportQuarterSnapshot,
} from "@shared/inhouseAnnualReportSnapshot";
import type {
  InhousePlanHistoryEntry,
  StreetRateSource,
} from "@shared/inhousePlanning";
import {
  MODEL_MAX_TURNOVER_PCT,
  MODEL_MIN_TURNOVER_PCT,
  defaultTurnoverFor,
  describeTurnoverBand,
  explainTurnoverOutOfBand,
  formatLos,
} from "@shared/turnoverBounds";
import {
  formatQuarterYoyDisplay,
  formatQuarterLabels,
  getQuarterYoyDisplay,
  summarizeQuarterYoy,
  type QuarterYoyDisplay,
  type QuarterYoyDisplayInput,
} from "@/lib/inhouseQuarterYoyDisplay";

/**
 * Where a resident's comparison rate came from, said plainly. A ceiling set by
 * other buildings, or by a formula, is weaker evidence than this unit's own
 * asking rate, and the badge must not blur the three together.
 */
const STREET_SOURCE_NOTE: Partial<Record<StreetRateSource, string>> = {
  product_median: ", the median for this product at this campus",
  service_line_median: ", the median for this product across the service line",
  derived_formula: ", derived from the base rate by the configured formula",
};

function FormulaValue({
  value,
  formula,
  className,
}: {
  value: string;
  formula: string;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "inline-block cursor-help border-b border-dotted border-current/40 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[360px] text-left text-xs leading-relaxed">
        <p className="mb-1 font-semibold">Calculation</p>
        <p className="font-mono">{formula}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function HeaderHelp({ label, explanation }: { label: string; explanation: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex cursor-help items-center justify-self-center gap-1 border-b border-dotted border-current/40 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {label}
          <Info className="h-3 w-3" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[340px] text-left text-xs normal-case leading-relaxed tracking-normal">
        {explanation}
      </TooltipContent>
    </Tooltip>
  );
}

/** Column template shared by the Rate growth snapshot header, rows and total. */
const GROWTH_GRID_COLS =
  "grid min-w-[1420px] grid-cols-[minmax(110px,1.2fr)_repeat(5,minmax(135px,1fr))_minmax(200px,1.5fr)_minmax(135px,1fr)]";

interface QuarterYoyCell extends QuarterYoyDisplay {
  key: string;
  label: string;
  passes: boolean;
}

function quarterYoyDisplayInput(
  quarter: PlanResult["quarters"][number],
): QuarterYoyDisplayInput {
  return {
    priorRate: quarter.priorYear.realizedRateMonthly,
    yoyGrowthPct: quarter.yoyGrowthPct,
    basis: quarter.priorYear.basis,
    monthsAvailable: quarter.priorYear.monthsAvailable,
    priorYearLabel: quarter.priorYear.label,
  };
}

/**
 * Per-quarter YoY under the column average. Quarter labels drop the year while
 * every quarter shares one, which is the usual single-plan-year case. A quarter
 * with an incomplete prior-year baseline reads "Partial"; other unavailable
 * comparisons read "n/a". The solver scores them as 0% and passing, which
 * would otherwise show as a green 0.0%.
 */
function QuarterYoyBreakdown({ quarters }: { quarters: QuarterYoyCell[] }) {
  if (quarters.length === 0) return null;
  return (
    <div
      className="mx-auto mt-1.5 grid w-fit grid-cols-2 gap-x-3 gap-y-0.5 border-t pt-1.5 text-[11px]"
      data-testid="quarterly-yoy-breakdown"
    >
      {quarters.map((quarter) => (
        <div key={quarter.key} className="flex items-baseline gap-1.5">
          <span className="text-muted-foreground">{quarter.label}</span>
          {quarter.yoyPct == null ? (
            <span
              className="font-medium text-muted-foreground"
              title={quarter.unavailableExplanation}
            >
              {formatQuarterYoyDisplay(quarter)}
            </span>
          ) : (
            <>
              {quarter.qualifierLabel && (
                <span className="font-medium text-muted-foreground">
                  {quarter.qualifierLabel.split(/\s+/)[0]}
                </span>
              )}
              <span
                className={cn(
                  "font-medium tabular-nums",
                  quarter.passes ? "text-emerald-600" : "text-amber-600",
                )}
              >
                {formatPct(quarter.yoyPct, 1)}
              </span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function formatQuarterlyRate(
  monthly: number | null | undefined,
  rateBasis: PlanResult["rateBasis"],
): string {
  if (monthly == null || !Number.isFinite(monthly)) return "—";
  return formatMoney(rateBasis === "daily" ? monthly / DAYS_PER_MONTH : monthly);
}

export function QuarterlySummaryRow({
  plan,
  quarter,
  open,
  onToggle,
}: {
  plan: Pick<PlanResult, "rateBasis">;
  quarter: PlanResult["quarters"][number] | AnnualReportQuarterSnapshot;
  open: boolean;
  onToggle: () => void;
}) {
  const displayRate = (monthly: number | null | undefined) =>
    formatQuarterlyRate(monthly, plan.rateBasis);

  return (
    <tr
      data-testid={`row-quarter-${quarter.label.replace(/\s/g, "-")}`}
      className={cn(
        "cursor-pointer border-b transition-colors hover:bg-muted/50",
        quarter.isBinding && "bg-amber-500/[0.07]",
      )}
      onClick={onToggle}
    >
      <td className="px-4 py-2.5 font-medium">
        <span className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {quarter.label}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className="flex flex-wrap items-center gap-1.5">
          {quarter.priorYear.label}
          {quarter.priorYear.basis !== "actual" && (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-[11px] font-normal text-amber-600 dark:text-amber-400"
            >
              {quarter.priorYear.basis === "projected"
                ? "Projected"
                : quarter.priorYear.basis === "ungated_fallback"
                  ? "Limited match"
                  : `${quarter.priorYear.monthsAvailable} of ${quarter.priorYear.monthsExpected} months`}
            </Badge>
          )}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right font-mono">
        {displayRate(quarter.priorYear.realizedRateMonthly)}
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
        {displayRate(quarter.requiredRateMonthly)}
      </td>
      <td className="px-4 py-2.5 text-right font-mono font-medium">
        {displayRate(quarter.projectedRateMonthly)}
      </td>
      <td
        className={cn(
          "px-4 py-2.5 text-right font-mono font-medium",
          quarter.passes ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
        )}
      >
        {formatPct(quarter.yoyGrowthPct, 2)}
      </td>
      <td className="px-4 py-2.5">
        <span className="flex flex-wrap gap-1.5">
          {quarter.isBinding && (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-[11px] font-normal text-amber-600 dark:text-amber-400"
            >
              Binding
            </Badge>
          )}
          {!quarter.passes && (
            <Badge variant="destructive" className="text-[11px] font-normal">
              {quarter.shortfallPct == null ? "—" : `${formatPct(quarter.shortfallPct, 2)} short`}
            </Badge>
          )}
        </span>
      </td>
    </tr>
  );
}

export function CalculationDetailToggle({
  serviceLine,
  multiplePlans,
  feasible,
  expanded,
  detailsAvailable,
  onToggle,
}: {
  serviceLine: string;
  multiplePlans: boolean;
  feasible: boolean;
  expanded: boolean;
  detailsAvailable: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-start justify-between gap-3 text-left"
      aria-expanded={detailsAvailable ? expanded : false}
      aria-controls={detailsAvailable ? `plan-detail-${serviceLine}` : undefined}
      onClick={onToggle}
      disabled={!detailsAvailable}
      data-testid={`button-toggle-plan-details-${serviceLine}`}
    >
      <span>
        <CardTitle className="flex items-center gap-2 text-base">
          {detailsAvailable && expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          Calculation detail{multiplePlans ? ` · ${serviceLine}` : ""}
        </CardTitle>
        <CardDescription className="mt-1">
          {!detailsAvailable
            ? "Detailed calculation support is unavailable in this saved report. Recalculate the plan to view it."
            : expanded
              ? "Derivation, target diagnostics, and quarter-level support."
              : "Expand for the arithmetic behind the summary above."}
        </CardDescription>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "gap-1 text-[11px] font-normal",
            feasible
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {feasible
            ? <CheckCircle2 className="h-3 w-3" />
            : <AlertTriangle className="h-3 w-3" />}
          {feasible ? "Reachable" : "Not reachable"}
        </Badge>
        <Badge variant="outline" className="text-[11px] font-normal">
          {!detailsAvailable
            ? "Detail unavailable"
            : expanded
              ? "Hide detail"
              : "Show detail"}
        </Badge>
      </span>
    </button>
  );
}

const DEVIATION_DRIVER_STATUS: Record<string, { label: string; className: string }> = {
  contributing: { label: "Contributing", className: "text-amber-600 dark:text-amber-400" },
  mitigating: { label: "Mitigating", className: "text-emerald-600 dark:text-emerald-400" },
  binding: { label: "Binding", className: "text-amber-600 dark:text-amber-400" },
  not_binding: { label: "Not binding", className: "text-muted-foreground" },
  not_applicable: { label: "Not applicable", className: "text-muted-foreground" },
};

function TargetDeviationDiagnosticView({
  diagnostic,
  targetPct,
  rateBasis = "monthly",
}: {
  diagnostic: TargetDeviationDiagnostic | null | undefined;
  targetPct: number;
  rateBasis?: "monthly" | "daily";
}) {
  if (!diagnostic) return null;
  const unit = rateBasis === "daily" ? "/day" : "/mo";
  const maxQuarter = diagnostic.maximumQuarterLabel
    ? diagnostic.quarters.find((q) => q.label === diagnostic.maximumQuarterLabel)
    : null;
  const maxQuarterYoy =
    maxQuarter?.priorYearRateMonthly != null && maxQuarter.priorYearRateMonthly > 0
      ? (maxQuarter.projectedRateMonthly / maxQuarter.priorYearRateMonthly - 1) * 100
      : null;
  return (
    <div className="rounded-md border bg-background p-3" data-testid="target-deviation-diagnostic">
      <div className="mb-3">
        <p className="text-sm font-medium">Why the quarterly result differs from target</p>
        <p className="text-xs text-muted-foreground">
          Positive deviations are modeled overshoot above the YoY target. Driver contributions are
          solver counterfactuals, so interacting drivers are not added together.
        </p>
      </div>
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded border px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Maximum-quarter deviation</p>
          <p className="font-mono text-lg font-semibold">{formatPct(diagnostic.maximumQuarterDeviationPct, 2)}</p>
          <p className="text-xs text-muted-foreground">
            {diagnostic.maximumQuarterLabel ?? "No testable quarter"}
            {maxQuarterYoy != null ? ` · ${formatPct(maxQuarterYoy, 2)} realized` : ""}
          </p>
        </div>
        <div className="rounded border px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cumulative deviation</p>
          <p className="font-mono text-lg font-semibold">{formatPct(diagnostic.cumulativeDeviationPct, 2)}</p>
          <p className="text-xs text-muted-foreground">Sum of positive quarterly deviations</p>
        </div>
        <div className="rounded border px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Target basis</p>
          <p className="font-mono text-lg font-semibold">{formatPct(targetPct, 2)}</p>
          <p className="text-xs text-muted-foreground">Each testable quarter · rates {unit}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Driver</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 text-right font-medium">Max-quarter contribution</th>
              <th className="py-2 pr-3 text-right font-medium">Cumulative contribution</th>
              <th className="py-2 font-medium">Why</th>
            </tr>
          </thead>
          <tbody>
            {diagnostic.drivers.map((driver) => {
              const status = DEVIATION_DRIVER_STATUS[driver.status] ?? DEVIATION_DRIVER_STATUS.not_binding;
              return (
                <tr key={driver.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{driver.label}</td>
                  <td className={cn("py-2 pr-3 font-medium", status.className)}>{status.label}</td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {driver.maximumQuarterContributionPct == null ? "—" : formatPct(driver.maximumQuarterContributionPct, 2)}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">
                    {driver.cumulativeContributionPct == null ? "—" : formatPct(driver.cumulativeContributionPct, 2)}
                  </td>
                  <td className="py-2 text-muted-foreground">{driver.note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SERVICE_LINES = ["AL", "AL/MC", "HC", "HC/MC", "SL", "VIL"];
const PLAN_SCATTER_COLORS: Record<string, string> = {
  AL: "#0d9488",
  "AL/MC": "#1e3a5f",
  HC: "#d97706",
  "HC/MC": "#0284c7",
  SL: "#16a34a",
  VIL: "#67e8f9",
};

/** One service line's measured turnover, from /api/inhouse-planning/historical-turnover. */
interface ServiceLineTurnover {
  serviceLine: string;
  moveOuts: number;
  explicitMoveOuts: number;
  inferredMoveOuts: number;
  avgOccupiedUnits: number;
  /** True for HC and HC/MC (private-pay numerator + private-pay denominator). False for all other lines (all move-outs / all occupied units). */
  privatePayBasis: boolean;
  privatePaySharePct: number;
  monthsCovered: number;
  turnoverPct: number;
  /** Average length of stay implied by the turnover rate, in months. 1200 / turnoverPct. */
  losMonths: number;
  /** What the solver plans with: turnoverPct capped at the model's maximum. */
  plannedPct: number;
  /** True when the line really does turn over faster than the model can express. */
  saturating: boolean;
  plausible: boolean;
  bandMin: number;
  bandMax: number;
  outOfBandReason: string | null;
}

interface HistoricalTurnoverResponse {
  windowStart: string | null;
  windowEnd: string | null;
  monthsInWindow: number;
  byServiceLine: ServiceLineTurnover[];
}

const COMPANY_TURNOVER_CACHE_KEY = "inhouse-rate-planning:company-turnover:v1";

function readCachedCompanyTurnover(
  identityKey: string | null,
): HistoricalTurnoverResponse | undefined {
  if (!identityKey || typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(COMPANY_TURNOVER_CACHE_KEY);
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as Record<string, HistoricalTurnoverResponse>;
    const cached = stored[identityKey];
    return cached && Array.isArray(cached.byServiceLine) ? cached : undefined;
  } catch {
    return undefined;
  }
}

function writeCachedCompanyTurnover(
  identityKey: string | null,
  value: HistoricalTurnoverResponse,
): void {
  if (!identityKey || typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(COMPANY_TURNOVER_CACHE_KEY);
    const stored = raw
      ? JSON.parse(raw) as Record<string, HistoricalTurnoverResponse>
      : {};
    stored[identityKey] = value;
    window.localStorage.setItem(COMPANY_TURNOVER_CACHE_KEY, JSON.stringify(stored));
  } catch {
    // The live request remains the source of truth if browser storage is unavailable.
  }
}

/** "2026-07" -> "Jul 2026", for labelling the measurement window. */
function formatMonth(month: string | null): string {
  if (!month) return "";
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return "";
  return `${MONTH_ABBR[m - 1]} ${y}`;
}

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const ALL_CAMPUSES = "__all__";

/** Which tier of the fallback chain the shown assumptions actually came from. */
const SCOPE_LEVEL_LABEL: Record<string, string> = {
  default: "built-in defaults",
  global: "your portfolio-wide assumptions",
  serviceLine: "your portfolio-wide assumptions for this service line",
  location: "campus-level assumptions",
  "location+serviceLine": "campus + service line assumptions",
};

interface LocationRow {
  id: string;
  name: string;
}

type SortKey =
  | "location"
  | "roomNumber"
  | "currentRate"
  | "streetRate"
  | "gap"
  | "increasePct"
  | "increaseDollars";

// ── Small presentational helpers ───────────────────────────────────────────

/** Renders the derivation the calculation layer produced for itself. */
function keepArrowsTogether(value: string): string {
  return value.replace(/\s+→\s+/g, "\u00a0→\u00a0");
}

function Explanation({
  explanation,
  plan,
  serviceLine,
  exportPending,
  onExport,
}: {
  explanation?: CalcExplanation | null;
  plan: PlanResult;
  serviceLine: string;
  exportPending: boolean;
  onExport: () => void;
}) {
  const [verificationRate, setVerificationRate] = useState<"inhouse" | "street" | "yoy" | null>(null);
  const verificationTitle =
    verificationRate === "yoy" ? "YoY growth evidence" : "Resident rate averages";
  if (!explanation) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="calculation-explanation-unavailable">
        Calculation detail is not retained in this saved report.
      </p>
    );
  }
  return (
    <>
      <div className="space-y-3 text-sm">
        <div className="font-medium">{explanation.headline}</div>
        <div className="space-y-1.5">
          {explanation.steps.map((step, i) => {
            const rateKind =
              step.label.startsWith("In-house rate · current")
                ? "inhouse"
                : step.label.startsWith("Street Rate · current")
                  ? "street"
                    : step.label.startsWith("Growth target")
                      ? "yoy"
                  : null;
            const [currentValue, recommendedValue] = rateKind
              ? step.value.split(/\s+→\s+/, 2)
              : [step.value, undefined];
            return (
              <div key={i} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="min-w-[13rem] text-muted-foreground">
                  {keepArrowsTogether(step.label)}
                </span>
                <span className="shrink-0 whitespace-nowrap font-mono font-medium">
                  {rateKind ? (
                    <>
                      <button
                        type="button"
                        className="rounded-sm bg-amber-200 px-0.5 text-slate-950 underline decoration-dotted underline-offset-2 hover:bg-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setVerificationRate(rateKind)}
                         aria-label={`Verify ${
                           rateKind === "inhouse"
                             ? "current In-House"
                             : rateKind === "street"
                               ? "current Street"
                               : "YoY growth"
                         }`}
                      >
                        {currentValue}
                      </button>
                      {recommendedValue ? `\u00a0→\u00a0${recommendedValue}` : null}
                    </>
                  ) : keepArrowsTogether(step.value)}
                </span>
                {step.note && (
                  <span className="text-xs text-muted-foreground sm:ml-2">{step.note}</span>
                )}
              </div>
            );
          })}
        </div>
        {explanation.narrative.length > 0 && (
          <div className="space-y-1 border-l-2 border-muted pl-3 text-muted-foreground">
            {explanation.narrative.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}
      </div>
      <Dialog open={verificationRate !== null} onOpenChange={(open) => !open && setVerificationRate(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{verificationTitle} · {serviceLine}</DialogTitle>
            <DialogDescription>
               {verificationRate === "yoy"
                 ? "The plan's modeled YoY result is assembled from these resident and room-level projections, with future turnover represented as a modeled replacement share."
                 : "Weighted averages for the resident rows included in this calculation."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {verificationRate === "yoy" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      YoY target
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {formatPct(plan.assumptions.rateGrowthTargetPct, 2)}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Modeled full-year YoY
                    </div>
                    <div className="mt-1 text-2xl font-semibold">
                      {formatPct(fullYearYoyFromQuarters(plan.quarters, plan.rateBasis).growthPct, 2)}
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-4">
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Binding quarter
                    </div>
                    <div className="mt-1 text-lg font-semibold">
                      {plan.bindingQuarterLabel ?? "None"}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  The download adds planned in-house rate, in-house growth, recommended Street growth,
                  and each quarter&apos;s projected resident rate and YoY growth against the prior-year
                  scope baseline. This shows how the target is achieved without inventing future resident identities.
                </p>
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Current In-House
                </div>
                <div className="mt-1 text-2xl font-semibold">
                  {formatMoney(plan.summary.currentAvgInhouseRateMonthly)}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Matched Street Rate
                </div>
                <div className="mt-1 text-2xl font-semibold">
                  {formatMoney(plan.currentStreetRateMonthly)}
                </div>
              </div>
              </div>
            )}
            <div className="text-sm text-muted-foreground">
              {plan.summary.residentCount.toLocaleString()} resident rows · rent roll month{" "}
              {formatMonth(plan.scope.sourceMonth)}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={onExport} disabled={exportPending}>
              {exportPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Download className="mr-2 h-4 w-4" />}
              Download resident detail
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const CONSTRAINT_LABEL: Record<ResidentRecommendation["constraint"], string | null> = {
  none: null,
  min: "At minimum",
  max: "At maximum",
  street_cap: "Capped at street",
  at_or_above_street: "At/above street",
};

function ConstraintBadge({ constraint }: { constraint: ResidentRecommendation["constraint"] }) {
  const label = CONSTRAINT_LABEL[constraint];
  if (!label) return null;
  const tone =
    constraint === "at_or_above_street" || constraint === "street_cap"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "border-blue-500/40 bg-blue-500/10 text-blue-600 dark:text-blue-400";
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap text-[11px] font-normal", tone)}>
      {label}
    </Badge>
  );
}

/**
 * The arithmetic behind a line's turnover, shown under the input.
 *
 * The page's rule is that no number appears without its derivation, and this
 * one carries a real trap: a line can be measured and still be unusable. An
 * implausible figure is shown with what it was, not hidden, so the operator
 * can see why the saved assumption is still in the box.
 */
function TurnoverEvidence({
  serviceLine,
  hist,
  applied,
  saved,
  loading = false,
}: {
  serviceLine: string;
  hist: ServiceLineTurnover | undefined;
  applied: number;
  loading?: boolean;
  /**
   * The stored assumption for this scope, or null when none was ever saved.
   * Measured history outranks it, so this is shown whenever the two differ —
   * an operator who deliberately saved a number is entitled to see that it is
   * not the one being planned with.
   */
  saved: number | null;
}) {
  // The value actually in the box is what the plan will run on, so it gets
  // checked against the band whatever its provenance — measured, saved years
  // ago, or just typed. This is the only warning that can catch a stale saved
  // assumption, which no amount of history validation would ever look at.
  const appliedWarning = explainTurnoverOutOfBand(serviceLine, applied);
  const band = describeTurnoverBand(serviceLine);
  const departureEvidence = hist
    ? `${hist.moveOuts.toLocaleString()} departures${
        hist.inferredMoveOuts > 0
          ? ` (${hist.explicitMoveOuts.toLocaleString()} recorded + ${hist.inferredMoveOuts.toLocaleString()} verified move-in-date replacements)`
          : ""
      }`
    : "";

  let history: JSX.Element;
  if (!hist && loading) {
    history = (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading turnover history…
      </span>
    );
  } else if (!hist) {
    history = (
      <span className="text-muted-foreground">
        No measured history — using the saved assumption.
      </span>
    );
  } else if (hist.moveOuts === 0) {
    history = (
      <span className="text-amber-500">
        No {hist.privatePayBasis ? "private-pay " : ""}move-outs recorded — using the saved
        assumption.
      </span>
    );
  } else if (!hist.plausible) {
    const unitLabel = hist.privatePayBasis ? "private-pay units" : "occupied units";
    history = (
      <span className="text-amber-500">
        History says {hist.turnoverPct}% ({formatLos(hist.turnoverPct)}){" "}
        — {departureEvidence} /{" "}
        {hist.avgOccupiedUnits.toLocaleString()} {unitLabel}.{" "}
        {hist.outOfBandReason} Saved assumption kept.
      </span>
    );
  } else {
    // Compare against what is actually planned with, not the raw measurement:
    // for a saturating line those differ, and judging "adopted" against the
    // measurement would report every capped line as overridden.
    const adopted = Math.abs(applied - hist.plannedPct) < 0.05;
    // Measured history outranks a stored assumption, so when it displaces one
    // say so outright. Swapping an operator's saved number for a different one
    // and printing only the new value is how a plan quietly stops being the
    // plan they signed off on.
    const displaced =
      adopted && saved !== null && Math.abs(saved - hist.plannedPct) >= 0.05;
    const unitLabel = hist.privatePayBasis ? "private-pay units" : "occupied units";
    history = (
      <span className="text-muted-foreground">
        {adopted ? "From history: " : "History: "}
        {departureEvidence} /{" "}
        {hist.avgOccupiedUnits.toLocaleString()} {unitLabel} = {hist.turnoverPct}%{" "}
        ({formatLos(hist.turnoverPct)})
        {/* The measurement is trusted here, so say the ceiling bound rather
            than quietly printing a number the operator never measured. */}
        {hist.saturating &&
          ` — turns over faster than a year can hold, so planning uses ${hist.plannedPct}%`}
        {!adopted && " (overridden)"}
        {displaced && ` — replaces the saved ${saved}%`}
      </span>
    );
  }

  // LOS for the value currently in the box — so the operator can spot-check
  // the assumption they're about to plan against, not just the historical figure.
  const appliedLos = formatLos(applied);

  return (
    <div className="mt-1 min-h-8 space-y-0.5 text-[11px] leading-tight">
      <p>{history}</p>
      {appliedWarning && (
        <p className="text-amber-500" data-testid={`turnover-out-of-band-${serviceLine}`}>
          {appliedWarning}
        </p>
      )}
      <p className="text-muted-foreground/60">
        {appliedWarning ? `Planning at ${applied}%` : `Typical ${band}`}
        {appliedLos && ` — ${appliedLos}`}
      </p>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  suffix,
  hint,
  min,
  max,
  step = 0.5,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  testId: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={testId} className="text-xs font-medium">
        {label}
      </Label>
      <div className="relative">
        <CommitNumberInput
          id={testId}
          data-testid={testId}
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          onCommit={onChange}
          className={cn("h-9", suffix && "pr-8")}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Keeps each keystroke inside the field. Committing every character to the
 * parent rerenders the full calculated plan, including its charts and rows.
 */
function CommitNumberInput({
  value,
  onCommit,
  className,
  id,
  min,
  max,
  step = 0.5,
  disabled,
  "data-testid": testId,
}: {
  value: number | "";
  onCommit: (value: number) => void;
  className?: string;
  id?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  const displayValue = value === "" ? "" : String(value);
  const [draft, setDraft] = useState(displayValue);
  const [editing, setEditing] = useState(false);
  const pendingCommit = useRef<string | null>(null);

  useEffect(() => {
    if (editing) return;
    // Parent assumption updates run at transition priority so the rest of the
    // plan remains responsive. Do not flash the previous prop value while that
    // transition catches up with a spinner click or typed commit.
    if (pendingCommit.current !== null) {
      if (displayValue !== pendingCommit.current) return;
      pendingCommit.current = null;
    }
    setDraft(displayValue);
  }, [displayValue, editing]);

  const commit = () => {
    const raw = draft === "" ? NaN : Number(draft);
    const stepped = Number.isFinite(raw) && step
      ? Math.round(raw / step) * step
      : raw;
    const bounded = Number.isFinite(stepped)
      ? Math.min(max ?? stepped, Math.max(min ?? stepped, stepped))
      : stepped;
    const next = Number.isFinite(bounded) ? Number(bounded.toFixed(10)) : bounded;
    if (Number.isFinite(next) && next !== value) {
      pendingCommit.current = String(next);
      onCommit(next);
    }
    else if (!Number.isFinite(next)) setDraft(displayValue);
    if (Number.isFinite(next)) setDraft(String(next));
  };

  return (
    <Input
      id={id}
      data-testid={testId}
      type="number"
      inputMode="decimal"
      value={draft}
      min={min}
      max={max}
      step={step}
      className={className}
      disabled={disabled}
      onFocus={() => setEditing(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        commit();
        setEditing(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(displayValue);
          event.preventDefault();
        }
      }}
    />
  );
}

function DateField({
  label,
  value,
  onChange,
  hint,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  testId: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={testId} className="text-xs font-medium">
        {label}
      </Label>
      <Input
        id={testId}
        data-testid={testId}
        type="date"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9"
      />
      {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

/** A PlanResult tagged with the service line it was calculated for. */
interface PlanWithSl { sl: string; plan: PlanResult }

export const RESIDENT_INCREASE_TIER_LABELS = [
  "<3%",
  "3.0%",
  "3.5%",
  "4.0%",
  "4.5%",
  "5.0%",
  "5.5%",
  "6.0%",
  "6.5%",
  "7.0%",
  "7.5%",
  "8.0%",
  "8.5%",
  "9.0%+",
] as const;
export type ResidentIncreaseTierLabel = typeof RESIDENT_INCREASE_TIER_LABELS[number];

export function residentIncreaseTier(value: number): ResidentIncreaseTierLabel {
  if (!Number.isFinite(value) || value < 3) return "<3%";
  if (value >= 9) return "9.0%+";
  const halfPoint = Math.floor(value * 2 + 1e-9) / 2;
  return `${halfPoint.toFixed(1)}%` as ResidentIncreaseTierLabel;
}

export function residentIncreaseTierCounts(
  residents: ReadonlyArray<Pick<ResidentRecommendation, "increasePct">>,
): Record<ResidentIncreaseTierLabel, number> {
  const counts = Object.fromEntries(
    RESIDENT_INCREASE_TIER_LABELS.map((label) => [label, 0]),
  ) as Record<ResidentIncreaseTierLabel, number>;
  for (const resident of residents) {
    counts[residentIncreaseTier(resident.increasePct)] += 1;
  }
  return counts;
}

/**
 * Restore operations are asynchronous, so the previous scope can briefly
 * remain in `plans` after a filter changes. Filter both scope dimensions at
 * render time instead of relying on an effect to clear the old result first.
 */
export function filterPlansForScatterScope(
  plans: ReadonlyArray<PlanWithSl>,
  selectedLocationId: string | null,
  selectedServiceLines: ReadonlyArray<string>,
): PlanWithSl[] {
  return plans.filter(({ sl, plan }) =>
    selectedServiceLines.includes(sl) &&
    (plan.scope.locationId ?? null) === selectedLocationId,
  );
}

interface CampusOccupancyReading {
  locationId: string;
  location: string;
  serviceLine: string;
  occupancyPct: number | null;
  month: string | null;
  source: "occupancy_history" | "rent_roll";
}

interface CampusPlanPoint {
  locationId: string;
  location: string;
  serviceLine: string;
  occupancy: number;
  inhouseIncrease: number;
  streetIncrease: number;
  occupancyMonth: string | null;
  residents: number;
  generatedAt: string;
}

function PlanScatterReview({
  plans,
  selectedLocationId,
  selectedServiceLines,
  tierGrid,
  campusOccupancy,
  campusPlanPoints,
}: {
  plans: PlanWithSl[];
  selectedLocationId: string | null;
  selectedServiceLines: string[];
  tierGrid: TierGridResult | null;
  campusOccupancy: CampusOccupancyReading[];
  campusPlanPoints: CampusPlanPoint[];
}) {
  const [highlight, setHighlight] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const occupancyByLine = useMemo(() => {
    const map = new Map<string, CampusOccupancyReading>();
    campusOccupancy
      .filter((reading) => selectedLocationId === null || reading.locationId === selectedLocationId)
      .forEach((reading) =>
        map.set(`${reading.location}::${reading.serviceLine}`, reading),
      );
    if (map.size === 0 && selectedLocationId !== null) {
      tierGrid?.lines.forEach((line) =>
        map.set(`${plans[0]?.plan.scope.location ?? ""}::${line.serviceLine}`, {
          locationId: selectedLocationId,
          location: plans[0]?.plan.scope.location ?? "Selected campus",
          serviceLine: line.serviceLine,
          occupancyPct: line.occupancyPct,
          month: line.occupancyMonth,
          source: line.occupancySource ?? "rent_roll",
        }),
      );
    }
    return map;
  }, [campusOccupancy, plans, selectedLocationId, tierGrid]);

  const points = useMemo(() => {
    return filterPlansForScatterScope(plans, selectedLocationId, selectedServiceLines).flatMap(({ sl, plan }) => {
      // Async browser/report restores can briefly leave the previous result in
      // memory while Scope changes. Never let those stale plans contribute a
      // point under the newly selected filter labels.
      const tierLine = tierGrid?.lines.find((line) => line.serviceLine === sl);
      // Compact saved reports omit resident rows. Their calculated summary is
      // still sufficient for one aggregate point while details reload. Full
      // portfolio plans continue below and group resident rows by campus so
      // "All campuses" actually displays every campus with measured occupancy.
      if (plan.residents.length === 0) {
        if (selectedLocationId === null) {
          const restoredCampusPoints = campusPlanPoints.filter((point) => point.serviceLine === sl);
          if (restoredCampusPoints.length > 0) {
            return restoredCampusPoints.map((point) => ({
              ...point,
              streetSource: "calculated campus service-line recommendation",
            }));
          }
        }
        return [{
          location: plan.scope.location ?? (selectedLocationId === null ? "All campuses" : "Selected campus"),
          serviceLine: sl,
          occupancy: tierLine?.occupancyPct ?? null,
          inhouseIncrease: plan.summary.weightedAvgIncreasePct,
          streetIncrease: plan.streetIncreasePct,
          streetSource: selectedLocationId === null
            ? "calculated portfolio service-line recommendation"
            : "calculated campus service-line recommendation",
          occupancyMonth: tierLine?.occupancyMonth ?? null,
          residents: plan.summary.residentCount,
        }];
      }
      const grouped = new Map<string, { revenue: number; increase: number; weight: number; residents: number }>();
      plan.residents.forEach((resident) => {
        const key = resident.location;
        const weight = Number.isFinite(resident.weight) ? resident.weight : 0;
        const revenue = resident.currentRateMonthly * weight;
        const row = grouped.get(key) ?? { revenue: 0, increase: 0, weight: 0, residents: 0 };
        row.revenue += revenue;
        row.increase += revenue * resident.increasePct;
        row.weight += weight;
        row.residents += 1;
        grouped.set(key, row);
      });
      return Array.from(grouped, ([location, row]) => {
        const occupancy = occupancyByLine.get(`${location}::${sl}`);
        return {
          location,
          serviceLine: sl,
          occupancy: occupancy?.occupancyPct ?? null,
          inhouseIncrease: row.revenue > 0 ? row.increase / row.revenue : null,
          streetIncrease: plan.streetIncreasePct,
          streetSource: "calculated service-line recommendation",
          occupancyMonth: occupancy?.month ?? null,
          residents: row.residents,
        };
      });
    }).filter((point) => point.occupancy != null && Number.isFinite(point.occupancy));
  }, [campusPlanPoints, occupancyByLine, plans, selectedLocationId, selectedServiceLines, tierGrid]);

  const unknownCount = useMemo(() => {
    const scopedPlans = filterPlansForScatterScope(plans, selectedLocationId, selectedServiceLines);
    const combos = new Set(scopedPlans.flatMap(({ sl, plan }) => plan.residents.map((r) => `${r.location}::${sl}`)));
    return Array.from(combos).filter((key) => !occupancyByLine.get(key)?.occupancyPct && occupancyByLine.get(key)?.occupancyPct !== 0).length;
  }, [occupancyByLine, plans, selectedLocationId, selectedServiceLines]);

  const tooltip = (key: "inhouseIncrease" | "streetIncrease") => ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0].payload;
    return (
      <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
        <p className="font-semibold">{point.location}</p>
        <p className="text-muted-foreground">{point.serviceLine}</p>
        <p className="mt-1">Occupancy: <strong>{point.occupancy.toFixed(1)}%</strong></p>
        <p>{key === "inhouseIncrease" ? "In-house increase" : "Street Rate increase"}: <strong>{point[key].toFixed(2)}%</strong></p>
        {key === "streetIncrease" && <p className="text-[10px] text-muted-foreground">{point.streetSource}</p>}
      </div>
    );
  };

  const renderChart = (key: "inhouseIncrease" | "streetIncrease", title: string) => (
    <div className="min-w-0 flex-1">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="h-[250px] w-full">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 8, right: 14, bottom: 22, left: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" dataKey="occupancy" domain={["auto", "auto"]} tickFormatter={(v) => `${v}%`} fontSize={11} label={{ value: "Occupancy", position: "insideBottom", offset: -12, fontSize: 11 }} />
            <YAxis type="number" dataKey={key} tickFormatter={(v) => `${v}%`} fontSize={11} width={42} label={{ value: "Increase", angle: -90, position: "insideLeft", fontSize: 11 }} />
            <RechartsTooltip content={tooltip(key)} />
            <Scatter data={points} name={title}>
              {points.map((point) => (
                <Cell key={`${key}-${point.location}-${point.serviceLine}`} fill={PLAN_SCATTER_COLORS[point.serviceLine] ?? "#64748b"} fillOpacity={highlight && highlight !== point.serviceLine ? 0.16 : 0.9} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  if (points.length === 0) return null;
  return (
    <Card data-testid="card-inhouse-scatterplots">
      <CardHeader className={cn("pb-3", expanded && "border-b")}>
        <button
          type="button"
          className="flex w-full items-start justify-between gap-4 text-left"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-controls="inhouse-scatterplot-content"
          data-testid="button-toggle-inhouse-scatterplots"
        >
          <div className="space-y-1.5">
            <CardTitle className="text-base">Pricing Position by Service Line</CardTitle>
            <CardDescription>
              Scatterplots of occupancy against in-house and Street Rate increases.
            </CardDescription>
          </div>
          {expanded ? (
            <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          )}
        </button>
      </CardHeader>
      {expanded && (
        <CardContent id="inhouse-scatterplot-content" className="pt-4">
          <p className="mb-3 text-xs text-muted-foreground">
            {selectedLocationId === null
              ? "Each dot is one campus and service-line calculation. Occupancy is measured; unknown readings are not plotted."
              : "Each dot is a selected-campus service-line calculation. Occupancy is measured; unknown readings are not plotted."}
          </p>
          <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 border-y py-3">
            {Array.from(new Set(points.map((p) => p.serviceLine))).map((sl) => (
              <button
                key={sl}
                type="button"
                onClick={() => setHighlight((current) => current === sl ? null : sl)}
                className={cn("flex items-center gap-1.5 text-xs transition-opacity", highlight && highlight !== sl && "opacity-35")}
                aria-pressed={highlight === sl}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PLAN_SCATTER_COLORS[sl] ?? "#64748b" }} />
                <span>{sl}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            {renderChart("inhouseIncrease", "In-house resident rate increase")}
            {renderChart("streetIncrease", "Street Rate increase")}
          </div>
          {unknownCount > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {unknownCount} campus/service-line combination{unknownCount === 1 ? "" : "s"} omitted because occupancy was unavailable.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

interface CalculateRequest {
  identityKey: string | null;
  locationId: string | null;
  serviceLines: string[];
  assumptionsByLine: Record<string, PlanningAssumptions>;
}

/** One service line's three tier plans, as returned by /calculate-tiers. */
interface TierGridLine {
  serviceLine: string;
  occupancyPct: number | null;
  occupancyMonth: string | null;
  occupancySource: "occupancy_history" | "rent_roll" | null;
  currentTier: OccupancyTierId | null;
  currentPlan: PlanResult;
  cells: OccupancyTierPlanCell[];
  warnings: string[];
}

interface TierGridResult {
  lines: TierGridLine[];
  skipped: Array<{ sl: string; message: string }>;
  identityKey: string | null;
  planScopeKey: string;
  /**
   * The scope and the full set of solver inputs the grid was built from,
   * captured when the request went out. A grid takes ~30 seconds to build,
   * which is long enough for the operator to change campus or edit an input
   * while it runs; without these a late result would repaint under a scope it
   * does not describe, or sit there looking current under changed inputs.
   */
  scopeKey: string;
  inputsKey: string;
  inputSnapshot: PlanningInputSnapshotEntry[];
}

/**
 * Column track shared by the tier table's header and every body row. Written
 * as one literal so the two can never drift out of alignment.
 */
const TIER_GRID_COLS =
  "grid grid-cols-[4.5rem_3.75rem_6.5rem_7.5rem_7.5rem_4.25rem_4.75rem_6rem] gap-x-2";

/** Stable empty map, so reading out of scope does not churn referential equality. */
const NO_TIER_POLICIES: Record<string, OccupancyTierPolicy> = {};

/** Column track for the tier summary grid, shared by its headers and rows. */
const TIER_SUMMARY_COLS =
  "grid grid-cols-[3.5rem_4.25rem_5.5rem_1fr] gap-x-2 sm:grid-cols-[6rem_5.5rem_minmax(6.5rem,1fr)_repeat(3,minmax(6.5rem,1fr))]";

/** Signed one-decimal percent, or an em dash when the tier produced nothing. */
function formatTierPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function tierRangeHeader(grid: TierGridResult, tier: OccupancyTierId): string {
  const ranges = Array.from(new Set(
    grid.lines
      .map((line) => line.cells.find((cell) => cell.tier === tier)?.rangeLabel)
      .filter((value): value is string => !!value),
  ));
  if (ranges.length === 1) return `${ranges[0]} occupancy`;
  if (ranges.length > 1) return "Range varies by service line";
  return OCCUPANCY_TIER_LABELS[tier];
}

/** Compact numeric cell for the tier table; full-size fields are too tall here. */
function TierInput({
  value,
  onCommit,
  min,
  max,
  testId,
  disabled,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  testId?: string;
  /**
   * Set until the line's stored policy has been applied. An edit accepted
   * before then has nothing real to build on, so it would be recorded against
   * a default policy and the stored one silently discarded.
   */
  disabled?: boolean;
}) {
  return (
    <CommitNumberInput
      className="h-7 w-full px-1.5 text-xs"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      onCommit={onCommit}
      disabled={disabled}
      data-testid={testId}
    />
  );
}

function quarterPeriodWeight(
  year: number,
  quarter: number,
  rateBasis: PlanResult["rateBasis"],
): number {
  if (rateBasis === "monthly") return 3;
  const startMonth = (quarter - 1) * 3;
  return (
    Date.UTC(year, startMonth + 3, 1) - Date.UTC(year, startMonth, 1)
  ) / 86_400_000;
}

function fullYearYoyFromQuarters(
  quarters: PlanResult["quarters"],
  rateBasis: PlanResult["rateBasis"],
): {
  priorRateMonthly: number;
  projectedRateMonthly: number;
  growthPct: number;
} {
  let priorWeighted = 0;
  let projectedWeighted = 0;
  let priorPeriodWeight = 0;
  let projectedPeriodWeight = 0;

  for (const quarter of quarters) {
    const prior = quarter.priorYear.realizedRateMonthly;
    if (prior == null || prior <= 0 || !Number.isFinite(quarter.projectedRateMonthly)) continue;
    // Weight complete calendar periods, not resident volume. Quarter rates are
    // already normalized averages; using census here would reintroduce
    // occupancy/payer mix into a rate-growth measure.
    const priorWeight = quarterPeriodWeight(
      quarter.priorYear.year,
      quarter.priorYear.quarter,
      rateBasis,
    );
    const projectedWeight = quarterPeriodWeight(quarter.year, quarter.quarter, rateBasis);
    priorWeighted += prior * priorWeight;
    projectedWeighted += quarter.projectedRateMonthly * projectedWeight;
    priorPeriodWeight += priorWeight;
    projectedPeriodWeight += projectedWeight;
  }

  const priorRateMonthly = priorPeriodWeight > 0 ? priorWeighted / priorPeriodWeight : 0;
  const projectedRateMonthly = projectedPeriodWeight > 0
    ? projectedWeighted / projectedPeriodWeight
    : 0;
  return {
    priorRateMonthly,
    projectedRateMonthly,
    growthPct: priorRateMonthly > 0
      ? (projectedRateMonthly / priorRateMonthly - 1) * 100
      : 0,
  };
}

/** A ResidentRecommendation tagged with the service line it came from. */
type TaggedResident = ResidentRecommendation & { _sl: string };
/**
 * Calculated plans are a client-side working result, not an approved plan.
 * Keep one result per scope so leaving the page does not discard a calculation,
 * while switching campus or service-line selections never shows another
 * scope's result.
 */
export function calculatedPlanScopeKey(locationId: string | null, serviceLines: string[]): string {
  return `${locationId ?? ALL_CAMPUSES}::${Array.from(new Set(serviceLines)).sort().join(",")}`;
}

function isStoredPlan(value: unknown): value is PlanWithSl {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { sl?: unknown; plan?: unknown };
  if (typeof candidate.sl !== "string" || !candidate.plan || typeof candidate.plan !== "object") {
    return false;
  }
  const plan = candidate.plan as Partial<PlanResult>;
  return (
    !!plan.scope &&
    !!plan.assumptions &&
    !!plan.summary &&
    Array.isArray(plan.quarters) &&
    Array.isArray(plan.residents) &&
    Array.isArray(plan.warnings)
  );
}

interface StoredCalculatedPlan {
  plans: PlanWithSl[];
  lastRunAt: string;
  detailsOmitted?: boolean;
  tierGrid?: TierGridResult;
  /** Exact raw assumptions and tier policies posted for this calculation. */
  inputsKey?: string;
  inputSnapshot?: PlanningInputSnapshotEntry[];
}

function readStoredCalculatedPlan(value: unknown): {
  plans: PlanWithSl[];
  lastRunAt: string | null;
  detailsOmitted: boolean;
  inputsKey: string | null;
  inputSnapshot: PlanningInputSnapshotEntry[] | null;
  tierGrid: TierGridResult | null;
} | null {
  // Backward compatibility for calculations saved before timestamps existed.
  if (Array.isArray(value) && value.every(isStoredPlan)) {
    return {
      plans: value,
      lastRunAt: null,
      detailsOmitted: false,
      inputsKey: null,
      inputSnapshot: null,
      tierGrid: null,
    };
  }
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<StoredCalculatedPlan>;
  if (
    !Array.isArray(candidate.plans) ||
    !candidate.plans.every(isStoredPlan) ||
    typeof candidate.lastRunAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.lastRunAt))
  ) {
    return null;
  }
  return {
    plans: candidate.plans,
    lastRunAt: candidate.lastRunAt,
    detailsOmitted: candidate.detailsOmitted === true,
    inputsKey: typeof candidate.inputsKey === "string" ? candidate.inputsKey : null,
    inputSnapshot: Array.isArray(candidate.inputSnapshot)
      ? candidate.inputSnapshot as PlanningInputSnapshotEntry[]
      : null,
    tierGrid:
      candidate.tierGrid &&
      Array.isArray(candidate.tierGrid.lines) &&
      candidate.tierGrid.lines.every((line) =>
        !!line &&
        typeof line.serviceLine === "string" &&
        isStoredPlan({ sl: line.serviceLine, plan: line.currentPlan }),
      )
        ? candidate.tierGrid
        : null,
  };
}

function compactPlanForBrowserStorage(result: PlanWithSl): PlanWithSl {
  return {
    ...result,
    plan: {
      ...result.plan,
      // The portfolio result can contain tens of thousands of resident rows.
      // Keep the complete result in memory for the current session, but persist
      // the calculated totals, projections, assumptions, and warnings only.
      residents: [],
    },
  };
}

function compactTierGridForBrowserStorage(result: TierGridResult): TierGridResult {
  return {
    ...result,
    lines: result.lines.map((line) => ({
      ...line,
      currentPlan: compactPlanForBrowserStorage({
        sl: line.serviceLine,
        plan: line.currentPlan,
      }).plan,
    })),
  };
}

export default function InhouseIncreases() {
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const fromReferenceData =
    new URLSearchParams(window.location.search).get("from") === "reference-data";

  const referenceDataUrl = () => {
    const params = new URLSearchParams({
      scrollTo: "reference-data",
      focusGroup: "ihCalculated",
    });
    if (serviceLines.length === 1) params.set("serviceLine", serviceLines[0]);
    if (fromReferenceData) params.set("restorePosition", "reference-data");
    return `/pricing-controls?${params.toString()}`;
  };

  const [locationId, setLocationId] = useState<string>(() =>
    new URLSearchParams(window.location.search).get("locationId") || ALL_CAMPUSES,
  );
  // Multi-select: default to all service lines.
  const [serviceLines, setServiceLines] = useState<string[]>(() => {
    const requested = new URLSearchParams(window.location.search).get("serviceLine");
    return requested && SERVICE_LINES.includes(requested) ? [requested] : [...SERVICE_LINES];
  });
  const [assumptions, setAssumptions] = useState<PlanningAssumptions>({ ...DEFAULT_ASSUMPTIONS });
  // Per-line overrides for the two fields that legitimately differ by service line.
  const [perLineTargets, setPerLineTargets] = useState<
    Record<string, { rateGrowthTargetPct: number; annualTurnoverPct: number }>
  >({});
  /**
   * Per-line occupancy tier policies: two cutoffs and one guardrail set per
   * tier. Held beside perLineTargets rather than inside `assumptions` because
   * a tier is a policy about which guardrails apply, not an input the solver
   * reads directly.
   */
  /**
   * Policies carry the campus they were loaded for, and `edited` names the
   * lines the operator has typed into.
   *
   * The scope lives inside the state rather than being cleared by an effect
   * because effect ordering cannot be relied on: returning to a campus visited
   * earlier makes the cached policies available on the first render, so a
   * seed-then-reset pair silently ends at empty. Carrying the scope makes a
   * policy from the wrong campus unrepresentable instead of merely unlikely.
   *
   * Keyed on campus only, not campus-and-selection: a policy belongs to a
   * (campus, service line) pair, so adding a line to the selection must not
   * throw away edits to the lines already there.
   */
  const [tierState, setTierState] = useState<{
    scopeKey: string;
    policies: Record<string, OccupancyTierPolicy>;
    edited: Record<string, true>;
    /**
     * Lines whose stored policy has actually come back from the server. Only
     * this proves a policy is real; a populated `policies[sl]` could equally
     * be a default an edit was built on before the load landed.
     */
    loaded: Record<string, true>;
  }>({ scopeKey: "", policies: {}, edited: {}, loaded: {} });
  const [tierGrid, setTierGrid] = useState<TierGridResult | null>(null);
  const [mobileTier, setMobileTier] = useState<OccupancyTierId>("target");
  const [assumptionsTouched, setAssumptionsTouched] = useState(false);
  const [plans, setPlans] = useState<PlanWithSl[] | null>(null);
  // Persisted separately from PlanResult because the server normalizes empty
  // dates and applies the measured tier's guardrails before returning a plan.
  const [calculatedInputsKey, setCalculatedInputsKey] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [restoredPlanDetailsOmitted, setRestoredPlanDetailsOmitted] = useState(false);
  const [expandedQuarter, setExpandedQuarter] = useState<string | null>(null);
  const [expandedResident, setExpandedResident] = useState<string | null>(null);
  const [expandedPlanDetails, setExpandedPlanDetails] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    scope: false,
    assumptions: false,
    occupancyTiers: false,
    dataWarnings: false,
  });

  function toggleSection(section: "scope" | "assumptions" | "occupancyTiers" | "dataWarnings") {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function togglePlanDetails(serviceLine: string) {
    setExpandedPlanDetails((current) => ({
      ...current,
      [serviceLine]: !current[serviceLine],
    }));
  }
  const [sortKey, setSortKey] = useState<SortKey>("increasePct");
  const [sortDesc, setSortDesc] = useState(true);
  const [constrainedOnly, setConstrainedOnly] = useState(false);
  const [heldBackOnly, setHeldBackOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);

  const scopeLocationId = locationId === ALL_CAMPUSES ? null : locationId;
  const storageIdentityKey =
    user?.isAuthenticated && user.id && user.clientId
      ? `${user.clientId}::${user.id}`
      : null;
  // When a single line is selected use it; otherwise use the first for assumptions loading.
  const firstLine = serviceLines[0] ?? SERVICE_LINES[0];
  // What the tier grid describes. Scope and inputs are tracked separately so
  // the two can be reported differently: a scope change invalidates the grid
  // outright, while an edited input only makes it out of date.
  const tierScopeKey = `${scopeLocationId ?? "all"}|${serviceLines.join(",")}`;
  // Policies are per campus; the service line is the record key inside them.
  const policyScopeKey = scopeLocationId ?? "all";
  // Reading through the scope check is what makes a policy from another campus
  // unrepresentable rather than merely unlikely.
  const tierPolicies =
    tierState.scopeKey === policyScopeKey ? tierState.policies : NO_TIER_POLICIES;
  // Every value posted to the solver, not just the tier policy. Growth target,
  // turnover and the effective dates all change the answer, so a grid built
  // before one of them was edited is just as stale as one built under an old
  // cutoff — and must not be readable as current.
  const tierInputsKey = planningInputSnapshotKey(
    serviceLines.map((sl) => ({
      serviceLine: sl,
      assumptions: assumptionsForLine(sl),
      tierPolicy: tierPolicies[sl] ?? defaultOccupancyTierPolicy(),
    })),
  );
  const tierScopeKeyRef = useRef(tierScopeKey);
  tierScopeKeyRef.current = tierScopeKey;
  const singleLine = serviceLines.length === 1 ? serviceLines[0] : null;
  const calculatedPlanKey = useMemo(
    () => storageIdentityKey
      ? calculatedPlanScopeKey(scopeLocationId, serviceLines)
      : null,
    [scopeLocationId, serviceLines, storageIdentityKey],
  );

  const previousStorageIdentity = useRef<string | null | undefined>(undefined);
  const currentStorageIdentity = useRef<string | null>(storageIdentityKey);
  const restoredAnnualReport = useRef(false);
  const autoDetailReloadScope = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousStorageIdentity.current;
    previousStorageIdentity.current = storageIdentityKey;
    currentStorageIdentity.current = storageIdentityKey;
    // Auth hydrates asynchronously on every page load: null → signed-in user
    // is not a logout and must never erase that user's saved calculations.
    // Entries are identity-keyed, so only a transition from an authenticated
    // identity to no identity requires privacy cleanup.
    if (previous !== undefined && previous !== null && storageIdentityKey === null) {
      void clearInhousePlanStorage();
    }
  }, [storageIdentityKey]);

  // Restore the last calculation for every selected campus + service-line.
  // A multi-line calculation is also saved one line at a time, so calculating
  // "All service lines" once means AL, HC, etc. are immediately available when
  // the operator later filters to either line individually (and vice versa).
  useEffect(() => {
    let cancelled = false;
    restoredAnnualReport.current = false;
    autoDetailReloadScope.current = null;
    setPlans(null);
    setCalculatedInputsKey(null);
    setLastRunAt(null);
    setRestoredPlanDetailsOmitted(false);
    setVisibleCount(50);
    setExpandedResident(null);
    setExpandedQuarter(null);
    void (async () => {
      const storedValue = await readInhousePlan<unknown>(storageIdentityKey, calculatedPlanKey);
      const stored = readStoredCalculatedPlan(storedValue);
      let restored =
        stored &&
        stored.plans.every(({ sl }) => serviceLines.includes(sl))
          ? stored.plans
          : null;
      let restoredLastRunAt = restored ? stored?.lastRunAt ?? null : null;
      let detailsOmitted = restored ? stored?.detailsOmitted === true : false;
      let restoredInputsKey =
        restored
          ? stored?.inputSnapshot
            ? planningInputSnapshotKey(stored.inputSnapshot)
            : stored?.inputsKey ?? null
          : null;
      let restoredTierGrid = restored ? stored?.tierGrid ?? null : null;

      // Older cache entries and individually calculated lines may not have a
      // combined entry for the current multi-select. Compose it from each
      // line's most recent result rather than forcing another Calculate.
      if (!restored || restored.length !== serviceLines.length) {
        const perLine = await Promise.all(
          serviceLines.map(async (sl) => {
            const lineKey = calculatedPlanScopeKey(scopeLocationId, [sl]);
            const lineStoredValue = await readInhousePlan<unknown>(
              storageIdentityKey,
              lineKey,
            );
            const lineStored = readStoredCalculatedPlan(lineStoredValue);
            return {
              sl,
              plan: lineStored?.plans.find((candidate) => candidate.sl === sl) ?? null,
              lastRunAt: lineStored?.lastRunAt ?? null,
              detailsOmitted: lineStored?.detailsOmitted === true,
              inputSnapshot: lineStored?.inputSnapshot ?? null,
              tierGrid: lineStored?.tierGrid ?? null,
            };
          }),
        );
        const available = perLine
          .map(({ plan }) => plan)
          .filter((plan): plan is PlanWithSl => plan !== null);
        restored = available.length > 0 ? available : restored;
        const timestamps = perLine
          .filter(({ plan, lastRunAt }) => plan !== null && lastRunAt !== null)
          .map(({ lastRunAt }) => lastRunAt!);
        if (available.length === serviceLines.length && new Set(timestamps).size === 1) {
          restoredLastRunAt = timestamps[0] ?? restoredLastRunAt;
        }
        detailsOmitted = perLine.some(({ plan, detailsOmitted }) => plan !== null && detailsOmitted);
        const perLineSnapshots = perLine
          .filter(({ plan, inputSnapshot }) => plan !== null && inputSnapshot?.length === 1)
          .map(({ inputSnapshot }) => inputSnapshot![0]);
        const combinedSnapshot =
          available.length === serviceLines.length
            ? combinePlanningInputSnapshots(serviceLines, perLineSnapshots)
            : null;
        restoredInputsKey = combinedSnapshot
          ? planningInputSnapshotKey(combinedSnapshot)
          : null;
        const gridLines = perLine.flatMap(({ sl, tierGrid }) =>
          tierGrid?.lines.filter((line) => line.serviceLine === sl) ?? [],
        );
        if (gridLines.length === serviceLines.length && combinedSnapshot) {
          restoredTierGrid = {
            lines: gridLines,
            skipped: [],
            identityKey: storageIdentityKey,
            planScopeKey: calculatedPlanKey ?? "",
            scopeKey: tierScopeKey,
            inputsKey: planningInputSnapshotKey(combinedSnapshot),
            inputSnapshot: combinedSnapshot,
          };
        }
      }

      if (cancelled || restoredAnnualReport.current) return;
      setPlans(restored);
      setCalculatedInputsKey(restoredInputsKey);
      setLastRunAt(restoredLastRunAt);
      setRestoredPlanDetailsOmitted(detailsOmitted);
      setTierGrid(restoredTierGrid);
      const first = restored?.find((r) => r.plan.feasible) ?? restored?.[0];
      setExpandedQuarter(first?.plan.bindingQuarterLabel
        ? `${first.sl}-${first.plan.bindingQuarterLabel}`
        : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [calculatedPlanKey, scopeLocationId, serviceLines, storageIdentityKey]);

  function toggleServiceLine(sl: string) {
    setServiceLines((prev) => {
      const next = prev.includes(sl) ? prev.filter((x) => x !== sl) : [...prev, sl];
      // Never leave the list empty.
      return next.length ? next : prev;
    });
    setAssumptionsTouched(false);
    setPlans(null);
    setCalculatedInputsKey(null);
  }

  const { data: locationsData } = useQuery<{ locations: LocationRow[] }>({
    queryKey: ["/api/locations"],
  });
  const locations = locationsData?.locations ?? [];

  const { data: campusOccupancyData } = useQuery<{ readings: CampusOccupancyReading[] }>({
    queryKey: ["/api/inhouse-planning/occupancy-by-campus"],
    enabled: plans !== null,
    staleTime: 5 * 60 * 1000,
  });
  const { data: campusPlanPointsData } = useQuery<{ points: CampusPlanPoint[] }>({
    queryKey: ["/api/inhouse-planning/campus-plan-points", serviceLines.join(",")],
    queryFn: async () => {
      const params = new URLSearchParams({ serviceLines: serviceLines.join(",") });
      const res = await fetch(`/api/inhouse-planning/campus-plan-points?${params}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: plans !== null && scopeLocationId === null,
    refetchInterval: restoredPlanDetailsOmitted ? 10_000 : false,
    retry: false,
  });

  // Saved assumptions for this scope. Loading them replaces the editor state
  // only while the operator has not started editing, so a fetch settling late
  // can never overwrite something they just typed.
  // Load assumptions keyed on the first selected line. When multiple lines are
  // selected the user edits one shared set; saving writes it to all of them.
  const assumptionsQuery = useQuery<{ assumptions: PlanningAssumptions; scopeLevel: string }>({
    queryKey: [
      "/api/inhouse-planning/assumptions",
      scopeLocationId ?? "all",
      firstLine,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ serviceLine: firstLine });
      if (scopeLocationId) params.set("locationId", scopeLocationId);
      const res = await fetch(`/api/inhouse-planning/assumptions?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      if (!assumptionsTouched) {
        setAssumptions(json.assumptions);
        // Seed per-line targets from the loaded values (only for lines that
        // haven't been individually edited yet).
        setPerLineTargets((prev) => {
          // Nothing saved anywhere means the flat 35% is a system placeholder,
          // not somebody's decision — and 35% is wrong for every line except
          // by accident. Start each line at its own normal instead.
          //
          // Scope of this rule: it governs the PLACEHOLDER only. A value from a
          // real saved row is never replaced by a band default; if that value
          // is out of band the operator gets a warning, not a rewrite. Measured
          // history is the one thing that does outrank a saved value (see the
          // adoption effect below) — and when it does, the evidence line says
          // so explicitly rather than just showing the new number.
          const isPlaceholder = json.scopeLevel === "default";
          const next: typeof prev = {};
          for (const sl of serviceLines) {
            next[sl] = prev[sl] ?? {
              rateGrowthTargetPct: json.assumptions.rateGrowthTargetPct,
              annualTurnoverPct: isPlaceholder
                ? defaultTurnoverFor(sl)
                : json.assumptions.annualTurnoverPct,
            };
          }
          return next;
        });
      }
      return json;
    },
  });

  /**
   * Tier policies are loaded per service line, not cloned from the first one.
   *
   * Unlike the shared assumptions — which the operator edits once and saves to
   * every selected line — a tier policy is genuinely per line: a villa and a
   * skilled-nursing wing set different cutoffs. Seeding all lines from the
   * first line's stored policy would hide the others' saved values on screen
   * and then overwrite them on the next save.
   */
  const tierPoliciesQuery = useQuery<{
    scopeKey: string;
    policies: Record<string, OccupancyTierPolicy>;
  }>({
    // Shares the assumptions prefix deliberately: saving invalidates that
    // prefix, and this query has to go with it. A distinct key string looks
    // related but is not — TanStack matches array prefixes, not substrings, so
    // a saved policy would sit behind an untouched cache entry (staleTime is
    // Infinity globally) and reappear as the old value on the next visit.
    queryKey: [
      "/api/inhouse-planning/assumptions",
      "tier-policies",
      scopeLocationId ?? "all",
      serviceLines.join(","),
    ],
    queryFn: async ({ signal }) => {
      // The campus this run is answering for, captured before any awaiting.
      const scopeKey = scopeLocationId ?? "all";
      const params = new URLSearchParams({ serviceLines: serviceLines.join(",") });
      if (scopeLocationId) params.set("locationId", scopeLocationId);
      const controller = new AbortController();
      const cancelForQuery = () => controller.abort();
      signal.addEventListener("abort", cancelForQuery, { once: true });
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`/api/inhouse-planning/assumptions-batch?${params}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(await res.text());
        const payload = await res.json();
        const entries = serviceLines.map((sl) => {
          const json = payload.policies?.[sl];
          if (!json) throw new Error(`No saved occupancy tier response for ${sl}`);
          const loaded: OccupancyTierPolicy = json.tierPolicy ?? defaultOccupancyTierPolicy();
          // A line that never saved a policy starts its middle tier at the
          // guardrails already in force, so the grid's target column
          // reproduces the plan being shown rather than introducing numbers
          // nobody chose.
          const seeded: OccupancyTierPolicy = json.tierPolicyStored
            ? loaded
            : {
                ...loaded,
                tiers: {
                  ...loaded.tiers,
                  target: guardrailsFromAssumptions(json.assumptions),
                },
              };
          return [sl, seeded] as const;
        });
        return { scopeKey, policies: Object.fromEntries(entries) };
      } catch (error) {
        if (controller.signal.aborted && !signal.aborted) {
          throw new Error("Saved occupancy tier settings took too long to load.");
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", cancelForQuery);
      }
    },
    retry: 8,
    retryDelay: (attempt) => Math.min(2_000 + attempt * 1_000, 5_000),
  });

  /**
   * Seeding is applied here rather than inside the fetch so the campus can be
   * re-checked at the moment the state is written: a request for the previous
   * campus can still be in flight when the campus changes.
   *
   * The reset to a new campus happens inside this same update rather than in
   * a separate effect, so there is no interleaving in which the old campus's
   * policies outlive it or the new campus's get cleared after being seeded.
   */
  useEffect(() => {
    const data = tierPoliciesQuery.data;
    if (!data || data.scopeKey !== policyScopeKey) return;
    setTierState((prev) => {
      const base =
        prev.scopeKey === policyScopeKey
          ? prev
          : { scopeKey: policyScopeKey, policies: {}, edited: {}, loaded: {} };
      let changed = base !== prev;
      const policies = { ...base.policies };
      const loaded = { ...base.loaded };
      for (const [sl, policy] of Object.entries(data.policies)) {
        if (!loaded[sl]) {
          loaded[sl] = true;
          changed = true;
        }
        // Lines the operator is editing are theirs; everything else tracks
        // what the server actually has stored.
        if (base.edited[sl]) continue;
        if (JSON.stringify(policies[sl]) === JSON.stringify(policy)) continue;
        policies[sl] = policy;
        changed = true;
      }
      return changed ? { ...base, policies, loaded } : prev;
    });
  }, [tierPoliciesQuery.data, policyScopeKey]);

  /**
   * Until every selected line's stored policy is actually in state,
   * `tierPolicyFor` answers with defaults. Saving then writes those defaults
   * over whatever the lines had, and a tier grid solves guardrails nobody
   * chose — so both actions wait. Readiness is measured on the state the
   * buttons will read, not on the query, because a cached query result that
   * has not been applied yet would otherwise report ready.
   */
  // A failed load leaves whatever was cached on screen. That may well be
  // right, but nothing here can tell, so treat the line as unloaded rather
  // than let a guess be saved back over the stored policy.
  const tierLineLoaded = (sl: string) =>
    tierState.scopeKey === policyScopeKey &&
    tierState.loaded[sl] === true &&
    !tierPoliciesQuery.isError;
  const tierPoliciesReady = serviceLines.every(tierLineLoaded);

  /**
   * Per-line overrides belong to the campus they were seeded from. Keeping
   * them across a campus change leaves the previous campus's turnover sitting
   * in the box for any line the new campus cannot measure — while the note
   * underneath says the saved assumption is being used. Clear them and let
   * both loaders reseed for the new scope.
   */
  useEffect(() => {
    setPerLineTargets({});
    // Tier policies and any grid built from them belong to the campus they
    // were loaded for; a stale grid under a new campus reads as that campus's
    // answer.
    // Tier policies need no reset here: they carry their own campus and are
    // read through a scope check, so last campus's values can never be read
    // as this one's regardless of which effect runs first.
    setTierGrid(null);
  }, [scopeLocationId]);

  /**
   * Measured turnover per service line. This is what the turnover assumption
   * should be — the solver blends residents toward the street rate at this
   * rate, so a guessed number silently changes every recommended increase.
   */
  const turnoverQuery = useQuery<HistoricalTurnoverResponse>({
    queryKey: [
      "/api/inhouse-planning/historical-turnover",
      storageIdentityKey ?? "anonymous",
      scopeLocationId ?? "all",
    ],
    initialData: () =>
      scopeLocationId === null
        ? readCachedCompanyTurnover(storageIdentityKey)
        : undefined,
    // Turnover is independent of restoring the last calculated plan. Start
    // both requests together so a slow IndexedDB read cannot add latency to
    // the historical assumptions request.
    enabled: true,
    // Paint the identity-scoped browser cache immediately, then refresh it
    // while the independent IndexedDB plan restore continues.
    staleTime: 0,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: true,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (scopeLocationId) params.set("locationId", scopeLocationId);
      const res = await fetch(`/api/inhouse-planning/historical-turnover?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json() as HistoricalTurnoverResponse;
      if (scopeLocationId === null) {
        writeCachedCompanyTurnover(storageIdentityKey, json);
      }
      return json;
    },
  });

  /**
   * What is actually stored for this scope, or null when the page is showing
   * system defaults. Read from the query rather than the `assumptions` state
   * so that in-session edits do not masquerade as a saved decision.
   */
  const savedTurnoverPct =
    assumptionsQuery.data && assumptionsQuery.data.scopeLevel !== "default"
      ? assumptionsQuery.data.assumptions.annualTurnoverPct
      : null;

  const turnoverBySl = useMemo(() => {
    const m = new Map<string, ServiceLineTurnover>();
    for (const row of turnoverQuery.data?.byServiceLine ?? []) m.set(row.serviceLine, row);
    return m;
  }, [turnoverQuery.data]);

  /**
   * Adopt the measured turnover for every line that has a usable one, until
   * the operator edits something. Implausible lines keep the saved assumption
   * — see the badge in the table.
   *
   * `plannedPct`, not `turnoverPct`: a short-stay line genuinely measures past
   * 100%, and feeding that in raw would clamp inside the solver and quietly
   * make in-house increases irrelevant. Capping here keeps the cap visible on
   * the page instead of burying it in the solver.
   */
  useEffect(() => {
    // Automatic measured turnover is an initial editor default only. A late
    // history response must never mutate the inputs underneath a calculated or
    // restored result and falsely claim the operator changed its settings.
    if (assumptionsTouched || !turnoverQuery.data || plans !== null) return;
    setPerLineTargets((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const sl of serviceLines) {
        const hist = turnoverBySl.get(sl);
        if (!hist?.plausible) continue;
        const base = next[sl] ?? {
          rateGrowthTargetPct: assumptions.rateGrowthTargetPct,
          annualTurnoverPct: assumptions.annualTurnoverPct,
        };
        if (base.annualTurnoverPct === hist.plannedPct && next[sl]) continue;
        next[sl] = { ...base, annualTurnoverPct: hist.plannedPct };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [turnoverQuery.data, turnoverBySl, serviceLines, assumptionsTouched, assumptions, plans]);

  const tierInputsReady =
    assumptionsQuery.isSuccess &&
    tierState.scopeKey === policyScopeKey &&
    serviceLines.every((sl) => tierState.loaded[sl] === true);
  const calculatedTierInputsKey =
    tierGrid?.inputSnapshot?.length
      ? planningInputSnapshotKey(tierGrid.inputSnapshot)
      : tierGrid?.inputsKey;
  const tierGridStale =
    tierGrid != null &&
    (
      tierGrid.scopeKey !== tierScopeKey ||
      (tierInputsReady && calculatedTierInputsKey !== tierInputsKey)
    );

  /**
   * The workbook is built server-side: it needs the solver's per-resident
   * internals (weight, headroom, shape, effective bounds, lambda) to write the
   * formula chain, and none of those are on the PlanResult the page holds.
   */
  // Export one service line at a time (the server builds the full formula workbook
  // per-line). When multiple lines are selected we download each sequentially.
  const exportPlan = useMutation({
    mutationFn: async (sl: string) => {
      const start = await fetch("/api/inhouse-planning/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          locationId: scopeLocationId,
          serviceLine: sl,
          assumptions: assumptionsForLine(sl),
          tierPolicy: tierPolicyFor(sl),
        }),
      });
      if (!start.ok) {
        let message = "Failed to build the export";
        try { message = (await start.json()).error || message; } catch { /* non-JSON */ }
        throw new Error(message);
      }
      const { exportId } = await start.json() as { exportId?: string };
      if (!exportId) throw new Error("The export did not start correctly");

      let res: Response | null = null;
      const deadline = Date.now() + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        try {
          const status = await fetch(
            `/api/inhouse-planning/export/${encodeURIComponent(exportId)}`,
            { credentials: "include", cache: "no-store" },
          );
          if (status.status === 202) continue;
          res = status;
          break;
        } catch {
          // A brief proxy reconnect must not lose a long-running export.
        }
      }
      if (!res) throw new Error("The export took longer than 15 minutes");
      if (!res.ok) {
        let message = "Failed to build the export";
        try { message = (await res.json()).error || message; } catch { /* non-JSON */ }
        throw new Error(message);
      }
      const disposition = res.headers.get("Content-Disposition") || "";
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = named || `in-house-rate-plan-${sl}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
    onSuccess: () =>
      toast({
        title: "Rate plan exported",
        description: "Every step is a live Excel formula — change an assumption on the summary sheet and the workbook recalculates.",
      }),
    onError: (error: Error) =>
      toast({ title: "Export failed", description: error.message, variant: "destructive" }),
  });

  // The server batches the selected lines so shared policy/occupancy reads are
  // done once. It still returns line-level failures instead of failing the
  // whole portfolio calculation.
  const calculate = useMutation({
    mutationFn: async (request: CalculateRequest) => {
      const requestedScopeKey = calculatedPlanScopeKey(request.locationId, request.serviceLines);
      const res = await apiRequest("/api/inhouse-planning/calculate-batch", "POST", {
        locationId: request.locationId,
        lines: request.serviceLines.map((sl) => ({
          serviceLine: sl,
          assumptions: request.assumptionsByLine[sl],
        })),
      });
      const payload = (await res.json()) as {
        plans: Array<{ serviceLine: string; plan: PlanResult }>;
        skipped: Array<{ serviceLine: string; message: string }>;
      };
      const results = payload.plans.map(({ serviceLine, plan }) =>
        ({ sl: serviceLine, plan }) as PlanWithSl,
      );
      const skipped = payload.skipped.map(({ serviceLine, message }) => ({
        sl: serviceLine,
        message: cleanError(message),
      }));
      if (results.length === 0) {
        throw new Error(
          skipped.length > 0
            ? skipped.map(({ sl, message }) => `${sl}: ${message}`).join(" ")
            : "No service lines were selected.",
        );
      }
      return { identityKey: request.identityKey, scopeKey: requestedScopeKey, results, skipped };
    },
    onSuccess: async ({ identityKey, scopeKey, results, skipped }) => {
      // Persist the completed request even if the operator switched filters
      // while it was running. Save both the exact selection and each line so
      // any later filter combination can restore the last available plans.
      const lastRunAt = new Date().toISOString();
      let saved = false;
      if (identityKey) {
        const compactResults = results.map(compactPlanForBrowserStorage);
        const stored: StoredCalculatedPlan = {
          plans: compactResults,
          lastRunAt,
          detailsOmitted: true,
        };
        saved = await writeInhousePlanBundle(
          identityKey,
          { scopeKey, value: stored },
          compactResults.map((result) => ({
            scopeKey: calculatedPlanScopeKey(result.plan.scope.locationId ?? null, [result.sl]),
            value: {
              plans: [result],
              lastRunAt,
              detailsOmitted: true,
            } satisfies StoredCalculatedPlan,
          })),
        );
      }
      // If the operator changed scope while the request was running, retain
      // the result under its original scope but never render it under the new
      // one.
      if (
        identityKey !== currentStorageIdentity.current ||
        scopeKey !== calculatedPlanScopeKey(scopeLocationId, serviceLines)
      ) return;
      setPlans(results);
      setLastRunAt(lastRunAt);
      setRestoredPlanDetailsOmitted(false);
      setVisibleCount(50);
      setExpandedResident(null);
      // Expand the binding quarter of the first feasible plan.
      const first = results.find((r) => r.plan.feasible) ?? results[0];
      setExpandedQuarter(first?.plan.bindingQuarterLabel ?? null);
      if (skipped.length > 0) {
        toast({
          title: `${skipped.length} service line${skipped.length === 1 ? "" : "s"} skipped`,
          description: skipped.map(({ sl, message }) => `${sl}: ${message}`).join(" "),
        });
      }
      if (identityKey && !saved) {
        toast({
          title: "Plan calculated but not saved",
          description: "Browser storage is unavailable. Keep this page open or enable site storage before leaving.",
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) => {
      // Do not clear the current or stored successful result. A transient
      // calculation failure must not erase the last plan the operator can use.
      toast({ title: "Could not calculate a plan", description: cleanError(err.message), variant: "destructive" });
    },
  });

  const annualReport = useMutation({
    mutationFn: async ({
      reportPlans,
      reportTierGrid,
      reportLocationId,
      reportServiceLines,
      openAfterSave,
    }: {
      reportPlans: PlanWithSl[];
      reportTierGrid: TierGridResult;
      reportLocationId: string | null;
      reportServiceLines: string[];
      openAfterSave: boolean;
    }) => {
      // A report is a presentation snapshot, not a second resident data store.
      // Persist aggregate distribution bands rather than one object per
      // resident. Portfolio plans can contain thousands of residents, and the
      // repeated anonymous objects add no report information while exceeding
      // normal HTTP request limits.
      const compactPlans = reportPlans.map(({ sl, plan }) => ({
        sl,
        plan: compactPlanForAnnualReport(plan),
      }));
      const compactTierGrid = {
        lines: reportTierGrid.lines.map((line) => ({
          serviceLine: line.serviceLine,
          occupancyPct: line.occupancyPct,
          occupancyMonth: line.occupancyMonth,
          occupancySource: line.occupancySource,
          currentTier: line.currentTier,
          cells: line.cells,
          warnings: line.warnings,
        })),
        skipped: reportTierGrid.skipped,
        scopeKey: reportTierGrid.scopeKey,
        inputsKey: reportTierGrid.inputsKey,
        inputSnapshot: reportTierGrid.inputSnapshot,
      };
      const payload = {
        scopeKey: reportTierGrid.scopeKey,
        locationId: reportLocationId,
        serviceLines: reportServiceLines,
        plans: compactPlans,
        tierGrid: compactTierGrid,
      };
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
      if (payloadBytes >= 90_000) {
        throw new Error(
          `The report snapshot is unexpectedly large (${Math.ceil(payloadBytes / 1024)} KB). Recalculate the plan and try again.`,
        );
      }
      const response = await apiRequest("/api/inhouse-planning/annual-report-runs", "POST", payload);
      return {
        ...(await response.json()) as { report: { id: string; scopeKey: string } },
        openAfterSave,
      };
    },
    onSuccess: ({ report, openAfterSave }) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/inhouse-planning/annual-report-runs/latest"],
      });
      if (openAfterSave) {
        setLocation(`/inhouse-increases/annual-report?scopeKey=${encodeURIComponent(report.scopeKey)}`);
      }
    },
    onError: (error: Error) => toast({ title: "Annual report could not be created", description: error.message, variant: "destructive" }),
  });
  const autoSavedAnnualReportRun = useRef<string | null>(null);
  useEffect(() => {
    if (!plans || !tierGrid || tierGridStale || !lastRunAt) return;
    const runKey = `${tierGrid.scopeKey}|${lastRunAt}`;
    if (autoSavedAnnualReportRun.current === runKey) return;
    autoSavedAnnualReportRun.current = runKey;
    annualReport.mutate({
      reportPlans: plans,
      reportTierGrid: tierGrid,
      reportLocationId: plans[0]?.plan.scope.locationId ?? null,
      reportServiceLines: plans.map(({ sl }) => sl),
      openAfterSave: false,
    });
  }, [plans, tierGrid, tierGridStale, lastRunAt]);

  /**
   * The what-if grid: every selected service line solved under all three of
   * its tiers. Fanned out per line like the single-plan calculation, so the
   * grid fills in line by line and one unsolvable line cannot lose the rest.
   */
  const calculateTiers = useMutation({
    mutationFn: async (): Promise<TierGridResult> => {
      const requested = [...serviceLines];
      // Snapshot what this run describes before any awaiting starts.
      const scopeKey = tierScopeKey;
      const inputEntries = requested.map((sl) => ({
        serviceLine: sl,
        assumptions: { ...assumptionsForLine(sl) },
        tierPolicy: tierPolicyFor(sl),
      }));
      const inputsKey = planningInputSnapshotKey(inputEntries);
      const locationIdAtStart = scopeLocationId;
      const identityKey = storageIdentityKey;
      const planScopeKey = calculatedPlanScopeKey(locationIdAtStart, requested);
      const res = await apiRequest("/api/inhouse-planning/calculate-tiers-batch", "POST", {
        locationId: locationIdAtStart,
        lines: inputEntries.map((entry) => ({
          serviceLine: entry.serviceLine,
          assumptions: entry.assumptions,
          tierPolicy: entry.tierPolicy,
        })),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        throw new Error(
          "The planning service returned an invalid response. Refresh the page and calculate again.",
        );
      }
      const payload = (await res.json()) as {
        lines: TierGridLine[];
        skipped: Array<{ serviceLine: string; message: string }>;
      };
      const lines = payload.lines;
      const skipped = payload.skipped.map(({ serviceLine, message }) => ({
        sl: serviceLine,
        message: cleanError(message),
      }));
      if (lines.length === 0) {
        throw new Error(
          skipped.length > 0
            ? skipped.map(({ sl, message }) => `${sl}: ${message}`).join(" ")
            : "No service lines were selected.",
        );
      }
      return { lines, skipped, scopeKey, inputsKey, inputSnapshot: inputEntries, identityKey, planScopeKey };
    },
    onSuccess: (result) => {
      // The scope moved while this was in flight. Showing it would label one
      // campus's numbers with another campus's name, so drop it and say so.
      if (result.scopeKey !== tierScopeKeyRef.current) {
        toast({
          title: "Tier grid discarded",
          description:
            "The campus or service line selection changed while the grid was building, so the finished result no longer describes what is on screen. Run it again.",
        });
        return;
      }
      setTierGrid(result);
      const calculatedPlans = result.lines.map((line) => ({
        sl: line.serviceLine,
        plan: line.currentPlan,
      }));
      const lastRunAt = new Date().toISOString();
      if (
        result.identityKey === currentStorageIdentity.current &&
        result.planScopeKey === calculatedPlanScopeKey(scopeLocationId, serviceLines)
      ) {
        setPlans(calculatedPlans);
        setCalculatedInputsKey(result.inputsKey);
        setLastRunAt(lastRunAt);
        setRestoredPlanDetailsOmitted(false);
        setVisibleCount(50);
        setExpandedResident(null);
        const first = calculatedPlans.find((entry) => entry.plan.feasible) ?? calculatedPlans[0];
        setExpandedQuarter(first?.plan.bindingQuarterLabel ?? null);
      }
      if (result.skipped.length > 0) {
        toast({
          title: `${result.skipped.length} service line${result.skipped.length === 1 ? "" : "s"} skipped`,
          description: result.skipped.map(({ sl, message }) => `${sl}: ${message}`).join(" "),
        });
      }
      // Browser persistence is best-effort and must never hold the calculation
      // mutation open. IndexedDB can be slow or blocked in embedded/mobile
      // browsers even after the server result is ready.
      if (result.identityKey) {
        const compactPlans = calculatedPlans.map(compactPlanForBrowserStorage);
        const compactTierGrid = compactTierGridForBrowserStorage(result);
        const stored: StoredCalculatedPlan = {
          plans: compactPlans,
          lastRunAt,
          detailsOmitted: true,
          inputsKey: result.inputsKey,
          inputSnapshot: result.inputSnapshot,
          tierGrid: compactTierGrid,
        };
        void writeInhousePlanBundle(
          result.identityKey,
          { scopeKey: result.planScopeKey, value: stored },
          compactPlans.map((calculated) => {
            const inputSnapshot = result.inputSnapshot.filter(
              (entry) => entry.serviceLine === calculated.sl,
            );
            return {
              scopeKey: calculatedPlanScopeKey(calculated.plan.scope.locationId ?? null, [calculated.sl]),
              value: {
                plans: [calculated],
                lastRunAt,
                detailsOmitted: true,
                inputsKey: inputSnapshot.length === 1
                  ? planningInputSnapshotKey(inputSnapshot)
                  : result.inputsKey,
                inputSnapshot,
                tierGrid: {
                  ...compactTierGrid,
                  lines: compactTierGrid.lines.filter(
                    (line) => line.serviceLine === calculated.sl,
                  ),
                  scopeKey: `${calculated.plan.scope.locationId ?? "all"}|${calculated.sl}`,
                  inputsKey: inputSnapshot.length === 1
                    ? planningInputSnapshotKey(inputSnapshot)
                    : result.inputsKey,
                  inputSnapshot,
                },
              } satisfies StoredCalculatedPlan,
            };
          }),
        ).then((saved) => {
          if (saved) return;
          toast({
            title: "Plan calculated but not saved",
            description: "Browser storage is unavailable. Keep this page open or enable site storage before leaving.",
            variant: "destructive",
          });
        }).catch(() => {
          toast({
            title: "Plan calculated but not saved",
            description: "Browser storage is unavailable. Keep this page open or enable site storage before leaving.",
            variant: "destructive",
          });
        });
      }
    },
    onError: (err: Error) =>
      toast({
        title: "Could not build the tier grid",
        description: cleanError(err.message),
        variant: "destructive",
      }),
  });

  // Campus reports and browser cache entries intentionally omit resident rows.
  // Once the exact saved inputs have hydrated, refresh that selected scope so
  // filtering to a campus shows its resident recommendations rather than 0 of 0.
  useEffect(() => {
    if (
      !restoredPlanDetailsOmitted ||
      !tierInputsReady ||
      calculateTiers.isPending
    ) {
      return;
    }
    const scope = `${storageIdentityKey ?? "anonymous"}|${tierScopeKey}|${tierInputsKey}`;
    if (autoDetailReloadScope.current === scope) return;
    autoDetailReloadScope.current = scope;
    calculateTiers.mutate();
  }, [
    restoredPlanDetailsOmitted,
    storageIdentityKey,
    tierInputsKey,
    tierInputsReady,
    tierScopeKey,
  ]);

  // Saving writes the shared assumptions to every selected service line.
  const saveAssumptions = useMutation({
    mutationFn: async () => {
      const scopeKey = scopeLocationId ?? "all";
      const submitted: Record<string, OccupancyTierPolicy> = {};
      for (const sl of serviceLines) submitted[sl] = tierPolicyFor(sl);
      const responses = await Promise.all(
        serviceLines.map((sl) =>
          apiRequest("/api/inhouse-planning/assumptions", "POST", {
            locationId: scopeLocationId,
            serviceLine: sl,
            assumptions: assumptionsForLine(sl),
            tierPolicy: submitted[sl],
          }).then((r) => r.json()),
        ),
      );
      return {
        scopeKey,
        submitted,
        savedAssumptions: responses[0]?.assumptions as PlanningAssumptions | undefined,
      };
    },
    onSuccess: ({ scopeKey, submitted, savedAssumptions }) => {
      setAssumptionsTouched(false);
      if (savedAssumptions) {
        // Apply the server acknowledgement immediately. The response is the
        // persisted row, not just the values that were submitted, so dates
        // cannot disappear while the invalidated query is refetching.
        setAssumptions(savedAssumptions);
        queryClient.setQueryData<{
          assumptions: PlanningAssumptions;
          scopeLevel: string;
        }>(
          [
            "/api/inhouse-planning/assumptions",
            scopeLocationId ?? "all",
            firstLine,
          ],
          (old) => (old ? { ...old, assumptions: savedAssumptions } : old),
        );
      }
      /**
       * Write the acknowledged policies into the cache before invalidating.
       *
       * Invalidation marks data stale but leaves it readable, so on its own it
       * still leaves a window — the length of the refetch, or forever if the
       * refetch is aborted by a campus change or fails — in which the
       * pre-save policy is served, counts as loaded, and can be saved back
       * over what was just written. Writing the acknowledged values first
       * means the only thing left in the cache is already correct.
       *
       * Every cache entry for this campus is updated, not just the one for
       * the current selection: entries are also keyed by the set of selected
       * service lines, so the same line appears in several of them.
       */
      queryClient.setQueriesData<{
        scopeKey: string;
        policies: Record<string, OccupancyTierPolicy>;
      }>(
        {
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === "/api/inhouse-planning/assumptions" &&
            q.queryKey[1] === "tier-policies" &&
            q.queryKey[2] === scopeKey,
        },
        (old) => (old ? { ...old, policies: { ...old.policies, ...submitted } } : old),
      );
      // Prefix-invalidates the per-line tier-policy query too, so returning to
      // this campus later reseeds from what was just saved.
      queryClient.invalidateQueries({ queryKey: ["/api/inhouse-planning/assumptions"] });
      const lineLabel = serviceLines.length === 1 ? serviceLines[0] : `${serviceLines.length} service lines`;
      toast({
        title: "Assumptions saved",
        description: scopeLocationId
          ? `Saved for ${lineLabel} at this campus.`
          : `Saved for ${lineLabel} across all campuses.`,
      });
    },
    onError: (err: Error) =>
      toast({ title: "Could not save assumptions", description: cleanError(err.message), variant: "destructive" }),
  });

  // Submit each plan separately. Server re-calculates and creates linked
  // street + in-house proposals in one transaction for each service line.
  const applyPlan = useMutation({
    mutationFn: async () => {
      const currentPlans = plans ?? [];
      const submittablePlans = selectPlansForSubmission(currentPlans);
      if (submittablePlans.length === 0) {
        throw new Error("Calculate a plan before submitting proposals.");
      }
      if (hasChangedPlanAssumptions) {
        throw new Error("These results were calculated with different assumptions. Recalculate the plan before submitting it.");
      }
      const results = await Promise.all(
        submittablePlans.map(({ sl }) =>
          apiRequest("/api/inhouse-planning/apply", "POST", {
            locationId: scopeLocationId,
            serviceLine: sl,
            assumptions: assumptionsForLine(sl),
            tierPolicy: tierPolicyFor(sl),
          }).then((r) => r.json()),
        ),
      );
      return results;
    },
    onSuccess: (results: any[]) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inhouse-planning/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-rules"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/reference-data"], exact: false });
      const desc =
        results.length === 1
          ? `Plan v${results[0].version} and its linked rules were submitted for approval.`
          : `${results.length} plans and their linked rules were submitted for approval.`;
       toast({ title: "Proposals submitted", description: desc });
    },
    onError: (err: Error) =>
      toast({ title: "Could not submit proposals", description: cleanError(err.message), variant: "destructive" }),
  });

   // Fetch submitted and applied plan history; omit serviceLine filter when multiple are
  // selected so all lines' history shows in one list.
  const plansQuery = useQuery<{ plans: InhousePlanHistoryEntry[] }>({
    queryKey: ["/api/inhouse-planning/plans", scopeLocationId ?? "all", singleLine ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (singleLine) params.set("serviceLine", singleLine);
      if (scopeLocationId) params.set("locationId", scopeLocationId);
      const res = await fetch(`/api/inhouse-planning/plans?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const latestAnnualReportQuery = useQuery<{
    report: {
      id: string;
      generatedAt: string;
      scopeKey: string;
      locationId: string | null;
      plans?: unknown;
      tierGrid?: unknown;
    } | null;
  }>({
    queryKey: ["/api/inhouse-planning/annual-report-runs/latest", tierScopeKey],
    queryFn: async () => {
      const params = new URLSearchParams({ scopeKey: tierScopeKey });
      const res = await fetch(
        `/api/inhouse-planning/annual-report-runs/latest?${params}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    enabled: isAuthenticated,
    retry: false,
    // Portfolio fan-out runs in a bounded background queue. Keep checking a
    // selected campus so its newly generated report replaces an older snapshot
    // as soon as that campus finishes.
    refetchInterval: scopeLocationId === null ? false : 10_000,
  });

  // Calculations saved before tier grids were added to browser storage can
  // still recover the exact table from their saved Annual Report snapshot.
  // This applies to portfolio scopes as well as individual campuses.
  useEffect(() => {
    if (tierGrid) return;
    const report = latestAnnualReportQuery.data?.report;
    if (
      !report ||
      report.scopeKey !== tierScopeKey ||
      report.locationId !== scopeLocationId
    ) return;
    if (!report.tierGrid || typeof report.tierGrid !== "object") return;
    const saved = report.tierGrid as Partial<TierGridResult> & {
      skipped?: Array<{ sl?: string; serviceLine?: string; message: string }>;
    };
    if (!Array.isArray(saved.lines)) return;
    const reportPlans = Array.isArray(report.plans) ? report.plans : [];
    const hydratedLines = saved.lines.map((line) => {
      const currentPlan = line.currentPlan ??
        reportPlans.find((entry) =>
          isStoredPlan(entry) && entry.sl === line.serviceLine
        )?.plan;
      return currentPlan ? { ...line, currentPlan } : null;
    });
    if (hydratedLines.some((line) => line == null)) return;
    const inputSnapshot = Array.isArray(saved.inputSnapshot)
      ? saved.inputSnapshot
      : [];
    setTierGrid({
      lines: hydratedLines as TierGridLine[],
      skipped: (saved.skipped ?? []).map((entry) => ({
        sl: entry.sl ?? (entry as { serviceLine?: string }).serviceLine ?? "Service line",
        message: entry.message,
      })),
      identityKey: storageIdentityKey,
      planScopeKey: calculatedPlanKey ?? "",
      scopeKey: report.scopeKey,
      inputsKey: saved.inputsKey ??
        (inputSnapshot.length ? planningInputSnapshotKey(inputSnapshot) : tierInputsKey),
      inputSnapshot,
    });
  }, [
    calculatedPlanKey,
    latestAnnualReportQuery.data,
    scopeLocationId,
    storageIdentityKey,
    tierScopeKey,
    tierGrid,
    tierInputsKey,
  ]);

  /**
   * Portfolio campus reports are generated server-side after the portfolio
   * request returns. When the operator later filters to a campus, restore that
   * campus's saved compact result rather than slicing the portfolio resident
   * array and labelling its totals as campus metrics.
   */
  useEffect(() => {
    const report = latestAnnualReportQuery.data?.report;
    if (scopeLocationId === null || !report) return;
    // Wait for live scope resolution before restoring historical results. The
    // report may describe the calculation, but it must never write its captured
    // inputs into the editor: current campus assumptions win when present, and
    // current portfolio assumptions are the fallback when they are not.
    if (!assumptionsQuery.isSuccess) return;
    if (
      report.scopeKey !== tierScopeKey ||
      report.locationId !== scopeLocationId ||
      !Array.isArray(report.plans)
    ) return;
    // Saving the current calculation creates a report with a newer timestamp
    // than the calculation. It is still the same result, not a newer result to
    // restore; restoring it would advance lastRunAt and trigger another save.
    if (plans && tierGrid?.scopeKey === report.scopeKey) return;
    const reportTime = Date.parse(report.generatedAt || "");
    const currentTime = Date.parse(lastRunAt || "");
    if (plans && Number.isFinite(currentTime) && (!Number.isFinite(reportTime) || currentTime >= reportTime)) {
      return;
    }
    const restored = report.plans.flatMap((value): PlanWithSl[] => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as { sl?: unknown; plan?: unknown };
      const plan = candidate.plan as Partial<PlanResult> | undefined;
      if (
        typeof candidate.sl !== "string" ||
        !plan ||
        !plan.scope ||
        !plan.assumptions ||
        !plan.summary
      ) {
        return [];
      }
      return [{
        sl: candidate.sl,
        plan: hydrateAnnualReportPlanSnapshot(
          plan as unknown as AnnualReportPlanSnapshot,
        ) as unknown as PlanResult,
      }];
    });
    const selected = restored.filter(({ sl }) => serviceLines.includes(sl));
    if (selected.length === 0) return;
    restoredAnnualReport.current = true;
    setPlans(selected);
    setLastRunAt(report.generatedAt || null);
    setRestoredPlanDetailsOmitted(true);
    setCalculatedInputsKey(null);
    const inputSnapshot =
      report.tierGrid &&
      typeof report.tierGrid === "object" &&
      Array.isArray((report.tierGrid as { inputSnapshot?: unknown }).inputSnapshot)
        ? (report.tierGrid as { inputSnapshot: PlanningInputSnapshotEntry[] }).inputSnapshot
        : null;
    const savedTierGrid =
      report.tierGrid && typeof report.tierGrid === "object"
        ? report.tierGrid as Partial<TierGridResult> & {
            skipped?: Array<{ sl?: string; serviceLine?: string; message: string }>;
          }
        : null;
    if (
      savedTierGrid &&
      Array.isArray(savedTierGrid.lines)
    ) {
      const hydratedLines = savedTierGrid.lines.map((line) => {
        const currentPlan = line.currentPlan ??
          restored.find(({ sl }) => sl === line.serviceLine)?.plan;
        return currentPlan ? { ...line, currentPlan } : null;
      });
      if (hydratedLines.some((line) => line == null)) return;
      setTierGrid({
        lines: hydratedLines as TierGridLine[],
        skipped: (savedTierGrid.skipped ?? []).map((entry) => ({
          sl: entry.sl ?? (entry as { serviceLine?: string }).serviceLine ?? "Service line",
          message: entry.message,
        })),
        identityKey: storageIdentityKey,
        planScopeKey: calculatedPlanKey ?? "",
        scopeKey: report.scopeKey,
        inputsKey: inputSnapshot ? planningInputSnapshotKey(inputSnapshot) : "",
        inputSnapshot: inputSnapshot ?? [],
      });
    }
    const first = selected.find((entry) => entry.plan.feasible) ?? selected[0];
    setExpandedQuarter(first?.plan.bindingQuarterLabel
      ? `${first.sl}-${first.plan.bindingQuarterLabel}`
      : null);
  }, [
    latestAnnualReportQuery.data,
    assumptionsQuery.isSuccess,
    lastRunAt,
    plans,
    calculatedPlanKey,
    storageIdentityKey,
    scopeLocationId,
    serviceLines,
    tierScopeKey,
  ]);

  const removePlan = useMutation({
    mutationFn: async (planId: string) =>
      apiRequest(`/api/inhouse-planning/plans/${encodeURIComponent(planId)}/remove`, "POST"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inhouse-planning/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-rules"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/reference-data"], exact: false });
      toast({
        title: "Plan removed",
        description: "The plan no longer appears as an active plan in Reference Data. Its history was retained.",
      });
    },
    onError: (err: Error) =>
      toast({ title: "Could not remove plan", description: cleanError(err.message), variant: "destructive" }),
  });

  function update<K extends keyof PlanningAssumptions>(key: K, value: PlanningAssumptions[K]) {
    setAssumptionsTouched(true);
    setAssumptions((prev) => ({ ...prev, [key]: value }));
  }

  function updatePerLine(sl: string, field: "rateGrowthTargetPct" | "annualTurnoverPct", value: number) {
    setAssumptionsTouched(true);
    // This is called once when the number input commits, not on every
    // keystroke. Keep the state write synchronous: Save assumptions may be
    // clicked immediately after the input blurs, and a deferred transition
    // could otherwise serialize the previous target.
    setPerLineTargets((prev) => ({
      ...prev,
      [sl]: {
        rateGrowthTargetPct: prev[sl]?.rateGrowthTargetPct ?? assumptions.rateGrowthTargetPct,
        annualTurnoverPct: prev[sl]?.annualTurnoverPct ?? assumptions.annualTurnoverPct,
        [field]: value,
      },
    }));
  }

  /** Merge shared assumptions with a service line's per-line overrides. */
  function assumptionsForLine(sl: string): PlanningAssumptions {
    const overrides = perLineTargets[sl];
    if (!overrides) return assumptions;
    return { ...assumptions, ...overrides };
  }

  function currentCalculateRequest(): CalculateRequest {
    const selectedLines = [...serviceLines];
    return {
      identityKey: storageIdentityKey,
      locationId: scopeLocationId,
      serviceLines: selectedLines,
      assumptionsByLine: Object.fromEntries(
        selectedLines.map((sl) => [sl, { ...assumptionsForLine(sl) }]),
      ),
    };
  }

  function calculatePlanAndTiers() {
    calculateTiers.mutate();
  }

  function tierPolicyFor(sl: string): OccupancyTierPolicy {
    return tierPolicies[sl] ?? defaultOccupancyTierPolicy();
  }

  /**
   * Single writer for a tier policy. Marks the line as edited and stamps the
   * current campus in the same update, so an edit can never be recorded
   * against one campus and then read under another.
   */
  function editTierPolicy(sl: string, change: (base: OccupancyTierPolicy) => OccupancyTierPolicy) {
    // The inputs are disabled until the line loads; this refuses the edit
    // outright so no path can build one on top of a default policy and then
    // have the real one skipped as "already edited".
    if (!tierLineLoaded(sl)) return;
    setAssumptionsTouched(true);
    setTierState((prev) => {
      if (prev.scopeKey !== policyScopeKey || !prev.loaded[sl]) return prev;
      return {
        ...prev,
        policies: {
          ...prev.policies,
          [sl]: change(prev.policies[sl] ?? defaultOccupancyTierPolicy()),
        },
        edited: { ...prev.edited, [sl]: true },
      };
    });
  }

  function updateTierCutoff(sl: string, key: "lowCutoffPct" | "highCutoffPct", value: number) {
    editTierPolicy(sl, (base) => {
      const next: OccupancyTierPolicy = { ...base, [key]: value };
      // Push the other cutoff rather than allowing them to cross. A crossed
      // pair makes the middle tier unreachable, and the row would still show
      // three editable tiers while one of them could never apply.
      if (next.lowCutoffPct > next.highCutoffPct) {
        if (key === "lowCutoffPct") next.highCutoffPct = value;
        else next.lowCutoffPct = value;
      }
      return next;
    });
  }

  function updateTierGuardrail<K extends keyof OccupancyTierGuardrails>(
    sl: string,
    tier: OccupancyTierId,
    field: K,
    value: OccupancyTierGuardrails[K],
  ) {
    editTierPolicy(sl, (base) => ({
      ...base,
      tiers: { ...base.tiers, [tier]: { ...base.tiers[tier], [field]: value } },
    }));
  }

  // The tier run snapshots the exact raw policies and assumptions before the
  // request starts. Compare against that snapshot rather than the normalized
  // assumptions returned by the solver, which can contain resolved dates and
  // tier guardrails and therefore look changed even when the operator touched
  // nothing.
  const hasChangedPlanAssumptions =
    !!plans?.length &&
    ((tierGrid?.inputSnapshot
      ? planningInputSnapshotKey(tierGrid.inputSnapshot)
      : calculatedInputsKey) !== tierInputsKey);

  const rangeError =
    !assumptions.streetRateEffectiveDate || !assumptions.inhouseEffectiveDate
      ? "Choose both effective dates before calculating or saving assumptions."
      : assumptions.minInhouseIncreasePct > assumptions.maxInhouseIncreasePct
      ? "The minimum increase cannot be larger than the maximum."
      : assumptions.minStreetIncreasePct > assumptions.maxStreetIncreasePct
        ? "The minimum Street Rate increase cannot be larger than the maximum."
      : null;

  // Combine residents from all plans, tagging each with its service line.
  const allTaggedResidents: TaggedResident[] = useMemo(
    () => (plans ?? []).flatMap(({ sl, plan }) => plan.residents.map((r) => ({ ...r, _sl: sl }))),
    [plans],
  );

  const residentIncreaseCharts = useMemo(() => {
    const countsBySl = new Map<string, Record<ResidentIncreaseTierLabel, number>>();
    for (const resident of allTaggedResidents) {
      const counts = countsBySl.get(resident._sl) ?? residentIncreaseTierCounts([]);
      counts[residentIncreaseTier(resident.increasePct)] += 1;
      countsBySl.set(resident._sl, counts);
    }
    const populatedIndexes = RESIDENT_INCREASE_TIER_LABELS
      .map((tier, index) => ({
        index,
        populated: [...countsBySl.values()].some((counts) => counts[tier] > 0),
      }))
      .filter(({ populated }) => populated)
      .map(({ index }) => index);
    const firstVisibleIndex = populatedIndexes.length ? Math.min(...populatedIndexes) : 0;
    const lastPopulatedIndex = populatedIndexes.length
      ? Math.max(...populatedIndexes)
      : RESIDENT_INCREASE_TIER_LABELS.length - 1;
    const configuredMaxPct = Math.max(
      ...(plans ?? []).map(({ plan }) => plan.assumptions.maxInhouseIncreasePct),
      0,
    );
    const configuredMaxIndex = RESIDENT_INCREASE_TIER_LABELS.reduce(
      (lastIndex, tier, index) => {
        const tierPct = tier === "<3%" ? 0 : Number.parseFloat(tier);
        return tierPct <= configuredMaxPct + 1e-9 ? index : lastIndex;
      },
      0,
    );
    const lastVisibleIndex = Math.max(lastPopulatedIndex, configuredMaxIndex);
    // Keep empty intermediate buckets so the horizontal scale represents the
    // actual range rather than jumping from the first populated bar to 9%+.
    const visibleTiers = RESIDENT_INCREASE_TIER_LABELS.slice(
      firstVisibleIndex,
      lastVisibleIndex + 1,
    );
    return (plans ?? []).map(({ sl, plan }) => {
      const increaseValues = plan.residents
        .map((resident) => resident.increasePct)
        .filter(Number.isFinite);
      const uniformIncrease =
        increaseValues.length > 1 &&
        Math.max(...increaseValues) - Math.min(...increaseValues) < 1e-6;
      const summaryMin = plan.summary?.minIncreasePct ?? Math.min(...increaseValues);
      const summaryMax = plan.summary?.maxIncreasePct ?? Math.max(...increaseValues);
      const pinnedToMinimum =
        Math.abs(summaryMin - plan.assumptions.minInhouseIncreasePct) < 1e-6;
      const pinnedToMaximum =
        Math.abs(summaryMax - plan.assumptions.maxInhouseIncreasePct) < 1e-6;
      const highTierPinned =
        plan.assumptions.equalizationStrength === "high" &&
        (pinnedToMinimum || pinnedToMaximum);
      return {
        sl,
        data: visibleTiers.map((tier) => ({
          tier,
          residents: countsBySl.get(sl)?.[tier] ?? 0,
        })),
        uniformReason:
          uniformIncrease && highTierPinned && pinnedToMaximum
            ? `High equalization is selected, but the growth target is using the full ${formatPct(plan.assumptions.maxInhouseIncreasePct, 1)} tier maximum. Raise this tier maximum to create a spread.`
            : uniformIncrease && highTierPinned
              ? `High equalization is selected, but the growth target is pinned to the ${formatPct(plan.assumptions.minInhouseIncreasePct, 1)} tier minimum. Lower the minimum or raise the target to create a spread.`
            : null,
      };
    });
  }, [allTaggedResidents, plans]);

  const sortedResidents = useMemo(() => {
    const filtered = heldBackOnly
      ? allTaggedResidents.filter((r) =>
          r.constraint === "max" ||
          r.constraint === "street_cap" ||
          r.constraint === "at_or_above_street",
        )
      : constrainedOnly
        ? allTaggedResidents.filter((r) => r.constraint !== "none")
        : allTaggedResidents;
    const pick = (r: TaggedResident): string | number => {
      switch (sortKey) {
        case "location": return r.location;
        case "roomNumber": return r.roomNumber;
        case "currentRate": return r.currentRateMonthly;
        case "streetRate": return r.streetRateMonthly;
        case "gap": return r.gapToStreetPct;
        case "increaseDollars": return r.increaseDollarsMonthly;
        case "increasePct": default: return r.increasePct;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = pick(a), bv = pick(b);
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv) : Number(av) - Number(bv);
      return sortDesc ? -cmp : cmp;
    });
  }, [allTaggedResidents, sortKey, sortDesc, constrainedOnly, heldBackOnly]);

  useEffect(() => {
    if (!heldBackOnly || allTaggedResidents.length === 0) return;
    requestAnimationFrame(() => {
      document.getElementById("resident-recommendations")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [heldBackOnly, allTaggedResidents.length]);

  function showHeldBackResidents() {
    setHeldBackOnly(true);
    setConstrainedOnly(false);
    setVisibleCount(50);
    if (restoredPlanDetailsOmitted || allTaggedResidents.length === 0) {
      toast({
        title: "Loading resident details",
        description: "Refreshing this calculation so the held-back residents and their reasons can be shown.",
      });
      calculatePlanAndTiers();
      return;
    }
    requestAnimationFrame(() => {
      document.getElementById("resident-recommendations")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) { setSortDesc((d) => !d); }
    else { setSortKey(key); setSortDesc(true); }
    setVisibleCount(50);
  }

  // When all selected plans share the same rate basis we can show a unit in
  // column headers; with a mix we omit it (each row shows its own basis).
  const sharedBasis = plans && plans.length > 0 && plans.every((p) => p.plan.rateBasis === plans[0].plan.rateBasis)
    ? plans[0].plan.rateBasis : null;
  const unit = sharedBasis === "daily" ? "/day" : sharedBasis === "monthly" ? "/mo" : "";

  // Aggregate summary across all plans.
  const combinedSummary = useMemo(() => {
    if (!plans || plans.length === 0) return null;
    let totalResidents = 0, receivingIncrease = 0, blockedByStreet = 0, atMax = 0;
    let totalMonthly = 0, totalAnnual = 0, totalRevAdded = 0, totalCurrentRev = 0;
    for (const { plan } of plans) {
      const s = plan.summary;
      totalResidents += s.residentCount;
      receivingIncrease += s.residentsReceivingIncrease;
      blockedByStreet += s.residentsBlockedByStreet;
      atMax += s.residentsAtMax;
      totalMonthly += s.totalMonthlyIncreaseDollars;
      totalAnnual += s.totalAnnualIncreaseDollars;
      totalRevAdded += s.totalMonthlyIncreaseDollars;
      if (s.weightedAvgIncreasePct > 0)
        totalCurrentRev += s.totalMonthlyIncreaseDollars / s.weightedAvgIncreasePct;
    }
    return {
      residentCount: totalResidents,
      residentsReceivingIncrease: receivingIncrease,
      residentsBlockedByStreet: blockedByStreet,
      residentsAtMax: atMax,
      totalMonthlyIncreaseDollars: totalMonthly,
      totalAnnualIncreaseDollars: totalAnnual,
      weightedAvgIncreasePct: totalCurrentRev > 0 ? totalRevAdded / totalCurrentRev : 0,
    };
  }, [plans]);

  const growthSnapshot = useMemo(() => {
    if (!plans || plans.length === 0) return null;
    let residents = 0;
    let streetCurrentMonthly = 0;
    let streetRecommendedMonthly = 0;
    let inhouseCurrentMonthly = 0;
    let inhouseNewMonthly = 0;
    let adjustedTopCompCurrentMonthly = 0;
    let adjustedTopCompProjectedMonthly = 0;
    let streetAfterForCompMonthly = 0;
    let adjustedTopCompResidents = 0;
    let priorFullYearMonthly = 0;
    let projectedFullYearMonthly = 0;
    let quarterlyGoalWeighted = 0;
    let quarterlyYoyWeighted = 0;
    let measuredResidents = 0;
    let quartersMeetingGoal = 0;
    let projectedQuarterCount = 0;
    // Resident-weighted YoY per calendar quarter, so the combined row can show
    // the same quarter-by-quarter detail as each service line.
    const quarterTotals = new Map<
      string,
      {
        year: number;
        quarter: number;
        weighted: number;
        goalWeighted: number;
        residents: number;
        unavailableLabel?: string;
        unavailableExplanation?: string;
      }
    >();
    for (const { plan } of plans) {
      const count = plan.summary.residentCount;
      const fullYearYoy = fullYearYoyFromQuarters(plan.quarters, plan.rateBasis);
      const quarterDisplays = plan.quarters.map((quarter) =>
        getQuarterYoyDisplay(quarterYoyDisplayInput(quarter)),
      );
      const quarterlyYoySummary = summarizeQuarterYoy(
        plan.quarters.map(quarterYoyDisplayInput),
      );
      residents += count;
      streetCurrentMonthly += plan.currentStreetRateMonthly * count;
      streetRecommendedMonthly += plan.recommendedStreetRateMonthly * count;
      inhouseCurrentMonthly += plan.summary.currentAvgInhouseRateMonthly * count;
      inhouseNewMonthly += plan.summary.newAvgInhouseRateMonthly * count;
      if (
        plan.adjustedTopCompetitorRateMonthly != null &&
        plan.adjustedTopCompetitorRateMonthly > 0
      ) {
        adjustedTopCompCurrentMonthly += plan.adjustedTopCompetitorRateMonthly * count;
        adjustedTopCompProjectedMonthly +=
          plan.adjustedTopCompetitorRateMonthly * (1 + plan.streetIncreasePct / 100) * count;
        streetAfterForCompMonthly += plan.recommendedStreetRateMonthly * count;
        adjustedTopCompResidents += count;
      }
      priorFullYearMonthly += fullYearYoy.priorRateMonthly * count;
      projectedFullYearMonthly += fullYearYoy.projectedRateMonthly * count;
      if (quarterlyYoySummary.measuredQuarterCount > 0) {
        measuredResidents += count;
        quarterlyGoalWeighted += plan.assumptions.rateGrowthTargetPct * count;
        quarterlyYoyWeighted += quarterlyYoySummary.averagePct * count;
      }
      quartersMeetingGoal += plan.quarters.filter(
        (quarter, index) => quarterDisplays[index].yoyPct != null && quarter.passes,
      ).length;
      projectedQuarterCount += plan.quarters.length;
      for (const quarter of plan.quarters) {
        const key = `${quarter.year}-Q${quarter.quarter}`;
        const bucket = quarterTotals.get(key) ?? {
          year: quarter.year,
          quarter: quarter.quarter,
          weighted: 0,
          goalWeighted: 0,
          residents: 0,
        };
        quarterTotals.set(key, bucket);
        // A quarter with no prior-year realized rate is untestable: the solver
        // scores it 0% and passing, so weighting it in would drag the combined
        // number toward a number nobody measured.
        const display = getQuarterYoyDisplay(quarterYoyDisplayInput(quarter));
        const yoyPct = display.yoyPct;
        if (yoyPct == null) {
          if (display.unavailableLabel && !bucket.unavailableLabel) {
            bucket.unavailableLabel = display.unavailableLabel;
            bucket.unavailableExplanation = display.unavailableExplanation;
          }
          continue;
        }
        bucket.weighted += yoyPct * count;
        bucket.goalWeighted += plan.assumptions.rateGrowthTargetPct * count;
        bucket.residents += count;
      }
    }
    const orderedQuarters = Array.from(quarterTotals.entries()).sort(
      ([, a], [, b]) => a.year - b.year || a.quarter - b.quarter,
    );
    const quarterLabels = formatQuarterLabels(orderedQuarters.map(([, q]) => q));
    return {
      residents,
      streetCurrentMonthly,
      streetRecommendedMonthly,
      streetGrowthPct: streetCurrentMonthly > 0
        ? (streetRecommendedMonthly / streetCurrentMonthly - 1) * 100
        : 0,
      inhouseCurrentMonthly,
      inhouseNewMonthly,
      inhouseGrowthPct: inhouseCurrentMonthly > 0
        ? (inhouseNewMonthly / inhouseCurrentMonthly - 1) * 100
        : 0,
      adjustedTopCompCurrentMonthly: adjustedTopCompResidents > 0
        ? adjustedTopCompCurrentMonthly / adjustedTopCompResidents
        : null,
      adjustedTopCompProjectedMonthly: adjustedTopCompResidents > 0
        ? adjustedTopCompProjectedMonthly / adjustedTopCompResidents
        : null,
      streetAfterForCompMonthly: adjustedTopCompResidents > 0
        ? streetAfterForCompMonthly / adjustedTopCompResidents
        : null,
      adjustedTopCompVariancePct:
        adjustedTopCompProjectedMonthly > 0
          ? (streetAfterForCompMonthly / adjustedTopCompProjectedMonthly - 1) * 100
          : null,
      fullYearYoyPct: priorFullYearMonthly > 0
        ? (projectedFullYearMonthly / priorFullYearMonthly - 1) * 100
        : 0,
      quarterlyGoalPct: measuredResidents > 0 ? quarterlyGoalWeighted / measuredResidents : 0,
      averageQuarterlyYoyPct: measuredResidents > 0 ? quarterlyYoyWeighted / measuredResidents : 0,
      quartersMeetingGoal,
      projectedQuarterCount,
      quarterlyBreakdown: orderedQuarters.map(([key, bucket], index) => {
        const measurable = bucket.residents > 0;
        const yoyPct = measurable ? bucket.weighted / bucket.residents : null;
        const goalPct = measurable ? bucket.goalWeighted / bucket.residents : 0;
        return {
          key,
          label: quarterLabels[index],
          yoyPct,
          unavailableLabel: bucket.unavailableLabel,
          unavailableExplanation: bucket.unavailableExplanation,
          // Colour the weighted number against the weighted goal, so it always
          // describes the value shown rather than a per-line pass tally.
          passes: yoyPct != null && yoyPct >= goalPct - 1e-6,
        };
      }),
    };
  }, [plans]);

  const allFeasible = plans ? plans.every((p) => p.plan.feasible) : false;
  const allWarnings = plans ? Array.from(new Set(plans.flatMap((p) => p.plan.warnings))) : [];
  const quarterlyComparisonPeriods = plans?.[0]?.plan.quarters
    .map(({ quarter, year }) => `Q${quarter} ${year} vs Q${quarter} ${year - 1}`)
    .join("; ") || "each projected quarter versus the same quarter one year earlier";

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-1 text-center">
        <div className="flex justify-start">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation(fromReferenceData ? referenceDataUrl() : "/overview")}
            data-testid="button-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {fromReferenceData ? "Back to Reference Data" : "Back"}
          </Button>
        </div>
        <h1 className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight">
          <TrendingUp className="h-6 w-6 text-primary" />
          In-House Rate Planning
        </h1>
        <p className="mx-auto max-w-3xl text-sm text-muted-foreground">
          Set a growth goal and see the rates required to reach it.
        </p>
      </header>

      {/* ── Scope ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className={cn("pb-3", expandedSections.scope && "border-b")}>
          <button
            type="button"
            className="flex w-full items-start justify-between gap-4 text-left"
            onClick={() => toggleSection("scope")}
            aria-expanded={expandedSections.scope}
            aria-controls="inhouse-scope-content"
            data-testid="button-toggle-inhouse-scope"
          >
            <div>
              <CardTitle className="text-base">Scope</CardTitle>
              <CardDescription>
                Choose the campuses and service lines included in the plan.
              </CardDescription>
            </div>
            {expandedSections.scope
              ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
          </button>
        </CardHeader>
        {expandedSections.scope && <CardContent id="inhouse-scope-content" className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Campus</Label>
            <Select
              value={locationId}
              onValueChange={(v) => {
                setLocationId(v);
                setAssumptionsTouched(false);
                setPlans(null);
              }}
            >
              <SelectTrigger className="h-9" data-testid="select-campus">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_CAMPUSES}>All campuses</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ── Multi-select service line ── */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Service line</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  data-testid="select-service-line"
                  className="h-9 w-full justify-between font-normal"
                >
                  <span className="truncate">
                    {serviceLines.length === SERVICE_LINES.length
                      ? "All service lines"
                      : serviceLines.length === 1
                      ? serviceLines[0]
                      : `${serviceLines.length} selected`}
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2" align="start">
                <div className="space-y-1">
                  {/* Select all / clear all */}
                  <button
                    className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
                    onClick={() =>
                      serviceLines.length === SERVICE_LINES.length
                        ? setServiceLines([SERVICE_LINES[0]])
                        : setServiceLines([...SERVICE_LINES])
                    }
                  >
                    {serviceLines.length === SERVICE_LINES.length ? "Deselect all" : "Select all"}
                  </button>
                  <div className="border-t pt-1">
                    {SERVICE_LINES.map((sl) => (
                      <label
                        key={sl}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted"
                      >
                        <Checkbox
                          checked={serviceLines.includes(sl)}
                          onCheckedChange={() => toggleServiceLine(sl)}
                          className="h-3.5 w-3.5"
                        />
                        <span className="text-sm">{sl}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
            {/* Selected line badges */}
            {serviceLines.length < SERVICE_LINES.length && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {serviceLines.map((sl) => (
                  <Badge key={sl} variant="secondary" className="gap-1 text-[11px]">
                    {sl}
                    <button
                      className="ml-0.5 rounded hover:text-destructive"
                      onClick={() => toggleServiceLine(sl)}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-end text-xs text-muted-foreground sm:col-span-2">
            {assumptionsQuery.data && (
              <p>
                Showing{" "}
                <span className="font-medium text-foreground">
                  {SCOPE_LEVEL_LABEL[assumptionsQuery.data.scopeLevel] ?? "saved assumptions"}
                </span>
                {serviceLines.length > 1
                  ? ` (from ${firstLine}). Saving writes to all ${serviceLines.length} selected lines.`
                  : ". Saving writes to the scope selected above."}
              </p>
            )}
          </div>
        </CardContent>}
      </Card>

      {/* ── Assumptions ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className={cn("pb-3", expandedSections.assumptions && "border-b")}>
          <button
            type="button"
            className="flex w-full items-start justify-between gap-4 text-left"
            onClick={() => toggleSection("assumptions")}
            aria-expanded={expandedSections.assumptions}
            aria-controls="inhouse-assumptions-content"
            data-testid="button-toggle-inhouse-assumptions"
          >
            <div>
              <CardTitle className="text-base">Assumptions</CardTitle>
              <CardDescription>
                Growth targets, turnover, effective dates, and occupancy-tier guardrails.
              </CardDescription>
            </div>
            {expandedSections.assumptions
              ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
          </button>
        </CardHeader>
        {expandedSections.assumptions && <CardContent id="inhouse-assumptions-content" className="space-y-5 pt-4">
          {/* Rate growth target + Annual turnover: per-line when multiple SLs selected */}
          {serviceLines.length > 1 ? (
            <div className="space-y-2">
              <div className="grid grid-cols-[5rem_minmax(8rem,12rem)_minmax(20rem,1fr)] gap-x-4 gap-y-0.5 text-xs font-medium text-muted-foreground">
                <HeaderHelp
                  label="Service line"
                  explanation="The level of care being planned. Each selected service line is calculated independently using its own rates, residents, turnover, and competitive benchmark."
                />
                <HeaderHelp
                  label="Rate growth target"
                  explanation="The year-over-year realized-rate goal for each quarter. Street Rate aims at this target, while resident increases solve the remaining gap."
                />
                <HeaderHelp
                  label="Annual turnover"
                  explanation="The estimated percentage of occupied units replaced by new move-ins over one year. Turnover determines how quickly residents paying the proposed Street Rate affect projected realized-rate growth."
                />
              </div>
              {serviceLines.map((sl) => {
                const vals = perLineTargets[sl] ?? {
                  rateGrowthTargetPct: assumptions.rateGrowthTargetPct,
                  annualTurnoverPct: assumptions.annualTurnoverPct,
                };
                const hist = turnoverBySl.get(sl);
                return (
                  <div key={sl} className="grid grid-cols-[5rem_minmax(8rem,12rem)_minmax(20rem,1fr)] items-baseline gap-x-4">
                    <span className="pt-1.5 text-sm font-medium">{sl}</span>
                    <div className="flex items-center gap-1">
                      <CommitNumberInput
                        className="h-8 text-sm"
                        value={vals.rateGrowthTargetPct}
                        onCommit={(value) => updatePerLine(sl, "rateGrowthTargetPct", value)}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <CommitNumberInput
                          className="h-8 text-sm"
                          min={MODEL_MIN_TURNOVER_PCT}
                          max={MODEL_MAX_TURNOVER_PCT}
                          value={vals.annualTurnoverPct}
                          onCommit={(value) => updatePerLine(sl, "annualTurnoverPct", value)}
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                      <TurnoverEvidence
                        serviceLine={sl}
                        hist={hist}
                        applied={vals.annualTurnoverPct}
                        saved={savedTurnoverPct}
                        loading={turnoverQuery.isPending && !turnoverQuery.data}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /*
             * Bound to perLineTargets, exactly like the multi-line branch.
             *
             * These two fields must NOT bind to `assumptions`: the solver reads
             * them back through assumptionsForLine(), which prefers
             * perLineTargets[sl] whenever it exists — and seeding always
             * populates it for every selected line. Binding to `assumptions`
             * here made the field inert, typing into it changed nothing the
             * solver saw. It was invisible only while the seed happened to
             * equal the shared value; per-line defaults made the two diverge.
             */
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                testId="input-growth-target"
                label="Rate growth target"
                value={assumptionsForLine(firstLine).rateGrowthTargetPct}
                onChange={(v) => updatePerLine(firstLine, "rateGrowthTargetPct", v)}
                suffix="%"
                hint="Year-over-year realized rate growth, measured every quarter."
              />
              <div>
                <NumberField
                  testId="input-turnover"
                  label="Annual turnover"
                  value={assumptionsForLine(firstLine).annualTurnoverPct}
                  onChange={(v) => updatePerLine(firstLine, "annualTurnoverPct", v)}
                  suffix="%"
                  min={MODEL_MIN_TURNOVER_PCT}
                  max={MODEL_MAX_TURNOVER_PCT}
                  hint="Move-outs replaced at street rate; higher turnover lifts the realized rate on its own."
                />
                <TurnoverEvidence
                  serviceLine={firstLine}
                  hist={turnoverBySl.get(firstLine)}
                  applied={assumptionsForLine(firstLine).annualTurnoverPct}
                  saved={savedTurnoverPct}
                  loading={turnoverQuery.isPending && !turnoverQuery.data}
                />
              </div>
            </div>
          )}

          {/* Applies to both branches: one service line is measured the same way as six. */}
          {turnoverQuery.data?.windowEnd && (
            <p className="text-xs text-muted-foreground">
              Turnover measured from private-pay move-outs over the{" "}
              {turnoverQuery.data.monthsInWindow} months to{" "}
              {formatMonth(turnoverQuery.data.windowEnd)}. Only residents whose rate we set are
              counted — Medicare, Medicaid and Managed Care are priced externally, so replacing
              one does not move revenue.
            </p>
          )}

          {/* ── Occupancy tiers ──────────────────────────────────────────── */}
          <div className="space-y-2 rounded-md border p-3">
            <div>
              <p className="text-sm font-medium">Occupancy tiers</p>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Each service line sets its own two cutoffs and one set of guardrails per tier — a
                villa and a skilled-nursing wing are not full at the same number. Effective dates,
                the growth target and turnover stay shared: a tier changes how hard the solver may
                push, never the period it is measured over.
              </p>
            </div>

            <Accordion type="multiple" className="rounded-md border" data-testid="assumption-tier-accordion">
              {OCCUPANCY_TIER_IDS.map((tier) => (
                <AccordionItem key={tier} value={tier} className="last:border-b-0">
                  <AccordionTrigger
                    className="px-3 py-2.5 hover:no-underline"
                    data-testid={`button-toggle-assumption-tier-${tier}`}
                  >
                    <div className="flex flex-1 items-center justify-between gap-4 pr-3 text-left">
                      <div>
                        <p className="text-sm font-semibold">{OCCUPANCY_TIER_LABELS[tier]}</p>
                        <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                          {tier === "low"
                            ? "Lower occupancy · conservative pricing guardrails"
                            : tier === "target"
                              ? "Target occupancy · balanced pricing guardrails"
                              : "Higher occupancy · strongest pricing opportunity"}
                        </p>
                      </div>
                      <span className="shrink-0 text-[11px] font-normal text-muted-foreground">
                        {serviceLines.length} service {serviceLines.length === 1 ? "line" : "lines"}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-0">
                    <div className="overflow-x-auto border-t">
                      <div className="min-w-[46rem] px-3 py-2">
                        <div
                          className={cn(
                            TIER_GRID_COLS,
                            "items-end border-b pb-1 text-[11px] font-medium text-muted-foreground",
                          )}
                        >
                          <span>Service line</span>
                          <span>Tier</span>
                          <HeaderHelp
                            label="Occupancy"
                            explanation="The measured occupancy range this tier governs. Set the lower cutoff on the Low tier and the upper cutoff on the High tier; the Target range between them follows automatically."
                          />
                          <HeaderHelp
                            label="In-house min / max"
                            explanation="The smallest and largest increase any individual resident may receive under this tier."
                          />
                          <HeaderHelp
                            label="Street min / max"
                            explanation="The bounds on the recommended Street Rate increase under this tier."
                          />
                          <HeaderHelp
                            label="Max YoY"
                            explanation="Ceiling on the Street Rate increase measured year over year, independent of the per-cycle maximum."
                          />
                          <HeaderHelp
                            label="vs Top comp"
                            explanation="Where the Street Rate should sit against the care-adjusted Top Competitor benchmark. Negative prices below the competitor, positive above."
                          />
                          <HeaderHelp
                            label="Equalization"
                            explanation="How much more the residents furthest below street rate get than those closest to it."
                          />
                        </div>

                        {serviceLines.map((sl) => {
                          const policy = tierPolicyFor(sl);
                          const lineDisabled = !tierLineLoaded(sl);
                          const g = policy.tiers[tier];
                          return (
                            <div
                              key={sl}
                              className={cn(TIER_GRID_COLS, "items-center border-b py-1 last:border-b-0")}
                              data-testid={`tier-row-${sl}-${tier}`}
                            >
                              <span className="truncate text-xs font-medium">{sl}</span>
                              <span className="text-xs text-muted-foreground">
                                {OCCUPANCY_TIER_LABELS[tier]}
                              </span>

                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                {tier === "low" && (
                                  <>
                                    <span>&lt;</span>
                                    <TierInput
                                      disabled={lineDisabled}
                                      value={policy.lowCutoffPct}
                                      min={0}
                                      max={100}
                                      onCommit={(v) => updateTierCutoff(sl, "lowCutoffPct", v)}
                                      testId={`tier-cutoff-low-${sl}`}
                                    />
                                  </>
                                )}
                                {tier === "target" && (
                                  <span className="tabular-nums">
                                    {policy.lowCutoffPct}–{policy.highCutoffPct}%
                                  </span>
                                )}
                                {tier === "high" && (
                                  <>
                                    <span>≥</span>
                                    <TierInput
                                      disabled={lineDisabled}
                                      value={policy.highCutoffPct}
                                      min={0}
                                      max={100}
                                      onCommit={(v) => updateTierCutoff(sl, "highCutoffPct", v)}
                                      testId={`tier-cutoff-high-${sl}`}
                                    />
                                  </>
                                )}
                              </div>

                              <div className="flex items-center gap-1">
                                <TierInput
                                  disabled={lineDisabled}
                                  value={g.minInhouseIncreasePct}
                                  min={0}
                                  max={100}
                                  onCommit={(v) => updateTierGuardrail(sl, tier, "minInhouseIncreasePct", v)}
                                />
                                <span className="text-[11px] text-muted-foreground">–</span>
                                <TierInput
                                  disabled={lineDisabled}
                                  value={g.maxInhouseIncreasePct}
                                  min={0}
                                  max={100}
                                  onCommit={(v) => updateTierGuardrail(sl, tier, "maxInhouseIncreasePct", v)}
                                />
                              </div>

                              <div className="flex items-center gap-1">
                                <TierInput
                                  disabled={lineDisabled}
                                  value={g.minStreetIncreasePct}
                                  min={0}
                                  max={100}
                                  onCommit={(v) => updateTierGuardrail(sl, tier, "minStreetIncreasePct", v)}
                                />
                                <span className="text-[11px] text-muted-foreground">–</span>
                                <TierInput
                                  disabled={lineDisabled}
                                  value={g.maxStreetIncreasePct}
                                  min={0}
                                  max={100}
                                  onCommit={(v) => updateTierGuardrail(sl, tier, "maxStreetIncreasePct", v)}
                                />
                              </div>

                              <TierInput
                                disabled={lineDisabled}
                                value={g.maxYoYStreetIncreasePct}
                                min={0}
                                max={100}
                                onCommit={(v) => updateTierGuardrail(sl, tier, "maxYoYStreetIncreasePct", v)}
                              />

                              <TierInput
                                disabled={lineDisabled}
                                value={g.desiredVarianceToTopCompetitorPct}
                                min={-100}
                                max={100}
                                onCommit={(v) => updateTierGuardrail(sl, tier, "desiredVarianceToTopCompetitorPct", v)}
                              />

                              <Select
                                value={g.equalizationStrength}
                                onValueChange={(v) =>
                                  updateTierGuardrail(sl, tier, "equalizationStrength", v as EqualizationStrength)
                                }
                              >
                                <SelectTrigger className="h-7 px-2 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="low">Low</SelectItem>
                                  <SelectItem value="medium">Medium</SelectItem>
                                  <SelectItem value="high">High</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DateField
              testId="input-street-date"
              label="Street rate effective"
              value={assumptions.streetRateEffectiveDate}
              onChange={(v) => update("streetRateEffectiveDate", v)}
              hint="When new move-ins start paying the new street rate."
            />
            <DateField
              testId="input-inhouse-date"
              label="In-house increase effective"
              value={assumptions.inhouseEffectiveDate}
              onChange={(v) => update("inhouseEffectiveDate", v)}
              hint="When existing residents' increases hit their bill."
            />
          </div>

          {rangeError && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{rangeError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={calculatePlanAndTiers}
              disabled={
                !!rangeError ||
                calculate.isPending ||
                calculateTiers.isPending ||
                !tierPoliciesReady
              }
              data-testid="button-calculate"
            >
              {calculate.isPending || calculateTiers.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="mr-2 h-4 w-4" />
              )}
              Calculate plan
            </Button>
            <Button
              variant="outline"
              onClick={() => saveAssumptions.mutate()}
              disabled={!!rangeError || saveAssumptions.isPending || !tierPoliciesReady}
              data-testid="button-save-assumptions"
            >
              {saveAssumptions.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save assumptions
            </Button>
            {plans && tierGrid && !tierGridStale && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => annualReport.mutate({
                  reportPlans: plans,
                  reportTierGrid: tierGrid,
                  reportLocationId: scopeLocationId,
                  reportServiceLines: serviceLines,
                  openAfterSave: true,
                })}
                disabled={annualReport.isPending}
                data-testid="button-annual-report"
                className="border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15"
              >
                {annualReport.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
                Annual Report
              </Button>
            )}
            {!tierPoliciesReady && (
              <div
                className={cn(
                  "flex items-center gap-2 self-center text-[11px] leading-snug",
                  tierPoliciesQuery.isError ? "text-destructive" : "text-muted-foreground",
                )}
                data-testid="tier-policies-status"
              >
                <span>
                  {tierPoliciesQuery.isError
                    ? "Saved occupancy tier settings could not be loaded."
                    : "Loading saved occupancy tier settings…"}
                </span>
                {tierPoliciesQuery.isError && (
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-[11px]"
                    onClick={() => tierPoliciesQuery.refetch()}
                  >
                    Retry
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>}
      </Card>

      <Card className="border-primary/20 bg-gradient-to-br from-card to-primary/[0.03]">
        <CardHeader className="space-y-0.5 px-4 pb-2 pt-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Save className="h-4 w-4 text-primary" />
            Saved work and last run
          </CardTitle>
          <CardDescription className="text-xs">
            Reopen or refresh the latest calculation, submitted plan, or annual report for this scope.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 px-4 pb-3 md:grid-cols-3">
          <div className="rounded-md border bg-background/80 p-2.5" data-testid="calculated-plan-last-run">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Latest calculation</p>
            {plans && lastRunAt ? (
              <>
                <p className="mt-0.5 text-xs font-medium">{plans.length} service line{plans.length === 1 ? "" : "s"} calculated</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{new Date(lastRunAt).toLocaleString()}</p>
                {restoredPlanDetailsOmitted && (
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    Saved totals and projections restored. Recalculate to reload resident details.
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button variant="link" size="sm" className="h-7 p-0 text-[11px]" onClick={() => document.getElementById("calculated-plan-results")?.scrollIntoView({ behavior: "smooth" })}>
                    View calculated result
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={calculatePlanAndTiers}
                    disabled={
                      !!rangeError ||
                      calculate.isPending ||
                      calculateTiers.isPending ||
                      !tierPoliciesReady
                    }
                    className="h-7 px-2.5 text-[11px]"
                    data-testid="button-recalculate-top"
                  >
                    {calculate.isPending || calculateTiers.isPending ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Calculator className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Recalculate
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">No calculation is saved for the selected campus and service lines.</p>
            )}
          </div>

          <div className="rounded-md border bg-background/80 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Submitted plan</p>
            {plansQuery.data?.plans?.[0] ? (
              <>
                <p className="mt-0.5 text-xs font-medium">v{plansQuery.data.plans[0].version} · {plansQuery.data.plans[0].serviceLine}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatPct(plansQuery.data.plans[0].summary?.weightedAvgIncreasePct ?? 0, 2)} average · {plansQuery.data.plans[0].status}
                </p>
                <Button variant="link" size="sm" className="mt-0.5 h-auto p-0 text-[11px]" onClick={() => document.getElementById("plan-history")?.scrollIntoView({ behavior: "smooth" })}>
                  View plan history
                </Button>
              </>
            ) : (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">No plan has been submitted for this scope yet.</p>
            )}
          </div>

          <div className="rounded-md border bg-background/80 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Annual report and PDF</p>
            {latestAnnualReportQuery.data?.report ? (
              <>
                <p className="mt-0.5 text-xs font-medium">Executive report available</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Saved {new Date(latestAnnualReportQuery.data.report.generatedAt).toLocaleString()}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button size="sm" className="h-7 px-2.5 text-[11px]" onClick={() => setLocation(`/inhouse-increases/annual-report?scopeKey=${encodeURIComponent(latestAnnualReportQuery.data!.report!.scopeKey)}`)}>
                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                    Open report
                  </Button>
                  <Button asChild variant="outline" size="sm" className="h-7 px-2.5 text-[11px]">
                    <a href={`/api/inhouse-planning/annual-report-runs/${latestAnnualReportQuery.data.report.id}/pdf`} download>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      PDF
                    </a>
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">No annual report has been saved for this scope. Calculate the plan, then choose Annual Report.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Occupancy tier summary ────────────────────────────────────── */}
      {(calculate.isPending || calculateTiers.isPending) && (!plans?.length || !tierGrid) && (
        <div className="flex items-center gap-3 rounded-md border p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Calculating the plan for {serviceLines.length > 1
            ? `${serviceLines.length} service lines and their occupancy tiers`
            : `${serviceLines[0]} and its occupancy tiers`}…
        </div>
      )}

      {tierGrid && (
        <Card>
          <CardHeader className={cn("pb-3", expandedSections.occupancyTiers && "border-b")}>
            <button
              type="button"
              className="flex w-full items-start justify-between gap-4 text-left"
              onClick={() => toggleSection("occupancyTiers")}
              aria-expanded={expandedSections.occupancyTiers}
              aria-controls="inhouse-occupancy-tiers-content"
              data-testid="button-toggle-inhouse-occupancy-tiers"
            >
              <div>
                <CardTitle className="text-base">Increases by Occupancy Tier</CardTitle>
                <CardDescription>
                  Compare the measured tier with the other occupancy scenarios.
                </CardDescription>
              </div>
              {expandedSections.occupancyTiers
                ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
            </button>
          </CardHeader>
          {expandedSections.occupancyTiers && <CardContent id="inhouse-occupancy-tiers-content" className="space-y-2 pt-4">
            {tierGridStale && (
              <p
                className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-600 dark:text-amber-400"
                data-testid="tier-grid-stale"
              >
                These numbers were solved under the tier settings as they were when the grid was
                built, and those settings have changed since. Run the comparison again before
                reading anything into them.
              </p>
            )}
            <div
              className="grid grid-cols-3 rounded-md border p-0.5 sm:hidden"
              role="group"
              aria-label="Occupancy scenario"
              data-testid="mobile-occupancy-tier-options"
            >
              {OCCUPANCY_TIER_IDS.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  className={cn(
                    "rounded px-2 py-1.5 text-xs font-medium",
                    mobileTier === tier
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={() => setMobileTier(tier)}
                  aria-pressed={mobileTier === tier}
                  data-testid={`button-mobile-tier-${tier}`}
                >
                  {tierRangeHeader(tierGrid, tier)}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <div className="sm:min-w-[42rem]">
                <div
                  className={cn(
                    TIER_SUMMARY_COLS,
                    "items-end border-b pb-1 text-[11px] font-medium text-muted-foreground",
                  )}
                >
                  <span>Service line</span>
                  <HeaderHelp
                    label="Occupancy"
                    explanation="Measured occupancy for this service line, from occupancy history. This is what selects the tier in force."
                  />
                  <div className="flex justify-center text-center">
                    <HeaderHelp
                       label="Current tier"
                       explanation="The in-house and Street Rate increases for the measured occupancy tier. These are the same recommendations shown in the Rate Growth Snapshot."
                    />
                  </div>
                  {OCCUPANCY_TIER_IDS.map((tier) => (
                    <span
                      key={tier}
                      className={cn("text-center", tier !== mobileTier && "hidden sm:block")}
                    >
                      {tierRangeHeader(tierGrid, tier)}
                    </span>
                  ))}
                </div>
                <div
                  className={cn(
                    TIER_SUMMARY_COLS,
                    "border-b pb-1 pt-0.5 text-[10px] text-muted-foreground",
                  )}
                >
                  <span />
                  <span />
                  <span className="text-center">in-house / street</span>
                  {OCCUPANCY_TIER_IDS.map((tier) => (
                    <span
                      key={tier}
                      className={cn("text-center", tier !== mobileTier && "hidden sm:block")}
                    >
                      in-house / street
                    </span>
                  ))}
                </div>

                {tierGrid.lines.map((line) => {
                  const byTier = new Map(line.cells.map((c) => [c.tier, c]));
                  const currentInhouse = line.currentPlan.summary.weightedAvgIncreasePct;
                  const currentStreet = line.currentPlan.streetIncreasePct;
                  return (
                    <div
                      key={line.serviceLine}
                      className={cn(TIER_SUMMARY_COLS, "items-center border-b py-1 last:border-b-0")}
                      data-testid={`tier-summary-${line.serviceLine}`}
                    >
                      <span className="truncate text-xs font-medium">{line.serviceLine}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {line.occupancyPct == null ? "—" : `${line.occupancyPct.toFixed(1)}%`}
                      </span>
                      <div
                        className="rounded px-1.5 py-1 text-center text-xs tabular-nums"
                         title={`Recommendation at the measured ${line.currentTier} occupancy tier`}
                      >
                         <span>{formatTierPct(currentInhouse)}</span>
                        <span className="text-muted-foreground"> / </span>
                         <span>{formatTierPct(currentStreet)}</span>
                      </div>
                      {OCCUPANCY_TIER_IDS.map((tier) => {
                        const cell = byTier.get(tier);
                        const current = line.currentTier === tier;
                        return (
                          <div
                            key={tier}
                            className={cn(
                              "rounded px-1.5 py-1 text-center text-xs tabular-nums",
                              tier !== mobileTier && "hidden sm:block",
                              current && "bg-primary/10 font-medium ring-1 ring-primary/30",
                            )}
                            title={cell?.error ?? cell?.rangeLabel}
                          >
                            {!cell || cell.error ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className="block">
                                <span>{formatTierPct(cell.inhouseIncreasePct)}</span>
                                <span className="text-muted-foreground"> / </span>
                                <span>{formatTierPct(cell.streetIncreasePct)}</span>
                                {cell.feasible === false && (
                                  <span
                                    className="ml-1 text-amber-500"
                                    title="The solver could not hit the growth target inside this tier's guardrails."
                                  >
                                    !
                                  </span>
                                )}
                                {current && (
                                  <span className="ml-1.5 text-[10px] font-normal text-primary sm:hidden">
                                    Current
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {tierGrid.lines.some((l) => l.warnings.length > 0) && (
              <div className="space-y-1 pt-1">
                {tierGrid.lines.flatMap((l) =>
                  l.warnings.map((w) => (
                    <p key={`${l.serviceLine}-${w}`} className="text-[11px] leading-snug text-muted-foreground">
                      {w}
                    </p>
                  )),
                )}
              </div>
            )}

            <p className="text-[11px] leading-snug text-muted-foreground">
              {(() => {
                // Occupancy is resolved per service line, so the sources can
                // differ within one grid. Say which lines fell back rather
                // than labelling the whole table with the first line's source.
                const measured = tierGrid.lines.filter((l) => l.occupancyMonth);
                const months = Array.from(new Set(measured.map((l) => l.occupancyMonth!))).sort();
                const fellBack = tierGrid.lines
                  .filter((l) => l.occupancySource === "rent_roll")
                  .map((l) => l.serviceLine);
                if (months.length === 0) return "No occupancy reading was available for any line. ";
                const monthText = months.map((m) => formatMonth(m)).join(" and ");
                const base = `Occupancy read from ${monthText}. `;
                return fellBack.length === 0
                  ? base
                  : `${base}${fellBack.join(", ")} came from the rent roll rather than occupancy history. `;
              })()}
              A “!” marks a tier whose guardrails cannot reach the growth target.
            </p>
          </CardContent>}
        </Card>
      )}

      {plans && plans.length > 0 && <div id="calculated-plan-results" />}

      {plans && plans.length > 0 && (
        <PlanScatterReview
          key={calculatedPlanScopeKey(scopeLocationId, serviceLines)}
          plans={plans}
          selectedLocationId={scopeLocationId}
          selectedServiceLines={serviceLines}
          tierGrid={tierGrid}
          campusOccupancy={campusOccupancyData?.readings ?? []}
          campusPlanPoints={campusPlanPointsData?.points ?? []}
        />
      )}

      {(calculate.isPending || calculateTiers.isPending) && !!plans?.length && !!tierGrid && (
        <div
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg"
          role="status"
          aria-live="polite"
          data-testid="plan-updating-status"
        >
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Updating plan…
        </div>
      )}

      {plans && plans.length > 0 && combinedSummary && (
        <>
          <Card data-testid="monthly-rate-growth-chart">
            <CardHeader className="pb-2 text-center">
              <CardTitle className="text-base">Rate Growth Snapshot</CardTitle>
              <CardDescription>
                Street and in-house growth by service line, followed by the weighted total for all selected lines.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mx-auto mb-6 max-w-7xl overflow-x-auto rounded-lg border">
                <div className={cn(GROWTH_GRID_COLS, "bg-muted/40 px-4 py-2 text-center text-xs font-medium text-muted-foreground")}>
                  <HeaderHelp
                    label="Service line"
                    explanation="The level of care, shown with its monthly or daily rate basis."
                  />
                  <HeaderHelp
                    label="Street Rate"
                    explanation="Current versus recommended rate for new move-ins. For a portfolio view, each service line stays at least 1% above its resident-weighted planned in-house average; individual locations are not forced to meet that floor."
                  />
                  <HeaderHelp
                    label="Adjusted Top Competitor"
                    explanation="Product-matched, care-adjusted Top Competitor rate; projected forward by the recommended Street Rate increase, then compared with the recommended Street Rate."
                  />
                  <HeaderHelp
                    label="In-house rate"
                    explanation="Average current-resident rate before and after the increase."
                  />
                  <HeaderHelp
                    label="Full-year YoY growth"
                    explanation="The projected plan-year average compared with the prior-year average—not today's rate. It includes prior-year carryover, effective-date timing, retained residents, and expected move-ins at the new Street Rate. HC is weighted by resident days. This is not the increase each current resident receives."
                  />
                  <HeaderHelp
                    label="Quarterly YoY goal"
                    explanation={`Minimum YoY growth required for measured quarters with complete prior-year baselines: ${quarterlyComparisonPeriods}. Partial and unavailable baselines are excluded.`}
                  />
                  <HeaderHelp
                    label="Average quarterly YoY"
                    explanation={`Average of complete prior-year baseline quarters only. Partial and unavailable baselines are excluded from both this average and its goal comparison. Each measured quarter's result is listed beneath the average — green when it meets the goal, amber when it falls short.`}
                  />
                  <HeaderHelp
                    label="Quarters at goal"
                     explanation="Planned quarters meeting the goal out of all four quarters. A partial prior-year baseline counts when it produces a valid comparison; an unavailable comparison does not count as meeting the goal."
                  />
                </div>
                {plans.map(({ sl, plan }) => {
                  const daily = plan.rateBasis === "daily";
                  const rate = (monthly: number) => formatMoney(daily ? monthly / DAYS_PER_MONTH : monthly);
                  const quarterlyYoySummary = summarizeQuarterYoy(
                    plan.quarters.map(quarterYoyDisplayInput),
                  );
                  const averageQuarterlyYoy = quarterlyYoySummary.averagePct;
                  const fullYearYoy = fullYearYoyFromQuarters(plan.quarters, plan.rateBasis);
                  const planYear = plan.quarters[0]?.year;
                  const quarterLabels = formatQuarterLabels(plan.quarters);
                  const quarterCells: QuarterYoyCell[] = plan.quarters.map((quarter, index) => {
                    const display = getQuarterYoyDisplay(quarterYoyDisplayInput(quarter));
                    return {
                      key: `${quarter.year}-Q${quarter.quarter}`,
                      label: quarterLabels[index],
                      ...display,
                      passes: quarter.passes,
                    };
                  });
                  const quartersMeetingGoal = quarterCells.filter(
                     (quarter) => quarter.yoyPct != null && quarter.passes,
                  ).length;
                   const plannedQuarterCount = quarterCells.length;
                  const adjustedTopComp = plan.adjustedTopCompetitorRateMonthly;
                  const projectedAdjustedTopComp =
                    adjustedTopComp != null
                      ? adjustedTopComp * (1 + plan.streetIncreasePct / 100)
                      : null;
                  const varianceToProjectedTopComp =
                    projectedAdjustedTopComp != null && projectedAdjustedTopComp > 0
                      ? (plan.recommendedStreetRateMonthly / projectedAdjustedTopComp - 1) * 100
                      : null;
                  // Recompute rather than trusting the stored field, so a plan
                  // calculated before this comparison existed still shows it.
                  const streetPremium = plan.summary.newAvgInhouseRateMonthly > 0
                    ? (plan.recommendedStreetRateMonthly / plan.summary.newAvgInhouseRateMonthly - 1) * 100
                    : null;
                  return (
                    <div key={`growth-${sl}`} className={cn(GROWTH_GRID_COLS, "items-center border-t px-4 py-3 text-center")}>
                      <div>
                        <p className="font-semibold">{sl}</p>
                        <p className="text-[11px] text-muted-foreground">{daily ? "Daily rates" : "Monthly rates"}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-blue-600">+{plan.streetIncreasePct.toFixed(1)}%</p>
                        <p className="text-xs text-muted-foreground">{rate(plan.currentStreetRateMonthly)} → {rate(plan.recommendedStreetRateMonthly)}</p>
                        {scopeLocationId == null && streetPremium != null && (
                          <p className={cn("text-[11px]", streetPremium >= 1 ? "text-muted-foreground" : "text-amber-600")}>
                            {formatPct(streetPremium, 1)} over in-house portfolio avg
                          </p>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        {adjustedTopComp != null && projectedAdjustedTopComp != null && varianceToProjectedTopComp != null ? (
                          <>
                            <p className="text-xs text-muted-foreground">
                              {rate(adjustedTopComp)} → {rate(projectedAdjustedTopComp)}
                            </p>
                            <p className="text-xs">
                              Street after: <span className="font-semibold">{rate(plan.recommendedStreetRateMonthly)}</span>
                            </p>
                            <p className={cn("text-xs font-semibold", varianceToProjectedTopComp >= 0 ? "text-emerald-600" : "text-amber-600")}>
                              {formatPct(varianceToProjectedTopComp, 1)} variance
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">No matched benchmark</p>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-[#0f9f9a]">+{plan.summary.weightedAvgIncreasePct.toFixed(1)}%</p>
                        <p className="text-xs text-muted-foreground">{rate(plan.summary.currentAvgInhouseRateMonthly)} → {rate(plan.summary.newAvgInhouseRateMonthly)}</p>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">
                          {fullYearYoy.growthPct >= 0 ? "+" : ""}
                          {fullYearYoy.growthPct.toFixed(1)}%
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {planYear ? `${planYear - 1} → ${planYear}` : "Full year"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold">{formatPct(plan.assumptions.rateGrowthTargetPct, 1)}</p>
                        <p className="text-xs text-muted-foreground">Each measured quarter</p>
                      </div>
                      <div>
                        <p className="font-semibold">{formatPct(averageQuarterlyYoy, 1)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatPct(averageQuarterlyYoy - plan.assumptions.rateGrowthTargetPct, 1)} vs goal
                        </p>
                        <QuarterYoyBreakdown quarters={quarterCells} />
                      </div>
                      <div>
                        <p className={cn("font-semibold", quartersMeetingGoal === plannedQuarterCount ? "text-emerald-600" : "text-amber-600")}>
                          {quartersMeetingGoal} / {plannedQuarterCount}
                        </p>
                        <p className="text-xs text-muted-foreground">Planned quarters</p>
                      </div>
                    </div>
                  );
                })}
                {growthSnapshot && (
                  <div className={cn(GROWTH_GRID_COLS, "items-center border-t-2 bg-muted/30 px-4 py-3 text-center")}>
                    <div>
                      <p className="font-semibold">Combined total</p>
                      <p className="text-[11px] text-muted-foreground">{growthSnapshot.residents.toLocaleString()} residents · monthly equivalent</p>
                    </div>
                    <div>
                      <p className="font-semibold text-blue-600">+{growthSnapshot.streetGrowthPct.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">{formatMoney(growthSnapshot.streetCurrentMonthly)} → {formatMoney(growthSnapshot.streetRecommendedMonthly)}</p>
                    </div>
                    <div className="space-y-0.5">
                      {growthSnapshot.adjustedTopCompCurrentMonthly != null &&
                      growthSnapshot.adjustedTopCompProjectedMonthly != null &&
                      growthSnapshot.streetAfterForCompMonthly != null &&
                      growthSnapshot.adjustedTopCompVariancePct != null ? (
                        <>
                          <p className="text-xs text-muted-foreground">
                            {formatMoney(growthSnapshot.adjustedTopCompCurrentMonthly)} → {formatMoney(growthSnapshot.adjustedTopCompProjectedMonthly)}
                          </p>
                          <p className="text-xs">
                            Street after: <span className="font-semibold">{formatMoney(growthSnapshot.streetAfterForCompMonthly)}</span>
                          </p>
                          <p className={cn("text-xs font-semibold", growthSnapshot.adjustedTopCompVariancePct >= 0 ? "text-emerald-600" : "text-amber-600")}>
                            {formatPct(growthSnapshot.adjustedTopCompVariancePct, 1)} variance
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">No matched benchmark</p>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-[#0f9f9a]">+{growthSnapshot.inhouseGrowthPct.toFixed(1)}%</p>
                      <p className="text-xs text-muted-foreground">{formatMoney(growthSnapshot.inhouseCurrentMonthly)} → {formatMoney(growthSnapshot.inhouseNewMonthly)}</p>
                    </div>
                    <div>
                      <p className="font-semibold text-foreground">
                        {growthSnapshot.fullYearYoyPct >= 0 ? "+" : ""}{growthSnapshot.fullYearYoyPct.toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground">Full year vs prior year</p>
                    </div>
                    <div>
                      <p className="font-semibold">{formatPct(growthSnapshot.quarterlyGoalPct, 1)}</p>
                      <p className="text-xs text-muted-foreground">Resident weighted</p>
                    </div>
                    <div>
                      <p className="font-semibold">{formatPct(growthSnapshot.averageQuarterlyYoyPct, 1)}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatPct(growthSnapshot.averageQuarterlyYoyPct - growthSnapshot.quarterlyGoalPct, 1)} vs goal
                      </p>
                      <QuarterYoyBreakdown
                        quarters={growthSnapshot.quarterlyBreakdown.map((quarter) => ({
                          ...quarter,
                          includedInSummary: quarter.yoyPct != null,
                        }))}
                      />
                    </div>
                    <div>
                      <p className={cn("font-semibold", growthSnapshot.quartersMeetingGoal === growthSnapshot.projectedQuarterCount ? "text-emerald-600" : "text-amber-600")}>
                        {growthSnapshot.quartersMeetingGoal} / {growthSnapshot.projectedQuarterCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Measured service-line quarters</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-3 text-center">
                <h3 className="text-sm font-semibold">Monthly rate growth</h3>
                <p className="text-xs text-muted-foreground">
                  Each chart begins one month before its Street Rate effective date so the increase is visible.
                </p>
              </div>
              <div className={cn("mx-auto grid max-w-5xl justify-items-center gap-4", plans.length > 1 && "md:grid-cols-2")}>
                {plans.map(({ sl, plan }) => {
                  const daily = plan.rateBasis === "daily";
                  const display = (monthly: number) => daily ? monthly / DAYS_PER_MONTH : monthly;
                  const chartFullYearYoy = fullYearYoyFromQuarters(
                    plan.quarters,
                    plan.rateBasis,
                  );
                  const chartData = (plan.monthlyRateProjection ?? []).map((point) => ({
                    ...point,
                    label: new Date(`${point.month}-01T00:00:00Z`).toLocaleDateString("en-US", {
                      month: "short",
                      year: "2-digit",
                      timeZone: "UTC",
                    }),
                    projected: display(point.projectedRateMonthly),
                    street: display(point.streetRateMonthly),
                  }));
                  return (
                    <div key={sl} className="w-full max-w-[460px] min-w-0 rounded-lg border p-3">
                      <div className="mb-2 flex items-center justify-center gap-3 text-center">
                        <div>
                          <p className="text-sm font-medium">{sl}</p>
                          <p className="text-xs text-muted-foreground">
                            {daily ? "Daily rate" : "Monthly rate"} · full-year YoY in badge and hover
                          </p>
                        </div>
                        <Badge variant="outline">
                          {chartFullYearYoy.growthPct >= 0 ? "+" : ""}
                          {chartFullYearYoy.growthPct.toFixed(1)}%
                        </Badge>
                      </div>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                            <XAxis
                              dataKey="label"
                              tick={{ fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                              width={54}
                              tickFormatter={(value) => `$${Math.round(value).toLocaleString()}`}
                              domain={[
                                (dataMin: number) => Math.floor(dataMin * 0.995),
                                (dataMax: number) => Math.ceil(dataMax * 1.005),
                              ]}
                            />
                            <RechartsTooltip
                              wrapperStyle={{
                                top: "auto",
                                right: 8,
                                bottom: 28,
                                left: "auto",
                                transform: "none",
                                pointerEvents: "none",
                                maxWidth: 245,
                              }}
                              formatter={(value: number, name: string, item: any) => [
                                `${formatMoney(Number(value))}${daily ? "/day" : "/mo"}${
                                  name === "Projected realized"
                                     ? ` (${chartFullYearYoy.growthPct >= 0 ? "+" : ""}${chartFullYearYoy.growthPct.toFixed(1)}% full-year YoY)`
                                    : ""
                                }`,
                                name,
                              ]}
                              labelFormatter={(label) => String(label)}
                              contentStyle={{
                                width: "245px",
                                padding: "6px 8px",
                                borderRadius: "6px",
                                borderColor: "hsl(var(--border))",
                                background: "hsl(var(--popover))",
                                color: "hsl(var(--popover-foreground))",
                                fontSize: "10px",
                                lineHeight: "1.25",
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="projected"
                              name="Projected realized"
                              stroke="#0f9f9a"
                              strokeWidth={3}
                              dot={{ r: 2, fill: "#0f9f9a", strokeWidth: 0 }}
                              activeDot={{ r: 4 }}
                              isAnimationActive={false}
                            />
                            <Line
                              type="stepAfter"
                              dataKey="street"
                              name="Street Rate"
                              stroke="#2563eb"
                              strokeWidth={2}
                              strokeDasharray="5 4"
                              dot={{ r: 1.5, fill: "#2563eb", strokeWidth: 0 }}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-1 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 bg-[#0f9f9a]" />Projected realized</span>
                        <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#2563eb]" />Street Rate</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {allWarnings.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-left"
                  onClick={() => toggleSection("dataWarnings")}
                  aria-expanded={expandedSections.dataWarnings}
                  aria-controls="inhouse-data-warnings"
                >
                  <span>
                    Worth knowing about this data
                    <span className="ml-2 font-normal text-muted-foreground">
                      {allWarnings.length} {allWarnings.length === 1 ? "note" : "notes"}
                    </span>
                  </span>
                  {expandedSections.dataWarnings
                    ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
              </AlertTitle>
              {expandedSections.dataWarnings && (
                <AlertDescription id="inhouse-data-warnings">
                  <ul className="ml-4 mt-2 list-disc space-y-1 text-sm">
                    {allWarnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </AlertDescription>
              )}
            </Alert>
          )}

          {/* ── How each plan was derived + quarterly (per line) ─────── */}
          {plans.map(({ sl, plan }) => (
            <div key={sl} className="space-y-4">
              <Card>
                <CardHeader className={cn("pb-3", !restoredPlanDetailsOmitted && expandedPlanDetails[sl] && "border-b")}>
                  <CalculationDetailToggle
                    serviceLine={sl}
                    multiplePlans={plans.length > 1}
                    feasible={plan.feasible}
                    expanded={!!expandedPlanDetails[sl]}
                    detailsAvailable={!restoredPlanDetailsOmitted}
                    onToggle={() => {
                      if (!restoredPlanDetailsOmitted) togglePlanDetails(sl);
                    }}
                  />
                </CardHeader>
                {!restoredPlanDetailsOmitted && expandedPlanDetails[sl] && <CardContent id={`plan-detail-${sl}`} className="space-y-4 pt-4">
                  {plan.feasible ? (
                    <Alert className="border-emerald-500/40 bg-emerald-500/10">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <AlertTitle>
                        {sl} — {formatPct(plan.assumptions.rateGrowthTargetPct)} growth is reachable
                      </AlertTitle>
                      <AlertDescription>
                        Every quarter in the next year clears the target
                        {plan.bindingQuarterLabel && (
                          <> — <span className="font-medium">{plan.bindingQuarterLabel}</span> is the tightest</>
                        )}.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="destructive" data-testid={`alert-infeasible-${sl}`}>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>{sl} — {formatPct(plan.assumptions.rateGrowthTargetPct)} growth is not reachable</AlertTitle>
                      <AlertDescription className="space-y-1 text-sm">
                        <p>{plan.infeasibility?.message}</p>
                        {plan.infeasibility && (
                          <ul className="ml-4 list-disc space-y-0.5">
                            <li>Needs {formatPct(plan.infeasibility.requiredAvgIncreasePct, 2)} avg; guardrails allow {formatPct(plan.infeasibility.achievableAvgIncreasePct, 2)}.</li>
                            {plan.infeasibility.minimumChange.maxInhouseIncreasePct !== null && (
                              <li>Raise max resident increase to at least <span className="font-medium">{formatPct(plan.infeasibility.minimumChange.maxInhouseIncreasePct, 2)}</span>.</li>
                            )}
                            <li>Or accept <span className="font-medium">{formatPct(plan.infeasibility.minimumChange.achievableGrowthTargetPct, 2)}</span> growth, which these guardrails do reach.</li>
                          </ul>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">How this plan was derived</p>
                    <Explanation
                      explanation={plan.explanation}
                      plan={plan}
                      serviceLine={sl}
                      exportPending={exportPlan.isPending}
                      onExport={() => exportPlan.mutate(sl)}
                    />
                  </div>
                  <TargetDeviationDiagnosticView
                    diagnostic={plan.targetDeviationDiagnostic}
                    targetPct={plan.assumptions.rateGrowthTargetPct}
                    rateBasis={plan.rateBasis}
                  />
                  <div>
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold">Quarterly realized rate vs prior year</h3>
                      <p className="text-xs text-muted-foreground">
                        Each quarter compared against the same quarter one year earlier. Binding quarter sets the plan.
                        {plan.rateBasis === "daily" ? " Rates are shown per day." : " Rates are shown per month."}
                      </p>
                    </div>
                <div className="p-0 sm:p-6 sm:pt-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-2 font-medium">Quarter</th>
                          <th className="px-4 py-2 font-medium">Prior year</th>
                          <th className="px-4 py-2 text-right font-medium">Prior rate</th>
                          <th className="px-4 py-2 text-right font-medium">Needed</th>
                          <th className="px-4 py-2 text-right font-medium">Projected</th>
                          <th className="px-4 py-2 text-right font-medium">YoY</th>
                          <th className="px-4 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.quarters.flatMap((q) => {
                          const qKey = `${sl}-${q.label}`;
                          const open = expandedQuarter === qKey;
                          const displayRate = (monthly: number | null | undefined) =>
                            formatQuarterlyRate(monthly, plan.rateBasis);
                          return [
                            <QuarterlySummaryRow
                              key={qKey}
                              plan={plan}
                              quarter={q}
                              open={open}
                              onToggle={() => setExpandedQuarter(open ? null : qKey)}
                            />,
                            open ? (
                              <tr key={`${qKey}-detail`} className="border-b bg-muted/30">
                                <td colSpan={7} className="space-y-4 px-4 py-4">
                                  <Explanation
                                    explanation={q.explanation}
                                    plan={plan}
                                    serviceLine={sl}
                                    exportPending={exportPlan.isPending}
                                    onExport={() => exportPlan.mutate(sl)}
                                  />
                                  <div className="rounded-md border bg-background">
                                    <div className="flex flex-wrap items-start justify-between gap-2 border-b px-3 py-2.5">
                                      <div>
                                        <p className="text-sm font-medium">Room-level before and after</p>
                                        <p className="text-xs text-muted-foreground">
                                          “New” is the modeled replacement share from the turnover assumption. Future resident identities are not yet known.
                                        </p>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <div className="text-right text-xs text-muted-foreground">
                                          <div>Room detail: <span className="font-mono text-foreground">{displayRate(q.roomDetailProjectedRateMonthly ?? q.projectedRateMonthly)}</span></div>
                                          <div>Quarter headline: <span className="font-mono text-foreground">{displayRate(q.projectedRateMonthly)}</span></div>
                                        </div>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          disabled={exportPlan.isPending || hasChangedPlanAssumptions}
                                          onClick={() => exportPlan.mutate(sl)}
                                        >
                                          {exportPlan.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                                          Export room tables
                                        </Button>
                                      </div>
                                    </div>
                                    <TooltipProvider delayDuration={150}>
                                    <div className="max-h-[420px] overflow-auto">
                                      <table className="w-full min-w-[1240px] text-xs">
                                        <thead className="sticky top-0 z-10 bg-background">
                                          <tr className="border-b text-left uppercase tracking-wide text-muted-foreground">
                                            <th className="px-3 py-2 font-medium"><HeaderHelp label="Campus" explanation="The campus in the calculated plan scope. Portfolio plans show the campus assigned to each room." /></th>
                                            <th className="px-3 py-2 font-medium"><HeaderHelp label="Room" explanation="The occupied room or bed from the source-month Rent Roll. This is the unit used to bridge the current occupant to modeled future turnover." /></th>
                                            <th className="px-3 py-2 font-medium"><HeaderHelp label="Current occupant" explanation="The current resident's move-in date from the source-month Rent Roll. Future resident identities are unknown and represented by the modeled New share." /></th>
                                            <th className="px-3 py-2 text-right font-medium"><HeaderHelp label="Before" explanation="The current resident's in-house room rate from the source-month Rent Roll, before the proposed annual increase." /></th>
                                            <th className="px-3 py-2 text-right font-medium"><HeaderHelp label="Existing after" explanation="The quarter-average rate for today's occupant after applying the proposed resident increase on its effective date. If the increase begins during the quarter, this averages the before and after periods." /></th>
                                            <th className="px-3 py-2 text-right font-medium"><HeaderHelp label="Existing growth" explanation="Percentage growth from the room's Before rate to its Existing-after rate. Existing growth = (Existing after ÷ Before − 1) × 100." /></th>
                                            <th className="px-3 py-2 text-right font-medium"><HeaderHelp label="Existing share" explanation="The expected portion of the quarter still occupied by today's resident cohort. Existing share = 100% − modeled New share." /></th>
                                            <th className="px-3 py-2 text-right font-medium"><HeaderHelp label="New share" explanation="The expected portion occupied by replacement move-ins, calculated from the annual turnover assumption and averaged across the quarter. It is a modeled share, not a named future resident." /></th>
                                            <th className="px-3 py-2 text-right font-medium"><HeaderHelp label="Move-in rate" explanation="The average Street Rate in force on the modeled replacement move-in dates. It reflects the Street Rate effective date when that date falls within the projection." /></th>
                                            <th className="px-3 py-2 text-right font-medium"><HeaderHelp label="Move-in growth" explanation="Percentage growth from the room's Before rate to the modeled Move-in rate. Move-in growth = (Move-in rate ÷ Before − 1) × 100." /></th>
                                            <th className="px-3 py-2 text-right font-medium"><HeaderHelp label="Blended after" explanation="Projected room rate = (Existing share × Existing-after rate) + (New share × Move-in rate)." /></th>
                                            <th className="px-3 py-2 text-right font-medium"><HeaderHelp label="Change" explanation="Blended-after projected rate minus the Before rate for this room." /></th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {(q.roomDetails ?? []).map((room) => (
                                            <tr key={`${qKey}-${room.key}`} className="border-b last:border-0">
                                              <td className="px-3 py-2">{room.location}</td>
                                              <td className="px-3 py-2 font-medium">{room.roomNumber}</td>
                                              <td className="px-3 py-2 text-muted-foreground">
                                                {room.moveInDate ? `Since ${room.moveInDate}` : "Current resident"}
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                <FormulaValue
                                                  value={displayRate(room.currentRateMonthly)}
                                                  formula={`Before = current occupied-room rate from ${plan.scope.sourceMonth} = ${displayRate(room.currentRateMonthly)}`}
                                                />
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                <FormulaValue
                                                  value={displayRate(room.existingRateUsedMonthly)}
                                                  formula={`Existing after = quarter-average rate for today's occupant = ${displayRate(room.existingRateUsedMonthly)}. Full planned rate after ${plan.assumptions.inhouseEffectiveDate} = ${displayRate(room.plannedExistingRateMonthly)}.`}
                                                />
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                <FormulaValue
                                                  value={formatPct(room.currentRateMonthly > 0 ? (room.existingRateUsedMonthly / room.currentRateMonthly - 1) * 100 : 0, 1)}
                                                  formula={`Existing growth = (${displayRate(room.existingRateUsedMonthly)} existing after ÷ ${displayRate(room.currentRateMonthly)} before − 1) × 100 = ${formatPct(room.currentRateMonthly > 0 ? (room.existingRateUsedMonthly / room.currentRateMonthly - 1) * 100 : 0, 1)}`}
                                                />
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                <FormulaValue
                                                  value={formatPct(room.existingSharePct, 1)}
                                                  formula={`Existing share = 100.0% − ${formatPct(room.replacementSharePct, 1)} new = ${formatPct(room.existingSharePct, 1)}`}
                                                />
                                              </td>
                                              <td className="px-3 py-2 text-right">
                                                <FormulaValue
                                                  value={`${formatPct(room.replacementSharePct, 1)} new`}
                                                  formula={`New share = modeled turnover replacement share averaged across ${q.label}, using ${formatPct(plan.assumptions.annualTurnoverPct, 1)} annual turnover = ${formatPct(room.replacementSharePct, 1)}`}
                                                />
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                <FormulaValue
                                                  value={displayRate(room.replacementRateMonthly)}
                                                  formula={`Move-in rate = replacement-rate contribution ÷ new share. Street rate in force on each modeled move-in date, including the ${plan.assumptions.streetRateEffectiveDate} change = ${displayRate(room.replacementRateMonthly)}`}
                                                />
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono">
                                                <FormulaValue
                                                  value={formatPct(room.currentRateMonthly > 0 ? (room.replacementRateMonthly / room.currentRateMonthly - 1) * 100 : 0, 1)}
                                                  formula={`Move-in growth = (${displayRate(room.replacementRateMonthly)} move-in rate ÷ ${displayRate(room.currentRateMonthly)} before − 1) × 100 = ${formatPct(room.currentRateMonthly > 0 ? (room.replacementRateMonthly / room.currentRateMonthly - 1) * 100 : 0, 1)}`}
                                                />
                                              </td>
                                              <td className="px-3 py-2 text-right font-mono font-medium">
                                                <FormulaValue
                                                  value={displayRate(room.projectedRateMonthly)}
                                                  formula={`Blended after = (${formatPct(room.existingSharePct, 1)} × ${displayRate(room.existingRateUsedMonthly)}) + (${formatPct(room.replacementSharePct, 1)} × ${displayRate(room.replacementRateMonthly)}) = ${displayRate(room.projectedRateMonthly)}`}
                                                />
                                              </td>
                                              <td className={cn("px-3 py-2 text-right font-mono", room.changeMonthly >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                                                <FormulaValue
                                                  value={`${room.changeMonthly >= 0 ? "+" : ""}${displayRate(room.changeMonthly)}`}
                                                  formula={`Change = ${displayRate(room.projectedRateMonthly)} blended after − ${displayRate(room.currentRateMonthly)} before = ${room.changeMonthly >= 0 ? "+" : ""}${displayRate(room.changeMonthly)}`}
                                                />
                                              </td>
                                            </tr>
                                          ))}
                                          {(q.roomDetails ?? []).length === 0 && (
                                            <tr><td colSpan={12} className="px-3 py-6 text-center text-muted-foreground">Room detail is unavailable for this saved calculation. Recalculate the plan.</td></tr>
                                          )}
                                        </tbody>
                                        {q.roomDetailTotals && (
                                          <tfoot className="sticky bottom-0 z-10 border-t-2 bg-background shadow-[0_-2px_6px_rgba(0,0,0,0.06)]">
                                            <tr className="font-semibold">
                                              <td className="px-3 py-2.5">Weighted total</td>
                                              <td className="px-3 py-2.5">{q.roomDetails?.length ?? 0} rooms</td>
                                              <td className="px-3 py-2.5 text-muted-foreground">Quarter rate bridge</td>
                                              <td className="px-3 py-2.5 text-right font-mono"><FormulaValue value={displayRate(q.roomDetailTotals.currentRateMonthly)} formula={`Weighted before = Σ(room before × room weight) ÷ Σ(room weight) = ${displayRate(q.roomDetailTotals.currentRateMonthly)}`} /></td>
                                              <td className="px-3 py-2.5 text-right font-mono"><FormulaValue value={displayRate(q.roomDetailTotals.existingRateUsedMonthly)} formula={`Weighted existing after = Σ(room existing-after rate × room weight) ÷ Σ(room weight) = ${displayRate(q.roomDetailTotals.existingRateUsedMonthly)}`} /></td>
                                              <td className="px-3 py-2.5 text-right font-mono"><FormulaValue value={formatPct(q.roomDetailTotals.currentRateMonthly > 0 ? (q.roomDetailTotals.existingRateUsedMonthly / q.roomDetailTotals.currentRateMonthly - 1) * 100 : 0, 1)} formula={`Weighted existing growth = (${displayRate(q.roomDetailTotals.existingRateUsedMonthly)} existing after ÷ ${displayRate(q.roomDetailTotals.currentRateMonthly)} before − 1) × 100`} /></td>
                                              <td className="px-3 py-2.5 text-right font-mono"><FormulaValue value={formatPct(q.roomDetailTotals.existingSharePct, 1)} formula={`Existing share = 100.0% − ${formatPct(q.roomDetailTotals.replacementSharePct, 1)} new = ${formatPct(q.roomDetailTotals.existingSharePct, 1)}`} /></td>
                                              <td className="px-3 py-2.5 text-right font-mono"><FormulaValue value={formatPct(q.roomDetailTotals.replacementSharePct, 1)} formula={`Modeled new share averaged across ${q.label} at ${formatPct(plan.assumptions.annualTurnoverPct, 1)} annual turnover = ${formatPct(q.roomDetailTotals.replacementSharePct, 1)}`} /></td>
                                              <td className="px-3 py-2.5 text-right font-mono"><FormulaValue value={displayRate(q.roomDetailTotals.replacementRateMonthly)} formula={`Move-in rate = replacement-rate contribution ÷ modeled new share = ${displayRate(q.roomDetailTotals.replacementRateMonthly)}`} /></td>
                                              <td className="px-3 py-2.5 text-right font-mono"><FormulaValue value={formatPct(q.roomDetailTotals.currentRateMonthly > 0 ? (q.roomDetailTotals.replacementRateMonthly / q.roomDetailTotals.currentRateMonthly - 1) * 100 : 0, 1)} formula={`Weighted move-in growth = (${displayRate(q.roomDetailTotals.replacementRateMonthly)} move-in rate ÷ ${displayRate(q.roomDetailTotals.currentRateMonthly)} before − 1) × 100`} /></td>
                                              <td className="px-3 py-2.5 text-right font-mono"><FormulaValue value={displayRate(q.roomDetailTotals.projectedRateMonthly)} formula={`Blended after = (${formatPct(q.roomDetailTotals.existingSharePct, 1)} × ${displayRate(q.roomDetailTotals.existingRateUsedMonthly)}) + (${formatPct(q.roomDetailTotals.replacementSharePct, 1)} × ${displayRate(q.roomDetailTotals.replacementRateMonthly)}) = ${displayRate(q.roomDetailTotals.projectedRateMonthly)}; matches quarter headline ${displayRate(q.projectedRateMonthly)}`} /></td>
                                              <td className={cn("px-3 py-2.5 text-right font-mono", q.roomDetailTotals.changeMonthly >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                                                <FormulaValue value={`${q.roomDetailTotals.changeMonthly >= 0 ? "+" : ""}${displayRate(q.roomDetailTotals.changeMonthly)}`} formula={`Weighted change = ${displayRate(q.roomDetailTotals.projectedRateMonthly)} blended after − ${displayRate(q.roomDetailTotals.currentRateMonthly)} before = ${q.roomDetailTotals.changeMonthly >= 0 ? "+" : ""}${displayRate(q.roomDetailTotals.changeMonthly)}`} />
                                              </td>
                                            </tr>
                                          </tfoot>
                                        )}
                                      </table>
                                    </div>
                                    </TooltipProvider>
                                  </div>
                                </td>
                              </tr>
                            ) : null,
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
                  </div>
                </CardContent>}
              </Card>
            </div>
          ))}

          {/* ── Combined resident summary ── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Resident increases{plans.length > 1 ? " — all lines" : ""}</CardTitle>
              <CardDescription>
                Effective {assumptions.inhouseEffectiveDate}
                {plans.length === 1 ? ` · population read from ${plans[0].plan.scope.sourceMonth}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Average increase" value={formatPct(combinedSummary.weightedAvgIncreasePct, 2)} note="Revenue weighted" testId="text-avg-increase" />
              <Stat label="Residents" value={combinedSummary.residentCount.toLocaleString()} note={`${combinedSummary.residentsReceivingIncrease.toLocaleString()} receive one`} />
              <Stat label="Monthly revenue added" value={formatMoney(combinedSummary.totalMonthlyIncreaseDollars)} note={`${formatMoney(combinedSummary.totalAnnualIncreaseDollars)} annualized`} />
              <Stat
                label="Held back"
                value={(combinedSummary.residentsBlockedByStreet + combinedSummary.residentsAtMax).toLocaleString()}
                note={`${combinedSummary.residentsBlockedByStreet} at street · ${combinedSummary.residentsAtMax} at max · View residents`}
                onClick={showHeldBackResidents}
                testId="button-view-held-back-residents"
              />
            </CardContent>
          </Card>

          {/* ── Residents — all lines combined ──────────────────────── */}
          <Card id="resident-recommendations" className="scroll-mt-4">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Resident recommendations</CardTitle>
                  <CardDescription>
                     {restoredPlanDetailsOmitted && calculateTiers.isPending
                       ? "Loading residents and their calculation details for this campus…"
                       : heldBackOnly && (calculate.isPending || calculateTiers.isPending) && allTaggedResidents.length === 0
                         ? "Loading held-back residents and their calculation details…"
                       : <>
                           {sortedResidents.length.toLocaleString()} of{" "}
                           {allTaggedResidents.length.toLocaleString()} residents
                           {heldBackOnly ? " held back by the Street Rate or maximum increase" : ""}.
                           {" "}Tap a row to see why and how the increase was calculated.
                         </>}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Switch id="constrained-only" data-testid="switch-constrained-only" checked={constrainedOnly}
                      onCheckedChange={(v) => { setConstrainedOnly(v); setHeldBackOnly(false); setVisibleCount(50); }} />
                    <Label htmlFor="constrained-only" className="text-xs">Only residents hitting a limit</Label>
                  </div>
                  {heldBackOnly && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setHeldBackOnly(false)}
                    >
                      Clear held-back filter
                    </Button>
                  )}
                  {/* One export button per service line */}
                  {plans.map(({ sl }) => (
                    <Button key={sl} variant="outline" size="sm" data-testid="button-export-plan"
                      disabled={exportPlan.isPending || hasChangedPlanAssumptions}
                      onClick={() => exportPlan.mutate(sl)}
                    >
                      {exportPlan.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                      Export {plans.length > 1 ? sl : "to Excel"}
                    </Button>
                  ))}
                </div>
              </div>
            </CardHeader>
             {allTaggedResidents.length > 0 && residentIncreaseCharts.some(({ data }) => data.length > 0) && (
               <CardContent className="border-t px-4 py-4 sm:px-6">
                 <div className="mb-3">
                   <p className="text-sm font-medium">Resident in-house increases by tier</p>
                   <p className="text-xs text-muted-foreground">
                     Number of residents receiving each recommended in-house increase, shown separately by service line.
                   </p>
                 </div>
                 <div className={cn(
                   "grid gap-4",
                   residentIncreaseCharts.length > 1 ? "sm:grid-cols-2 xl:grid-cols-3" : "grid-cols-1",
                 )}>
                   {residentIncreaseCharts.map(({ sl, data, uniformReason }) => (
                     <div key={sl} className="rounded-lg border bg-muted/10 px-2 pt-2" data-testid={`resident-increase-chart-${sl}`}>
                       <div className="mb-1 text-center text-sm font-medium">{sl}</div>
                       {uniformReason && (
                         <p className="mb-1 px-1 text-center text-[10px] leading-tight text-muted-foreground">
                           {uniformReason}
                         </p>
                       )}
                       <div className="h-44">
                         <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data} margin={{ top: 8, right: 8, left: 16, bottom: 2 }}>
                             <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                             <XAxis
                               dataKey="tier"
                               tick={{ fontSize: 10 }}
                               tickLine={false}
                               axisLine={false}
                             />
                             <YAxis
                               allowDecimals={false}
                               tick={{ fontSize: 10 }}
                               tickLine={false}
                               axisLine={false}
                               width={42}
                               label={{ value: "Residents", angle: -90, position: "left", offset: 8, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                             />
                             <RechartsTooltip
                               formatter={(value: number) => [Number(value).toLocaleString(), "Residents"]}
                               labelFormatter={(label) => `Increase tier: ${label}`}
                               contentStyle={{
                                 borderRadius: "6px",
                                 borderColor: "hsl(var(--border))",
                                 background: "hsl(var(--popover))",
                                 color: "hsl(var(--popover-foreground))",
                                 fontSize: "11px",
                               }}
                             />
                             <Bar dataKey="residents" name="Residents" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                               {data.map((entry) => (
                                 <Cell key={`${sl}-${entry.tier}`} fill="#0f9f9a" />
                               ))}
                             </Bar>
                           </BarChart>
                         </ResponsiveContainer>
                       </div>
                     </div>
                   ))}
                 </div>
               </CardContent>
             )}
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      {plans.length > 1 && <th className="px-4 py-2 font-medium">SL</th>}
                      <SortableTh label="Campus" k="location" {...{ sortKey, sortDesc, toggleSort }} />
                      <SortableTh label="Room" k="roomNumber" {...{ sortKey, sortDesc, toggleSort }} />
                      <th className="px-4 py-2 font-medium">Room type</th>
                      <SortableTh label={`Current${unit}`} k="currentRate" align="right" {...{ sortKey, sortDesc, toggleSort }} />
                      <SortableTh label={`Street${unit}`} k="streetRate" align="right" {...{ sortKey, sortDesc, toggleSort }} />
                      <SortableTh label="Room to street" k="gap" align="right" {...{ sortKey, sortDesc, toggleSort }} />
                      <SortableTh label="Increase" k="increasePct" align="right" {...{ sortKey, sortDesc, toggleSort }} />
                      <SortableTh label="New rate" k="increaseDollars" align="right" {...{ sortKey, sortDesc, toggleSort }} />
                      <th className="px-4 py-2 font-medium">Limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResidents.slice(0, visibleCount).flatMap((r) => {
                      const open = expandedResident === r.key;
                      const colSpan = plans.length > 1 ? 10 : 9;
                      // Tagged residents are created directly from these plans,
                      // so the matching service-line plan is guaranteed here.
                      const residentPlan = plans.find(({ sl }) => sl === r._sl)!.plan;
                      return [
                        <tr key={r.key} data-testid="row-resident"
                          className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                          onClick={() => setExpandedResident(open ? null : r.key)}
                        >
                          {plans.length > 1 && (
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">{r._sl}</td>
                          )}
                          <td className="px-4 py-2.5">{r.location}</td>
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-1.5">
                              {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              {r.roomNumber}
                              {r.isCompanionBed && <Badge variant="outline" className="text-[11px] font-normal">B</Badge>}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{r.roomType || "—"}</td>
                          <td className="px-4 py-2.5 text-right font-mono">{formatMoney(r.currentRateDisplay)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                            <span className="inline-flex items-center justify-end gap-1.5">
                              {r.streetRateMonthly > 0 ? formatMoney(r.rateBasis === "daily" ? r.streetRateMonthly / (365 / 12) : r.streetRateMonthly) : "—"}
                              {r.rateProduct !== "base" && (
                                <Badge
                                  variant="outline"
                                  className="text-[11px] font-normal"
                                  title={`Compared against the ${RATE_PRODUCT_LABEL[r.rateProduct].toLowerCase()} street rate${STREET_SOURCE_NOTE[r.streetRateSource] ?? ""}.`}
                                >
                                  {RATE_PRODUCT_LABEL[r.rateProduct]}
                                </Badge>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                            {r.streetRateMonthly > 0 ? formatPct(r.gapToStreetPct, 1) : "—"}
                          </td>
                          <td className={cn("px-4 py-2.5 text-right font-mono font-medium", r.increasePct > 0 ? "" : "text-muted-foreground")}>
                            {formatPct(r.increasePct, 2)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono">
                            {formatMoney(r.newRateDisplay)}
                            {r.increaseDollarsDisplay > 0 && (
                              <span className="ml-1.5 text-xs text-muted-foreground">+{formatMoney(r.increaseDollarsDisplay)}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5"><ConstraintBadge constraint={r.constraint} /></td>
                        </tr>,
                        open ? (
                          <tr key={`${r.key}-detail`} className="border-b bg-muted/30">
                            <td colSpan={colSpan} className="px-4 py-4">
                              <Explanation
                                explanation={r.explanation}
                                plan={residentPlan}
                                serviceLine={r._sl}
                                exportPending={exportPlan.isPending}
                                onExport={() => exportPlan.mutate(r._sl)}
                              />
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              {visibleCount < sortedResidents.length && (
                <div className="flex justify-center border-t p-4">
                  <Button variant="outline" size="sm" onClick={() => setVisibleCount((c) => c + 100)} data-testid="button-show-more">
                    Show 100 more ({(sortedResidents.length - visibleCount).toLocaleString()} remaining)
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Submit proposals ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Submit this plan as proposals</CardTitle>
              <CardDescription>
                Submitting saves the calculated Street Rate and every resident increase as a
                numbered plan plus linked proposals. It does not change any live rate until the
                proposals are implemented and published.
                {plans.length > 1 && " Each service line is saved as a separate versioned plan."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!allFeasible && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    Some service lines do not reach the target. They can still be submitted as proposals for review.
                  </AlertDescription>
                </Alert>
              )}
              {!isAuthenticated && (
                <Alert>
                  <Info className="h-4 w-4" />
                   <AlertDescription>Sign in to submit a plan.</AlertDescription>
                </Alert>
              )}
              {hasChangedPlanAssumptions && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span>The assumptions have changed since this result was calculated. Recalculate the plan before submitting it.</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={calculatePlanAndTiers}
                      disabled={
                        !!rangeError ||
                        calculate.isPending ||
                        calculateTiers.isPending ||
                        !tierPoliciesReady
                      }
                      className="shrink-0"
                    >
                      {calculate.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Calculator className="mr-2 h-4 w-4" />
                      )}
                      Recalculate plan
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => applyPlan.mutate()}
                  disabled={!isAuthenticated || applyPlan.isPending || hasChangedPlanAssumptions}
                  data-testid="button-apply-plan"
                >
                  {applyPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Submit proposals for {plans.length > 1 ? `${plans.length} plan(s)` : "plan"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={(plansQuery.data?.plans?.length ?? 0) === 0}
                  onClick={() => {
                    setLocation(referenceDataUrl());
                  }}
                  title={(plansQuery.data?.plans?.length ?? 0) === 0
                    ? "Submit the calculated proposal first so Reference Data can load it."
                    : "Open the submitted or applied plan columns in Reference Data."}
                  data-testid="view-inhouse-plan-reference-data"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View in Reference Data
                </Button>
              </div>

            </CardContent>
          </Card>
        </>
      )}

      {(plansQuery.data?.plans?.length ?? 0) > 0 && (
        <Card id="plan-history">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Plan history</CardTitle>
            <CardDescription>
              Versioned Street Rate and resident increase plans previously submitted from this workflow.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {plansQuery.data!.plans.map((p) => {
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2"
                  >
                    <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">v{p.version}</span>
                      <span className="text-muted-foreground">
                        {p.location || "All campuses"} · {p.serviceLine}
                      </span>
                      <span className="font-mono text-xs">
                        {formatPct(p.summary?.weightedAvgIncreasePct ?? 0, 2)} avg
                      </span>
                      <span className="text-xs text-muted-foreground">
                        effective {p.inhouseEffectiveDate}
                      </span>
                      {p.status === "proposed" && (
                        <Badge variant="outline" className="text-[11px] font-normal">
                          Proposed
                        </Badge>
                      )}
                      {(p.status === "applied" || p.status === "published") && (
                        <Badge variant="outline" className="text-[11px] font-normal">
                          Applied
                        </Badge>
                      )}
                      {p.status === "superseded" && (
                        <Badge variant="outline" className="text-[11px] font-normal">
                          Superseded
                        </Badge>
                      )}
                    </div>
                    {p.targetDeviationDiagnostic ? (
                      <div className="w-full">
                        <TargetDeviationDiagnosticView
                          diagnostic={p.targetDeviationDiagnostic}
                          targetPct={p.assumptions.rateGrowthTargetPct}
                        />
                      </div>
                    ) : (
                      <p className="w-full text-xs text-muted-foreground">
                        Quarterly deviation diagnostic unavailable for this saved plan. It was
                        created before these explanations were persisted.
                      </p>
                    )}
                    {p.status === "withdrawn" && (
                      <Badge variant="outline" className="text-[11px] font-normal">
                        Removed
                      </Badge>
                    )}
                    {["proposed", "applied", "published"].includes(p.status) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="ml-auto h-7 text-xs text-destructive hover:text-destructive"
                        disabled={removePlan.isPending}
                        onClick={() => {
                          if (window.confirm(
                            `Remove plan v${p.version} from Reference Data? The audit history will be retained.`,
                          )) {
                            removePlan.mutate(p.id);
                          }
                        }}
                        data-testid={`remove-inhouse-plan-${p.id}`}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        Remove from Reference Data
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  testId,
  onClick,
}: {
  label: string;
  value: string;
  note?: string;
  testId?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold" data-testid={onClick ? undefined : testId}>
        {value}
      </div>
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      className="space-y-0.5 rounded-md p-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      data-testid={testId}
    >
      {content}
    </button>
  ) : (
    <div className="space-y-0.5">{content}</div>
  );
}

function SortableTh({
  label,
  k,
  align = "left",
  sortKey,
  sortDesc,
  toggleSort,
}: {
  label: string;
  k: SortKey;
  align?: "left" | "right";
  sortKey: SortKey;
  sortDesc: boolean;
  toggleSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      className={cn(
        "cursor-pointer select-none px-4 py-2 font-medium hover:text-foreground",
        align === "right" && "text-right",
        active && "text-foreground",
      )}
      onClick={() => toggleSort(k)}
      data-testid={`sort-${k}`}
    >
      {label}
      {active && <span className="ml-1">{sortDesc ? "↓" : "↑"}</span>}
    </th>
  );
}

/** Strips the "422: " status prefix apiRequest bakes into thrown errors. */
function cleanError(message: string): string {
  const stripped = message.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed.error === "string") return parsed.error;
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return stripped;
}
