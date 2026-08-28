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
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
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
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Calculator,
  Download,
  Info,
  Loader2,
  Save,
  TrendingUp,
} from "lucide-react";
import {
  DEFAULT_ASSUMPTIONS,
  formatMoney,
  formatPct,
  type EqualizationStrength,
  type PlanResult,
  type PlanningAssumptions,
  type ResidentRecommendation,
  type CalcExplanation,
} from "@shared/inhousePlanning";
import {
  MODEL_MAX_TURNOVER_PCT,
  MODEL_MIN_TURNOVER_PCT,
  defaultTurnoverFor,
  describeTurnoverBand,
  explainTurnoverOutOfBand,
  formatLos,
} from "@shared/turnoverBounds";

const SERVICE_LINES = ["AL", "AL/MC", "HC", "HC/MC", "SL", "VIL"];

/** One service line's measured turnover, from /api/inhouse-planning/historical-turnover. */
interface ServiceLineTurnover {
  serviceLine: string;
  moveOuts: number;
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
}: {
  serviceLine: string;
  hist: ServiceLineTurnover | undefined;
  applied: number;
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

  let history: JSX.Element;
  if (!hist) {
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
        — {hist.moveOuts.toLocaleString()} move-outs /{" "}
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
        {hist.moveOuts.toLocaleString()} move-outs /{" "}
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
    <div className="mt-1 space-y-0.5 text-[11px] leading-tight">
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
        <Input
          id={testId}
          data-testid={testId}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const next = e.target.value === "" ? NaN : Number(e.target.value);
            onChange(next);
          }}
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

/** A ResidentRecommendation tagged with the service line it came from. */
type TaggedResident = ResidentRecommendation & { _sl: string };

export default function InhouseIncreases() {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const [locationId, setLocationId] = useState<string>(ALL_CAMPUSES);
  // Multi-select: default to all service lines.
  const [serviceLines, setServiceLines] = useState<string[]>([...SERVICE_LINES]);
  const [assumptions, setAssumptions] = useState<PlanningAssumptions>({ ...DEFAULT_ASSUMPTIONS });
  // Per-line overrides for the two fields that legitimately differ by service line.
  const [perLineTargets, setPerLineTargets] = useState<
    Record<string, { rateGrowthTargetPct: number; annualTurnoverPct: number }>
  >({});
  const [assumptionsTouched, setAssumptionsTouched] = useState(false);
  const [plans, setPlans] = useState<PlanWithSl[] | null>(null);
  const [expandedQuarter, setExpandedQuarter] = useState<string | null>(null);
  const [expandedResident, setExpandedResident] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("increasePct");
  const [sortDesc, setSortDesc] = useState(true);
  const [constrainedOnly, setConstrainedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);

  const scopeLocationId = locationId === ALL_CAMPUSES ? null : locationId;
  // When a single line is selected use it; otherwise use the first for assumptions loading.
  const firstLine = serviceLines[0] ?? SERVICE_LINES[0];
  const singleLine = serviceLines.length === 1 ? serviceLines[0] : null;

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
    queryKey: ["/api/inhouse-planning/historical-turnover", scopeLocationId ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (scopeLocationId) params.set("locationId", scopeLocationId);
      const res = await fetch(`/api/inhouse-planning/historical-turnover?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
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
        body: JSON.stringify({ locationId: scopeLocationId, serviceLine: sl, assumptions }),
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
    mutationFn: async () => {
      const results = await Promise.all(
        serviceLines.map(async (sl) => {
          const res = await apiRequest("/api/inhouse-planning/calculate", "POST", {
            locationId: scopeLocationId,
            serviceLine: sl,
            assumptions: assumptionsForLine(sl),
          });
          const plan = (await res.json()) as PlanResult;
          return { sl, plan } as PlanWithSl;
        }),
      );
      return results;
    },
    onSuccess: (results) => {
      setPlans(results);
      setVisibleCount(50);
      setExpandedResident(null);
      // Expand the binding quarter of the first feasible plan.
      const first = results.find((r) => r.plan.feasible) ?? results[0];
      setExpandedQuarter(first?.plan.bindingQuarterLabel ?? null);
    },
    onError: (err: Error) => {
      setPlans(null);
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

  // Apply each plan separately. Server re-calculates and versions each one.
  const applyPlan = useMutation({
    mutationFn: async () => {
      const results = await Promise.all(
        (plans ?? []).map(({ sl }) =>
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
      const desc =
        results.length === 1
          ? `Plan v${results[0].version} recorded.`
          : `${results.length} plans recorded.`;
      toast({ title: "Plan approved", description: desc });
    },
    onError: (err: Error) =>
      toast({ title: "Could not apply this plan", description: cleanError(err.message), variant: "destructive" }),
  });

  // Fetch previously approved plans; omit serviceLine filter when multiple are
  // selected so all lines' history shows in one list.
  const plansQuery = useQuery<{ plans: any[] }>({
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

  const rangeError =
    assumptions.minInhouseIncreasePct > assumptions.maxInhouseIncreasePct
      ? "The minimum increase cannot be larger than the maximum."
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

  const allFeasible = plans ? plans.every((p) => p.plan.feasible) : false;
  const anyFeasible = plans ? plans.some((p) => p.plan.feasible) : false;
  const allWarnings = plans ? Array.from(new Set(plans.flatMap((p) => p.plan.warnings))) : [];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6">
      {/* Sailboat hero banner */}
      <div className="-mx-4 -mt-6 mb-2 h-56 overflow-hidden bg-[#e8e7d4] sm:-mx-6 sm:h-64">
        <img
          src="/sailboats.jpg"
          alt=""
          className="mx-auto block h-full w-auto object-contain"
        />
      </div>

      <header className="space-y-1 text-center">
        <div className="flex justify-start">
          <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
        <h1 className="flex items-center justify-center gap-2 text-2xl font-semibold tracking-tight">
          <TrendingUp className="h-6 w-6 text-primary" />
          In-House Rate Planning
        </h1>
        <p className="mx-auto max-w-3xl text-sm text-muted-foreground">
          Set a rate-growth objective, then see the street rate and the resident-by-resident
          in-house increases required to reach it. Every number below can be expanded to show
          exactly how it was derived.
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
              <div className="grid grid-cols-[6rem_1fr_1fr] gap-x-3 gap-y-0.5 text-xs font-medium text-muted-foreground">
                <span>Service line</span>
                <span>Rate growth target</span>
                <span>Annual turnover</span>
              </div>
              {serviceLines.map((sl) => {
                const vals = perLineTargets[sl] ?? {
                  rateGrowthTargetPct: assumptions.rateGrowthTargetPct,
                  annualTurnoverPct: assumptions.annualTurnoverPct,
                };
                const hist = turnoverBySl.get(sl);
                return (
                  <div key={sl} className="grid grid-cols-[6rem_1fr_1fr] items-baseline gap-x-3">
                    <span className="pt-1.5 text-sm font-medium">{sl}</span>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        className="h-8 text-sm"
                        value={vals.rateGrowthTargetPct}
                        onChange={(e) => updatePerLine(sl, "rateGrowthTargetPct", Number(e.target.value))}
                      />
                      <span className="text-xs text-muted-foreground">%</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          className="h-8 text-sm"
                          min={MODEL_MIN_TURNOVER_PCT}
                          max={MODEL_MAX_TURNOVER_PCT}
                          value={vals.annualTurnoverPct}
                          onChange={(e) => updatePerLine(sl, "annualTurnoverPct", Number(e.target.value))}
                        />
                        <span className="text-xs text-muted-foreground">%</span>
                      </div>
                      <TurnoverEvidence
                        serviceLine={sl}
                        hist={hist}
                        applied={vals.annualTurnoverPct}
                        saved={savedTurnoverPct}
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
              testId="input-max-street"
              label="Maximum street increase"
              value={assumptions.maxStreetIncreasePct}
              onChange={(v) => update("maxStreetIncreasePct", v)}
              suffix="%"
              hint="How far the solver may push street rate to create headroom."
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

          <div className="flex items-start gap-3 rounded-md border p-3">
            <Switch
              id="allow-above-street"
              data-testid="switch-allow-above-street"
              checked={assumptions.allowInhouseAboveStreet}
              onCheckedChange={(v) => update("allowInhouseAboveStreet", v)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="allow-above-street" className="text-sm font-medium">
                Allow in-house rates above street
              </Label>
              <p className="text-xs text-muted-foreground">
                Off by default: a resident's rate stops at the street rate a new move-in would pay.
                Turning this on lets long-stay residents be raised past it.
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
              onClick={() => calculate.mutate()}
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

      {calculate.isPending && (
        <div className="flex items-center gap-3 rounded-md border p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reading the rent roll and solving for {serviceLines.length > 1 ? `${serviceLines.length} service lines` : serviceLines[0]}…
        </div>
      )}

      {plans && plans.length > 0 && combinedSummary && (
        <>
          {/* ── Feasibility ─────────────────────────────────────────── */}
          {allFeasible ? (
            <Alert className="border-emerald-500/40 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <AlertTitle>
                {formatPct(assumptions.rateGrowthTargetPct)} growth is reachable
                {plans.length > 1 ? " across all selected service lines" : ""}
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
                  <CardDescription>Each quarter compared against the same quarter one year earlier. Binding quarter sets the plan.</CardDescription>
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
                              <td className="px-4 py-2.5 text-right font-mono">{q.priorYear.realizedRateMonthly === null ? "—" : formatMoney(q.priorYear.realizedRateMonthly)}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">{formatMoney(q.requiredRateMonthly)}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-medium">{formatMoney(q.projectedRateMonthly)}</td>
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
                                <td colSpan={7} className="px-4 py-4"><Explanation explanation={q.explanation} /></td>
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
                      disabled={exportPlan.isPending}
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
                            {r.streetRateMonthly > 0 ? formatMoney(r.rateBasis === "daily" ? r.streetRateMonthly / (365 / 12) : r.streetRateMonthly) : "—"}
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

          {/* ── Apply ───────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Approve this plan</CardTitle>
              <CardDescription>
                Recording a plan saves the assumptions, the street recommendation and every
                resident increase as a numbered version you can come back to. It does not change
                any live rate on its own.
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
                    Some service lines do not reach the target and cannot be approved. Only the feasible lines will be recorded.
                  </AlertDescription>
                </Alert>
              )}
              {!isAuthenticated && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>Sign in to approve a plan.</AlertDescription>
                </Alert>
              )}
              <Button
                onClick={() => applyPlan.mutate()}
                disabled={!anyFeasible || !isAuthenticated || applyPlan.isPending}
                data-testid="button-apply-plan"
              >
                {applyPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Approve and record {plans.length > 1 ? `${plans.filter((p) => p.plan.feasible).length} plan(s)` : "plan"}
              </Button>

              {(plansQuery.data?.plans?.length ?? 0) > 0 && (
                <div className="space-y-2 pt-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Previously approved
                  </h3>
                  <ul className="space-y-1.5 text-sm">
                    {plansQuery.data!.plans.map((p: any) => (
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
                        {p.status === "superseded" && (
                          <Badge variant="outline" className="text-[11px] font-normal">
                            Superseded
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </>
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
