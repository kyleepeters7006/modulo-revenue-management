import PDFDocument from "pdfkit";
import { isBBedRow } from "@shared/bBed";
import {
  DERIVED_RATE_TYPE_META,
  applyDerivedFormula,
  resolveFormula,
  type DerivedRateFormula,
  type DerivedRateType,
} from "@shared/derivedRates";
import type { EffectiveRateUnit } from "./services/exportRateService";

const NAVY = "#08213D";
const BLUE = "#9CB9D4";
const LIGHT_BLUE = "#DCE8F2";
const LIGHT_GRAY = "#F3F4F6";
const MID_GRAY = "#64748B";
const TEXT = "#172033";
const WHITE = "#FFFFFF";
const DAYS_PER_MONTH = 365.25 / 12;
const DAILY_SERVICE_LINES = new Set(["HC", "HC/MC"]);
const DAILY_DERIVED_TYPES = new Set<DerivedRateType>(["respite", "rehab_tcu", "bed_hold"]);

type RateRow = {
  roomType: string;
  baseRate: number;
};

type ServiceLineTable = {
  serviceLine: string;
  rows: RateRow[];
  formulas: Array<{
    type: DerivedRateType;
    label: string;
    formula: DerivedRateFormula;
  }>;
};

type CampusSection = {
  location: string;
  tables: ServiceLineTable[];
};

export interface RateCardPdfOptions {
  companyName: string;
  uploadMonth: string;
  scopeLabel: string;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildCampusSections(
  units: EffectiveRateUnit[],
  formulas: DerivedRateFormula[],
): CampusSection[] {
  const grouped = new Map<string, number[]>();

  for (const unit of units) {
    if (!unit.hasRate || isBBedRow(unit.serviceLine, unit.roomNumber)) continue;
    const key = `${unit.location}\u0000${unit.serviceLine}\u0000${unit.roomType}`;
    const rates = grouped.get(key) ?? [];
    rates.push(unit.effectiveRate);
    grouped.set(key, rates);
  }

  const campuses = new Map<string, Map<string, RateRow[]>>();
  for (const [key, rates] of Array.from(grouped.entries())) {
    const [location, serviceLine, roomType] = key.split("\u0000");
    const serviceLines = campuses.get(location) ?? new Map<string, RateRow[]>();
    const rows = serviceLines.get(serviceLine) ?? [];
    rows.push({ roomType, baseRate: Math.round(average(rates)) });
    serviceLines.set(serviceLine, rows);
    campuses.set(location, serviceLines);
  }

  return Array.from(campuses.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([location, serviceLines]) => ({
      location,
      tables: Array.from(serviceLines.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([serviceLine, rows]) => ({
          serviceLine,
          rows: rows.sort((a, b) => a.roomType.localeCompare(b.roomType)),
          formulas: DERIVED_RATE_TYPE_META.flatMap((meta) => {
            const formula = resolveFormula(formulas, meta.type, serviceLine);
            return formula?.enabled
              ? [{ type: meta.type, label: meta.label, formula }]
              : [];
          }),
        })),
    }));
}

function formatMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatRate(value: number | null, serviceLine: string, type?: DerivedRateType): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  const daily = DAILY_SERVICE_LINES.has(serviceLine) || (type != null && DAILY_DERIVED_TYPES.has(type));
  return `$${Math.round(value).toLocaleString("en-US")} / ${daily ? "day" : "mo."}`;
}

function derivedRate(baseRate: number, serviceLine: string, type: DerivedRateType, formula: DerivedRateFormula): number | null {
  const value = applyDerivedFormula(baseRate, formula);
  if (value == null) return null;
  if (!DAILY_SERVICE_LINES.has(serviceLine) && DAILY_DERIVED_TYPES.has(type)) {
    return Math.round(value / DAYS_PER_MONTH);
  }
  return value;
}

function drawBrandHeader(doc: PDFKit.PDFDocument, options: RateCardPdfOptions): void {
  const width = doc.page.width;
  doc.save().fillColor(NAVY).rect(0, 0, width, 78).fill();

  doc.fillColor(BLUE).roundedRect(32, 18, 42, 42, 8).fill();
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(24).text("T", 45, 25, {
    width: 16,
    align: "center",
  });
  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(17).text("TRILOGY", 86, 18);
  doc.fillColor(BLUE).font("Helvetica").fontSize(7.5).text("HEALTH SERVICES", 87, 40, {
    characterSpacing: 1.35,
  });

  doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(20).text("RATE CARD", width - 250, 20, {
    width: 218,
    align: "right",
  });
  doc.fillColor(LIGHT_BLUE).font("Helvetica").fontSize(8.5).text(
    `${formatMonth(options.uploadMonth)}  •  Generated ${new Date().toLocaleDateString("en-US")}`,
    width - 330,
    48,
    { width: 298, align: "right" },
  );
  doc.restore();
  doc.y = 96;
}

function drawPageFooter(doc: PDFKit.PDFDocument, pageNumber: number, totalPages: number): void {
  // Keep the text baseline inside PDFKit's printable area. Writing below the
  // bottom margin silently creates an overflow page for each text call.
  const bottom = doc.page.height - 46;
  doc.save();
  doc.strokeColor("#CBD5E1").lineWidth(0.5).moveTo(32, bottom - 7).lineTo(doc.page.width - 32, bottom - 7).stroke();
  doc.fillColor(MID_GRAY).font("Helvetica").fontSize(7.5)
    .text("Confidential pricing document", 32, bottom, { width: 250, lineBreak: false })
    .text(`Page ${pageNumber} of ${totalPages}`, doc.page.width - 130, bottom, {
      width: 98,
      align: "right",
      lineBreak: false,
    });
  doc.restore();
}

function drawSummary(
  doc: PDFKit.PDFDocument,
  sections: CampusSection[],
  units: EffectiveRateUnit[],
  options: RateCardPdfOptions,
): void {
  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(15).text("Rate Summary", 32, doc.y);
  doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8.5).text(options.scopeLabel, 32, doc.y + 3, {
    width: doc.page.width - 64,
    align: "right",
  });
  doc.moveDown(0.65);

  const serviceLines = new Set(sections.flatMap((section) => section.tables.map((table) => table.serviceLine)));
  const roomTypes = new Set(sections.flatMap((section) => section.tables.flatMap((table) => table.rows.map((row) => row.roomType))));
  const usableRates = units.filter((unit) => unit.hasRate && !isBBedRow(unit.serviceLine, unit.roomNumber));
  const avgBase = usableRates.length > 0 ? average(usableRates.map((unit) => unit.effectiveRate)) : 0;
  const stats = [
    ["Campuses", String(sections.length)],
    ["Service Lines", String(serviceLines.size)],
    ["Room Types", String(roomTypes.size)],
    ["Average Base Rate", `$${Math.round(avgBase).toLocaleString("en-US")}`],
  ];

  const gap = 10;
  const cardWidth = (doc.page.width - 64 - gap * 3) / 4;
  const cardY = doc.y + 6;
  stats.forEach(([label, value], index) => {
    const x = 32 + index * (cardWidth + gap);
    doc.fillColor(LIGHT_BLUE).roundedRect(x, cardY, cardWidth, 48, 5).fill();
    doc.fillColor(MID_GRAY).font("Helvetica-Bold").fontSize(7.5).text(label.toUpperCase(), x + 10, cardY + 9, {
      width: cardWidth - 20,
    });
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(15).text(value, x + 10, cardY + 23, {
      width: cardWidth - 20,
    });
  });
  doc.y = cardY + 64;

  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(9).text("Rate basis");
  doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8.5).text(
    "Single Occupant is the current published base rate. Additional columns are calculated from enabled Derived Rate Formulas, including service-line overrides.",
    32,
    doc.y + 2,
    { width: doc.page.width - 64 },
  );
  doc.moveDown(1.8);

  const sources = new Map<string, number>();
  for (const unit of usableRates) sources.set(unit.rateSource, (sources.get(unit.rateSource) ?? 0) + 1);
  const sourceText = [
    ["override", "Manual override"],
    ["rule", "Rules rate"],
    ["modulo", "Saved base rate"],
    ["street", "Street rate"],
  ]
    .map(([key, label]) => `${label}: ${(sources.get(key) ?? 0).toLocaleString("en-US")}`)
    .join("   •   ");
  doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8).text(sourceText, 32, doc.y, {
    width: doc.page.width - 64,
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, height: number, options: RateCardPdfOptions): void {
  if (doc.y + height <= doc.page.height - 66) return;
  doc.addPage();
  drawBrandHeader(doc, options);
}

function drawRateTable(doc: PDFKit.PDFDocument, table: ServiceLineTable, options: RateCardPdfOptions): void {
  const columns = [
    { key: "roomType", label: "Room Type" },
    { key: "base", label: "Single Occupant" },
    ...table.formulas.map((entry) => ({ key: entry.type, label: entry.label })),
  ];
  const usableWidth = doc.page.width - 64;
  const firstWidth = Math.min(150, Math.max(112, usableWidth * 0.22));
  const rateWidth = (usableWidth - firstWidth) / Math.max(columns.length - 1, 1);
  const headerHeight = 28;
  const rowHeight = 23;

  ensureSpace(doc, 48 + headerHeight + rowHeight, options);
  doc.fillColor(TEXT).font("Helvetica-Bold").fontSize(13).text(`${table.serviceLine} Rental Rates`, 32, doc.y);
  doc.moveDown(0.45);

  const headerY = doc.y;
  doc.fillColor(NAVY).rect(32, headerY, usableWidth, headerHeight).fill();
  let x = 32;
  columns.forEach((column, index) => {
    const width = index === 0 ? firstWidth : rateWidth;
    doc.fillColor(WHITE).font("Helvetica-Bold").fontSize(7.5).text(column.label, x + 5, headerY + 8, {
      width: width - 10,
      align: index === 0 ? "left" : "center",
      ellipsis: true,
    });
    x += width;
  });
  doc.y = headerY + headerHeight;

  table.rows.forEach((row, rowIndex) => {
    ensureSpace(doc, rowHeight + 8, options);
    const y = doc.y;
    doc.fillColor(rowIndex % 2 === 0 ? WHITE : LIGHT_GRAY).rect(32, y, usableWidth, rowHeight).fill();
    doc.strokeColor("#CBD5E1").lineWidth(0.35).rect(32, y, usableWidth, rowHeight).stroke();

    x = 32;
    doc.fillColor(TEXT).font("Helvetica").fontSize(8).text(row.roomType, x + 5, y + 7, {
      width: firstWidth - 10,
      ellipsis: true,
    });
    x += firstWidth;
    doc.font("Helvetica-Bold").text(formatRate(row.baseRate, table.serviceLine), x + 4, y + 7, {
      width: rateWidth - 8,
      align: "center",
    });
    x += rateWidth;

    table.formulas.forEach((entry) => {
      const rate = derivedRate(row.baseRate, table.serviceLine, entry.type, entry.formula);
      doc.font("Helvetica").text(formatRate(rate, table.serviceLine, entry.type), x + 4, y + 7, {
        width: rateWidth - 8,
        align: "center",
      });
      x += rateWidth;
    });
    doc.y = y + rowHeight;
  });
  doc.moveDown(1.15);
}

export function generateRateCardPdf(
  units: EffectiveRateUnit[],
  formulas: DerivedRateFormula[],
  options: RateCardPdfOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "landscape",
      margins: { top: 32, right: 32, bottom: 32, left: 32 },
      bufferPages: true,
      info: {
        Title: `${options.companyName} Rate Card`,
        Author: options.companyName,
        Subject: `Published rental rates for ${formatMonth(options.uploadMonth)}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const sections = buildCampusSections(units, formulas);
    drawBrandHeader(doc, options);
    drawSummary(doc, sections, units, options);

    sections.forEach((section, campusIndex) => {
      if (campusIndex > 0 || doc.y > doc.page.height - 180) {
        doc.addPage();
        drawBrandHeader(doc, options);
      } else {
        doc.moveDown(1);
      }
      doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(16).text(section.location, 32, doc.y);
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8).text(
        `${section.tables.length} service line${section.tables.length === 1 ? "" : "s"}`,
        32,
        doc.y + 3,
        { width: doc.page.width - 64, align: "right" },
      );
      doc.moveDown(0.8);
      section.tables.forEach((table) => drawRateTable(doc, table, options));
    });

    const pageRange = doc.bufferedPageRange();
    for (let pageIndex = pageRange.start; pageIndex < pageRange.start + pageRange.count; pageIndex++) {
      doc.switchToPage(pageIndex);
      drawPageFooter(doc, pageIndex - pageRange.start + 1, pageRange.count);
    }
    doc.end();
  });
}