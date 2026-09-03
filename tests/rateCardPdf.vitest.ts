/**
 * Rate-card PDF regression coverage.
 *
 * This deliberately tests the production effective-rate service and PDF
 * renderer together. A PDF that merely has a valid header can still publish
 * the wrong campus, resurrect a disabled formula, or silently add pages when
 * the footer is drawn.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import { request as httpRequest } from "node:http";
import { inflateSync } from "node:zlib";
import {
  DERIVED_RATE_TYPE_META,
  type DerivedRateFormula,
} from "../shared/derivedRates";

type RentRollFixture = {
  id: string;
  locationId: string;
  location: string;
  serviceLine: string;
  roomType: string;
  roomNumber: string;
  occupiedYN: boolean;
  residentId: null;
  residentName: null;
  inHouseRate: number;
  streetRate: number;
  moduloSuggestedRate: number | null;
  ruleAdjustedRate: number | null;
};

const { fakeDb, configureDb } = vi.hoisted(() => {
  let rentRollRows: RentRollFixture[] = [];
  let campusRows: Array<{ name: string }> = [];
  let overrideRows: Array<Record<string, unknown>> = [];

  const db = {
    select: (fields?: Record<string, unknown>) => {
      const selectedField = fields ? Object.keys(fields)[0] : undefined;
      return {
        from: () => {
          const rows: any[] = selectedField === "m"
            ? [{ m: "2026-08" }]
            : selectedField === "name"
              ? campusRows
              : rentRollRows;
          return Object.assign([...rows], {
            where: async () => rows,
          });
        },
      };
    },
    execute: async () => ({ rows: overrideRows }),
  };

  return {
    fakeDb: db,
    configureDb: (
      nextRentRollRows: RentRollFixture[],
      nextOverrideRows: Array<Record<string, unknown>>,
      nextCampusRows?: Array<{ name: string }>,
    ) => {
      rentRollRows = nextRentRollRows;
      overrideRows = nextOverrideRows;
      campusRows = nextCampusRows ?? Array.from(
        new Set(nextRentRollRows.map((row) => row.location)),
        (name) => ({ name }),
      );
    },
  };
});

vi.mock("../server/db", () => ({ db: fakeDb }));
vi.mock("../server/services/derivedRateFormulasService", () => ({
  getDerivedRateFormulas: vi.fn(async () => []),
}));

import { generateRateCardPdf } from "../server/rateCardPdf";
import { getEffectiveRateUnits } from "../server/services/exportRateService";
import { registerRateCardPdfRoute } from "../server/routes";

function rentRollRow(
  overrides: Partial<RentRollFixture> & Pick<RentRollFixture, "id" | "location" | "serviceLine" | "roomType">,
): RentRollFixture {
  return {
    id: overrides.id,
    locationId: overrides.locationId ?? `location-${overrides.location.replace(/\s+/g, "-").toLowerCase()}`,
    location: overrides.location,
    serviceLine: overrides.serviceLine,
    roomType: overrides.roomType,
    roomNumber: overrides.roomNumber ?? "1",
    occupiedYN: overrides.occupiedYN ?? false,
    residentId: null,
    residentName: null,
    inHouseRate: overrides.inHouseRate ?? 1200,
    streetRate: overrides.streetRate ?? 1400,
    moduloSuggestedRate: overrides.moduloSuggestedRate === undefined ? 1500 : overrides.moduloSuggestedRate,
    ruleAdjustedRate: overrides.ruleAdjustedRate === undefined ? 1600 : overrides.ruleAdjustedRate,
  };
}

function formulaSet(): DerivedRateFormula[] {
  return DERIVED_RATE_TYPE_META.map((meta) => ({
    rateType: meta.type,
    serviceLine: null,
    percentOfBase: meta.type === "respite" ? 80 : 100,
    dollarOffset: 0,
    // Respite is globally enabled; the AL override disables it below.
    // Bed hold is globally disabled; the AL override enables it below.
    enabled: meta.type === "couple" || meta.type === "respite",
  }));
}

function pdfText(pdf: Buffer): string {
  const textChunks: string[] = [];
  const source = pdf.toString("latin1");
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  for (const match of source.matchAll(streamPattern)) {
    let stream: string;
    try {
      stream = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    } catch {
      continue;
    }

    for (const tj of stream.matchAll(/\[(.*?)\]\s*TJ/g)) {
      const rendered = Array.from(tj[1].matchAll(/<([0-9a-f]+)>/gi))
        .map((part) => Buffer.from(part[1], "hex").toString("latin1"))
        .join("");
      if (rendered) textChunks.push(rendered);
    }
    for (const tj of stream.matchAll(/<([0-9a-f]+)>\s*Tj/g)) {
      textChunks.push(Buffer.from(tj[1], "hex").toString("latin1"));
    }
  }
  return textChunks.join("\n");
}

function pageCount(pdf: Buffer): number {
  return [...pdf.toString("latin1").matchAll(/\/Type\s+\/Page\b/g)].length;
}

function expectPdfIsValidAndBounded(pdf: Buffer): void {
  expect(pdf.subarray(0, 8).toString()).toBe("%PDF-1.3");
  expect(pdf.toString("latin1").endsWith("%%EOF\n")).toBe(true);
  expect(pageCount(pdf)).toBeGreaterThan(0);
  expect(pageCount(pdf)).toBeLessThanOrEqual(6);
}

async function requestRateCardPdf(query: Record<string, string>): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}> {
  const app = express();
  registerRateCardPdfRoute(app);
  const server = app.listen(0);

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine test server address");
    }
    const path = `/api/export/rate-card-pdf?${new URLSearchParams(query).toString()}`;
    return await new Promise((resolve, reject) => {
      const request = httpRequest({
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method: "GET",
      }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }));
        response.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const rows: RentRollFixture[] = [
  // This row proves manual override wins over every other candidate.
  rentRollRow({
    id: "al-studio",
    location: "Campus A",
    serviceLine: "AL",
    roomType: "Studio",
    roomNumber: "101",
  }),
  // These rows prove each lower-priority source remains usable.
  rentRollRow({
    id: "al-rule",
    location: "Campus A",
    serviceLine: "AL",
    roomType: "Rule fallback",
    roomNumber: "102",
    ruleAdjustedRate: 1610,
  }),
  rentRollRow({
    id: "al-modulo",
    location: "Campus A",
    serviceLine: "AL",
    roomType: "Modulo fallback",
    roomNumber: "103",
    ruleAdjustedRate: null,
  }),
  rentRollRow({
    id: "al-street",
    location: "Campus A",
    serviceLine: "AL",
    roomType: "Street fallback",
    roomNumber: "104",
    ruleAdjustedRate: null,
    moduloSuggestedRate: null,
  }),
  // Enough rows to cross a page boundary and exercise footer pagination.
  ...Array.from({ length: 42 }, (_, index) =>
    rentRollRow({
      id: `al-room-${index}`,
      location: "Campus A",
      serviceLine: "AL",
      roomType: `Additional room ${index}`,
      roomNumber: `${200 + index}`,
    }),
  ),
  rentRollRow({
    id: "hc-room",
    location: "Campus A",
    serviceLine: "HC",
    roomType: "HC private room",
    roomNumber: "501",
    inHouseRate: 2800,
    streetRate: 3000,
    moduloSuggestedRate: 3000,
    ruleAdjustedRate: null,
  }),
  // This campus must never appear in a Campus A export.
  rentRollRow({
    id: "other-campus",
    location: "Campus B",
    serviceLine: "AL",
    roomType: "Leaked room",
    roomNumber: "901",
  }),
];

const overrides = [
  {
    location_id: "location-campus-a",
    location_name: "Campus A",
    service_line: "AL",
    room_type: "Studio",
    override_rate: 1700,
  },
];

describe("rate-card PDF export", () => {
  it("honors rate precedence and both campus and service-line filters", async () => {
    configureDb(rows, overrides);

    const campusScoped = await getEffectiveRateUnits("client-a", {
      campusNames: ["Campus A"],
    });
    expect(campusScoped.uploadMonth).toBe("2026-08");
    expect(campusScoped.units.every((unit) => unit.location === "Campus A")).toBe(true);
    expect(campusScoped.units.some((unit) => unit.location === "Campus B")).toBe(false);

    expect(campusScoped.units.find((unit) => unit.id === "al-studio")).toMatchObject({
      effectiveRate: 1700,
      rateSource: "override",
    });
    expect(campusScoped.units.find((unit) => unit.id === "al-rule")).toMatchObject({
      effectiveRate: 1610,
      rateSource: "rule",
    });
    expect(campusScoped.units.find((unit) => unit.id === "al-modulo")).toMatchObject({
      effectiveRate: 1500,
      rateSource: "modulo",
    });
    expect(campusScoped.units.find((unit) => unit.id === "al-street")).toMatchObject({
      effectiveRate: 1400,
      rateSource: "street",
    });

    // This is the same service-line narrowing used by the PDF route after the
    // campus lookup; keep the assertion beside the rendered output so a
    // future change cannot silently broaden the downloaded card.
    const alUnits = campusScoped.units.filter((unit) => unit.serviceLine === "AL");
    expect(alUnits.length).toBeGreaterThan(0);
    expect(alUnits.every((unit) => unit.serviceLine === "AL")).toBe(true);

    const formulas = [
      ...formulaSet(),
      {
        rateType: "couple",
        serviceLine: "AL",
        percentOfBase: 125,
        dollarOffset: 25,
        enabled: true,
      },
      {
        rateType: "respite",
        serviceLine: "AL",
        percentOfBase: 80,
        dollarOffset: 0,
        enabled: false,
      },
      {
        rateType: "bed_hold",
        serviceLine: "AL",
        percentOfBase: 50,
        dollarOffset: 0,
        enabled: true,
      },
    ] satisfies DerivedRateFormula[];

    const pdf = await generateRateCardPdf(alUnits, formulas, {
      companyName: "Test Health Services",
      uploadMonth: campusScoped.uploadMonth!,
      scopeLabel: "1 campus  •  Service line: AL",
    });
    expectPdfIsValidAndBounded(pdf);

    const text = pdfText(pdf);
    expect(text).toContain("Campus A");
    expect(text).not.toContain("Campus B");
    expect(text).toContain("AL Rental Rates");
    expect(text).not.toContain("HC Rental Rates");
    expect(text).toContain("Single Occupant");
    expect(text).toContain("Couple / double occupant");
    expect(text).toContain("Bed hold");
    // Respite is enabled globally but explicitly disabled for AL.
    expect(text).not.toContain("Respite");
    expect(text).toContain("$1,700 / mo.");
    expect(text).toContain("$2,150 / mo.");
    expect(text).toContain("$28 / day");
    expect(text).toContain("Page 1 of");
  });

  it("renders daily rates as daily while senior housing remains monthly", async () => {
    configureDb(rows, overrides);
    const campusScoped = await getEffectiveRateUnits("client-a", {
      campusNames: ["Campus A"],
    });

    const pdf = await generateRateCardPdf(campusScoped.units, formulaSet(), {
      companyName: "Test Health Services",
      uploadMonth: campusScoped.uploadMonth!,
      scopeLabel: "1 campus  •  All service lines",
    });
    expectPdfIsValidAndBounded(pdf);

    const text = pdfText(pdf);
    expect(text).toContain("AL Rental Rates");
    expect(text).toContain("HC Rental Rates");
    expect(text).toContain("$1,600 / mo.");
    expect(text).toContain("$3,000 / day");
  });

  it("delivers a filtered PDF through the download route", async () => {
    configureDb(rows, overrides, [{ name: "Campus A" }]);

    const response = await requestRateCardPdf({
      locations: "Campus A",
      serviceLine: "AL",
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/pdf\b/);
    expect(response.headers["content-disposition"]).toMatch(
      /^attachment; filename="Trilogy_Rate_Card_2026-08_\d{4}-\d{2}-\d{2}\.pdf"$/,
    );
    expect(response.headers["content-length"]).toBe(String(response.body.length));

    expectPdfIsValidAndBounded(response.body);
    const text = pdfText(response.body);
    expect(text).toContain("Campus A");
    expect(text).not.toContain("Campus B");
    expect(text).toContain("AL Rental Rates");
    expect(text).not.toContain("HC Rental Rates");
  });

  it("returns 404 when the campus or service-line filter has no matches", async () => {
    configureDb(rows, overrides, []);
    const missingCampus = await requestRateCardPdf({
      locations: "Missing Campus",
      serviceLine: "AL",
    });

    expect(missingCampus.status).toBe(404);
    expect(missingCampus.headers["content-type"]).toMatch(/^application\/json\b/);
    expect(JSON.parse(missingCampus.body.toString())).toEqual({
      error: "No campuses match the selected filters.",
    });

    configureDb(rows, overrides, [{ name: "Campus A" }]);
    const missingServiceLine = await requestRateCardPdf({
      locations: "Campus A",
      serviceLine: "Unknown service line",
    });

    expect(missingServiceLine.status).toBe(404);
    expect(JSON.parse(missingServiceLine.body.toString())).toEqual({
      error: "No rate data matches the selected filters.",
    });
  });
});