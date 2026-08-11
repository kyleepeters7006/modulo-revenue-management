/**
 * Pricing Strategy Exporter
 * Generates Excel and PDF exports of the pricing strategy documentation,
 * including AI-generated per-rule descriptions and an overall portfolio summary.
 */

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";

export interface RuleSummary {
  ruleId: string;
  ruleName: string;
  description: string;
}

export interface AiContent {
  executiveSummary: string;
  ruleSummaries: RuleSummary[];
}

export interface StrategyDocumentation {
  campus: string;
  serviceLine?: string;
  sentenceVersion: string;
  equationVersion: string;
  currentMetrics: { occupancy: number; avgRate: number; unitCount: number };
}

// ──────────────────────────────────────────────────────────────────────────────
// AI Summary Generation
// ──────────────────────────────────────────────────────────────────────────────

export async function generateAiContent(
  rules: any[],
  portfolioStats: {
    totalLocations: number;
    totalUnits: number;
    avgOccupancy: number;
    avgStreetRate: number;
    clientName: string;
  }
): Promise<AiContent> {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI();

  const rulesText = rules
    .map((r, i) => {
      const action = r.action || {};
      const adjValue = action.adjustmentValue ?? 0;
      const adjType = action.adjustmentType === "fixed" ? `$${adjValue}` : `${adjValue}%`;
      const target = action.target === "care_rate" ? "care rate" : "street rate";
      const sl = r.service_line || r.serviceLine || action.filters?.serviceLine?.join(", ") || "all service lines";
      const rt = action.filters?.roomType?.join(", ") || "all room types";
      const occ = action.filters?.occupancyStatus || "all units";
      const monthly = r.monthly_impact ?? r.monthlyImpact ?? 0;
      return `${i + 1}. "${r.name}" — ${adjType} ${adjValue < 0 ? "decrease" : "increase"} to ${target} | Scope: ${sl}, ${rt}, ${occ} | Monthly impact: $${Number(monthly).toLocaleString()} | Executions: ${r.execution_count || 0}`;
    })
    .join("\n");

  const prompt = `You are a senior revenue management consultant specializing in senior living facilities.

Portfolio: ${portfolioStats.clientName}
- Properties: ${portfolioStats.totalLocations}
- Total units: ${portfolioStats.totalUnits}
- Average occupancy: ${Math.round(portfolioStats.avgOccupancy)}%
- Average street rate: $${portfolioStats.avgStreetRate.toLocaleString()}/mo

Active pricing rules (${rules.length} total):
${rulesText || "No active rules."}

Please provide:
1. An executive summary (3–5 sentences) of the overall pricing strategy — what the portfolio is optimizing for, the general approach, and any notable patterns in the rule set.
2. For each rule, a 1–2 sentence plain-English description of what the rule does, why it likely exists, and its expected impact on revenue or occupancy.

Return ONLY valid JSON in this exact structure:
{
  "executiveSummary": "...",
  "ruleSummaries": [
    { "ruleId": "<id>", "ruleName": "<name>", "description": "..." }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    return {
      executiveSummary: parsed.executiveSummary || "No summary generated.",
      ruleSummaries: parsed.ruleSummaries || [],
    };
  } catch (err) {
    console.error("[pricingStrategyExporter] AI generation error:", err);
    return {
      executiveSummary: "AI summary generation failed. Please review the rules manually.",
      ruleSummaries: rules.map((r) => ({
        ruleId: r.id,
        ruleName: r.name,
        description: "See rule details above.",
      })),
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Excel Export
// ──────────────────────────────────────────────────────────────────────────────

const TEAL = "FF0D9488";
const WHITE = "FFFFFFFF";
const LIGHT_GRAY = "FFF3F4F6";
const DARK_GRAY = "FF374151";

function headerRow(ws: ExcelJS.Worksheet, cols: string[]): void {
  const row = ws.addRow(cols);
  row.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    cell.font = { bold: true, color: { argb: WHITE }, size: 11 };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      bottom: { style: "medium", color: { argb: DARK_GRAY } },
    };
  });
  row.height = 28;
}

export async function generateExcelBuffer(
  docs: StrategyDocumentation[],
  rules: any[],
  aiContent: AiContent,
  clientName: string
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Modulo Revenue Management";
  wb.created = new Date();

  // ── Sheet 1: Executive Summary ──────────────────────────────────────────────
  const sumSheet = wb.addWorksheet("Executive Summary");
  sumSheet.columns = [
    { width: 24 },
    { width: 70 },
  ];

  const titleRow = sumSheet.addRow(["Pricing Strategy Documentation"]);
  titleRow.getCell(1).font = { bold: true, size: 18, color: { argb: TEAL } };
  titleRow.getCell(1).alignment = { horizontal: "left" };
  sumSheet.mergeCells(`A1:B1`);

  const subtitleRow = sumSheet.addRow([clientName, `Generated: ${new Date().toLocaleDateString()}`]);
  subtitleRow.getCell(1).font = { italic: true, size: 11, color: { argb: DARK_GRAY } };
  subtitleRow.getCell(2).font = { italic: true, size: 11, color: { argb: DARK_GRAY } };
  subtitleRow.getCell(2).alignment = { horizontal: "right" };

  sumSheet.addRow([]);

  const aiHeaderRow = sumSheet.addRow(["AI Executive Summary"]);
  aiHeaderRow.getCell(1).font = { bold: true, size: 13, color: { argb: TEAL } };
  sumSheet.mergeCells(`A4:B4`);

  const aiRow = sumSheet.addRow([aiContent.executiveSummary]);
  aiRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
  aiRow.getCell(1).font = { size: 11 };
  aiRow.height = Math.max(60, Math.ceil(aiContent.executiveSummary.length / 90) * 15);
  sumSheet.mergeCells(`A5:B5`);

  sumSheet.addRow([]);

  const statsHeaderRow = sumSheet.addRow(["Portfolio Overview"]);
  statsHeaderRow.getCell(1).font = { bold: true, size: 13, color: { argb: TEAL } };
  sumSheet.mergeCells(`A7:B7`);

  const statsData = [
    ["Total Active Rules", rules.length],
    ["Total Campus / Service Line Combinations", docs.length],
    [
      "Total Monthly Impact",
      `$${Math.round(rules.reduce((s, r) => s + (r.monthly_impact ?? r.monthlyImpact ?? 0), 0)).toLocaleString()}`,
    ],
    [
      "Total Annual Impact",
      `$${Math.round(rules.reduce((s, r) => s + (r.annual_impact ?? r.annualImpact ?? 0), 0)).toLocaleString()}`,
    ],
  ];
  statsData.forEach(([label, value]) => {
    const r = sumSheet.addRow([label, value]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { horizontal: "right" };
    r.eachCell((c, n) => {
      if (n <= 2) {
        c.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
      }
    });
  });

  // ── Sheet 2: Active Rules ───────────────────────────────────────────────────
  const rulesSheet = wb.addWorksheet("Active Rules");
  rulesSheet.columns = [
    { key: "name",        header: "Rule Name",          width: 28 },
    { key: "sl",          header: "Service Line",        width: 16 },
    { key: "type",        header: "Type",                width: 14 },
    { key: "value",       header: "Adjustment",          width: 14 },
    { key: "units",       header: "Affected Units",      width: 16 },
    { key: "campuses",    header: "Affected Campuses",   width: 18 },
    { key: "monthly",     header: "Monthly Impact",      width: 16 },
    { key: "annual",      header: "Annual Impact",       width: 16 },
    { key: "description", header: "AI Description",      width: 60 },
  ];

  headerRow(rulesSheet, rulesSheet.columns.map((c) => c.header as string));

  rules.forEach((rule, idx) => {
    const action = rule.action || {};
    const adjValue = action.adjustmentValue ?? 0;
    const adjType = action.adjustmentType || "percentage";
    const sl = rule.service_line || rule.serviceLine || action.filters?.serviceLine?.join(", ") || "All";
    const aiDesc = aiContent.ruleSummaries.find((s) => s.ruleId === rule.id)?.description || "";
    const monthly = rule.monthly_impact ?? rule.monthlyImpact ?? 0;
    const annual  = rule.annual_impact  ?? rule.annualImpact  ?? 0;

    const r = rulesSheet.addRow({
      name:        rule.name || "",
      sl,
      type:        adjType === "fixed" ? "Fixed ($)" : "Percentage (%)",
      value:       adjType === "fixed" ? `$${adjValue}` : `${adjValue}%`,
      units:       rule._affectedUnits ?? rule.execution_count ?? 0,
      campuses:    "-",
      monthly:     monthly ? `$${Math.round(monthly).toLocaleString()}` : "$0",
      annual:      annual  ? `$${Math.round(annual).toLocaleString()}`  : "$0",
      description: aiDesc,
    });

    if (idx % 2 === 0) {
      r.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GRAY } };
      });
    }
    r.getCell("description").alignment = { wrapText: true, vertical: "top" };
    r.height = Math.max(20, Math.ceil(aiDesc.length / 60) * 15 + 5);

    ["monthly", "annual"].forEach((k) => {
      const cell = r.getCell(k);
      cell.alignment = { horizontal: "right" };
    });
    ["units", "campuses"].forEach((k) => {
      const cell = r.getCell(k);
      cell.alignment = { horizontal: "center" };
    });
  });

  rulesSheet.autoFilter = {
    from: "A1",
    to: `I1`,
  };

  // ── Sheet 3: Campus Strategies ──────────────────────────────────────────────
  const campusSheet = wb.addWorksheet("Campus Strategies");
  campusSheet.columns = [
    { key: "campus",      header: "Campus",              width: 32 },
    { key: "sl",          header: "Service Line",        width: 18 },
    { key: "units",       header: "Units",               width: 10 },
    { key: "occupancy",   header: "Occupancy %",         width: 14 },
    { key: "avgRate",     header: "Avg Rate ($/mo)",     width: 18 },
    { key: "strategy",    header: "Pricing Strategy",    width: 80 },
  ];

  headerRow(campusSheet, campusSheet.columns.map((c) => c.header as string));

  docs.forEach((doc, idx) => {
    const r = campusSheet.addRow({
      campus:    doc.campus,
      sl:        doc.serviceLine || "All Service Lines",
      units:     doc.currentMetrics.unitCount,
      occupancy: `${Math.round(doc.currentMetrics.occupancy * 100)}%`,
      avgRate:   `$${doc.currentMetrics.avgRate.toLocaleString()}`,
      strategy:  doc.sentenceVersion,
    });

    if (idx % 2 === 0) {
      r.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_GRAY } };
      });
    }
    r.getCell("strategy").alignment = { wrapText: true, vertical: "top" };
    r.height = Math.max(20, Math.ceil((doc.sentenceVersion?.length || 0) / 100) * 15 + 5);
    r.getCell("units").alignment    = { horizontal: "center" };
    r.getCell("occupancy").alignment = { horizontal: "center" };
    r.getCell("avgRate").alignment   = { horizontal: "right" };
  });

  campusSheet.autoFilter = { from: "A1", to: "F1" };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ──────────────────────────────────────────────────────────────────────────────
// PDF Export
// ──────────────────────────────────────────────────────────────────────────────

const TEAL_RGB: [number, number, number] = [13, 148, 136];
const BLACK_RGB: [number, number, number] = [17, 24, 39];
const GRAY_RGB: [number, number, number] = [107, 114, 128];
const LIGHT_RGB: [number, number, number] = [243, 244, 246];

export async function generatePdfBuffer(
  docs: StrategyDocumentation[],
  rules: any[],
  aiContent: AiContent,
  clientName: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50, size: "LETTER" });

    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pw = doc.page.width - 100; // usable width

    const WHITE_RGB: [number, number, number] = [255, 255, 255];

    // Helper: section header bar
    const sectionTitle = (text: string) => {
      const sy = doc.y;
      doc.fillColor(TEAL_RGB).rect(50, sy, pw, 24).fill();
      doc.fillColor(WHITE_RGB).font("Helvetica-Bold").fontSize(12)
        .text(text, 60, sy + 6, { width: pw - 20 });
      doc.moveDown(0.4);
    };

    // Helper: divider
    const divider = () => {
      doc.strokeColor([209, 213, 219]).lineWidth(0.5)
        .moveTo(50, doc.y).lineTo(50 + pw, doc.y).stroke();
      doc.moveDown(0.4);
    };

    // ── Cover / Header ─────────────────────────────────────────────────────
    doc.fillColor(TEAL_RGB).rect(0, 0, doc.page.width, 80).fill();
    doc.fillColor(WHITE_RGB).font("Helvetica-Bold").fontSize(22)
      .text("Pricing Strategy Documentation", 50, 22, { width: pw });
    doc.fillColor([209, 250, 229] as [number, number, number]).font("Helvetica").fontSize(11)
      .text(`${clientName}  •  Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, 50, 52, { width: pw });

    doc.moveDown(2);

    // ── Executive AI Summary ───────────────────────────────────────────────
    sectionTitle("AI Executive Summary");

    doc.fillColor(BLACK_RGB).font("Helvetica").fontSize(10.5)
      .text(aiContent.executiveSummary, 50, doc.y, { width: pw, align: "justify" });
    doc.moveDown(1.5);

    // ── Portfolio Overview ─────────────────────────────────────────────────
    sectionTitle("Portfolio Overview");

    const totalMonthly = Math.round(rules.reduce((s, r) => s + (r.monthly_impact ?? r.monthlyImpact ?? 0), 0));
    const totalAnnual  = Math.round(rules.reduce((s, r) => s + (r.annual_impact  ?? r.annualImpact  ?? 0), 0));
    const stats = [
      ["Active Rules",                   String(rules.length)],
      ["Campus / Service Line Records",  String(docs.length)],
      ["Total Monthly Impact",           `$${totalMonthly.toLocaleString()}`],
      ["Total Annual Impact",            `$${totalAnnual.toLocaleString()}`],
    ];

    const col1 = 50;
    const col2 = 280;
    stats.forEach(([label, value], idx) => {
      const y = doc.y;
      if (idx % 2 === 0) {
        doc.fillColor(LIGHT_RGB).rect(50, y - 2, pw, 18).fill();
      }
      doc.fillColor(GRAY_RGB).font("Helvetica").fontSize(9.5).text(label, col1, y, { width: col2 - col1 - 10 });
      doc.fillColor(BLACK_RGB).font("Helvetica-Bold").fontSize(9.5).text(value, col2, y, { width: pw - (col2 - col1) });
      doc.moveDown(0.55);
    });

    doc.moveDown(0.8);

    // ── Active Rules ───────────────────────────────────────────────────────
    if (rules.length > 0) {
      doc.addPage();
      sectionTitle(`Active Pricing Rules (${rules.length})`);

      rules.forEach((rule, idx) => {
        // page break check
        if (doc.y > doc.page.height - 160) doc.addPage();

        const action = rule.action || {};
        const adjValue = action.adjustmentValue ?? 0;
        const adjType  = action.adjustmentType || "percentage";
        const sl       = rule.service_line || rule.serviceLine || action.filters?.serviceLine?.join(", ") || "All service lines";
        const aiDesc   = aiContent.ruleSummaries.find((s) => s.ruleId === rule.id)?.description || "";
        const monthly  = rule.monthly_impact ?? rule.monthlyImpact ?? 0;
        const annual   = rule.annual_impact  ?? rule.annualImpact  ?? 0;

        // Rule header
        const ruleY = doc.y;
        doc.fillColor(LIGHT_RGB).rect(50, ruleY, pw, 20).fill();
        doc.fillColor(TEAL_RGB).font("Helvetica-Bold").fontSize(10.5)
          .text(`${idx + 1}. ${rule.name || "Unnamed Rule"}`, 56, ruleY + 4, { width: pw - 12 });
        doc.moveDown(0.9);

        // Rule stats row
        const statItems = [
          `Type: ${adjType === "fixed" ? "Fixed" : "Percentage"}`,
          `Adjustment: ${adjType === "fixed" ? "$" : ""}${adjValue}${adjType !== "fixed" ? "%" : ""}`,
          `Scope: ${sl}`,
          `Executions: ${rule.execution_count || 0}`,
          `Monthly: $${Math.round(monthly).toLocaleString()}`,
          `Annual: $${Math.round(annual).toLocaleString()}`,
        ];
        doc.fillColor(GRAY_RGB).font("Helvetica").fontSize(8.5)
          .text(statItems.join("   |   "), 56, doc.y, { width: pw - 12 });
        doc.moveDown(0.5);

        // AI description
        if (aiDesc) {
          doc.fillColor(BLACK_RGB).font("Helvetica").fontSize(9.5)
            .text(aiDesc, 56, doc.y, { width: pw - 12 });
          doc.moveDown(0.4);
        }

        divider();
      });
    }

    // ── Campus Strategies ──────────────────────────────────────────────────
    if (docs.length > 0) {
      doc.addPage();
      sectionTitle("Campus-Level Pricing Strategies");

      docs.forEach((d) => {
        if (doc.y > doc.page.height - 160) doc.addPage();

        const campusY = doc.y;
        doc.fillColor(LIGHT_RGB).rect(50, campusY, pw, 20).fill();
        const title = d.serviceLine
          ? `${d.campus}  —  ${d.serviceLine}`
          : d.campus;
        doc.fillColor(TEAL_RGB).font("Helvetica-Bold").fontSize(10.5)
          .text(title, 56, campusY + 4, { width: pw - 12 });
        doc.moveDown(0.9);

        const metrics = [
          `Units: ${d.currentMetrics.unitCount}`,
          `Occupancy: ${Math.round(d.currentMetrics.occupancy * 100)}%`,
          `Avg Rate: $${d.currentMetrics.avgRate.toLocaleString()}/mo`,
        ];
        doc.fillColor(GRAY_RGB).font("Helvetica").fontSize(8.5)
          .text(metrics.join("   |   "), 56, doc.y, { width: pw - 12 });
        doc.moveDown(0.5);

        doc.fillColor(BLACK_RGB).font("Helvetica").fontSize(9.5)
          .text(d.sentenceVersion || "", 56, doc.y, { width: pw - 12 });
        doc.moveDown(0.4);

        divider();
      });
    }

    // ── Footer on every page ───────────────────────────────────────────────
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      doc.fillColor(GRAY_RGB).font("Helvetica").fontSize(8)
        .text(
          `Modulo Revenue Management  •  Confidential  •  Page ${i + 1} of ${pages.count}`,
          50,
          doc.page.height - 30,
          { width: pw, align: "center" }
        );
    }

    doc.end();
  });
}
