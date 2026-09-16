import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { ArrowLeft, Download, FileSpreadsheet, Maximize2, Printer, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  RateChart,
  type RateGrowthSeries,
} from "@/components/dashboard/rate-growth-drilldown";
import {
  OCCUPANCY_TIER_IDS,
  OCCUPANCY_TIER_LABELS,
  formatMoney,
  formatPct,
  type OccupancyTierId,
  type OccupancyTierPlanCell,
  type PlanResult,
} from "@shared/inhousePlanning";
import {
  annualRateGrowthBridge,
  annualRateGrowthRevenue,
  annualReportServiceLineLabel,
  type AnnualReportResidentScatterPoint,
  RESIDENT_INCREASE_TIER_LABELS,
} from "@shared/inhouseAnnualReportSnapshot";

type IncreaseDistribution = { label: string; count: number };
type ReportPlan = PlanResult & {
  increaseDistribution?: IncreaseDistribution[];
  residentIncreaseDistribution?: IncreaseDistribution[];
};
type PlanWithSl = { sl: string; plan: ReportPlan };
type TierLine = {
  serviceLine: string;
  occupancyPct: number | null;
  occupancyMonth: string | null;
  currentTier: OccupancyTierId | null;
  currentPlan: ReportPlan;
  cells: OccupancyTierPlanCell[];
  warnings: string[];
};
type TierGrid = {
  lines: TierLine[];
  skipped: Array<{ sl: string; message: string }>;
  scopeKey: string;
  generationStatus?: GenerationStatus | null;
};

type GenerationStatus = {
  state: "complete" | "incomplete";
  generationAt: string | null;
  expectedCampusCount: number;
  includedCampusCount: number;
  missingCampuses: Array<{ locationId: string; locationName: string; serviceLines: string[] }>;
};
type AnnualReport = {
  id: string;
  generatedAt: string;
  scopeKey: string;
  locationId: string | null;
  serviceLines: string[];
  plans: PlanWithSl[];
  tierGrid: TierGrid;
  status?: string;
  generationStatus?: GenerationStatus | null;
};
type ApiResponse = { report: AnnualReport | null };
type ScatterApiResponse = {
  points: AnnualReportResidentScatterPoint[];
  available: boolean;
};

const DAYS_PER_MONTH = 365 / 12;

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}
function signedMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`;
}
function rate(value: number | null | undefined, basis: PlanResult["rateBasis"]) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatMoney(value)}${basis === "daily" ? "/day" : "/mo"}`;
}
function pct(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : formatPct(value, 1);
}
function increaseTextColor(value: number | null | undefined, values: Array<number | null | undefined>) {
  if (value == null || !Number.isFinite(value)) return "#202020";
  const finite = values.filter((item): item is number => item != null && Number.isFinite(item));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const ratio = max > min ? (value - min) / (max - min) : 0.55;
  const lightness = 22 + ratio * 12;
  const saturation = 8 + ratio * 62;
  const hue = 145 - ratio * 5;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
function variance(current: number, street: number) {
  const dollars = current - street;
  const pct = street ? (dollars / street) * 100 : null;
  return { dollars, pct };
}
function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function Kpi({ label, value, note, accent = false }: { label: string; value: string; note?: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-primary/30 bg-primary/10" : "bg-background/60"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tracking-tight">{value}</div>
      {note && <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

function ReportBody({ report, history }: { report: AnnualReport; history: RateGrowthSeries[] }) {
  const measuredPlans = report.tierGrid.lines.map((line) => line.currentPlan).filter(Boolean);
  const totals = measuredPlans.reduce((sum, plan) => ({
    annual: sum.annual + (
      annualRateGrowthRevenue(
        annualRateGrowthBridge(
          plan.quarters,
          plan.rateBasis,
          plan.summary.weightedAvgIncreasePct,
        ),
        plan.summary.residentCount,
      ) ?? 0
    ),
    residents: sum.residents + (plan.summary.residentCount || 0),
  }), { annual: 0, residents: 0 });
  const location = report.plans[0]?.plan.scope.location || (report.locationId ? `Campus ${report.locationId}` : "Portfolio");
  const basis = measuredPlans[0]?.rateBasis ?? "monthly";
  const totalCurrentRevenue = measuredPlans.reduce(
    (sum, plan) => sum + plan.summary.currentAvgInhouseRateMonthly * plan.summary.residentCount,
    0,
  );
  const weightedIncrease = totalCurrentRevenue > 0
    ? measuredPlans.reduce(
        (sum, plan) => sum + plan.summary.currentAvgInhouseRateMonthly * plan.summary.residentCount *
          plan.summary.weightedAvgIncreasePct,
        0,
      ) / totalCurrentRevenue
    : 0;
  const occupancyLines = report.tierGrid.lines.filter(
    (line) =>
      line.occupancyPct != null &&
      Number.isFinite(line.occupancyPct) &&
      (line.currentPlan?.summary.residentCount ?? 0) > 0,
  );
  const occupancyResidents = occupancyLines.reduce(
    (sum, line) => sum + (line.currentPlan?.summary.residentCount ?? 0),
    0,
  );
  const weightedOccupancy = occupancyResidents > 0
    ? occupancyLines.reduce(
        (sum, line) => sum + line.occupancyPct! *
          (line.currentPlan?.summary.residentCount ?? 0),
        0,
      ) / occupancyResidents
    : null;
  const target = measuredPlans.length
    ? measuredPlans.reduce((sum, plan) => sum + plan.assumptions.rateGrowthTargetPct, 0) /
      measuredPlans.length
    : 0;
  const planYear = measuredPlans[0]?.assumptions.inhouseEffectiveDate?.slice(0, 4) || "—";
  const effectiveDates = Array.from(new Set(
    measuredPlans.map((plan) => plan.assumptions.inhouseEffectiveDate).filter(Boolean),
  ));
  const chartGroups = useMemo(() => {
    const selected = new Set(report.serviceLines);
    const combined = measuredPlans.map((plan): RateGrowthSeries => {
      const historical = history.find((series) => series.key === plan.scope.serviceLine);
      const divisor = plan.rateBasis === "daily" ? DAYS_PER_MONTH : 1;
      const points = new Map(
        (historical?.points ?? []).map((point) => [point.month, point]),
      );
      for (const point of plan.monthlyRateProjection ?? []) {
        points.set(point.month, {
          month: point.month,
          streetRate: point.streetRateMonthly / divisor,
          inHouseRate: point.projectedRateMonthly / divisor,
          units: plan.summary.residentCount,
        });
      }
      return {
        key: plan.scope.serviceLine,
        label: annualReportServiceLineLabel(plan.scope.serviceLine),
        rateBasis: plan.rateBasis,
        points: Array.from(points.values()).sort((a, b) => a.month.localeCompare(b.month)),
      };
    }).filter((series) => selected.has(series.key));
    return [
      { label: "Senior Housing", series: combined.filter((item) => item.rateBasis === "monthly") },
      { label: "SNF", series: combined.filter((item) => item.rateBasis === "daily") },
    ].filter((group) => group.series.length);
  }, [history, measuredPlans, report.serviceLines]);
  void chartGroups;
  const legacyAffectedResidents = measuredPlans.flatMap((plan) =>
    (plan.residents ?? []).filter((resident) => resident.increasePct > 0),
  );
  const emptyDistribution = RESIDENT_INCREASE_TIER_LABELS.map((label) => {
    if (label === "<3%") return { label, min: -Infinity, max: 3 };
    if (label === "9.0%+") return { label, min: 9, max: Infinity };
    const min = Number.parseFloat(label);
    return { label, min, max: min + 0.5 };
  });
  const savedDistribution = measuredPlans.flatMap((plan) => plan.increaseDistribution ?? []);
  const distributionBands = emptyDistribution.map((band) => ({
    ...band,
    count: savedDistribution.length
      ? savedDistribution
          .filter((entry) => entry.label === band.label)
          .reduce((sum, entry) => sum + Number(entry.count || 0), 0)
      : legacyAffectedResidents.filter(
          (resident) => resident.increasePct >= band.min && resident.increasePct < band.max,
        ).length,
  }));
  const affectedResidentCount = distributionBands.reduce((sum, band) => sum + band.count, 0);
  const positiveBands = distributionBands.filter((band) => band.count > 0);
  const singleIncrease = legacyAffectedResidents.length > 0
    ? legacyAffectedResidents.every(
        (resident) => Math.abs(resident.increasePct - legacyAffectedResidents[0].increasePct) < 0.001,
      )
    : positiveBands.length === 1 &&
      measuredPlans.every((plan) =>
        Math.abs(plan.summary.maxIncreasePct - plan.summary.minIncreasePct) < 0.001,
      );
  const singleIncreasePct = legacyAffectedResidents[0]?.increasePct
    ?? measuredPlans.find((plan) => plan.summary.residentsReceivingIncrease > 0)?.summary.minIncreasePct;

  return (
    <div id="annual-report-sheet" className="annual-report-sheet mx-auto max-w-[1480px] space-y-5">
      <header className="report-masthead flex flex-col gap-4 border-b border-primary/20 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
            <span className="h-2 w-2 rounded-full bg-primary" /> Modulo / decision document
          </div>
          <h1 className="font-serif text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl">Annual In-House Increase Plan</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {location} · {report.serviceLines.map(annualReportServiceLineLabel).join(" · ")} · Plan year {planYear} · Effective {effectiveDates.join(", ") || "—"}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Last run</div>
          <div className="mt-1 font-mono text-sm font-medium">{dateTime(report.generatedAt)}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Status: {report.status ?? "calculated"} · measured occupancy tier drives totals
          </div>
        </div>
      </header>
      {report.generationStatus?.state === "incomplete" && (
        <Alert variant="destructive">
          <AlertTitle>Incomplete report generation</AlertTitle>
          <AlertDescription>
            This report uses generation {report.generationStatus.generationAt
              ? dateTime(report.generationStatus.generationAt)
              : "—"} and includes {report.generationStatus.includedCampusCount} of{" "}
            {report.generationStatus.expectedCampusCount} campuses. Missing campuses are unavailable rather than mixed with an older generation:
            {" "}{report.generationStatus.missingCampuses.map((campus) => campus.locationName).join(", ")}.
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Recommended average increase" value={pct(weightedIncrease)} note="Revenue-weighted measured-tier plan" accent />
        <Kpi label="Total YoY revenue growth" value={signedMoney(totals.annual)} note="Prior-period increases plus plan increases" />
        <Kpi label="Current occupancy" value={pct(weightedOccupancy)} note={`${totals.residents.toLocaleString()} residents modeled`} />
        <Kpi label="Revenue growth target" value={pct(target)} note={basis === "daily" ? "Includes daily-rate service lines" : "Quarterly YoY target"} />
      </section>

      <section className="report-panel rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold">Street Rate vs In-House Rate</h2>
            <p className="mt-1 text-xs text-muted-foreground">Historical actuals flow into the exact calculated future plan. Solid is Street; dashed is in-house.</p>
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Annual Increase marker</span>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {chartGroups.map((group) => (
            <RateChart
              key={group.label}
              series={group.series}
              markerMonth={effectiveDates[0]?.slice(0, 7)}
            />
          ))}
        </div>
      </section>

      <section className="report-panel overflow-hidden rounded-xl border bg-card">
        <div className="border-b bg-primary/[0.04] px-4 py-3">
          <div className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Executive position by service line</h2></div>
          <p className="mt-1 text-xs text-muted-foreground">The highlighted row is the measured tier. Executive totals use only these plans.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-xs">
            <thead className="bg-muted/35 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
              <tr><th className="px-4 py-3 text-left">Line</th><th className="px-3 py-3 text-right">Current street</th><th className="px-3 py-3 text-right">Future street</th><th className="px-3 py-3 text-right">Current in-house</th><th className="px-3 py-3 text-right">Post-increase</th><th className="px-3 py-3 text-right">Current → street</th><th className="px-4 py-3 text-right">Revenue impact</th></tr>
            </thead>
            <tbody>
              {measuredPlans.map((plan) => {
                const v = variance(plan.summary.newAvgInhouseRateMonthly, plan.recommendedStreetRateMonthly);
                return <tr key={plan.scope.serviceLine} className="border-t">
                  <td className="px-4 py-3 font-semibold">{annualReportServiceLineLabel(plan.scope.serviceLine)}<div className="text-[10px] font-normal text-muted-foreground">{plan.feasible ? "Target status: clears" : "Target status: constrained"}</div></td>
                  <td className="px-3 py-3 text-right font-mono">{rate(plan.currentStreetRateDisplay, plan.rateBasis)}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">{rate(plan.recommendedStreetRateDisplay, plan.rateBasis)}<div className="text-[10px] font-normal text-primary">+{formatPct(plan.streetIncreasePct, 1)}</div></td>
                  <td className="px-3 py-3 text-right font-mono">{rate(plan.summary.currentAvgInhouseRateMonthly, "monthly")}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">{rate(plan.summary.newAvgInhouseRateMonthly, "monthly")}<div className="text-[10px] font-normal text-primary">+{formatPct(plan.summary.weightedAvgIncreasePct, 1)}</div></td>
                  <td className="px-3 py-3 text-right font-mono">{formatMoney(v.dollars)} <span className="text-muted-foreground">({pct(v.pct)})</span></td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-primary">{signedMoney(plan.summary.totalMonthlyIncreaseDollars)}<div className="text-[10px] font-normal text-muted-foreground">{signedMoney(plan.summary.totalAnnualIncreaseDollars)} annual</div></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="report-panel rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-end justify-between">
          <div><h2 className="text-sm font-semibold">Future rate position</h2><p className="mt-1 text-xs text-muted-foreground">The exact monthly projection from the plan, with Street Rate in force at month end.</p></div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">No separate forecast</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground"><tr><th className="px-3 py-2 text-left">Service line</th>{(measuredPlans[0]?.monthlyRateProjection ?? []).map((point) => <th key={point.month} className="px-2 py-2 text-right">{point.month}</th>)}</tr></thead>
            <tbody>{measuredPlans.map((plan) => <tr key={plan.scope.serviceLine} className="border-t"><td className="px-3 py-2 font-semibold">{annualReportServiceLineLabel(plan.scope.serviceLine)}<div className="text-[10px] font-normal text-muted-foreground">in-house / street · normalized monthly</div></td>{(plan.monthlyRateProjection ?? []).map((point) => <td key={point.month} className="px-2 py-2 text-right font-mono">{rate(point.projectedRateMonthly, "monthly")}<div className="text-[10px] font-normal text-muted-foreground">{rate(point.streetRateMonthly, "monthly")}</div></td>)}</tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="report-panel rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-end justify-between"><div><h2 className="text-sm font-semibold">Occupancy scenarios</h2><p className="mt-1 text-xs text-muted-foreground">Low, Target, and High show how the recommendation changes with occupancy.</p></div><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Current tier highlighted</span></div>
        <div className="grid gap-3 md:grid-cols-3">
          {report.tierGrid.lines.map((line) => <div key={line.serviceLine} className="overflow-hidden rounded-lg border">
            <div className="flex items-center justify-between border-b bg-muted/25 px-3 py-2"><span className="text-xs font-semibold">{annualReportServiceLineLabel(line.serviceLine)}</span><span className="font-mono text-[11px] text-muted-foreground">{line.occupancyPct == null ? "No occupancy" : `${line.occupancyPct.toFixed(1)}%`}</span></div>
            <div className="divide-y">{OCCUPANCY_TIER_IDS.map((tier) => { const cell = line.cells.find((c) => c.tier === tier); const current = line.currentTier === tier; return <div key={tier} className={`flex items-center justify-between px-3 py-2 text-xs ${current ? "bg-primary/10" : ""}`}><span className={current ? "font-semibold text-primary" : "text-muted-foreground"}>{OCCUPANCY_TIER_LABELS[tier]} {current && "· measured"}</span><span className="font-mono">{cell?.error ? "Unavailable" : `${pct(cell?.inhouseIncreasePct)} / ${pct(cell?.streetIncreasePct)}`}<span className="ml-1 text-[10px] text-muted-foreground">in-house / street</span></span></div>; })}</div>
          </div>)}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="report-panel rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Increase distribution</h2>
          <p className="mt-1 text-xs text-muted-foreground">Resident-level spread from the same measured-tier plans.</p>
          {singleIncrease ? (
            <div className="mt-3 rounded-md bg-muted/30 p-3 text-sm">
              All {affectedResidentCount.toLocaleString()} affected residents receive {pct(singleIncreasePct)}.
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {distributionBands.map((band) => (
                <div key={band.label} className="rounded-md bg-muted/30 p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{band.label}</div>
                  <div className="mt-1 font-mono text-sm">{band.count.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {affectedResidentCount ? ((band.count / affectedResidentCount) * 100).toFixed(1) : "0.0"}% of affected
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="report-panel rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Rationale</h2>
          <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
            {measuredPlans.slice(0, 4).map((plan) => {
              const current = variance(plan.summary.currentAvgInhouseRateMonthly, plan.currentStreetRateMonthly);
              const post = variance(plan.summary.newAvgInhouseRateMonthly, plan.recommendedStreetRateMonthly);
              return (
                <p key={plan.scope.serviceLine}>
                  <span className="font-semibold text-foreground">{annualReportServiceLineLabel(plan.scope.serviceLine)}:</span>{" "}
                  Current in-house is {pct(current.pct)} versus Street. The {pct(plan.summary.weightedAvgIncreasePct)} measured-tier increase generates {signedMoney(plan.summary.totalAnnualIncreaseDollars)} annualized while leaving post-increase in-house {pct(post.pct)} versus projected Street.
                </p>
              );
            })}
          </div>
        </div>
      </section>
      <p className="text-[10px] text-muted-foreground">Generated from the current Modulo in-house planning calculation. Rates and revenue impacts are not independently forecast on this report.</p>
    </div>
  );
}

function workbookRate(value: number | null | undefined, basis: PlanResult["rateBasis"]) {
  if (value == null || !Number.isFinite(value)) return "—";
  const display = basis === "daily" ? value / DAYS_PER_MONTH : value;
  return formatMoney(display);
}

function occupancyTierRangeText(report: AnnualReport, tier: OccupancyTierId): string | null {
  const labels = Array.from(new Set(
    report.tierGrid.lines
      .flatMap((line) => line.cells)
      .filter((cell) => cell.tier === tier)
      .map((cell) => cell.rangeLabel)
      .filter((label): label is string => typeof label === "string" && label.length > 0),
  ));
  if (labels.length === 0) return null;
  return labels.length === 1 ? labels[0] : labels.join(" · ");
}

function occupancyTierTitle(
  report: AnnualReport,
  tier: OccupancyTierId,
  label: string,
): string {
  const range = occupancyTierRangeText(report, tier);
  return range ? `${label} · ${range}` : label;
}

function WorkbookReportBlock({
  title,
  accent,
  report,
  tier,
}: {
  title: string;
  accent: "combined" | "tier1" | "tier2" | "tier3";
  report: AnnualReport;
  tier?: OccupancyTierId;
}) {
  const totalResidents = report.plans.reduce(
    (sum, entry) => sum + (entry.plan.summary.residentCount || 0),
    0,
  );
  const rows = report.plans.map(({ sl, plan }) => {
    const line = report.tierGrid.lines.find((entry) => entry.serviceLine === sl);
    const scenario = tier ? line?.cells.find((cell) => cell.tier === tier) : undefined;
    const scenarioAvailable = !tier || (
      scenario != null &&
      finiteNumber(scenario.inhouseIncreasePct) &&
      finiteNumber(scenario.streetIncreasePct) &&
      finiteNumber(scenario.newAvgInhouseRateMonthly) &&
      finiteNumber(scenario.recommendedStreetRateMonthly) &&
      finiteNumber(scenario.totalAnnualIncreaseDollars)
    );
    const inhouseIncrease = tier
      ? scenarioAvailable ? scenario!.inhouseIncreasePct : null
      : plan.summary.weightedAvgIncreasePct;
    const streetIncrease = tier
      ? scenarioAvailable ? scenario!.streetIncreasePct : null
      : plan.streetIncreasePct;
    const currentInhouse = plan.summary.currentAvgInhouseRateMonthly;
    const proposedInhouse = tier
      ? scenarioAvailable ? scenario!.newAvgInhouseRateMonthly : null
      : plan.summary.newAvgInhouseRateMonthly;
    const currentStreet = plan.currentStreetRateMonthly;
    const proposedStreet = tier
      ? scenarioAvailable ? scenario!.recommendedStreetRateMonthly : null
      : plan.recommendedStreetRateMonthly;
    const position = proposedInhouse && proposedStreet != null
      ? ((proposedStreet - proposedInhouse) / proposedInhouse) * 100
      : null;
    const growthBridge = tier
      ? null
      : inhouseIncrease == null
        ? null
        : annualRateGrowthBridge(plan.quarters, plan.rateBasis, inhouseIncrease);
    return {
      sl,
      plan,
      residents: plan.summary.residentCount,
      currentInhouse,
      proposedInhouse,
      inhouseIncrease,
      currentStreet,
      proposedStreet,
      streetIncrease,
      position,
      growthBridge,
      scenarioAvailable,
      annualizedRevenue: tier
        ? scenarioAvailable ? scenario!.totalAnnualIncreaseDollars : null
        : growthBridge
          ? annualRateGrowthRevenue(growthBridge, plan.summary.residentCount)
          : plan.summary.totalAnnualIncreaseDollars,
      portfolioShare: totalResidents ? plan.summary.residentCount / totalResidents * 100 : null,
    };
  });
  const weighted = (field: "inhouseIncrease" | "streetIncrease" | "position") => {
    const eligible = rows.filter((row) => row[field] != null && Number.isFinite(row[field]));
    if (eligible.length === 0) return null;
    if (field === "position") {
      const denominator = eligible.reduce(
        (sum, row) => sum + (
          row.proposedInhouse != null && row.proposedInhouse > 0
            ? row.proposedInhouse * row.residents
            : 0
        ),
        0,
      );
      const numerator = eligible.reduce(
        (sum, row) => sum + (row.proposedStreet ?? 0) * row.residents,
        0,
      );
      return denominator > 0 ? (numerator / denominator - 1) * 100 : null;
    }
    const denominator = eligible.reduce((sum, row) => {
      const rate = field === "inhouseIncrease" ? row.currentInhouse : row.currentStreet;
      return sum + (rate > 0 ? rate * row.residents : 0);
    }, 0);
    return denominator > 0
      ? eligible.reduce((sum, row) => {
          const rate = field === "inhouseIncrease" ? row.currentInhouse : row.currentStreet;
          return sum + Number(row[field]) * rate * row.residents;
        }, 0) / denominator
      : null;
  };
  const annualImpact = rows.reduce(
    (sum, row) => sum + (row.annualizedRevenue || 0),
    0,
  );
  const inhouseIncreaseValues = rows.map((row) => row.inhouseIncrease);
  const streetIncreaseValues = rows.map((row) => row.streetIncrease);
  const weightedInhouse = weighted("inhouseIncrease");
  const weightedStreet = weighted("streetIncrease");
  const scenarioComplete = !tier || rows.every((row) => row.scenarioAvailable);
  const bridgeResidents = rows.reduce(
    (sum, row) => sum + (row.growthBridge ? row.residents : 0),
    0,
  );
  const combinedPrior = rows.reduce(
    (sum, row) =>
      sum + (row.growthBridge?.priorYearAverageRateMonthly ?? 0) * row.residents,
    0,
  );
  const combinedProjected = rows.reduce(
    (sum, row) =>
      sum + (row.growthBridge?.projectedPlanYearAverageRateMonthly ?? 0) * row.residents,
    0,
  );
  const combinedFullYearYoy = combinedPrior > 0
    ? (combinedProjected / combinedPrior - 1) * 100
    : null;
  const combinedPriorPeriodIncrease =
    combinedFullYearYoy != null && weightedInhouse != null
      ? combinedFullYearYoy - weightedInhouse
      : null;

  return (
    <section className={`tier-block tier-block--${accent}`}>
      <div className="report-section-band flex items-center justify-between gap-3">
        <span>{title}</span>
        <span className="font-sans text-[10px] font-medium tracking-normal">
          {tier
            ? scenarioComplete
              ? "Scenario rates use this tier’s calculated increases"
              : "Scenario unavailable for one or more service lines"
            : `${signedMoney(annualImpact)} total YoY revenue growth`}
        </span>
      </div>
      <div className="overflow-x-auto">
          <table className={`report-data-table min-w-[1060px] ${tier ? "report-data-table--standard" : "report-data-table--bridge"}`}>
          <thead>
            <tr>
              <th>Service line</th>
              <th>Current IH<br />rate</th>
              <th>New IH<br />rate</th>
              <th>IH Increase<br />%</th>
              <th>Current Street<br />Rate</th>
              <th>New Street<br />Rate</th>
              <th>Street avg<br />increase</th>
              <th>New Street<br />over new IH</th>
              {!tier && <th>Prior-period<br />increase</th>}
              {!tier && <th>Plan<br />increase</th>}
              {!tier && <th>Total<br />YoY</th>}
              <th>{tier ? "Plan annualized" : "Total YoY"}<br />revenue growth</th>
              <th>Resident count</th>
              <th>Portfolio %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.sl}>
               <td className="font-semibold">{annualReportServiceLineLabel(row.sl)}</td>
                <td className="mono">{workbookRate(row.currentInhouse, row.plan.rateBasis)}</td>
                <td className="mono">{tier && !row.scenarioAvailable ? "Unavailable" : workbookRate(row.proposedInhouse, row.plan.rateBasis)}</td>
                <td className="mono increase-pct" style={{ color: increaseTextColor(row.inhouseIncrease, inhouseIncreaseValues) }}>{tier && !row.scenarioAvailable ? "Unavailable" : pct(row.inhouseIncrease)}</td>
                <td className="mono">{workbookRate(row.currentStreet, row.plan.rateBasis)}</td>
                <td className="mono">{tier && !row.scenarioAvailable ? "Unavailable" : workbookRate(row.proposedStreet, row.plan.rateBasis)}</td>
                <td className="mono increase-pct" style={{ color: increaseTextColor(row.streetIncrease, streetIncreaseValues) }}>{tier && !row.scenarioAvailable ? "Unavailable" : pct(row.streetIncrease)}</td>
                <td className="mono">{tier && !row.scenarioAvailable ? "Unavailable" : pct(row.position)}</td>
                {!tier && <td className="mono">{pct(row.growthBridge?.priorPeriodIncreasePct)}</td>}
                {!tier && <td className="mono increase-pct" style={{ color: increaseTextColor(row.inhouseIncrease, inhouseIncreaseValues) }}>{pct(row.growthBridge?.planIncreasePct)}</td>}
                {!tier && <td className="mono font-semibold">{pct(row.growthBridge?.fullYearYoyPct)}</td>}
                <td className="mono font-semibold">{tier && !row.scenarioAvailable ? "Unavailable" : signedMoney(row.annualizedRevenue)}</td>
                <td className="mono">{row.residents.toLocaleString()}</td>
                <td className="mono">{pct(row.portfolioShare)}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>Total</td>
              <td>—</td>
              <td>—</td>
              <td className="mono increase-pct" style={{ color: increaseTextColor(weightedInhouse, inhouseIncreaseValues) }}>{scenarioComplete ? pct(weightedInhouse) : "Unavailable"}</td>
              <td>—</td>
              <td>—</td>
              <td className="mono increase-pct" style={{ color: increaseTextColor(weightedStreet, streetIncreaseValues) }}>{scenarioComplete ? pct(weightedStreet) : "Unavailable"}</td>
              <td className="mono">{scenarioComplete ? pct(weighted("position")) : "Unavailable"}</td>
              {!tier && <td className="mono">{bridgeResidents > 0 ? pct(combinedPriorPeriodIncrease) : "—"}</td>}
              {!tier && <td className="mono increase-pct" style={{ color: increaseTextColor(weightedInhouse, inhouseIncreaseValues) }}>{bridgeResidents > 0 ? pct(weightedInhouse) : "—"}</td>}
              {!tier && <td className="mono">{bridgeResidents > 0 ? pct(combinedFullYearYoy) : "—"}</td>}
              <td className="mono">{scenarioComplete ? signedMoney(rows.reduce((sum, row) => sum + (row.annualizedRevenue ?? 0), 0)) : "Unavailable"}</td>
              <td className="mono">{totalResidents.toLocaleString()}</td>
              <td className="mono">{totalResidents ? "100.0%" : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WorkbookPageHeader({
  report,
  page,
}: {
  report: AnnualReport;
  page: number;
}) {
  const location = report.plans[0]?.plan.scope.location || (report.locationId ? `Campus ${report.locationId}` : "Portfolio");
  return (
    <header className="report-page-header flex items-end justify-between gap-6 border-b border-[#44546A] pb-2">
      <div>
        <p className="report-kicker">Modulo annual rate planning</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Annual In-House Rate Plan</h1>
        <p className="mt-1 text-xs text-muted-foreground">
           {location} · {report.serviceLines.map(annualReportServiceLineLabel).join(" · ")}
        </p>
      </div>
      <div className="text-right text-xs">
       <p className="font-semibold text-[#44546A]">Page {page} of 4</p>
        <p className="mt-1 text-muted-foreground">Last run {dateTime(report.generatedAt)}</p>
      </div>
    </header>
  );
}

const REPORT_SCATTER_COLORS: Record<string, string> = {
  AL: "#2F6B95",
  "AL/MC": "#7A5C9E",
  HC: "#388194",
  "HC/MC": "#7A8B3A",
  SL: "#B06D32",
  VIL: "#8B4B62",
};

function WorkbookScatterplots({ report }: { report: AnnualReport }) {
  const points = report.plans.flatMap(({ sl, plan }) => {
    const line = report.tierGrid.lines.find((entry) => entry.serviceLine === sl);
    return line?.occupancyPct == null ? [] : [{
      sl,
      occupancy: line.occupancyPct,
      inhouse: plan.summary.weightedAvgIncreasePct,
      street: plan.streetIncreasePct,
    }];
  });
  if (!points.length) return null;

  const chart = (field: "inhouse" | "street", title: string) => {
    const width = 430;
    const height = 168;
    const pad = { left: 44, right: 14, top: 18, bottom: 31 };
    const xValues = points.map((point) => point.occupancy);
    const yValues = points.map((point) => point[field]);
    const xMin = Math.floor(Math.min(...xValues) / 2.5) * 2.5;
    const xMax = Math.max(xMin + 2.5, Math.ceil(Math.max(...xValues) / 2.5) * 2.5);
    const rawYMin = Math.min(...yValues);
    const rawYMax = Math.max(...yValues);
    const yPadding = Math.max(0.15, (rawYMax - rawYMin) * 0.1);
    const yMin = rawYMin - yPadding;
    const yMax = rawYMax + yPadding;
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const sx = (value: number) => pad.left + (value - xMin) / (xMax - xMin) * plotWidth;
    const sy = (value: number) => pad.top + plotHeight - (value - yMin) / (yMax - yMin) * plotHeight;
    const occupiedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const labelPlacements = points.map((point) => {
      const px = sx(point.occupancy);
      const py = sy(point[field]);
      const labelWidth = Math.max(15, point.sl.length * 7);
      const candidates = [
        { x: px + 6, y: py + 3, anchor: "start" as const },
        { x: px - 6, y: py + 3, anchor: "end" as const },
        { x: px, y: py - 7, anchor: "middle" as const },
        { x: px, y: py + 12, anchor: "middle" as const },
        { x: px + 6, y: py - 6, anchor: "start" as const },
        { x: px - 6, y: py - 6, anchor: "end" as const },
      ];
      const placement = candidates.find((candidate) => {
        const left = candidate.anchor === "start"
          ? candidate.x
          : candidate.anchor === "end"
            ? candidate.x - labelWidth
            : candidate.x - labelWidth / 2;
        const box = { left, top: candidate.y - 10, right: left + labelWidth, bottom: candidate.y + 3 };
        const withinPlot =
          box.left >= pad.left &&
          box.right <= width - pad.right &&
          box.top >= pad.top &&
          box.bottom <= pad.top + plotHeight;
        const overlaps = occupiedLabels.some((used) =>
          box.left < used.right + 2 &&
          box.right > used.left - 2 &&
          box.top < used.bottom + 2 &&
          box.bottom > used.top - 2,
        );
        if (!withinPlot || overlaps) return false;
        occupiedLabels.push(box);
        return true;
      }) ?? candidates[0];
      return { point, px, py, ...placement };
    });
    return (
      <div className="report-scatter">
        <p className="report-scatter-title">{title}</p>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: occupancy against increase percentage`}>
          <line x1={pad.left} y1={pad.top + plotHeight} x2={width - pad.right} y2={pad.top + plotHeight} className="report-scatter-axis" />
          <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotHeight} className="report-scatter-axis" />
          {Array.from({ length: 5 }, (_, index) => index / 4).map((step) => {
            const y = pad.top + plotHeight * (1 - step);
            const value = yMin + (yMax - yMin) * step;
            return <g key={step}><line x1={pad.left} y1={y} x2={width - pad.right} y2={y} className="report-scatter-grid" /><text x={pad.left - 5} y={y + 3} textAnchor="end">{value.toFixed(1)}%</text></g>;
          })}
          {Array.from({ length: Math.round((xMax - xMin) / 2.5) + 1 }, (_, index) => xMin + index * 2.5).map((value) => {
            const x = sx(value);
            return <g key={value}><line x1={x} y1={pad.top} x2={x} y2={pad.top + plotHeight} className="report-scatter-grid" /><text x={x} y={height - 7} textAnchor="middle">{value.toFixed(1).replace(".0", "")}%</text></g>;
          })}
          {labelPlacements.map(({ point, px, py, x, y, anchor }) => (
            <g key={`${field}-${point.sl}`}>
              <circle cx={px} cy={py} r="5.2" fill={REPORT_SCATTER_COLORS[point.sl] ?? "#44546A"} />
               <text x={x} y={y} textAnchor={anchor} className="report-scatter-label">{annualReportServiceLineLabel(point.sl)}</text>
            </g>
          ))}
        </svg>
      </div>
    );
  };

  return (
    <section className="report-scatter-section">
      <div className="report-scatter-heading">Pricing Position by Service Line</div>
      <div className="report-scatter-grid-layout">
        {chart("inhouse", "In-House increase")}
        {chart("street", "Street Rate increase")}
      </div>
    </section>
  );
}

function ResidentIncreaseCharts({ plans }: { plans: ReportPlan[] }) {
  const chartPlans = plans.filter((plan) =>
    (plan.residentIncreaseDistribution ?? plan.increaseDistribution ?? []).some((entry) => entry.count > 0),
  );
  if (!chartPlans.length) return null;

  return (
    <section className="report-resident-section">
      <div className="report-scatter-heading">Resident in-house increases by tier</div>
      <p className="report-resident-description">
        Number of residents receiving each recommended in-house increase, shown separately by service line.
      </p>
      <div className="report-resident-grid">
        {chartPlans.map((plan) => {
          const distribution = new Map(
            (plan.residentIncreaseDistribution ?? plan.increaseDistribution ?? [])
              .map((entry) => [entry.label, entry.count]),
          );
          const values = RESIDENT_INCREASE_TIER_LABELS.map((label) => distribution.get(label) ?? 0);
          const maximum = Math.max(1, ...values);
          const width = 520;
          const height = 210;
          const pad = { left: 36, right: 8, top: 18, bottom: 43 };
          const plotWidth = width - pad.left - pad.right;
          const plotHeight = height - pad.top - pad.bottom;
          const slotWidth = plotWidth / values.length;
          const barWidth = Math.max(3, slotWidth * 0.68);
          return (
            <div key={plan.scope.serviceLine} className="report-resident-chart">
               <p className="report-resident-title">{annualReportServiceLineLabel(plan.scope.serviceLine)}</p>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label={`${plan.scope.serviceLine}: resident in-house increases by tier`}
              >
                <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotHeight} className="report-scatter-axis" />
                <line x1={pad.left} y1={pad.top + plotHeight} x2={width - pad.right} y2={pad.top + plotHeight} className="report-scatter-axis" />
                {[0, 0.5, 1].map((step) => {
                  const y = pad.top + plotHeight * (1 - step);
                  const value = Math.round(maximum * step);
                  return (
                    <g key={step}>
                      <line x1={pad.left} y1={y} x2={width - pad.right} y2={y} className="report-scatter-grid" />
                      <text x={pad.left - 5} y={y + 3} textAnchor="end">{value}</text>
                    </g>
                  );
                })}
                {values.map((value, index) => {
                  const x = pad.left + index * slotWidth + (slotWidth - barWidth) / 2;
                  const barHeight = value > 0 ? (value / maximum) * plotHeight : 0;
                  const label = RESIDENT_INCREASE_TIER_LABELS[index];
                  return (
                    <g key={label}>
                      {value > 0 && (
                        <text x={x + barWidth / 2} y={pad.top + plotHeight - barHeight - 4} textAnchor="middle">
                          {value}
                        </text>
                      )}
                      <rect
                        x={x}
                        y={pad.top + plotHeight - barHeight}
                        width={barWidth}
                        height={barHeight}
                        fill="#2F9E9A"
                      />
                      <text x={x + barWidth / 2} y={height - 23} textAnchor="middle">{label}</text>
                    </g>
                  );
                })}
                <text x={pad.left / 2} y={pad.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 ${pad.left / 2} ${pad.top + plotHeight / 2})`}>Residents</text>
              </svg>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ResidentIncreaseScatter({
  report,
  points,
  loading,
  available,
}: {
  report: AnnualReport;
  points: AnnualReportResidentScatterPoint[];
  loading: boolean;
  available: boolean;
}) {
  const serviceLines = Array.from(new Set(points.map((point) => point.serviceLine)));
  const [selectedServiceLines, setSelectedServiceLines] = useState<Set<string> | null>(null);
  const [hovered, setHovered] = useState<AnnualReportResidentScatterPoint | null>(null);

  useEffect(() => {
    setSelectedServiceLines((previous) => {
      if (previous == null) return null;
      return new Set(serviceLines.filter((serviceLine) => previous.has(serviceLine)));
    });
  }, [points]);

  const chartWidth = 820;
  const chartHeight = 430;
  const pad = { left: 66, right: 24, top: 24, bottom: 58 };
  const plotWidth = chartWidth - pad.left - pad.right;
  const plotHeight = chartHeight - pad.top - pad.bottom;
  const xValues = points.map((point) => point.occupancyPct);
  const yValues = points.map((point) => point.increasePct);
  const xMin = xValues.length ? Math.max(0, Math.floor(Math.min(...xValues) / 5) * 5 - 5) : 0;
  const xMax = xValues.length
    ? Math.min(100, Math.max(xMin + 10, Math.ceil(Math.max(...xValues) / 5) * 5 + 5))
    : 100;
  const rawYMin = yValues.length ? Math.min(...yValues) : 0;
  const rawYMax = yValues.length ? Math.max(...yValues) : 10;
  const yPadding = Math.max(0.5, (rawYMax - rawYMin) * 0.08);
  const yMin = rawYMin - yPadding;
  const yMax = rawYMax + yPadding;
  const sx = (value: number) => pad.left + (value - xMin) / Math.max(1, xMax - xMin) * plotWidth;
  const sy = (value: number) => pad.top + plotHeight - (value - yMin) / Math.max(0.01, yMax - yMin) * plotHeight;
  const active = selectedServiceLines ?? new Set(serviceLines);
  const returnTo = `/inhouse-increases/annual-report?scopeKey=${encodeURIComponent(report.scopeKey)}#annual-resident-scatter`;
  const referenceLink = (point: AnnualReportResidentScatterPoint) => {
    const params = new URLSearchParams({
      location: point.campus,
      serviceLine: point.serviceLine,
      focusGroup: "ihCalculated",
      scrollTo: "reference-data",
      returnTo,
    });
    if (point.roomType) params.set("roomType", point.roomType);
    return `/pricing-controls?${params.toString()}`;
  };

  return (
    <section id="annual-resident-scatter" className="report-resident-section scroll-mt-4">
      <div className="report-scatter-heading">Resident increase scattergram</div>
      <p className="report-resident-description">
        Each dot is one resident. Service-line occupancy is on the horizontal axis and the recommended resident increase is on the vertical axis.
        Hover a dot for its campus, service line, increase, and Reference Data edit link.
      </p>
      {loading ? (
        <div className="rounded border border-dashed border-[#B9C6D2] p-8 text-center text-sm text-muted-foreground">
          Loading resident-level detail…
        </div>
      ) : !available || points.length === 0 ? (
        <div className="rounded border border-dashed border-[#B9C6D2] p-8 text-center text-sm text-muted-foreground">
          Resident-level detail is unavailable for this saved report.
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold text-muted-foreground">Show lines:</span>
            {serviceLines.map((serviceLine) => {
              const isSelected = active.has(serviceLine);
              return (
                <button
                  key={serviceLine}
                  type="button"
                  onClick={() => setSelectedServiceLines((previous) => {
                    const next = new Set(previous ?? serviceLines);
                    if (next.has(serviceLine)) next.delete(serviceLine);
                    else next.add(serviceLine);
                    return next;
                  })}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-opacity ${isSelected ? "text-white" : "text-muted-foreground opacity-55"}`}
                  style={{
                    backgroundColor: isSelected ? REPORT_SCATTER_COLORS[serviceLine] ?? "#44546A" : "#E2E8F0",
                    borderColor: REPORT_SCATTER_COLORS[serviceLine] ?? "#94A3B8",
                  }}
                  aria-pressed={isSelected}
                >
                  {annualReportServiceLineLabel(serviceLine)}
                </button>
              );
            })}
            <button
              type="button"
              className="ml-1 text-[11px] font-medium text-primary underline underline-offset-2"
              onClick={() => setSelectedServiceLines(new Set(serviceLines))}
            >
              Select all
            </button>
          </div>
          <div className="relative overflow-hidden rounded border border-[#B9C6D2] bg-[#FCFBF6] p-2">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="h-auto w-full"
              role="img"
              aria-label="Resident increase percentage by service-line occupancy"
            >
              <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + plotHeight} className="report-scatter-axis" />
              <line x1={pad.left} y1={pad.top + plotHeight} x2={chartWidth - pad.right} y2={pad.top + plotHeight} className="report-scatter-axis" />
              {Array.from({ length: 5 }, (_, index) => index / 4).map((step) => {
                const y = pad.top + plotHeight * (1 - step);
                const value = yMin + (yMax - yMin) * step;
                return (
                  <g key={`y-${step}`}>
                    <line x1={pad.left} y1={y} x2={chartWidth - pad.right} y2={y} className="report-scatter-grid" />
                    <text x={pad.left - 8} y={y + 4} textAnchor="end">{value.toFixed(1)}%</text>
                  </g>
                );
              })}
              {Array.from({ length: Math.round((xMax - xMin) / 5) + 1 }, (_, index) => xMin + index * 5).map((value) => {
                const x = sx(value);
                return (
                  <g key={`x-${value}`}>
                    <line x1={x} y1={pad.top} x2={x} y2={pad.top + plotHeight} className="report-scatter-grid" />
                    <text x={x} y={pad.top + plotHeight + 18} textAnchor="middle">{value}%</text>
                  </g>
                );
              })}
              {points.map((point) => {
                const isSelected = active.has(point.serviceLine);
                return (
                  <circle
                    key={point.id}
                    cx={sx(point.occupancyPct)}
                    cy={sy(point.increasePct)}
                    r={hovered?.id === point.id ? 5.5 : 3.5}
                    fill={isSelected ? REPORT_SCATTER_COLORS[point.serviceLine] ?? "#44546A" : "#CBD5E1"}
                    opacity={isSelected ? 0.86 : 0.42}
                    stroke={hovered?.id === point.id ? "#172B4D" : "none"}
                    strokeWidth="1.5"
                    tabIndex={0}
                    aria-label={`${point.campus}, ${annualReportServiceLineLabel(point.serviceLine)}, ${point.increasePct.toFixed(1)} percent increase`}
                    onMouseEnter={() => setHovered(point)}
                    onMouseLeave={() => setHovered((current) => current?.id === point.id ? null : current)}
                    onFocus={() => setHovered(point)}
                    onBlur={() => setHovered((current) => current?.id === point.id ? null : current)}
                  />
                );
              })}
              <text x={pad.left + plotWidth / 2} y={chartHeight - 12} textAnchor="middle">Service-line occupancy</text>
              <text x={16} y={pad.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 16 ${pad.top + plotHeight / 2})`}>Resident increase</text>
            </svg>
            {hovered && (
              <div className="pointer-events-none absolute right-4 top-4 w-64 rounded-md border border-[#9EADBB] bg-[#FFFEFA] p-3 text-xs shadow-lg">
                <div className="font-semibold text-foreground">{hovered.campus || "Unknown campus"} · {annualReportServiceLineLabel(hovered.serviceLine)}</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                  <span>Occupancy</span><strong className="text-foreground">{hovered.occupancyPct.toFixed(1)}%</strong>
                  <span>Increase</span><strong className="text-foreground">{hovered.increasePct.toFixed(1)}%</strong>
                  <span>Increase $</span><strong className="text-foreground">{formatMoney(hovered.increaseDollarsMonthly)}/mo</strong>
                  <span>Room</span><strong className="truncate text-foreground">{hovered.roomNumber || "—"}</strong>
                </div>
                <a
                  href={referenceLink(hovered)}
                  className="pointer-events-auto mt-2 inline-block font-semibold text-primary underline underline-offset-2"
                >
                  Edit in Reference Data
                </a>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function WorkbookReportBody({
  report,
  scatter,
  scatterLoading,
}: {
  report: AnnualReport;
  scatter: ScatterApiResponse | undefined;
  scatterLoading: boolean;
}) {
  return (
    <div id="annual-report-sheet" className="annual-report-sheet mx-auto max-w-[1480px]">
      <article className="report-page space-y-4">
        <WorkbookPageHeader report={report} page={1} />
        <WorkbookReportBlock title="Combined" accent="combined" report={report} />
        <WorkbookScatterplots report={report} />
      </article>
      <article className="report-page space-y-4">
        <WorkbookPageHeader report={report} page={2} />
        <WorkbookReportBlock title={occupancyTierTitle(report, "high", "Occupancy Tier 1 · High occupancy")} accent="tier1" report={report} tier="high" />
        <WorkbookReportBlock title={occupancyTierTitle(report, "target", "Occupancy Tier 2 · Target occupancy")} accent="tier2" report={report} tier="target" />
        <WorkbookReportBlock title={occupancyTierTitle(report, "low", "Occupancy Tier 3 · Low occupancy")} accent="tier3" report={report} tier="low" />
        <p className="text-[10px] text-muted-foreground">
          Generated from the saved Modulo calculation. Scenario rates apply each occupancy tier’s calculated percentage to the same current-rate and resident-count basis.
        </p>
      </article>
      <article className="report-page space-y-4">
        <WorkbookPageHeader report={report} page={3} />
        <ResidentIncreaseCharts
          // The saved report keeps the compact plans in `report.plans`, while
          // tierGrid lines intentionally omit currentPlan to keep the payload
          // small. Reading the charts from the tier lines therefore made page
          // 3 silently render blank even though the distributions were saved.
          plans={report.plans.map(({ plan }) => plan)}
        />
        <a
          href="#annual-resident-scatter"
          className="inline-flex text-xs font-semibold text-primary underline underline-offset-2"
        >
          View resident-level increase scattergram →
        </a>
        <p className="text-[10px] text-muted-foreground">
          These distributions use the saved resident recommendations from the measured occupancy tier. The resident-level scattergram is loaded separately from the authenticated detail snapshot.
        </p>
      </article>
      <article className="report-page space-y-4">
        <WorkbookPageHeader report={report} page={4} />
        <ResidentIncreaseScatter
          report={report}
          points={scatter?.points ?? []}
          loading={scatterLoading}
          available={scatter?.available ?? false}
        />
        <p className="text-[10px] text-muted-foreground">
          The scattergram uses the resident-level detail snapshot saved with this report. Grey dots are service lines that are not selected.
        </p>
      </article>
    </div>
  );
}

export default function AnnualReportPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const scopeKey = new URLSearchParams(window.location.search).get("scopeKey") || "";
  const query = useQuery<ApiResponse>({
    queryKey: ["/api/inhouse-planning/annual-report-runs/latest", scopeKey],
    queryFn: async () => {
      const res = await fetch(`/api/inhouse-planning/annual-report-runs/latest?scopeKey=${encodeURIComponent(scopeKey)}`, { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error("Unable to load the latest annual report.");
      return res.json();
    },
    enabled: !!scopeKey,
  });
  const report = query.data?.report;
  const scatterQuery = useQuery<ScatterApiResponse>({
    queryKey: ["/api/inhouse-planning/annual-report-runs/resident-increase-scatter", report?.id],
    queryFn: async () => {
      const res = await fetch(`/api/inhouse-planning/annual-report-runs/${encodeURIComponent(report!.id)}/resident-increase-scatter`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Unable to load resident scatter data.");
      return res.json();
    },
    enabled: !!report,
  });
  useEffect(() => {
    if (!report || window.location.hash !== "#annual-resident-scatter") return;
    const timer = window.setTimeout(() => {
      document.getElementById("annual-resident-scatter")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [report]);
  const exportPdf = async () => {
    if (!report) return;
    const res = await fetch(`/api/inhouse-planning/annual-report-runs/${encodeURIComponent(report.id)}/pdf`, { credentials: "include" });
    if (!res.ok) throw new Error("PDF export failed.");
    const generatedDate = new Date(report.generatedAt);
    const datePart = Number.isNaN(generatedDate.getTime())
      ? new Date().toISOString().slice(0, 10)
      : generatedDate.toISOString().slice(0, 10);
    const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `Annual_In-House_Rate_Plan_${datePart}.pdf`; a.click(); URL.revokeObjectURL(url);
  };
  const exportAuditExcel = async () => {
    if (!report) return;
    try {
      const res = await fetch(`/api/inhouse-planning/annual-report-runs/${encodeURIComponent(report.id)}/excel`, {
        credentials: "include",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || "Excel export failed.");
      }
      const generatedDate = new Date(report.generatedAt);
      const datePart = Number.isNaN(generatedDate.getTime())
        ? new Date().toISOString().slice(0, 10)
        : generatedDate.toISOString().slice(0, 10);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `Annual_In-House_Rate_Plan_Audit_${datePart}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Excel export failed",
        description: error instanceof Error ? error.message : "Could not create the audit workbook.",
        variant: "destructive",
      });
    }
  };
  return <div className="min-h-[100dvh] bg-[var(--dashboard-bg)] px-4 py-5 sm:px-8 lg:px-12">
    <div className="report-toolbar mx-auto mb-5 flex max-w-[1480px] flex-wrap items-center justify-between gap-2">
      <Button variant="ghost" size="sm" onClick={() => setLocation("/inhouse-increases")}><ArrowLeft className="mr-2 h-4 w-4" />Back to plan</Button>
      {report && <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print</Button><Button variant="outline" size="sm" onClick={() => void exportPdf()}><Download className="mr-2 h-4 w-4" />Export PDF</Button><Button variant="outline" size="sm" onClick={() => void exportAuditExcel()}><FileSpreadsheet className="mr-2 h-4 w-4" />Export audit Excel</Button><Button variant="outline" size="sm" onClick={() => document.documentElement.requestFullscreen?.()}><Maximize2 className="mr-2 h-4 w-4" />Full screen</Button></div>}
    </div>
    {query.isLoading && <div className="mx-auto max-w-[1480px] space-y-4"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-72 animate-pulse rounded-xl bg-muted" /></div>}
    {query.isError && <Alert variant="destructive" className="mx-auto max-w-xl"><AlertTitle>Report unavailable</AlertTitle><AlertDescription>{query.error.message}</AlertDescription></Alert>}
    {!query.isLoading && !query.isError && !report && <Alert className="mx-auto max-w-xl"><AlertTitle>No annual report yet</AlertTitle><AlertDescription>Calculate a plan, then choose Annual Report to save the current run.</AlertDescription></Alert>}
     {report && <WorkbookReportBody report={report} scatter={scatterQuery.data} scatterLoading={scatterQuery.isLoading} />}
  </div>;
}
