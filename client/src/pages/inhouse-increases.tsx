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
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
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
  ArrowRight,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  Loader2,
  Save,
  TrendingUp,
} from "lucide-react";
import {
  clearInhousePlanStorage,
  readInhousePlan,
  writeInhousePlan,
} from "@/lib/inhousePlanStorage";
import { RATE_PRODUCT_LABEL } from "@shared/rateProduct";
import { DAYS_PER_MONTH } from "@shared/careRates";
import {
  DEFAULT_ASSUMPTIONS,
  formatMoney,
  formatPct,
  planAssumptionsMatch,
  selectSubmittablePlans,
  type CalcExplanation,
  type EqualizationStrength,
  type PlanResult,
  type PlanningAssumptions,
  type ResidentRecommendation,
} from "@shared/inhousePlanning";
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
          className="inline-flex cursor-help items-center gap-1 border-b border-dotted border-current/40 outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

interface QuarterYoyCell {
  key: string;
  label: string;
  /** Null when the prior-year quarter has no realized rate to measure against. */
  yoyPct: number | null;
  passes: boolean;
}

/**
 * Per-quarter YoY under the column average. Quarter labels drop the year while
 * every quarter shares one, which is the usual single-plan-year case. A quarter
 * with no prior-year baseline reads "n/a" — the solver scores it as 0% and
 * passing, which would otherwise show as a green 0.0%.
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
            <span className="font-medium text-muted-foreground">n/a</span>
          ) : (
            <span
              className={cn(
                "font-medium tabular-nums",
                quarter.passes ? "text-emerald-600" : "text-amber-600",
              )}
            >
              {formatPct(quarter.yoyPct, 1)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** "Q1" when the whole set sits in one year, otherwise "Q1 '27". */
function quarterCellLabel(quarter: number, year: number, singleYear: boolean): string {
  return singleYear ? `Q${quarter}` : `Q${quarter} '${String(year).slice(-2)}`;
}

const SERVICE_LINES = ["AL", "AL/MC", "HC", "HC/MC", "SL", "VIL"];

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
function Explanation({ explanation }: { explanation: CalcExplanation }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="font-medium">{explanation.headline}</div>
      <div className="space-y-1.5">
        {explanation.steps.map((step, i) => (
          <div key={i} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
            <span className="min-w-[13rem] text-muted-foreground">{step.label}</span>
            <span className="font-mono font-medium">{step.value}</span>
            {step.note && (
              <span className="text-xs text-muted-foreground sm:ml-2">{step.note}</span>
            )}
          </div>
        ))}
      </div>
      {explanation.narrative.length > 0 && (
        <div className="space-y-1 border-l-2 border-muted pl-3 text-muted-foreground">
          {explanation.narrative.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      )}
    </div>
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
  "data-testid": testId,
}: {
  value: number | "";
  onCommit: (value: number) => void;
  className?: string;
  id?: string;
  min?: number;
  max?: number;
  step?: number;
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

interface CalculateRequest {
  identityKey: string | null;
  locationId: string | null;
  serviceLines: string[];
  assumptionsByLine: Record<string, PlanningAssumptions>;
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
function calculatedPlanScopeKey(locationId: string | null, serviceLines: string[]): string {
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

export default function InhouseIncreases() {
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

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
  const [assumptionsTouched, setAssumptionsTouched] = useState(false);
  const [, startAssumptionTransition] = useTransition();
  const [plans, setPlans] = useState<PlanWithSl[] | null>(null);
  const [expandedQuarter, setExpandedQuarter] = useState<string | null>(null);
  const [expandedResident, setExpandedResident] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("increasePct");
  const [sortDesc, setSortDesc] = useState(true);
  const [constrainedOnly, setConstrainedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);

  const scopeLocationId = locationId === ALL_CAMPUSES ? null : locationId;
  const storageIdentityKey =
    user?.isAuthenticated && user.id && user.clientId
      ? `${user.clientId}::${user.id}`
      : null;
  // When a single line is selected use it; otherwise use the first for assumptions loading.
  const firstLine = serviceLines[0] ?? SERVICE_LINES[0];
  const singleLine = serviceLines.length === 1 ? serviceLines[0] : null;
  const calculatedPlanKey = useMemo(
    () => storageIdentityKey
      ? calculatedPlanScopeKey(scopeLocationId, serviceLines)
      : null,
    [scopeLocationId, serviceLines, storageIdentityKey],
  );

  const previousStorageIdentity = useRef<string | null | undefined>(undefined);
  const currentStorageIdentity = useRef<string | null>(storageIdentityKey);
  useEffect(() => {
    const previous = previousStorageIdentity.current;
    previousStorageIdentity.current = storageIdentityKey;
    currentStorageIdentity.current = storageIdentityKey;
    if (previous !== undefined && previous !== storageIdentityKey) {
      void clearInhousePlanStorage();
    }
  }, [storageIdentityKey]);

  // Restore the last calculation for every selected campus + service-line.
  // A multi-line calculation is also saved one line at a time, so calculating
  // "All service lines" once means AL, HC, etc. are immediately available when
  // the operator later filters to either line individually (and vice versa).
  useEffect(() => {
    let cancelled = false;
    setPlans(null);
    setVisibleCount(50);
    setExpandedResident(null);
    setExpandedQuarter(null);
    void (async () => {
      const stored = await readInhousePlan<PlanWithSl[]>(storageIdentityKey, calculatedPlanKey);
      let restored =
        Array.isArray(stored) &&
        stored.every(isStoredPlan) &&
        stored.every(({ sl }) => serviceLines.includes(sl))
          ? stored
          : null;

      // Older cache entries and individually calculated lines may not have a
      // combined entry for the current multi-select. Compose it from each
      // line's most recent result rather than forcing another Calculate.
      if (!restored || restored.length !== serviceLines.length) {
        const perLine = await Promise.all(
          serviceLines.map(async (sl) => {
            const lineKey = calculatedPlanScopeKey(scopeLocationId, [sl]);
            const lineStored = await readInhousePlan<PlanWithSl[]>(
              storageIdentityKey,
              lineKey,
            );
            return Array.isArray(lineStored)
              ? lineStored.find((candidate) => isStoredPlan(candidate) && candidate.sl === sl) ?? null
              : null;
          }),
        );
        const available = perLine.filter((plan): plan is PlanWithSl => plan !== null);
        restored = available.length > 0 ? available : restored;
      }

      if (cancelled) return;
      setPlans(restored);
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
  }

  const { data: locationsData } = useQuery<{ locations: LocationRow[] }>({
    queryKey: ["/api/locations"],
  });
  const locations = locationsData?.locations ?? [];

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
   * Per-line overrides belong to the campus they were seeded from. Keeping
   * them across a campus change leaves the previous campus's turnover sitting
   * in the box for any line the new campus cannot measure — while the note
   * underneath says the saved assumption is being used. Clear them and let
   * both loaders reseed for the new scope.
   */
  useEffect(() => {
    setPerLineTargets({});
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
    if (assumptionsTouched || !turnoverQuery.data) return;
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
  }, [turnoverQuery.data, turnoverBySl, serviceLines, assumptionsTouched, assumptions]);

  /**
   * The workbook is built server-side: it needs the solver's per-resident
   * internals (weight, headroom, shape, effective bounds, lambda) to write the
   * formula chain, and none of those are on the PlanResult the page holds.
   */
  // Export one service line at a time (the server builds the full formula workbook
  // per-line). When multiple lines are selected we download each sequentially.
  const exportPlan = useMutation({
    mutationFn: async (sl: string) => {
      const res = await fetch("/api/inhouse-planning/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          locationId: scopeLocationId,
          serviceLine: sl,
          assumptions: assumptionsForLine(sl),
        }),
      });
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

  // Run one calculate call per selected service line in parallel and combine.
  const calculate = useMutation({
    mutationFn: async (request: CalculateRequest) => {
      const requestedScopeKey = calculatedPlanScopeKey(request.locationId, request.serviceLines);
      const settled = await Promise.allSettled(
        request.serviceLines.map(async (sl) => {
          const res = await apiRequest("/api/inhouse-planning/calculate", "POST", {
            locationId: request.locationId,
            serviceLine: sl,
            assumptions: request.assumptionsByLine[sl],
          });
          const plan = (await res.json()) as PlanResult;
          return { sl, plan } as PlanWithSl;
        }),
      );
      const results: PlanWithSl[] = [];
      const skipped: Array<{ sl: string; message: string }> = [];
      settled.forEach((outcome, index) => {
        const sl = request.serviceLines[index];
        if (outcome.status === "fulfilled") {
          results.push(outcome.value);
        } else {
          const message =
            outcome.reason instanceof Error
              ? cleanError(outcome.reason.message)
              : "No plan could be calculated for this service line.";
          skipped.push({ sl, message });
        }
      });
      if (results.length === 0) {
        throw new Error(
          skipped.length > 0
            ? skipped.map(({ sl, message }) => `${sl}: ${message}`).join(" ")
            : "No service lines were selected.",
        );
      }
      return { identityKey: request.identityKey, scopeKey: requestedScopeKey, results, skipped };
    },
    onSuccess: ({ identityKey, scopeKey, results, skipped }) => {
      // Persist the completed request even if the operator switched filters
      // while it was running. Save both the exact selection and each line so
      // any later filter combination can restore the last available plans.
      if (identityKey) {
        void Promise.all([
          writeInhousePlan(identityKey, scopeKey, results),
          ...results.map((result) =>
            writeInhousePlan(
              identityKey,
              calculatedPlanScopeKey(result.plan.scope.locationId ?? null, [result.sl]),
              [result],
            ),
          ),
        ]);
      }
      // If the operator changed scope while the request was running, retain
      // the result under its original scope but never render it under the new
      // one.
      if (
        identityKey !== currentStorageIdentity.current ||
        scopeKey !== calculatedPlanKey ||
        !identityKey
      ) return;
      setPlans(results);
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
    },
    onError: (err: Error) => {
      // Do not clear the current or stored successful result. A transient
      // calculation failure must not erase the last plan the operator can use.
      toast({ title: "Could not calculate a plan", description: cleanError(err.message), variant: "destructive" });
    },
  });

  // Saving writes the shared assumptions to every selected service line.
  const saveAssumptions = useMutation({
    mutationFn: async () => {
      await Promise.all(
        serviceLines.map((sl) =>
          apiRequest("/api/inhouse-planning/assumptions", "POST", {
            locationId: scopeLocationId,
            serviceLine: sl,
            assumptions: assumptionsForLine(sl),
          }).then((r) => r.json()),
        ),
      );
    },
    onSuccess: () => {
      setAssumptionsTouched(false);
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
      const submittablePlans = selectSubmittablePlans(currentPlans);
      if (submittablePlans.length === 0) {
        throw new Error("No service lines currently reach the target. Recalculate after adjusting the assumptions.");
      }
      const hasChangedAssumptions = submittablePlans.some(
        ({ sl, plan }) => !planAssumptionsMatch(plan.assumptions, assumptionsForLine(sl)),
      );
      if (hasChangedAssumptions) {
        throw new Error("These results were calculated with different assumptions. Recalculate the plan before submitting it.");
      }
      const results = await Promise.all(
        submittablePlans.map(({ sl }) =>
          apiRequest("/api/inhouse-planning/apply", "POST", {
            locationId: scopeLocationId,
            serviceLine: sl,
            assumptions: assumptionsForLine(sl),
          }).then((r) => r.json()),
        ),
      );
      return results;
    },
    onSuccess: (results: any[]) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inhouse-planning/plans"] });
      queryClient.invalidateQueries({ queryKey: ["/api/adjustment-rules"], exact: false });
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

  function update<K extends keyof PlanningAssumptions>(key: K, value: PlanningAssumptions[K]) {
    setAssumptionsTouched(true);
    setAssumptions((prev) => ({ ...prev, [key]: value }));
  }

  function updatePerLine(sl: string, field: "rateGrowthTargetPct" | "annualTurnoverPct", value: number) {
    setAssumptionsTouched(true);
    // A committed assumption invalidates summaries, charts, and thousands of
    // resident rows. Keep focus/typing urgent and render that derived work at
    // transition priority so moving between fields remains immediate.
    startAssumptionTransition(() => {
      setPerLineTargets((prev) => ({
        ...prev,
        [sl]: {
          rateGrowthTargetPct: prev[sl]?.rateGrowthTargetPct ?? assumptions.rateGrowthTargetPct,
          annualTurnoverPct: prev[sl]?.annualTurnoverPct ?? assumptions.annualTurnoverPct,
          [field]: value,
        },
      }));
    });
  }

  /** Merge shared assumptions with a service line's per-line overrides. */
  function assumptionsForLine(sl: string): PlanningAssumptions {
    const overrides = perLineTargets[sl];
    if (!overrides) return assumptions;
    return { ...assumptions, ...overrides };
  }

  const hasChangedPlanAssumptions = !!plans?.some(
    ({ sl, plan }) => !planAssumptionsMatch(plan.assumptions, assumptionsForLine(sl)),
  );

  const rangeError =
    assumptions.minInhouseIncreasePct > assumptions.maxInhouseIncreasePct
      ? "The minimum increase cannot be larger than the maximum."
      : assumptions.minStreetIncreasePct > assumptions.maxStreetIncreasePct
        ? "The minimum Street Rate increase cannot be larger than the maximum."
      : null;

  // Combine residents from all plans, tagging each with its service line.
  const allTaggedResidents: TaggedResident[] = useMemo(
    () => (plans ?? []).flatMap(({ sl, plan }) => plan.residents.map((r) => ({ ...r, _sl: sl }))),
    [plans],
  );

  const sortedResidents = useMemo(() => {
    const filtered = constrainedOnly
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
  }, [allTaggedResidents, sortKey, sortDesc, constrainedOnly]);

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
    let quartersMeetingGoal = 0;
    let projectedQuarterCount = 0;
    // Resident-weighted YoY per calendar quarter, so the combined row can show
    // the same quarter-by-quarter detail as each service line.
    const quarterTotals = new Map<
      string,
      { year: number; quarter: number; weighted: number; goalWeighted: number; residents: number }
    >();
    for (const { plan } of plans) {
      const count = plan.summary.residentCount;
      const fullYearYoy = fullYearYoyFromQuarters(plan.quarters, plan.rateBasis);
      const quarterlyYoyValues = plan.quarters
        .map((quarter) => quarter.yoyGrowthPct)
        .filter(Number.isFinite);
      const averageQuarterlyYoy = quarterlyYoyValues.length > 0
        ? quarterlyYoyValues.reduce((sum, value) => sum + value, 0) / quarterlyYoyValues.length
        : 0;
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
      quarterlyGoalWeighted += plan.assumptions.rateGrowthTargetPct * count;
      quarterlyYoyWeighted += averageQuarterlyYoy * count;
      quartersMeetingGoal += plan.quarters.filter((quarter) => quarter.passes).length;
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
        const priorRate = quarter.priorYear.realizedRateMonthly;
        if (priorRate == null || priorRate <= 0 || !Number.isFinite(quarter.yoyGrowthPct)) continue;
        bucket.weighted += quarter.yoyGrowthPct * count;
        bucket.goalWeighted += plan.assumptions.rateGrowthTargetPct * count;
        bucket.residents += count;
      }
    }
    const orderedQuarters = Array.from(quarterTotals.entries()).sort(
      ([, a], [, b]) => a.year - b.year || a.quarter - b.quarter,
    );
    const singleQuarterYear = new Set(orderedQuarters.map(([, q]) => q.year)).size <= 1;
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
      quarterlyGoalPct: residents > 0 ? quarterlyGoalWeighted / residents : 0,
      averageQuarterlyYoyPct: residents > 0 ? quarterlyYoyWeighted / residents : 0,
      quartersMeetingGoal,
      projectedQuarterCount,
      quarterlyBreakdown: orderedQuarters.map(([key, bucket]) => {
        const measurable = bucket.residents > 0;
        const yoyPct = measurable ? bucket.weighted / bucket.residents : null;
        const goalPct = measurable ? bucket.goalWeighted / bucket.residents : 0;
        return {
          key,
          label: quarterCellLabel(bucket.quarter, bucket.year, singleQuarterYear),
          yoyPct,
          // Colour the weighted number against the weighted goal, so it always
          // describes the value shown rather than a per-line pass tally.
          passes: yoyPct != null && yoyPct >= goalPct - 1e-6,
        };
      }),
    };
  }, [plans]);

  const allFeasible = plans ? plans.every((p) => p.plan.feasible) : false;
  const anyFeasible = plans ? plans.some((p) => p.plan.feasible) : false;
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
            onClick={() => setLocation("/overview")}
            data-testid="button-back"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Scope</CardTitle>
          <CardDescription>
            Assumptions are saved per campus and service line. Selecting multiple service lines
            uses one shared set of assumptions, saving to each selected line.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        </CardContent>
      </Card>

      {/* ── Assumptions ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Assumptions</CardTitle>
          <CardDescription>
            The objective and the guardrails the solver has to work inside.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
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

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              testId="input-min-increase"
              label="Minimum resident increase"
              value={assumptions.minInhouseIncreasePct}
              onChange={(v) => update("minInhouseIncreasePct", v)}
              suffix="%"
              hint="Floor for anyone who has room to move."
            />
            <NumberField
              testId="input-max-increase"
              label="Maximum resident increase"
              value={assumptions.maxInhouseIncreasePct}
              onChange={(v) => update("maxInhouseIncreasePct", v)}
              suffix="%"
              hint="No resident is ever raised past this, even if the target needs it."
            />
            <NumberField
              testId="input-min-street"
              label="Minimum street increase"
              value={assumptions.minStreetIncreasePct}
              onChange={(v) => update("minStreetIncreasePct", v)}
              suffix="%"
              hint="Minimum Street Rate movement when the plan is calculated; hard maximums still apply."
            />
            <NumberField
              testId="input-desired-top-comp-variance"
              label="Desired variance to Top Competitor"
              value={assumptions.desiredVarianceToTopCompetitorPct}
              onChange={(v) => update("desiredVarianceToTopCompetitorPct", v)}
              suffix="%"
              hint="Directional target: negative stays below Top Competitor, positive moves above. It pushes underpriced rates more but never caps an increase."
            />
            <NumberField
              testId="input-max-street"
              label="Maximum street increase"
              value={assumptions.maxStreetIncreasePct}
              onChange={(v) => update("maxStreetIncreasePct", v)}
              suffix="%"
              hint="How far the solver may push street rate to create headroom."
            />
            <NumberField
              testId="input-max-yoy-street"
              label="Maximum YoY street increase"
              value={assumptions.maxYoYStreetIncreasePct}
              onChange={(v) => update("maxYoYStreetIncreasePct", v)}
              suffix="%"
              hint="Caps the proposed January rate versus January of the prior year—for example, 1/1/27 versus 1/1/26."
            />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Equalization</Label>
              <Select
                value={assumptions.equalizationStrength}
                onValueChange={(v) => update("equalizationStrength", v as EqualizationStrength)}
              >
                <SelectTrigger className="h-9" data-testid="select-equalization">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low — nearly the same increase for everyone</SelectItem>
                  <SelectItem value="medium">Medium — moderate catch-up</SelectItem>
                  <SelectItem value="high">High — aggressive catch-up</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">
                How much more the residents furthest below street get than those closest to it.
              </p>
            </div>
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
              onClick={() => {
                const selectedLines = [...serviceLines];
                calculate.mutate({
                  identityKey: storageIdentityKey,
                  locationId: scopeLocationId,
                  serviceLines: selectedLines,
                  assumptionsByLine: Object.fromEntries(
                    selectedLines.map((sl) => [sl, { ...assumptionsForLine(sl) }]),
                  ),
                });
              }}
              disabled={!!rangeError || calculate.isPending}
              data-testid="button-calculate"
            >
              {calculate.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Calculator className="mr-2 h-4 w-4" />
              )}
              Calculate plan
            </Button>
            <Button
              variant="outline"
              onClick={() => saveAssumptions.mutate()}
              disabled={!!rangeError || saveAssumptions.isPending}
              data-testid="button-save-assumptions"
            >
              {saveAssumptions.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save assumptions
            </Button>
          </div>
        </CardContent>
      </Card>

      {calculate.isPending && !plans?.length && (
        <div className="flex items-center gap-3 rounded-md border p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading the rent roll and solving for {serviceLines.length > 1 ? `${serviceLines.length} service lines` : serviceLines[0]}…
        </div>
      )}

      {calculate.isPending && !!plans?.length && (
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
              <CardTitle className="text-base">Rate growth snapshot</CardTitle>
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
                    explanation="Weighted projected realized rate for the full plan year versus the weighted realized rate for the full prior year."
                  />
                  <HeaderHelp
                    label="Quarterly YoY goal"
                    explanation={`Minimum YoY growth required for: ${quarterlyComparisonPeriods}.`}
                  />
                  <HeaderHelp
                    label="Average quarterly YoY"
                    explanation={`Average of: ${quarterlyComparisonPeriods}. Each quarter's own result is listed beneath the average — green when it meets the goal, amber when it falls short.`}
                  />
                  <HeaderHelp
                    label="Quarters at goal"
                    explanation={`Periods meeting the goal: ${quarterlyComparisonPeriods}.`}
                  />
                </div>
                {plans.map(({ sl, plan }) => {
                  const daily = plan.rateBasis === "daily";
                  const rate = (monthly: number) => formatMoney(daily ? monthly / DAYS_PER_MONTH : monthly);
                  const quarterlyYoyValues = plan.quarters
                    .map((quarter) => quarter.yoyGrowthPct)
                    .filter(Number.isFinite);
                  const averageQuarterlyYoy = quarterlyYoyValues.length > 0
                    ? quarterlyYoyValues.reduce((sum, value) => sum + value, 0) / quarterlyYoyValues.length
                    : 0;
                  const fullYearYoy = fullYearYoyFromQuarters(plan.quarters, plan.rateBasis);
                  const planYear = plan.quarters[0]?.year;
                  const singleQuarterYear = new Set(plan.quarters.map((quarter) => quarter.year)).size <= 1;
                  const quarterCells: QuarterYoyCell[] = plan.quarters.map((quarter) => {
                    const priorRate = quarter.priorYear.realizedRateMonthly;
                    const measurable =
                      priorRate != null && priorRate > 0 && Number.isFinite(quarter.yoyGrowthPct);
                    return {
                      key: `${quarter.year}-Q${quarter.quarter}`,
                      label: quarterCellLabel(quarter.quarter, quarter.year, singleQuarterYear),
                      yoyPct: measurable ? quarter.yoyGrowthPct : null,
                      passes: quarter.passes,
                    };
                  });
                  const quartersMeetingGoal = plan.quarters.filter((quarter) => quarter.passes).length;
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
                        <p className="text-xs text-muted-foreground">Each quarter</p>
                      </div>
                      <div>
                        <p className="font-semibold">{formatPct(averageQuarterlyYoy, 1)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatPct(averageQuarterlyYoy - plan.assumptions.rateGrowthTargetPct, 1)} vs goal
                        </p>
                        <QuarterYoyBreakdown quarters={quarterCells} />
                      </div>
                      <div>
                        <p className={cn("font-semibold", quartersMeetingGoal === plan.quarters.length ? "text-emerald-600" : "text-amber-600")}>
                          {quartersMeetingGoal} / {plan.quarters.length}
                        </p>
                        <p className="text-xs text-muted-foreground">Projected quarters</p>
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
                      <QuarterYoyBreakdown quarters={growthSnapshot.quarterlyBreakdown} />
                    </div>
                    <div>
                      <p className={cn("font-semibold", growthSnapshot.quartersMeetingGoal === growthSnapshot.projectedQuarterCount ? "text-emerald-600" : "text-amber-600")}>
                        {growthSnapshot.quartersMeetingGoal} / {growthSnapshot.projectedQuarterCount}
                      </p>
                      <p className="text-xs text-muted-foreground">Service-line quarters</p>
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
                            {daily ? "Daily rate" : "Monthly rate"} · growth from today shown on hover
                          </p>
                        </div>
                        <Badge variant="outline">
                          {chartData.length > 0
                            ? `${chartData[chartData.length - 1].growthFromCurrentPct >= 0 ? "+" : ""}${chartData[chartData.length - 1].growthFromCurrentPct.toFixed(1)}%`
                            : "No monthly data"}
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
                                    ? ` (${item.payload.growthFromCurrentPct >= 0 ? "+" : ""}${item.payload.growthFromCurrentPct.toFixed(1)}% from today)`
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

          {/* ── Feasibility ─────────────────────────────────────────── */}
          {allFeasible ? (
            <Alert className="border-emerald-500/40 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <AlertTitle>
                {plans.length > 1
                  ? "Each configured growth target is reachable across the selected service lines"
                  : `${formatPct(plans[0].plan.assumptions.rateGrowthTargetPct)} growth is reachable`}
              </AlertTitle>
              <AlertDescription>
                Every quarter in the next year clears the target
                {plans.length === 1 && plans[0].plan.bindingQuarterLabel && (
                  <> — <span className="font-medium">{plans[0].plan.bindingQuarterLabel}</span> is the tightest</>
                )}.
              </AlertDescription>
            </Alert>
          ) : (
            // Show per-line feasibility breakdown when any line fails.
            <div className="space-y-2" data-testid="alert-infeasible">
              {plans.map(({ sl, plan }) =>
                plan.feasible ? (
                  <Alert key={sl} className="border-emerald-500/40 bg-emerald-500/10">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <AlertTitle>{sl} — reachable</AlertTitle>
                  </Alert>
                ) : (
                  <Alert key={sl} variant="destructive">
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
                ),
              )}
            </div>
          )}

          {allWarnings.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Worth knowing about this data</AlertTitle>
              <AlertDescription>
                <ul className="ml-4 list-disc space-y-1 text-sm">
                  {allWarnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Street rate — one card per service line ─────────────── */}
          <div className={cn("grid gap-4", plans.length === 1 ? "lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3")}>
            {plans.map(({ sl, plan }) => {
              const slUnit = plan.rateBasis === "daily" ? "/day" : "/mo";
              return (
                <Card key={sl}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Street rate{plans.length > 1 ? ` · ${sl}` : ""}</CardTitle>
                    <CardDescription>Effective {plan.assumptions.streetRateEffectiveDate}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-baseline gap-2">
                      <span className="text-base text-muted-foreground line-through">{formatMoney(plan.currentStreetRateDisplay)}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <span className="text-2xl font-semibold" data-testid="text-recommended-street">{formatMoney(plan.recommendedStreetRateDisplay)}</span>
                      <span className="text-sm text-muted-foreground">{slUnit}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">{formatPct(plan.streetIncreasePct, 2)} increase</Badge>
                  </CardContent>
                </Card>
              );
            })}

            {/* ── Combined resident summary ── */}
            <Card className={plans.length === 1 ? "lg:col-span-2" : "sm:col-span-2 lg:col-span-3"}>
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
                <Stat label="Held back" value={(combinedSummary.residentsBlockedByStreet + combinedSummary.residentsAtMax).toLocaleString()} note={`${combinedSummary.residentsBlockedByStreet} at street · ${combinedSummary.residentsAtMax} at max`} />
              </CardContent>
            </Card>
          </div>

          {/* ── How each plan was derived + quarterly (per line) ─────── */}
          {plans.map(({ sl, plan }) => (
            <div key={sl} className="space-y-4">
              {plans.length > 1 && (
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{sl}</h2>
              )}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">How this plan was derived{plans.length > 1 ? ` · ${sl}` : ""}</CardTitle>
                </CardHeader>
                <CardContent><Explanation explanation={plan.explanation} /></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Quarterly realized rate vs prior year{plans.length > 1 ? ` · ${sl}` : ""}</CardTitle>
                  <CardDescription>
                    Each quarter compared against the same quarter one year earlier. Binding quarter sets the plan.
                    {plan.rateBasis === "daily" ? " Rates are shown per day." : " Rates are shown per month."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0 sm:p-6 sm:pt-0">
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
                          const displayRate = (monthly: number) =>
                            formatMoney(plan.rateBasis === "daily" ? monthly / DAYS_PER_MONTH : monthly);
                          return [
                            <tr key={qKey} data-testid={`row-quarter-${q.label.replace(/\s/g, "-")}`}
                              className={cn("cursor-pointer border-b transition-colors hover:bg-muted/50", q.isBinding && "bg-amber-500/[0.07]")}
                              onClick={() => setExpandedQuarter(open ? null : qKey)}
                            >
                              <td className="px-4 py-2.5 font-medium">
                                <span className="flex items-center gap-1.5">
                                  {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                                  {q.label}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  {q.priorYear.label}
                                  {q.priorYear.basis !== "actual" && (
                                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[11px] font-normal text-amber-600 dark:text-amber-400">
                                      {q.priorYear.basis === "projected" ? "Projected" : `${q.priorYear.monthsAvailable} of ${q.priorYear.monthsExpected} months`}
                                    </Badge>
                                  )}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono">{q.priorYear.realizedRateMonthly === null ? "—" : displayRate(q.priorYear.realizedRateMonthly)}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{displayRate(q.requiredRateMonthly)}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-medium">{displayRate(q.projectedRateMonthly)}</td>
                              <td className={cn("px-4 py-2.5 text-right font-mono font-medium", q.passes ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>{formatPct(q.yoyGrowthPct, 2)}</td>
                              <td className="px-4 py-2.5">
                                <span className="flex flex-wrap gap-1.5">
                                  {q.isBinding && <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[11px] font-normal text-amber-600 dark:text-amber-400">Binding</Badge>}
                                  {!q.passes && <Badge variant="destructive" className="text-[11px] font-normal">{formatPct(q.shortfallPct, 2)} short</Badge>}
                                </span>
                              </td>
                            </tr>,
                            open ? (
                              <tr key={`${qKey}-detail`} className="border-b bg-muted/30">
                                <td colSpan={7} className="space-y-4 px-4 py-4">
                                  <Explanation explanation={q.explanation} />
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
                </CardContent>
              </Card>
            </div>
          ))}

          {/* ── Residents — all lines combined ──────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Resident recommendations</CardTitle>
                  <CardDescription>
                    {sortedResidents.length.toLocaleString()} of{" "}
                    {allTaggedResidents.length.toLocaleString()} residents. Tap a row to see how the increase was calculated.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Switch id="constrained-only" data-testid="switch-constrained-only" checked={constrainedOnly}
                      onCheckedChange={(v) => { setConstrainedOnly(v); setVisibleCount(50); }} />
                    <Label htmlFor="constrained-only" className="text-xs">Only residents hitting a limit</Label>
                  </div>
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
                            <td colSpan={colSpan} className="px-4 py-4"><Explanation explanation={r.explanation} /></td>
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
              {!anyFeasible && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    No plans reach the target. Adjust the assumptions above first.
                  </AlertDescription>
                </Alert>
              )}
              {!allFeasible && anyFeasible && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                     Some service lines do not reach the target and cannot be submitted. Only feasible lines will be submitted.
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
                      onClick={() => calculate.mutate()}
                      disabled={!!rangeError || calculate.isPending}
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
              <Button
                onClick={() => applyPlan.mutate()}
                disabled={!anyFeasible || !isAuthenticated || applyPlan.isPending || hasChangedPlanAssumptions}
                data-testid="button-apply-plan"
              >
                {applyPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                 Submit proposals for {plans.length > 1 ? `${plans.filter((p) => p.plan.feasible).length} plan(s)` : "plan"}
              </Button>

            </CardContent>
          </Card>
        </>
      )}

      {(plansQuery.data?.plans?.length ?? 0) > 0 && (
        <Card>
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
}: {
  label: string;
  value: string;
  note?: string;
  testId?: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold" data-testid={testId}>
        {value}
      </div>
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
    </div>
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
