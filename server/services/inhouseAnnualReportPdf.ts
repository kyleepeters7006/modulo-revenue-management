import PDFDocument from "pdfkit";
import {
  annualRateGrowthBridge,
  annualRateGrowthRevenue,
  annualReportServiceLineLabel,
  RESIDENT_INCREASE_TIER_LABELS,
  type AnnualRateGrowthBridge,
  type AnnualReportResidentScatterPoint,
} from "@shared/inhouseAnnualReportSnapshot";

type JsonObject = Record<string, any>;

export interface AnnualReportPdfReport {
  id?: string;
  scopeKey: string;
  locationId?: string | null;
  serviceLines: unknown;
  plans: unknown;
  tierGrid: unknown;
  generatedAt?: Date | string | null;
  status?: string;
  residentScatterPoints?: AnnualReportResidentScatterPoint[];
}

const NAVY = "#17324D";
const BLUE = "#2F6B95";
const MUTED = "#637381";
const PALE = "#EEF3F7";
const BORDER = "#C9D4DE";
const GREEN = "#18723A";
const WORKBOOK_HEADER_FONT_SIZE = 7.2;
const WORKBOOK_CELL_FONT_SIZE = 8.2;
const PRESENTATION_FONT_SCALE = 1.22;

function objects(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter((v): v is JsonObject => !!v && typeof v === "object");
  if (value && typeof value === "object") {
    return Object.entries(value as JsonObject)
      .filter(([, v]) => !!v && typeof v === "object")
      .map(([key, v]) => ({ ...(v as JsonObject), serviceLine: (v as JsonObject).serviceLine ?? key }));
  }
  return [];
}

function reportPlans(value: unknown): JsonObject[] {
  return objects(value).map((entry) => {
    // The saved UI payload keeps the service-line key next to a PlanResult.
    // Flatten that envelope for the PDF while retaining the exact PlanResult
    // fields untouched.
    if (entry.plan && typeof entry.plan === "object") {
      return {
        ...(entry.plan as JsonObject),
        serviceLine: entry.sl ?? (entry.plan as JsonObject).scope?.serviceLine,
      };
    }
    return entry;
  });
}

function first(value: JsonObject, paths: string[]): unknown {
  for (const path of paths) {
    const result = path.split(".").reduce<unknown>((current, key) => (
      current && typeof current === "object" ? (current as JsonObject)[key] : undefined
    ), value);
    if (result !== undefined && result !== null && result !== "") return result;
  }
  return undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function money(value: unknown): string | null {
  const n = number(value);
  return n == null ? null : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function pct(value: unknown): string | null {
  const n = number(value);
  return n == null ? null : `${n.toFixed(1)}%`;
}

function scalar(value: unknown): string | null {
  const stringValue = text(value);
  if (stringValue) return stringValue;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null;
}

function serviceLine(plan: JsonObject): string {
  return annualReportServiceLineLabel(text(first(plan, ["serviceLine", "scope.serviceLine", "name"])) ?? "Service line");
}

function rateUnit(line: string): string {
  return /^(?:SNF|HC)\b/i.test(line) ? "daily" : "monthly";
}

function rate(plan: JsonObject, kind: "current" | "recommended"): string | null {
  const daily = rateUnit(serviceLine(plan)) === "daily";
  const names = kind === "current"
    ? (daily
      ? ["currentStreetRateDisplay", "currentStreetRateDaily", "currentStreetRateMonthly"]
      : ["currentStreetRateDisplay", "currentStreetRateMonthly"])
    : (daily
      ? ["recommendedStreetRateDisplay", "recommendedStreetRateDaily", "recommendedStreetRateMonthly"]
      : ["recommendedStreetRateDisplay", "recommendedStreetRateMonthly"]);
  return money(first(plan, names));
}

function planStatus(plans: JsonObject[]): string {
  const normalized = reportPlans(plans);
  const statuses = normalized
    .map((plan) => text(first(plan, ["status", "planStatus"])))
    .filter((status): status is string => !!status)
    .map((status) => status.toLowerCase());
  if (statuses.length && statuses.every((status) => status === "applied")) return "Applied";
  if (statuses.some((status) => status === "proposed")) return "Proposed";
  if (statuses.some((status) => status === "withdrawn")) return "Withdrawn";
  if (statuses.some((status) => status === "superseded")) return "Superseded";
  const feasibility = normalized
    .map((plan) => first(plan, ["feasible"]))
    .filter((value): value is boolean => typeof value === "boolean");
  if (feasibility.length && feasibility.every(Boolean)) return "On target";
  if (feasibility.some((value) => !value)) return "Constrained";
  return "Calculated";
}

function line(doc: PDFKit.PDFDocument, x: number, y: number, width: number, value: string, options: {
  size?: number; color?: string; bold?: boolean; align?: "left" | "right" | "center";
} = {}): void {
  const size = (options.size ?? 7) * PRESENTATION_FONT_SCALE;
  doc
    .font(options.bold ? "Times-Bold" : "Times-Roman")
    .fontSize(size)
    .fillColor(options.color ?? NAVY)
    .text(value, x, y, { width, height: size, lineBreak: false, align: options.align });
}

function wrappedHeader(doc: PDFKit.PDFDocument, x: number, y: number, width: number, value: string): void {
  doc
    .font("Times-Bold")
    .fontSize(WORKBOOK_HEADER_FONT_SIZE * PRESENTATION_FONT_SCALE)
    .fillColor("#404040")
    .text(value, x + 2, y + 4, {
      width: width - 4,
      height: 24,
      align: "center",
      lineGap: 0,
      lineBreak: true,
    });
}

function heading(doc: PDFKit.PDFDocument, x: number, y: number, width: number, value: string): void {
  line(doc, x, y, width, value.toUpperCase(), { size: 8, color: BLUE, bold: true });
  doc.moveTo(x, y + 11).lineTo(x + width, y + 11).lineWidth(0.5).strokeColor(BORDER).stroke();
}

function valueOrDash(value: unknown, formatter: (v: unknown) => string | null = scalar): string {
  return formatter(value) ?? "—";
}

function increaseColor(value: number | null, values: Array<number | null>): string {
  if (value == null) return "#202020";
  const finite = values.filter((item): item is number => item != null && Number.isFinite(item));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const ratio = max > min ? (value - min) / (max - min) : 0.55;
  if (ratio >= 0.66) return GREEN;
  if (ratio >= 0.33) return "#375F3D";
  return "#202020";
}

function reportRecommendation(report: AnnualReportPdfReport, plans: JsonObject[]): string | null {
  const root = report as unknown as JsonObject;
  const explicit = text(first(root, [
    "executiveRecommendation", "recommendation", "executive.recommendation",
    "summary.executiveRecommendation", "summary.recommendation",
  ])) ?? plans.map((p) => text(first(p, ["executiveRecommendation", "recommendation"]))).find(Boolean);
  if (explicit) return explicit;
  const feasibility = reportPlans(plans)
    .map((plan) => first(plan, ["feasible"]))
    .filter((value): value is boolean => typeof value === "boolean");
  if (feasibility.length && feasibility.every(Boolean)) return "Proceed with the measured-tier plan.";
  if (feasibility.some((value) => !value)) return "Review constrained plans before approval.";
  return null;
}

function reportRationale(report: AnnualReportPdfReport, plans: JsonObject[]): string | null {
  const root = report as unknown as JsonObject;
  return text(first(root, ["rationale", "executiveRationale", "summary.rationale"]))
    ?? plans.map((p) => text(first(p, [
      "rationale", "targetDeviationDiagnostic.rationale", "targetDeviationDiagnostic.summary",
      "explanation.headline", "explanation.rationale",
    ]))).find(Boolean) ?? null;
}

function tierCells(grid: unknown): JsonObject[] {
  const root = grid as JsonObject;
  if (root && Array.isArray(root.cells)) return objects(root.cells);
  if (root && Array.isArray(root.lines)) {
    return root.lines.flatMap((line: JsonObject) =>
      objects(line.cells).map((cell) => ({
        ...cell,
        serviceLine: cell.serviceLine ?? line.serviceLine,
        isCurrent: cell.isCurrent ?? cell.tier === line.currentTier,
      })),
    );
  }
  if (root && typeof root === "object") {
    return Object.entries(root).flatMap(([key, value]) => {
      if (key === "cells") return [];
      return objects(value).map((cell) => ({ ...cell, serviceLine: cell.serviceLine ?? key }));
    });
  }
  return objects(grid);
}

function occupancyTierRangeText(grid: unknown, tier: string): string | null {
  const labels = Array.from(new Set(
    tierCells(grid)
      .filter((cell) => text(first(cell, ["tier"])) === tier)
      .map((cell) => text(first(cell, ["rangeLabel", "range", "occupancyRange"])))
      .filter((label): label is string => Boolean(label)),
  ));
  if (labels.length === 0) return null;
  return labels.length === 1 ? labels[0] : labels.join(" · ");
}

function occupancyTierTitle(grid: unknown, tier: string, label: string): string {
  const range = occupancyTierRangeText(grid, tier);
  return range ? `${label}  •  ${range}` : label;
}

function drawPlanTable(doc: PDFKit.PDFDocument, plans: JsonObject[], x: number, y: number, width: number): void {
  heading(doc, x, y, width, "Plans by service line");
  const top = y + 17;
  doc.rect(x, top - 2, width, 13).fill(PALE);
  const cols = [0, width * 0.34, width * 0.52, width * 0.72, width * 0.86];
  const widths = [width * 0.33, width * 0.17, width * 0.19, width * 0.13, width * 0.14];
  ["Service line", "Current", "Recommended", "Increase", "Target"].forEach((label, i) => {
    line(doc, x + cols[i], top, widths[i], label, { size: 5.6, bold: true, color: MUTED });
  });
  plans.slice(0, 7).forEach((plan, i) => {
    const yy = top + 15 + i * 14;
    const name = serviceLine(plan);
    line(doc, x + cols[0], yy, widths[0], `${name} (${rateUnit(name)})`, { size: 5.8 });
    line(doc, x + cols[1], yy, widths[1], valueOrDash(rate(plan, "current")), { size: 5.8 });
    line(doc, x + cols[2], yy, widths[2], valueOrDash(rate(plan, "recommended")), { size: 5.8 });
    line(doc, x + cols[3], yy, widths[3], valueOrDash(first(plan, ["streetIncreasePct", "summary.weightedAvgIncreasePct"]), pct), { size: 5.8 });
    const feasible = first(plan, ["feasible", "targetStatus"]);
    const target = typeof feasible === "boolean" ? (feasible ? "On target" : "Below target") : text(feasible);
    line(doc, x + cols[4], yy, widths[4], target ?? "—", { size: 5.5, color: target === "Below target" ? "#9B2C2C" : NAVY });
  });
}

function drawTierTable(doc: PDFKit.PDFDocument, grid: unknown, x: number, y: number, width: number): void {
  heading(doc, x, y, width, "Plans by occupancy tier");
  const cells = tierCells(grid);
  const top = y + 17;
  doc.rect(x, top - 2, width, 13).fill(PALE);
  const cols = [0, width * 0.48, width * 0.68, width * 0.84];
  const widths = [width * 0.47, width * 0.19, width * 0.15, width * 0.15];
  ["Service line / tier", "Occupancy range", "In-house", "Street"].forEach((label, i) => {
    line(doc, x + cols[i], top, widths[i], label, { size: 5.4, bold: true, color: MUTED });
  });
  cells.slice(0, 18).forEach((cell, i) => {
    const yy = top + 13 + i * 7;
    const name = `${serviceLine(cell)} / ${text(first(cell, ["tier", "tierLabel"])) ?? "tier"}${first(cell, ["isCurrent", "measured"]) === true ? " (MEASURED)" : ""}`;
    line(doc, x + cols[0], yy, widths[0], name, { size: 5.2, bold: first(cell, ["isCurrent", "measured"]) === true });
    line(doc, x + cols[1], yy, widths[1], valueOrDash(first(cell, ["rangeLabel", "range", "occupancyRange"])), { size: 5.2 });
    line(doc, x + cols[2], yy, widths[2], valueOrDash(first(cell, ["inhouseIncreasePct"]), pct), { size: 5.2 });
    line(doc, x + cols[3], yy, widths[3], valueOrDash(first(cell, ["streetIncreasePct"]), pct), { size: 5.2 });
  });
}

function drawKpis(doc: PDFKit.PDFDocument, plans: JsonObject[], x: number, y: number, width: number): void {
  heading(doc, x, y, width, "Revenue impact");
  const top = y + 17;
  doc.rect(x, top - 2, width, 13).fill(PALE);
  const cols = [0, width * 0.20, width * 0.50, width * 0.79];
  const widths = [width * 0.19, width * 0.29, width * 0.28, width * 0.20];
  ["Line", "Annual", "Monthly", "Variance"].forEach((label, i) => {
    line(doc, x + cols[i], top, widths[i], label, { size: 5.4, bold: true, color: MUTED });
  });
  let annualTotal = 0;
  let monthlyTotal = 0;
  plans.slice(0, 7).forEach((plan, i) => {
    const yy = top + 15 + i * 14;
    const summary = (first(plan, ["summary"]) as JsonObject | undefined) ?? {};
    const annual = first(summary, ["totalAnnualIncreaseDollars"]) ?? first(plan, ["totalAnnualIncreaseDollars"]);
    const monthly = first(summary, ["totalMonthlyIncreaseDollars"]) ?? first(plan, ["totalMonthlyIncreaseDollars"]);
    annualTotal += number(annual) ?? 0;
    monthlyTotal += number(monthly) ?? 0;
    const explicitVariance = first(plan, [
      "varianceToTopCompetitorPct", "summary.varianceToTopCompetitorPct",
      "targetDeviationDiagnostic.varianceToTargetPct",
    ]);
    const currentInhouse = number(first(summary, ["newAvgInhouseRateMonthly"]));
    const futureStreet = number(first(plan, ["recommendedStreetRateMonthly"]));
    const calculatedVariance =
      explicitVariance ??
      (currentInhouse != null && futureStreet ? ((currentInhouse - futureStreet) / futureStreet) * 100 : undefined);
    const variance = calculatedVariance;
    line(doc, x + cols[0], yy, widths[0], serviceLine(plan), { size: 5.8, bold: true });
    line(doc, x + cols[1], yy, widths[1], valueOrDash(annual, money), { size: 5.5 });
    line(doc, x + cols[2], yy, widths[2], valueOrDash(monthly, money), { size: 5.5 });
    line(doc, x + cols[3], yy, widths[3], valueOrDash(variance, pct), { size: 5.5, align: "right" });
  });
  const totalY = top + 15 + Math.min(plans.length, 7) * 14 + 2;
  doc.moveTo(x, totalY - 4).lineTo(x + width, totalY - 4).lineWidth(0.6).strokeColor(BORDER).stroke();
  line(doc, x + cols[0], totalY, widths[0], "TOTAL", { size: 5.8, bold: true });
  line(doc, x + cols[1], totalY, widths[1], valueOrDash(annualTotal, money), { size: 5.8, bold: true });
  line(doc, x + cols[2], totalY, widths[2], valueOrDash(monthlyTotal, money), { size: 5.8, bold: true });
}

function drawRateComparisonChart(
  doc: PDFKit.PDFDocument,
  plans: JsonObject[],
  x: number,
  y: number,
  width: number,
): void {
  heading(doc, x, y, width, "Street vs. in-house rate");
  const rows = plans.slice(0, 7).map((plan) => {
    const summary = (first(plan, ["summary"]) as JsonObject | undefined) ?? {};
    return {
      name: serviceLine(plan),
      inhouse: number(first(summary, ["newAvgInhouseRateMonthly"])),
      street: number(first(plan, ["recommendedStreetRateMonthly"])),
    };
  });
  const maximum = Math.max(1, ...rows.flatMap(({ inhouse, street }) => [inhouse ?? 0, street ?? 0]));
  const labelWidth = 36;
  const valueWidth = 43;
  const barWidth = Math.max(40, width - labelWidth - valueWidth - 10);
  rows.forEach((row, index) => {
    const yy = y + 20 + index * 24;
    const daily = rateUnit(row.name) === "daily";
    const divisor = daily ? 30.4 : 1;
    const inhouse = row.inhouse == null ? null : row.inhouse / divisor;
    const street = row.street == null ? null : row.street / divisor;
    const displayMaximum = maximum / divisor;
    line(doc, x, yy + 4, labelWidth, row.name, { size: 5.8, bold: true });
    if (inhouse != null) {
      doc.rect(x + labelWidth, yy, Math.max(1, barWidth * inhouse / displayMaximum), 6).fill("#2F6B95");
      line(doc, x + labelWidth + barWidth + 5, yy, valueWidth, valueOrDash(inhouse, money), { size: 5.2 });
    }
    if (street != null) {
      doc.rect(x + labelWidth, yy + 9, Math.max(1, barWidth * street / displayMaximum), 6).fill("#7BC4BE");
      line(doc, x + labelWidth + barWidth + 5, yy + 9, valueWidth, valueOrDash(street, money), { size: 5.2 });
    }
  });
  const legendY = y + 20 + rows.length * 24 + 2;
  doc.rect(x, legendY, 7, 5).fill("#2F6B95");
  line(doc, x + 10, legendY - 1, 50, "In-house", { size: 5.2, color: MUTED });
  doc.rect(x + 62, legendY, 7, 5).fill("#7BC4BE");
  line(doc, x + 72, legendY - 1, 50, "Street", { size: 5.2, color: MUTED });
}

function drawDistribution(doc: PDFKit.PDFDocument, plans: JsonObject[], x: number, y: number, width: number): void {
  heading(doc, x, y, width, "Increase distribution");
  const distributions = plans.flatMap((plan) => {
    const candidate = first(plan, ["increaseDistribution", "distribution", "summary.increaseDistribution"]);
    if (candidate !== undefined) return objects(candidate);
    return [];
  });
  if (!distributions.length) {
    line(doc, x, y + 19, width, "No increase distribution was saved.", { size: 6.5, color: MUTED });
    return;
  }
  const maximum = Math.max(1, ...distributions.map((entry) => number(first(entry, ["count"])) ?? 0));
  distributions.slice(0, 6).forEach((entry, i) => {
    const yy = y + 21 + i * 22;
    const label = text(first(entry, ["label", "bucket", "range"])) ?? "Range";
    const count = number(first(entry, ["count", "residents", "residentCount"])) ?? 0;
    line(doc, x, yy, 38, label, { size: 5.8, bold: true });
    doc.rect(x + 40, yy, Math.max(1, (width - 72) * count / maximum), 8).fill("#AFC6D8");
    line(doc, x + width - 27, yy, 27, String(count), { size: 5.8, align: "right" });
  });
}

function drawNarrative(doc: PDFKit.PDFDocument, report: AnnualReportPdfReport, plans: JsonObject[], x: number, y: number, width: number): void {
  heading(doc, x, y, width, "Recommendation / rationale");
  line(doc, x, y + 17, width, `Recommendation: ${reportRecommendation(report, plans) ?? "Not provided"}`, { size: 6.7 });
  line(doc, x, y + 30, width, `Rationale: ${reportRationale(report, plans) ?? "Not provided"}`, { size: 6.7 });
  const gap = 18;
  const chartWidth = width * 0.62;
  drawRateComparisonChart(doc, plans, x, y + 52, chartWidth);
  drawDistribution(doc, plans, x + chartWidth + gap, y + 52, width - chartWidth - gap);
}

function drawResidentIncreaseCharts(
  doc: PDFKit.PDFDocument,
  plans: JsonObject[],
  x: number,
  y: number,
  width: number,
): void {
  heading(doc, x, y, width, "Resident in-house increases by tier");
  line(
    doc,
    x,
    y + 16,
    width,
    "Number of residents receiving each recommended in-house increase, shown separately by service line.",
    { size: 6.5, color: MUTED },
  );

  const chartPlans = plans.filter((plan) => {
    const distribution = first(plan, [
      "residentIncreaseDistribution",
      "increaseDistribution",
      "distribution",
      "summary.increaseDistribution",
    ]);
    return objects(distribution).some((entry) =>
      (number(first(entry, ["count", "residents", "residentCount"])) ?? 0) > 0,
    );
  });
  if (!chartPlans.length) {
    line(doc, x, y + 34, width, "No resident increase distribution was saved.", { size: 6.5, color: MUTED });
    return;
  }

  const columns = Math.min(3, chartPlans.length);
  const gap = 10;
  const cardWidth = (width - gap * (columns - 1)) / columns;
  const cardHeight = 214;
  const plotHeight = 132;
  const plotLeftOffset = 24;
  const plotRightOffset = 5;
  const plotWidth = cardWidth - plotLeftOffset - plotRightOffset;

  chartPlans.forEach((plan, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const cardX = x + column * (cardWidth + gap);
    const cardY = y + 30 + row * (cardHeight + 12);
    const plotTop = cardY + 17;
    const plotBottom = plotTop + plotHeight;
    const distribution = new Map(
      objects(first(plan, [
        "residentIncreaseDistribution",
        "increaseDistribution",
        "distribution",
        "summary.increaseDistribution",
      ]))
        .map((entry) => [
          text(first(entry, ["label", "bucket", "range"])) ?? "",
          number(first(entry, ["count", "residents", "residentCount"])) ?? 0,
        ]),
    );
    const values = RESIDENT_INCREASE_TIER_LABELS.map((label) => distribution.get(label) ?? 0);
    const maximum = Math.max(1, ...values);
    const slotWidth = plotWidth / values.length;
    const barWidth = Math.max(2, slotWidth * 0.7);

    doc.rect(cardX, cardY, cardWidth, cardHeight).lineWidth(0.5).strokeColor(BORDER).stroke();
    line(doc, cardX + 4, cardY + 7, cardWidth - 8, serviceLine(plan), { size: 7.3, bold: true, align: "center" });
    doc.moveTo(cardX + plotLeftOffset, plotTop).lineTo(cardX + plotLeftOffset, plotBottom)
      .lineTo(cardX + plotLeftOffset + plotWidth, plotBottom)
      .lineWidth(0.5).strokeColor("#657789").stroke();

    [0, 0.5, 1].forEach((step) => {
      const yy = plotBottom - plotHeight * step;
      const value = Math.round(maximum * step);
      doc.moveTo(cardX + plotLeftOffset, yy)
        .lineTo(cardX + plotLeftOffset + plotWidth, yy)
        .lineWidth(0.25).strokeColor("#D9DEE5").stroke();
      line(doc, cardX + 1, yy - 3, plotLeftOffset - 5, String(value), { size: 5.2, align: "right" });
    });

    values.forEach((value, valueIndex) => {
      const barX = cardX + plotLeftOffset + valueIndex * slotWidth + (slotWidth - barWidth) / 2;
      const barHeight = value > 0 ? (value / maximum) * plotHeight : 0;
      if (value > 0) {
        doc.rect(barX, plotBottom - barHeight, barWidth, barHeight).fill("#2F9E9A");
        line(doc, barX - 2, plotBottom - barHeight - 8, barWidth + 4, String(value), { size: 4.2, align: "center" });
      }
      line(doc, barX - 4, plotBottom + 5, slotWidth + 8, RESIDENT_INCREASE_TIER_LABELS[valueIndex], { size: 4.1, align: "center" });
    });
    line(doc, cardX - 1, plotTop + plotHeight / 2, 18, "Residents", { size: 4.8, align: "center" });
  });
}

function residentChartPlans(report: AnnualReportPdfReport, plans: JsonObject[]): JsonObject[] {
  const grid = report.tierGrid as JsonObject | null;
  const gridPlans = Array.isArray(grid?.lines)
    ? grid.lines.flatMap((line: JsonObject) => {
        const currentPlan = line.currentPlan;
        if (!currentPlan || typeof currentPlan !== "object") return [];
        return [{
          ...(currentPlan as JsonObject),
          serviceLine: serviceLine(currentPlan as JsonObject) === "Service line"
            ? line.serviceLine
            : serviceLine(currentPlan as JsonObject),
        }];
      })
    : [];
  const gridByLine = new Map(gridPlans.map((plan) => [serviceLine(plan), plan]));

  // The browser report uses the measured-tier currentPlan in tierGrid. Merge
  // that distribution into the compact top-level plan when the saved payload
  // was produced by a version that stored it only in tierGrid.
  return plans.map((plan) => {
    const gridPlan = gridByLine.get(serviceLine(plan));
    const topLevelDistribution = first(plan, [
      "residentIncreaseDistribution",
      "increaseDistribution",
      "distribution",
      "summary.increaseDistribution",
    ]);
    const gridDistribution = gridPlan
      ? first(gridPlan, [
          "residentIncreaseDistribution",
          "increaseDistribution",
          "distribution",
          "summary.increaseDistribution",
        ])
      : undefined;
    return topLevelDistribution !== undefined || gridDistribution === undefined
      ? plan
      : { ...plan, residentIncreaseDistribution: gridDistribution };
  });
}

type WorkbookRow = {
  line: string;
  residents: number | null;
  currentInhouse: number | null;
  proposedInhouse: number | null;
  inhouseIncrease: number | null;
  growthBridge: AnnualRateGrowthBridge | null;
  currentStreet: number | null;
  proposedStreet: number | null;
  streetIncrease: number | null;
  variance: number | null;
  annualizedRevenue: number | null;
  portfolioShare: number | null;
  scenarioAvailable: boolean;
};

function workbookRows(plans: JsonObject[], grid: unknown, tier?: string): WorkbookRow[] {
  const normalized = reportPlans(plans);
  const totalResidents = normalized.reduce(
    (sum, plan) => sum + (number(first(plan, ["summary.residentCount"])) ?? 0),
    0,
  );
  const cells = tierCells(grid);
  return normalized.slice(0, 8).map((plan) => {
    const lineName = serviceLine(plan);
    const summary = (first(plan, ["summary"]) as JsonObject | undefined) ?? {};
    const residents = number(first(summary, ["residentCount"]));
    const currentInhouse = number(first(summary, ["currentAvgInhouseRateMonthly"]));
    const measuredInhouse = number(first(summary, ["newAvgInhouseRateMonthly"]));
    const currentStreet = number(first(plan, ["currentStreetRateMonthly"]));
    const measuredStreet = number(first(plan, ["recommendedStreetRateMonthly"]));
    const scenario = tier
      ? cells.find((cell) =>
          serviceLine(cell) === lineName &&
          String(first(cell, ["tier", "tierLabel"]) ?? "").toLowerCase() === tier.toLowerCase())
      : undefined;
    const scenarioAvailable = !tier || (
      scenario != null &&
      number(first(scenario, ["inhouseIncreasePct"])) != null &&
      number(first(scenario, ["streetIncreasePct"])) != null &&
      number(first(scenario, ["newAvgInhouseRateMonthly"])) != null &&
      number(first(scenario, ["recommendedStreetRateMonthly"])) != null &&
      number(first(scenario, ["totalAnnualIncreaseDollars"])) != null
    );
    const inhouseIncrease = tier
      ? scenarioAvailable ? number(first(scenario!, ["inhouseIncreasePct"])) : null
      : number(first(summary, ["weightedAvgIncreasePct"]));
    const streetIncrease = tier
      ? scenarioAvailable ? number(first(scenario!, ["streetIncreasePct"])) : null
      : number(first(plan, ["streetIncreasePct"]));
    const proposedInhouse = tier
      ? scenarioAvailable ? number(first(scenario!, ["newAvgInhouseRateMonthly"])) : null
      : measuredInhouse;
    const proposedStreet = tier
      ? scenarioAvailable ? number(first(scenario!, ["recommendedStreetRateMonthly"])) : null
      : measuredStreet;
    const rateBasis = first(plan, ["rateBasis"]) === "daily" ? "daily" : "monthly";
    const quarters = objects(first(plan, ["quarters"]));
    const growthBridge = !tier && inhouseIncrease != null
      ? annualRateGrowthBridge(quarters as any, rateBasis, inhouseIncrease)
      : null;
    return {
      line: lineName,
      residents,
      currentInhouse,
      proposedInhouse,
      inhouseIncrease,
      growthBridge,
      currentStreet,
      proposedStreet,
      streetIncrease,
      variance: proposedInhouse
        ? ((proposedStreet ?? 0) - proposedInhouse) / proposedInhouse * 100
        : null,
      annualizedRevenue: growthBridge
        ? annualRateGrowthRevenue(growthBridge, residents ?? 0)
        : tier
          ? scenarioAvailable ? number(first(scenario!, ["totalAnnualIncreaseDollars"])) : null
          : number(first(summary, ["totalAnnualIncreaseDollars"])),
      portfolioShare: residents != null && totalResidents > 0 ? residents / totalResidents * 100 : null,
      scenarioAvailable,
    };
  });
}

function drawWorkbookBlock(
  doc: PDFKit.PDFDocument,
  rows: WorkbookRow[],
  x: number,
  y: number,
  width: number,
  title: string,
  accent: string,
): void {
  const includeGrowthBridge = rows.some((row) => row.growthBridge != null);
  const columns = [
    { label: "Service line", weight: includeGrowthBridge ? 0.9 : 1.3, align: "left" as const },
    { label: "Current\nIH rate", weight: includeGrowthBridge ? 0.7 : 0.9, align: "center" as const },
    { label: "New\nIH rate", weight: includeGrowthBridge ? 0.7 : 0.9, align: "center" as const },
    { label: "IH Increase\n%", weight: includeGrowthBridge ? 0.65 : 0.8, align: "center" as const },
    { label: "Current\nStreet Rate", weight: includeGrowthBridge ? 0.7 : 0.9, align: "center" as const },
    { label: "New\nStreet Rate", weight: includeGrowthBridge ? 0.7 : 0.9, align: "center" as const },
    { label: "Street avg\nincrease", weight: includeGrowthBridge ? 0.7 : 0.8, align: "center" as const },
    { label: "New Street\nover new IH", weight: includeGrowthBridge ? 0.7 : 0.8, align: "center" as const },
    ...(includeGrowthBridge ? [
      { label: "Prior-period\nincrease", weight: 0.7, align: "center" as const },
      { label: "Plan\nincrease", weight: 0.7, align: "center" as const },
      { label: "Total\nYoY", weight: 0.7, align: "center" as const },
    ] : []),
    {
      label: includeGrowthBridge ? "Total YoY\nrevenue growth" : "Plan annualized\nrevenue growth",
      weight: includeGrowthBridge ? 1 : 1.1,
      align: "center" as const,
    },
    { label: "Resident\ncount", weight: includeGrowthBridge ? 0.9 : 0.8, align: "center" as const },
    { label: "Portfolio\n%", weight: includeGrowthBridge ? 0.9 : 0.8, align: "center" as const },
  ];
  const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
  const widths = columns.map((column) => width * column.weight / totalWeight);
  const inhouseIncreaseColumn = columns.findIndex(
    (column) =>
      column.label === "IH Increase\n%" ||
      column.label === "Plan\nincrease",
  );
  const streetIncreaseColumn = columns.findIndex(
    (column) => column.label === "Street avg\nincrease",
  );
  const positions: number[] = [];
  widths.reduce((position, columnWidth) => {
    positions.push(position);
    return position + columnWidth;
  }, x);

  doc.rect(x, y, width, 24).fill(accent);
  const darkBand = ["#44546A", "#101010", "#388194"].includes(accent.toUpperCase());
  line(doc, x + 8, y + 7, width - 16, title, {
    size: 9,
    bold: true,
    color: darkBand ? "#FFFFFF" : NAVY,
  });
  const headerY = y + 24;
  doc.rect(x, headerY, width, 31).fill("#D6DCE4");
  columns.forEach((column, index) => {
    wrappedHeader(doc, positions[index], headerY, widths[index], column.label);
  });

  const rowHeight = 18;
  const inhouseValues = rows.map((row) => row.inhouseIncrease);
  const streetValues = rows.map((row) => row.streetIncrease);
  rows.forEach((row, index) => {
    const rowY = headerY + 31 + index * rowHeight;
    if (index % 2) doc.rect(x, rowY, width, rowHeight).fill("#F6F8FA");
    const values = [
      row.line,
      valueOrDash(row.currentInhouse, money),
      row.scenarioAvailable ? valueOrDash(row.proposedInhouse, money) : "Unavailable",
      row.scenarioAvailable ? valueOrDash(row.inhouseIncrease, pct) : "Unavailable",
      valueOrDash(row.currentStreet, money),
      row.scenarioAvailable ? valueOrDash(row.proposedStreet, money) : "Unavailable",
      row.scenarioAvailable ? valueOrDash(row.streetIncrease, pct) : "Unavailable",
      row.scenarioAvailable ? valueOrDash(row.variance, pct) : "Unavailable",
      ...(includeGrowthBridge ? [
        valueOrDash(row.growthBridge?.priorPeriodIncreasePct, pct),
        valueOrDash(row.growthBridge?.planIncreasePct, pct),
        valueOrDash(row.growthBridge?.fullYearYoyPct, pct),
      ] : []),
      row.scenarioAvailable ? valueOrDash(row.annualizedRevenue, money) : "Unavailable",
      row.residents == null ? "—" : row.residents.toLocaleString("en-US"),
      valueOrDash(row.portfolioShare, pct),
    ];
    values.forEach((value, columnIndex) => {
      line(doc, positions[columnIndex] + 3, rowY + 4, widths[columnIndex] - 6, value, {
        size: WORKBOOK_CELL_FONT_SIZE,
        bold: columnIndex === 0,
        color: columnIndex === inhouseIncreaseColumn
          ? increaseColor(row.inhouseIncrease, inhouseValues)
          : columnIndex === streetIncreaseColumn
            ? increaseColor(row.streetIncrease, streetValues)
            : "#202020",
        align: columns[columnIndex].align,
      });
    });
    doc.moveTo(x, rowY + rowHeight).lineTo(x + width, rowY + rowHeight)
      .lineWidth(0.25).strokeColor("#D9DEE5").stroke();
  });

  const totalY = headerY + 31 + rows.length * rowHeight;
  const residentTotal = rows.reduce((sum, row) => sum + (row.residents ?? 0), 0);
  const weighted = (field: "inhouseIncrease" | "streetIncrease" | "variance") => {
    const denominator = rows.reduce(
      (sum, row) => {
        if (row[field] == null || row.residents == null) return sum;
        const rate = field === "inhouseIncrease"
          ? row.currentInhouse
          : field === "streetIncrease"
            ? row.currentStreet
            : row.proposedInhouse;
        return sum + (rate != null && rate > 0 ? rate * row.residents : row.residents);
      },
      0,
    );
    return denominator
      ? rows.reduce((sum, row) => {
          if (row[field] == null || row.residents == null) return sum;
          const rate = field === "inhouseIncrease"
            ? row.currentInhouse
            : field === "streetIncrease"
              ? row.currentStreet
              : row.proposedInhouse;
          const weight = rate != null && rate > 0 ? rate * row.residents : row.residents;
          return sum + row[field]! * weight;
        }, 0) / denominator
      : null;
  };
  const bridgeRows = rows.filter(
    (row) => row.growthBridge != null && row.residents != null && row.residents > 0,
  );
  const bridgePrior = bridgeRows.reduce(
    (sum, row) =>
      sum + row.growthBridge!.priorYearAverageRateMonthly * row.residents!,
    0,
  );
  const bridgeProjected = bridgeRows.reduce(
    (sum, row) =>
      sum + row.growthBridge!.projectedPlanYearAverageRateMonthly * row.residents!,
    0,
  );
  const totalFullYearYoy = bridgePrior > 0 ? (bridgeProjected / bridgePrior - 1) * 100 : null;
  const totalPlanIncrease = weighted("inhouseIncrease");
  const scenariosComplete = rows.every((row) => row.scenarioAvailable);
  const totalPriorPeriodIncrease =
    totalFullYearYoy != null && totalPlanIncrease != null
      ? totalFullYearYoy - totalPlanIncrease
      : null;
  doc.rect(x, totalY, width, 17).fill("#E9EDF2");
  const totals = [
    "Total",
    "—",
    "—",
     scenariosComplete ? valueOrDash(totalPlanIncrease, pct) : "Unavailable",
    "—",
    "—",
     scenariosComplete ? valueOrDash(weighted("streetIncrease"), pct) : "Unavailable",
     scenariosComplete ? valueOrDash(weighted("variance"), pct) : "Unavailable",
    ...(includeGrowthBridge ? [
      valueOrDash(totalPriorPeriodIncrease, pct),
      valueOrDash(totalPlanIncrease, pct),
      valueOrDash(totalFullYearYoy, pct),
    ] : []),
     scenariosComplete
       ? valueOrDash(rows.reduce((sum, row) => sum + (row.annualizedRevenue ?? 0), 0), money)
       : "Unavailable",
    residentTotal.toLocaleString("en-US"),
    residentTotal ? "100.0%" : "—",
  ];
  totals.forEach((value, columnIndex) => {
    line(doc, positions[columnIndex] + 3, totalY + 5, widths[columnIndex] - 6, value, {
      size: WORKBOOK_CELL_FONT_SIZE,
      bold: true,
      color: columnIndex === inhouseIncreaseColumn
        ? increaseColor(weighted("inhouseIncrease"), inhouseValues)
        : columnIndex === streetIncreaseColumn
          ? increaseColor(weighted("streetIncrease"), streetValues)
          : "#202020",
      align: columns[columnIndex].align,
    });
  });
}

function drawWorkbookPageHeader(
  doc: PDFKit.PDFDocument,
  report: AnnualReportPdfReport,
  stamp: string,
  pageNumber: number,
): void {
  const width = doc.page.width - 36;
  line(doc, 18, 12, width * 0.65, "ANNUAL IN-HOUSE RATE PLAN", { size: 14, bold: true });
  line(doc, 18, 31, width * 0.65, `Scope: ${report.scopeKey}`, { size: 7.2, color: MUTED });
  line(doc, 18 + width * 0.65, 15, width * 0.35, `Page ${pageNumber} of 4`, {
    size: 7.4, bold: true, color: BLUE, align: "right",
  });
  line(doc, 18 + width * 0.65, 31, width * 0.35, stamp, { size: 6.8, color: MUTED, align: "right" });
}

function drawWorkbookScatterplots(
  doc: PDFKit.PDFDocument,
  rows: WorkbookRow[],
  grid: unknown,
  x: number,
  y: number,
  width: number,
): void {
  const occupancy = new Map(
    objects((grid as JsonObject)?.lines).map((line) => [
      serviceLine(line),
      number(first(line, ["occupancyPct"])),
    ]),
  );
  const points = rows.flatMap((row) => {
    const xValue = occupancy.get(row.line);
    return xValue == null ? [] : [{ ...row, occupancy: xValue }];
  });
  if (!points.length) return;
  line(doc, x, y, width, "PRICING POSITION BY SERVICE LINE", { size: 9, bold: true });
  doc.moveTo(x, y + 11).lineTo(x + width, y + 11).lineWidth(0.5).strokeColor(BORDER).stroke();

  const gap = 20;
  const chartWidth = (width - gap) / 2;
  const colors: Record<string, string> = {
    AL: "#2F6B95", "AL/MC": "#7A5C9E", HC: "#388194",
    "HC/MC": "#7A8B3A", SL: "#B06D32", VIL: "#8B4B62",
  };
  const draw = (field: "inhouseIncrease" | "streetIncrease", title: string, chartX: number) => {
    const top = y + 17;
    const plotX = chartX + 28;
    const plotY = top + 11;
    const plotWidth = chartWidth - 38;
    const plotHeight = 99;
    const xValues = points.map((point) => point.occupancy);
    const yValues = points.map((point) => point[field] ?? 0);
    const xMin = Math.floor(Math.min(...xValues) / 2.5) * 2.5;
    const xMax = Math.max(xMin + 2.5, Math.ceil(Math.max(...xValues) / 2.5) * 2.5);
    const rawYMin = Math.min(...yValues);
    const rawYMax = Math.max(...yValues);
    const yPadding = Math.max(0.15, (rawYMax - rawYMin) * 0.1);
    const yMin = rawYMin - yPadding;
    const yMax = rawYMax + yPadding;
    const occupiedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = [];
    const labelPlacements = points.map((point) => {
      const value = point[field] ?? 0;
      const px = plotX + (point.occupancy - xMin) / (xMax - xMin) * plotWidth;
      const py = plotY + plotHeight - (value - yMin) / (yMax - yMin) * plotHeight;
      const labelWidth = Math.max(10, point.line.length * 4.2);
      const candidates = [
        { x: px + 4, y: py - 2, align: "left" as const },
        { x: px - labelWidth - 4, y: py - 2, align: "left" as const },
        { x: px - labelWidth / 2, y: py - 9, align: "left" as const },
        { x: px - labelWidth / 2, y: py + 5, align: "left" as const },
        { x: px + 4, y: py - 9, align: "left" as const },
        { x: px - labelWidth - 4, y: py - 9, align: "left" as const },
      ];
      const placement = candidates.find((candidate) => {
        const box = {
          left: candidate.x,
          top: candidate.y,
          right: candidate.x + labelWidth,
          bottom: candidate.y + 9,
        };
        const withinPlot =
          box.left >= plotX &&
          box.right <= plotX + plotWidth &&
          box.top >= plotY &&
          box.bottom <= plotY + plotHeight;
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
      return { point, px, py, labelWidth, ...placement };
    });
    line(doc, chartX, top, chartWidth, title, { size: 7.4, bold: true });
    doc.moveTo(plotX, plotY).lineTo(plotX, plotY + plotHeight).lineTo(plotX + plotWidth, plotY + plotHeight)
      .lineWidth(0.5).strokeColor("#657789").stroke();
    Array.from({ length: 5 }, (_, index) => index / 4).forEach((step) => {
      const yy = plotY + plotHeight * (1 - step);
      doc.moveTo(plotX, yy).lineTo(plotX + plotWidth, yy).lineWidth(0.25).strokeColor("#D9DEE5").stroke();
      line(doc, chartX, yy - 3, 24, `${(yMin + (yMax - yMin) * step).toFixed(1)}%`, { size: 5.8, align: "right" });
    });
    const xTickCount = Math.round((xMax - xMin) / 2.5);
    Array.from({ length: xTickCount + 1 }, (_, index) => xMin + index * 2.5).forEach((value) => {
      const xx = plotX + (value - xMin) / (xMax - xMin) * plotWidth;
      doc.moveTo(xx, plotY).lineTo(xx, plotY + plotHeight).lineWidth(0.25).strokeColor("#D9DEE5").stroke();
      line(doc, xx - 14, plotY + plotHeight + 3, 28, `${value.toFixed(1).replace(".0", "")}%`, { size: 5.8, align: "center" });
    });
    line(doc, plotX, plotY + plotHeight + 12, plotWidth, "Occupancy", { size: 6, bold: true, align: "center" });
    labelPlacements.forEach(({ point, px, py, x: labelX, y: labelY, labelWidth }) => {
      doc.circle(px, py, 3.2).fill(colors[point.line] ?? "#44546A");
      line(doc, labelX, labelY, labelWidth, point.line, { size: 6.4, bold: true });
    });
  };
  draw("inhouseIncrease", "In-House increase", x);
  draw("streetIncrease", "Street Rate increase", x + chartWidth + gap);
}

const RESIDENT_SCATTER_COLORS: Record<string, string> = {
  AL: "#2F6B95",
  "AL/MC": "#7A5C9E",
  HC: "#388194",
  "HC/MC": "#7A8B3A",
  SL: "#B06D32",
  VIL: "#8B4B62",
};

function drawResidentIncreaseScatter(
  doc: PDFKit.PDFDocument,
  points: AnnualReportResidentScatterPoint[],
  x: number,
  top: number,
  width: number,
): void {
  line(doc, x, top, width, "Resident increase scattergram", { size: 10, color: BLUE, bold: true });
  doc.moveTo(x, top + 11).lineTo(x + width, top + 11).lineWidth(0.5).strokeColor(BORDER).stroke();
  line(
    doc,
    x,
    top + 18,
    width,
    "Each dot is one resident. Horizontal position is service-line occupancy; vertical position is the resident's recommended in-house increase.",
    { size: 6.5, color: MUTED },
  );
  if (!points.length) {
    line(doc, x, top + 54, width, "Resident-level detail is unavailable for this saved report.", { size: 8, color: MUTED });
    return;
  }

  const plotX = x + 42;
  const plotY = top + 42;
  const plotWidth = width - 60;
  const plotHeight = 280;
  const xValues = points.map((point) => point.occupancyPct);
  const yValues = points.map((point) => point.increasePct);
  const xMin = Math.max(0, Math.floor(Math.min(...xValues) / 5) * 5 - 5);
  const xMax = Math.min(100, Math.max(xMin + 10, Math.ceil(Math.max(...xValues) / 5) * 5 + 5));
  const rawYMin = Math.min(...yValues);
  const rawYMax = Math.max(...yValues);
  const yPadding = Math.max(0.5, (rawYMax - rawYMin) * 0.08);
  const yMin = rawYMin - yPadding;
  const yMax = rawYMax + yPadding;
  const sx = (value: number) => plotX + (value - xMin) / Math.max(1, xMax - xMin) * plotWidth;
  const sy = (value: number) => plotY + plotHeight - (value - yMin) / Math.max(0.01, yMax - yMin) * plotHeight;

  doc.moveTo(plotX, plotY).lineTo(plotX, plotY + plotHeight).lineTo(plotX + plotWidth, plotY + plotHeight)
    .lineWidth(0.5).strokeColor("#657789").stroke();
  Array.from({ length: 5 }, (_, index) => index / 4).forEach((step) => {
    const yy = plotY + plotHeight * (1 - step);
    doc.moveTo(plotX, yy).lineTo(plotX + plotWidth, yy).lineWidth(0.25).strokeColor("#D9DEE5").stroke();
    line(doc, x, yy - 3, 36, `${(yMin + (yMax - yMin) * step).toFixed(1)}%`, { size: 5.8, align: "right" });
  });
  const xTickCount = Math.max(1, Math.round((xMax - xMin) / 5));
  Array.from({ length: xTickCount + 1 }, (_, index) => xMin + index * 5).forEach((value) => {
    const xx = sx(value);
    doc.moveTo(xx, plotY).lineTo(xx, plotY + plotHeight).lineWidth(0.25).strokeColor("#D9DEE5").stroke();
    line(doc, xx - 14, plotY + plotHeight + 3, 28, `${value}%`, { size: 5.8, align: "center" });
  });
  line(doc, plotX, plotY + plotHeight + 13, plotWidth, "Service-line occupancy", { size: 6, bold: true, align: "center" });
  points.forEach((point) => {
    doc.circle(sx(point.occupancyPct), sy(point.increasePct), 2.2)
      .fill(RESIDENT_SCATTER_COLORS[point.serviceLine] ?? "#44546A");
  });

  const counts = new Map<string, number>();
  points.forEach((point) => counts.set(point.serviceLine, (counts.get(point.serviceLine) ?? 0) + 1));
  let legendX = x;
  const legendY = plotY + plotHeight + 30;
  for (const [serviceLine, count] of counts) {
    const label = `${annualReportServiceLineLabel(serviceLine)} (${count.toLocaleString("en-US")})`;
    const labelWidth = Math.max(58, label.length * 4.5 + 14);
    if (legendX + labelWidth > x + width) {
      legendX = x;
    }
    doc.circle(legendX + 3, legendY + 3, 3).fill(RESIDENT_SCATTER_COLORS[serviceLine] ?? "#44546A");
    line(doc, legendX + 10, legendY, labelWidth - 10, label, { size: 6.3, color: NAVY });
    legendX += labelWidth;
  }
}

/**
 * Render the saved report snapshot without recalculating it. The reference
 * workbook is a fixed four-page landscape report: Combined + charts on page 1,
 * all three occupancy tiers on page 2, resident increase distributions on page 3,
 * and the resident-level scattergram on page 4.
 */
export function generateAnnualInhouseReportPdf(report: AnnualReportPdfReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "landscape",
      margins: { top: 54, right: 18, bottom: 54, left: 18 },
      bufferPages: true,
      info: { Title: "Annual In-House Increase Report", Subject: report.scopeKey },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const plans = reportPlans(report.plans);
    const stamp = report.generatedAt ? new Date(report.generatedAt).toLocaleString("en-US") : "—";
    const pageX = 18;
    const pageWidth = doc.page.width - 36;
    const combinedRows = workbookRows(plans, report.tierGrid);
    drawWorkbookPageHeader(doc, report, stamp, 1);
    drawWorkbookBlock(doc, combinedRows, pageX, 54, pageWidth, "Combined", "#44546A");
    drawWorkbookScatterplots(doc, combinedRows, report.tierGrid, pageX, 300, pageWidth);

    doc.addPage();
    drawWorkbookPageHeader(doc, report, stamp, 2);
    drawWorkbookBlock(doc, workbookRows(plans, report.tierGrid, "high"), pageX, 54, pageWidth, occupancyTierTitle(report.tierGrid, "high", "Occupancy Tier 1  •  High occupancy"), "#F5F4ED");
    drawWorkbookBlock(doc, workbookRows(plans, report.tierGrid, "target"), pageX, 234, pageWidth, occupancyTierTitle(report.tierGrid, "target", "Occupancy Tier 2  •  Target occupancy"), "#101010");
    drawWorkbookBlock(doc, workbookRows(plans, report.tierGrid, "low"), pageX, 414, pageWidth, occupancyTierTitle(report.tierGrid, "low", "Occupancy Tier 3  •  Low occupancy"), "#388194");

    doc.addPage();
    drawWorkbookPageHeader(doc, report, stamp, 3);
    drawResidentIncreaseCharts(doc, residentChartPlans(report, plans), pageX, 54, pageWidth);

    doc.addPage();
    drawWorkbookPageHeader(doc, report, stamp, 4);
    drawResidentIncreaseScatter(doc, report.residentScatterPoints ?? [], pageX, 54, pageWidth);

    const pages = doc.bufferedPageRange();
    if (pages.count !== 4) {
      doc.end();
      reject(new Error(`Annual in-house report must be exactly four pages (${pages.count} pages)`));
      return;
    }
    doc.end();
  });
}

export { planStatus };
export const generateAnnualReportPdf = generateAnnualInhouseReportPdf;