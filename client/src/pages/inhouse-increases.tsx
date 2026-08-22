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
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
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
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Calculator,
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

const SERVICE_LINES = ["AL", "AL/MC", "HC", "HC/MC", "SL", "VIL"];
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

export default function InhouseIncreases() {
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();

  const [locationId, setLocationId] = useState<string>(ALL_CAMPUSES);
  const [serviceLine, setServiceLine] = useState<string>("AL");
  const [assumptions, setAssumptions] = useState<PlanningAssumptions>({ ...DEFAULT_ASSUMPTIONS });
  const [assumptionsTouched, setAssumptionsTouched] = useState(false);
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [expandedQuarter, setExpandedQuarter] = useState<string | null>(null);
  const [expandedResident, setExpandedResident] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("increasePct");
  const [sortDesc, setSortDesc] = useState(true);
  const [constrainedOnly, setConstrainedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);

  const scopeLocationId = locationId === ALL_CAMPUSES ? null : locationId;

  const { data: locationsData } = useQuery<{ locations: LocationRow[] }>({
    queryKey: ["/api/locations"],
  });
  const locations = locationsData?.locations ?? [];

  // Saved assumptions for this scope. Loading them replaces the editor state
  // only while the operator has not started editing, so a fetch settling late
  // can never overwrite something they just typed.
  const assumptionsQuery = useQuery<{ assumptions: PlanningAssumptions; scopeLevel: string }>({
    queryKey: [
      "/api/inhouse-planning/assumptions",
      scopeLocationId ?? "all",
      serviceLine,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ serviceLine });
      if (scopeLocationId) params.set("locationId", scopeLocationId);
      const res = await fetch(`/api/inhouse-planning/assumptions?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setAssumptions((prev) => (assumptionsTouched ? prev : json.assumptions));
      return json;
    },
  });

  const calculate = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/inhouse-planning/calculate", "POST", {
        locationId: scopeLocationId,
        serviceLine,
        assumptions,
      });
      return (await res.json()) as PlanResult;
    },
    onSuccess: (result) => {
      setPlan(result);
      setVisibleCount(50);
      setExpandedResident(null);
      setExpandedQuarter(result.bindingQuarterLabel);
    },
    onError: (err: Error) => {
      setPlan(null);
      toast({
        title: "Could not calculate a plan",
        description: cleanError(err.message),
        variant: "destructive",
      });
    },
  });

  const saveAssumptions = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/inhouse-planning/assumptions", "POST", {
        locationId: scopeLocationId,
        serviceLine,
        assumptions,
      });
      return res.json();
    },
    onSuccess: () => {
      setAssumptionsTouched(false);
      queryClient.invalidateQueries({ queryKey: ["/api/inhouse-planning/assumptions"] });
      toast({
        title: "Assumptions saved",
        description: scopeLocationId
          ? `Saved for ${serviceLine} at this campus.`
          : `Saved for ${serviceLine} across all campuses.`,
      });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not save assumptions",
        description: cleanError(err.message),
        variant: "destructive",
      }),
  });

  const applyPlan = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/inhouse-planning/apply", "POST", {
        locationId: scopeLocationId,
        serviceLine,
        assumptions,
      });
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/inhouse-planning/plans"] });
      toast({
        title: `Plan v${result.version} recorded`,
        description: "The approved plan is saved and can be reviewed at any time.",
      });
    },
    onError: (err: Error) =>
      toast({
        title: "Could not apply this plan",
        description: cleanError(err.message),
        variant: "destructive",
      }),
  });

  const plansQuery = useQuery<{ plans: any[] }>({
    queryKey: ["/api/inhouse-planning/plans", scopeLocationId ?? "all", serviceLine],
    queryFn: async () => {
      const params = new URLSearchParams({ serviceLine });
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

  const rangeError =
    assumptions.minInhouseIncreasePct > assumptions.maxInhouseIncreasePct
      ? "The minimum increase cannot be larger than the maximum."
      : null;

  const residents = plan?.residents ?? [];
  const sortedResidents = useMemo(() => {
    const filtered = constrainedOnly
      ? residents.filter((r) => r.constraint !== "none")
      : residents;
    const pick = (r: ResidentRecommendation): string | number => {
      switch (sortKey) {
        case "location":
          return r.location;
        case "roomNumber":
          return r.roomNumber;
        case "currentRate":
          return r.currentRateMonthly;
        case "streetRate":
          return r.streetRateMonthly;
        case "gap":
          return r.gapToStreetPct;
        case "increaseDollars":
          return r.increaseDollarsMonthly;
        case "increasePct":
        default:
          return r.increasePct;
      }
    };
    // Sort a copy — the plan object is the source of truth for the summary
    // totals and must not be reordered underneath them.
    return [...filtered].sort((a, b) => {
      const av = pick(a);
      const bv = pick(b);
      const cmp =
        typeof av === "string" && typeof bv === "string"
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return sortDesc ? -cmp : cmp;
    });
  }, [residents, sortKey, sortDesc, constrainedOnly]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
    setVisibleCount(50);
  }

  const unit = plan?.rateBasis === "daily" ? "/day" : "/mo";

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <TrendingUp className="h-6 w-6 text-primary" />
          In-House Rate Planning
        </h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
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
            Assumptions are saved per campus and service line, falling back to the portfolio-wide
            setting when a campus has none of its own.
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
                setPlan(null);
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
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Service line</Label>
            <Select
              value={serviceLine}
              onValueChange={(v) => {
                setServiceLine(v);
                setAssumptionsTouched(false);
                setPlan(null);
              }}
            >
              <SelectTrigger className="h-9" data-testid="select-service-line">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_LINES.map((sl) => (
                  <SelectItem key={sl} value={sl}>
                    {sl}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end text-xs text-muted-foreground sm:col-span-2">
            {assumptionsQuery.data && (
              <p>
                Showing{" "}
                <span className="font-medium text-foreground">
                  {SCOPE_LEVEL_LABEL[assumptionsQuery.data.scopeLevel] ??
                    "saved assumptions"}
                </span>
                . Saving writes to the scope selected above.
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              testId="input-growth-target"
              label="Rate growth target"
              value={assumptions.rateGrowthTargetPct}
              onChange={(v) => update("rateGrowthTargetPct", v)}
              suffix="%"
              hint="Year-over-year realized rate growth, measured every quarter."
            />
            <NumberField
              testId="input-turnover"
              label="Annual turnover"
              value={assumptions.annualTurnoverPct}
              onChange={(v) => update("annualTurnoverPct", v)}
              suffix="%"
              hint="Move-outs replaced at street rate; higher turnover lifts the realized rate on its own."
            />
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
          Reading the rent roll and solving for the street rate and resident increases…
        </div>
      )}

      {plan && (
        <>
          {/* ── Feasibility ─────────────────────────────────────────── */}
          {plan.feasible ? (
            <Alert className="border-emerald-500/40 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <AlertTitle>
                {formatPct(plan.assumptions.rateGrowthTargetPct)} growth is reachable
              </AlertTitle>
              <AlertDescription>
                Every quarter in the next year clears the target
                {plan.bindingQuarterLabel && (
                  <>
                    {" "}
                    — <span className="font-medium">{plan.bindingQuarterLabel}</span> is the
                    tightest and sets the plan
                  </>
                )}
                .
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive" data-testid="alert-infeasible">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {formatPct(plan.assumptions.rateGrowthTargetPct)} growth is not reachable within
                these guardrails
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{plan.infeasibility?.message}</p>
                {plan.infeasibility && (
                  <ul className="ml-4 list-disc space-y-1 text-sm">
                    <li>
                      Needs a {formatPct(plan.infeasibility.requiredAvgIncreasePct, 2)} average
                      increase; the guardrails allow{" "}
                      {formatPct(plan.infeasibility.achievableAvgIncreasePct, 2)}.
                    </li>
                    {plan.infeasibility.minimumChange.maxInhouseIncreasePct !== null && (
                      <li>
                        Raise the maximum resident increase to at least{" "}
                        <span className="font-medium">
                          {formatPct(plan.infeasibility.minimumChange.maxInhouseIncreasePct, 2)}
                        </span>
                        .
                      </li>
                    )}
                    {plan.infeasibility.minimumChange.streetIncreasePct !== null && (
                      <li>
                        Or allow a street increase of at least{" "}
                        <span className="font-medium">
                          {formatPct(plan.infeasibility.minimumChange.streetIncreasePct, 2)}
                        </span>
                        .
                      </li>
                    )}
                    <li>
                      Or accept{" "}
                      <span className="font-medium">
                        {formatPct(
                          plan.infeasibility.minimumChange.achievableGrowthTargetPct,
                          2,
                        )}
                      </span>{" "}
                      growth, which these guardrails do reach.
                    </li>
                  </ul>
                )}
                <p className="text-sm">
                  The plan below is the best available under the current settings.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {plan.warnings.length > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Worth knowing about this data</AlertTitle>
              <AlertDescription>
                <ul className="ml-4 list-disc space-y-1 text-sm">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* ── Headline recommendation ─────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Recommended street rate</CardTitle>
                <CardDescription>
                  Effective {plan.assumptions.streetRateEffectiveDate}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-lg text-muted-foreground line-through">
                    {formatMoney(plan.currentStreetRateDisplay)}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="text-3xl font-semibold" data-testid="text-recommended-street">
                    {formatMoney(plan.recommendedStreetRateDisplay)}
                  </span>
                  <span className="text-sm text-muted-foreground">{unit}</span>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {formatPct(plan.streetIncreasePct, 2)} increase
                </Badge>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Resident increases</CardTitle>
                <CardDescription>
                  Effective {plan.assumptions.inhouseEffectiveDate} · population read from{" "}
                  {plan.scope.sourceMonth}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat
                  label="Average increase"
                  value={formatPct(plan.summary.weightedAvgIncreasePct, 2)}
                  note="Revenue weighted"
                  testId="text-avg-increase"
                />
                <Stat
                  label="Residents"
                  value={plan.summary.residentCount.toLocaleString()}
                  note={`${plan.summary.residentsReceivingIncrease.toLocaleString()} receive one`}
                />
                <Stat
                  label="Monthly revenue added"
                  value={formatMoney(plan.summary.totalMonthlyIncreaseDollars)}
                  note={`${formatMoney(plan.summary.totalAnnualIncreaseDollars)} annualized`}
                />
                <Stat
                  label="Held back"
                  value={(
                    plan.summary.residentsBlockedByStreet + plan.summary.residentsAtMax
                  ).toLocaleString()}
                  note={`${plan.summary.residentsBlockedByStreet} at street · ${plan.summary.residentsAtMax} at max`}
                />
              </CardContent>
            </Card>
          </div>

          {/* ── How the plan was derived ────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">How this plan was derived</CardTitle>
            </CardHeader>
            <CardContent>
              <Explanation explanation={plan.explanation} />
            </CardContent>
          </Card>

          {/* ── Quarterly projection ────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Quarterly realized rate vs prior year</CardTitle>
              <CardDescription>
                Each quarter is compared against the same quarter one year earlier. The binding
                quarter is the one that sets the whole plan.
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
                      const open = expandedQuarter === q.label;
                      return [
                          <tr
                            key={q.label}
                            data-testid={`row-quarter-${q.label.replace(/\s/g, "-")}`}
                            className={cn(
                              "cursor-pointer border-b transition-colors hover:bg-muted/50",
                              q.isBinding && "bg-amber-500/[0.07]",
                            )}
                            onClick={() => setExpandedQuarter(open ? null : q.label)}
                          >
                            <td className="px-4 py-2.5 font-medium">
                              <span className="flex items-center gap-1.5">
                                {open ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                {q.label}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="flex flex-wrap items-center gap-1.5">
                                {q.priorYear.label}
                                {q.priorYear.basis !== "actual" && (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/40 bg-amber-500/10 text-[11px] font-normal text-amber-600 dark:text-amber-400"
                                  >
                                    {q.priorYear.basis === "projected"
                                      ? "Projected"
                                      : `${q.priorYear.monthsAvailable} of ${q.priorYear.monthsExpected} months`}
                                  </Badge>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono">
                              {q.priorYear.realizedRateMonthly === null
                                ? "—"
                                : formatMoney(q.priorYear.realizedRateMonthly)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                              {formatMoney(q.requiredRateMonthly)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-medium">
                              {formatMoney(q.projectedRateMonthly)}
                            </td>
                            <td
                              className={cn(
                                "px-4 py-2.5 text-right font-mono font-medium",
                                q.passes
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-destructive",
                              )}
                            >
                              {formatPct(q.yoyGrowthPct, 2)}
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="flex flex-wrap gap-1.5">
                                {q.isBinding && (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/40 bg-amber-500/10 text-[11px] font-normal text-amber-600 dark:text-amber-400"
                                  >
                                    Binding
                                  </Badge>
                                )}
                                {!q.passes && (
                                  <Badge variant="destructive" className="text-[11px] font-normal">
                                    {formatPct(q.shortfallPct, 2)} short
                                  </Badge>
                                )}
                              </span>
                            </td>
                          </tr>,
                          open ? (
                            <tr key={`${q.label}-detail`} className="border-b bg-muted/30">
                              <td colSpan={7} className="px-4 py-4">
                                <Explanation explanation={q.explanation} />
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

          {/* ── Residents ───────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Resident recommendations</CardTitle>
                  <CardDescription>
                    {sortedResidents.length.toLocaleString()} of{" "}
                    {residents.length.toLocaleString()} residents. Tap a row to see how the
                    increase was calculated.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="constrained-only"
                    data-testid="switch-constrained-only"
                    checked={constrainedOnly}
                    onCheckedChange={(v) => {
                      setConstrainedOnly(v);
                      setVisibleCount(50);
                    }}
                  />
                  <Label htmlFor="constrained-only" className="text-xs">
                    Only residents hitting a limit
                  </Label>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <SortableTh label="Campus" k="location" {...{ sortKey, sortDesc, toggleSort }} />
                      <SortableTh label="Room" k="roomNumber" {...{ sortKey, sortDesc, toggleSort }} />
                      <th className="px-4 py-2 font-medium">Room type</th>
                      <SortableTh
                        label={`Current${unit}`}
                        k="currentRate"
                        align="right"
                        {...{ sortKey, sortDesc, toggleSort }}
                      />
                      <SortableTh
                        label={`Street${unit}`}
                        k="streetRate"
                        align="right"
                        {...{ sortKey, sortDesc, toggleSort }}
                      />
                      <SortableTh
                        label="Room to street"
                        k="gap"
                        align="right"
                        {...{ sortKey, sortDesc, toggleSort }}
                      />
                      <SortableTh
                        label="Increase"
                        k="increasePct"
                        align="right"
                        {...{ sortKey, sortDesc, toggleSort }}
                      />
                      <SortableTh
                        label="New rate"
                        k="increaseDollars"
                        align="right"
                        {...{ sortKey, sortDesc, toggleSort }}
                      />
                      <th className="px-4 py-2 font-medium">Limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResidents.slice(0, visibleCount).flatMap((r) => {
                      const open = expandedResident === r.key;
                      return [
                          <tr
                            key={r.key}
                            data-testid="row-resident"
                            className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                            onClick={() => setExpandedResident(open ? null : r.key)}
                          >
                            <td className="px-4 py-2.5">{r.location}</td>
                            <td className="px-4 py-2.5">
                              <span className="flex items-center gap-1.5">
                                {open ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                {r.roomNumber}
                                {r.isCompanionBed && (
                                  <Badge variant="outline" className="text-[11px] font-normal">
                                    B
                                  </Badge>
                                )}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {r.roomType || "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono">
                              {formatMoney(r.currentRateDisplay)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                              {r.streetRateMonthly > 0
                                ? formatMoney(
                                    r.rateBasis === "daily"
                                      ? r.streetRateMonthly / (365 / 12)
                                      : r.streetRateMonthly,
                                  )
                                : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
                              {r.streetRateMonthly > 0 ? formatPct(r.gapToStreetPct, 1) : "—"}
                            </td>
                            <td
                              className={cn(
                                "px-4 py-2.5 text-right font-mono font-medium",
                                r.increasePct > 0 ? "" : "text-muted-foreground",
                              )}
                            >
                              {formatPct(r.increasePct, 2)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono">
                              {formatMoney(r.newRateDisplay)}
                              {r.increaseDollarsDisplay > 0 && (
                                <span className="ml-1.5 text-xs text-muted-foreground">
                                  +{formatMoney(r.increaseDollarsDisplay)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <ConstraintBadge constraint={r.constraint} />
                            </td>
                          </tr>,
                          open ? (
                            <tr key={`${r.key}-detail`} className="border-b bg-muted/30">
                              <td colSpan={9} className="px-4 py-4">
                                <Explanation explanation={r.explanation} />
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleCount((c) => c + 100)}
                    data-testid="button-show-more"
                  >
                    Show 100 more ({(sortedResidents.length - visibleCount).toLocaleString()}{" "}
                    remaining)
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
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {!plan.feasible && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    A plan that does not reach its target cannot be approved. Adjust the
                    assumptions above first.
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
                disabled={!plan.feasible || !isAuthenticated || applyPlan.isPending}
                data-testid="button-apply-plan"
              >
                {applyPlan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Approve and record plan
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
