import PDFDocument from "pdfkit";

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
}

const NAVY = "#17324D";
const BLUE = "#2F6B95";
const MUTED = "#637381";
const PALE = "#EEF3F7";
const BORDER = "#C9D4DE";

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
  return text(first(plan, ["serviceLine", "scope.serviceLine", "name"])) ?? "Service line";
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
  doc
    .font(options.bold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(options.size ?? 7)
    .fillColor(options.color ?? NAVY)
    .text(value, x, y, { width, height: options.size ?? 7, lineBreak: false, align: options.align });
}

function heading(doc: PDFKit.PDFDocument, x: number, y: number, width: number, value: string): void {
  line(doc, x, y, width, value.toUpperCase(), { size: 8, color: BLUE, bold: true });
  doc.moveTo(x, y + 11).lineTo(x + width, y + 11).lineWidth(0.5).strokeColor(BORDER).stroke();
}

function valueOrDash(value: unknown, formatter: (v: unknown) => string | null = scalar): string {
  return formatter(value) ?? "—";
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

/**
 * Render the saved report snapshot without recalculating it.  The layout is
 * deliberately fixed and never calls addPage: a generated annual report is
 * always one landscape page, even when optional sections have no data.
 */
export function generateAnnualInhouseReportPdf(report: AnnualReportPdfReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "landscape",
      margins: { top: 26, right: 30, bottom: 24, left: 30 },
      bufferPages: true,
      info: { Title: "Annual In-House Increase Report", Subject: report.scopeKey },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const plans = reportPlans(report.plans);
    const status = report.status ?? planStatus(plans);
    const stamp = report.generatedAt ? new Date(report.generatedAt).toLocaleString("en-US") : "—";
    const pageWidth = doc.page.width - 60;
    line(doc, 30, 26, pageWidth - 100, "ANNUAL IN-HOUSE INCREASE REPORT", { size: 16, color: NAVY, bold: true });
    line(doc, 30, 45, pageWidth - 100, `Scope: ${report.scopeKey}`, { size: 7, color: MUTED });
    line(doc, 30 + pageWidth - 100, 27, 100, status, { size: 8, color: BLUE, bold: true, align: "right" });
    line(doc, 30 + pageWidth - 100, 45, 100, stamp, { size: 6.5, color: MUTED, align: "right" });

    const gap = 8;
    const planWidth = pageWidth * 0.30;
    const tierWidth = pageWidth * 0.37;
    const kpiWidth = pageWidth - planWidth - tierWidth - gap * 2;
    drawPlanTable(doc, plans, 30, 66, planWidth);
    drawTierTable(doc, report.tierGrid, 30 + planWidth + gap, 66, tierWidth);
    drawKpis(doc, plans, 30 + planWidth + gap + tierWidth + gap, 66, kpiWidth);
    drawNarrative(doc, report, plans, 30, 225, pageWidth);

    line(doc, 30, doc.page.height - 25, pageWidth, `Status: ${status}  •  Generated: ${stamp}`, { size: 6.5, color: MUTED });
    const pages = doc.bufferedPageRange();
    if (pages.count !== 1) {
      doc.end();
      reject(new Error(`Annual in-house report exceeded one page (${pages.count} pages)`));
      return;
    }
    doc.end();
  });
}

export { planStatus };
export const generateAnnualReportPdf = generateAnnualInhouseReportPdf;