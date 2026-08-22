/**
 * Native Excel charts for ExcelJS workbooks.
 *
 * ExcelJS (4.x) has no chart API at all, and SheetJS's community build cannot
 * write charts either, so a workbook produced by either library has no way to
 * carry one. The alternative — pasting a rendered PNG of a chart into the sheet
 * — produces a picture that does not update when the operator changes an input,
 * which defeats the point of exporting live formulas in the first place.
 *
 * So this module writes the OOXML chart parts by hand and injects them into the
 * finished .xlsx (which is a zip). The charts reference worksheet ranges, so
 * they recalculate with the rest of the workbook: change an assumption, and the
 * bars move.
 *
 * Scope is deliberately narrow — clustered column and line charts over
 * contiguous ranges, which is all the rate-planning export needs. It is not a
 * general charting library.
 */
import JSZip from "jszip";

export interface ChartSeries {
  /** Series label shown in the legend. */
  name: string;
  /** Fully-qualified category range, e.g. `'Move-in trends'!$A$2:$A$25`. */
  categoriesRef: string;
  /** Fully-qualified value range, e.g. `'Move-in trends'!$B$2:$B$25`. */
  valuesRef: string;
  /** Series colour as a bare RRGGBB hex string. */
  color?: string;
}

export interface ChartSpec {
  /** Worksheet the chart is drawn on. Must already exist in the workbook. */
  sheetName: string;
  type: "bar" | "line";
  title: string;
  series: ChartSeries[];
  /** Number format for the value axis, e.g. `#,##0`. */
  valueAxisFormat?: string;
  /** Placement, in zero-based grid coordinates. */
  anchor: { fromCol: number; fromRow: number; toCol: number; toRow: number };
}

const NS_CHART = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_MAIN = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_SSDRAW = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";

const CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml";
const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

const REL_DRAWING = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing";
const REL_CHART = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";

const DEFAULT_COLORS = ["4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];

/**
 * Escape for element content. Only `&`, `<` and `>` are special there — and
 * apostrophes deliberately are NOT escaped, because sheet-qualified range
 * references (`'Move-in trends'!$B$2`) are full of them and turning those into
 * `&apos;` makes them far harder to read when debugging a chart part by hand.
 */
function escText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape for a double-quoted attribute value. */
function escAttr(value: string): string {
  return escText(value).replace(/"/g, "&quot;");
}

/** A chart series in OOXML order — the schema is sequence-typed, not a bag. */
function seriesXml(s: ChartSeries, index: number, type: ChartSpec["type"]): string {
  const color = s.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  const shape =
    type === "line"
      ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr>`
      : `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;

  // barChart series carry invertIfNegative; lineChart series carry marker and
  // smooth. Emitting the wrong one makes Excel treat the file as repairable.
  const typeSpecificBefore =
    type === "bar" ? `<c:invertIfNegative val="0"/>` : `<c:marker><c:symbol val="none"/></c:marker>`;
  const typeSpecificAfter = type === "line" ? `<c:smooth val="0"/>` : "";

  return (
    `<c:ser>` +
    `<c:idx val="${index}"/>` +
    `<c:order val="${index}"/>` +
    `<c:tx><c:v>${escText(s.name)}</c:v></c:tx>` +
    shape +
    typeSpecificBefore +
    `<c:cat><c:strRef><c:f>${escText(s.categoriesRef)}</c:f></c:strRef></c:cat>` +
    `<c:val><c:numRef><c:f>${escText(s.valuesRef)}</c:f></c:numRef></c:val>` +
    typeSpecificAfter +
    `</c:ser>`
  );
}

function chartXml(spec: ChartSpec, catAxId: number, valAxId: number): string {
  const plot =
    spec.type === "bar"
      ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>` +
        spec.series.map((s, i) => seriesXml(s, i, "bar")).join("") +
        `<c:gapWidth val="60"/><c:overlap val="-10"/>` +
        `<c:axId val="${catAxId}"/><c:axId val="${valAxId}"/></c:barChart>`
      : `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>` +
        spec.series.map((s, i) => seriesXml(s, i, "line")).join("") +
        `<c:marker val="1"/>` +
        `<c:axId val="${catAxId}"/><c:axId val="${valAxId}"/></c:lineChart>`;

  const valFmt = spec.valueAxisFormat
    ? `<c:numFmt formatCode="${escAttr(spec.valueAxisFormat)}" sourceLinked="0"/>`
    : "";

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    `<c:chart>` +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>` +
    `<a:pPr><a:defRPr sz="1200" b="1"/></a:pPr>` +
    `<a:r><a:rPr lang="en-US" sz="1200" b="1"/><a:t>${escText(spec.title)}</a:t></a:r>` +
    `</a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    `<c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/>` +
    plot +
    `<c:catAx><c:axId val="${catAxId}"/>` +
    `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="b"/>` +
    `<c:txPr><a:bodyPr rot="-2700000" vert="horz"/><a:lstStyle/>` +
    `<a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>` +
    `<c:crossAx val="${valAxId}"/></c:catAx>` +
    `<c:valAx><c:axId val="${valAxId}"/>` +
    `<c:scaling><c:orientation val="minMax"/></c:scaling>` +
    `<c:delete val="0"/><c:axPos val="l"/>` +
    `<c:majorGridlines/>` +
    valFmt +
    `<c:txPr><a:bodyPr/><a:lstStyle/>` +
    `<a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>` +
    `<c:crossAx val="${catAxId}"/></c:valAx>` +
    `</c:plotArea>` +
    `<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>` +
    `<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>` +
    `</c:chart></c:chartSpace>`
  );
}

/** One drawing part per worksheet, holding every chart anchored to that sheet. */
function drawingXml(specs: ChartSpec[]): string {
  const frames = specs
    .map((spec, i) => {
      const a = spec.anchor;
      return (
        `<xdr:twoCellAnchor>` +
        `<xdr:from><xdr:col>${a.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${a.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${a.toCol}</xdr:col><xdr:colOff>0</xdr:colOff>` +
        `<xdr:row>${a.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro="">` +
        `<xdr:nvGraphicFramePr>` +
        `<xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/>` +
        `<xdr:cNvGraphicFramePr/>` +
        `</xdr:nvGraphicFramePr>` +
        `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
        `<a:graphic><a:graphicData uri="${NS_CHART}">` +
        `<c:chart xmlns:c="${NS_CHART}" xmlns:r="${NS_REL}" r:id="rId${i + 1}"/>` +
        `</a:graphicData></a:graphic>` +
        `</xdr:graphicFrame>` +
        `<xdr:clientData/>` +
        `</xdr:twoCellAnchor>`
      );
    })
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<xdr:wsDr xmlns:xdr="${NS_SSDRAW}" xmlns:a="${NS_MAIN}">${frames}</xdr:wsDr>`
  );
}

/**
 * Map worksheet name to its part path, by walking workbook.xml and its rels.
 * Sheet order in workbook.xml does NOT reliably match sheetN.xml numbering, so
 * the relationship id is the only safe link.
 */
function resolveSheetPaths(workbookXml: string, relsXml: string): Map<string, string> {
  const relTarget = new Map<string, string>();
  for (const m of Array.from(relsXml.matchAll(/<Relationship\b[^>]*\/?>/g))) {
    const tag = m[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    if (id && target) relTarget.set(id, target);
  }

  const out = new Map<string, string>();
  for (const m of Array.from(workbookXml.matchAll(/<sheet\b[^>]*\/?>/g))) {
    const tag = m[0];
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    const rid = /r:id="([^"]+)"/.exec(tag)?.[1];
    if (!name || !rid) continue;
    const target = relTarget.get(rid);
    if (!target) continue;
    const path = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;
    // Unescape the XML entities Excel uses in sheet names.
    const decoded = name
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    out.set(decoded, path);
  }
  return out;
}

/**
 * Add charts to a finished .xlsx buffer.
 *
 * Returns a new buffer; the input is not modified. Throws when a chart names a
 * sheet that does not exist, or when the sheet already carries a drawing —
 * silently dropping either would produce a workbook that opens with no chart
 * and no explanation.
 */
export async function injectCharts(buffer: Buffer, charts: ChartSpec[]): Promise<Buffer> {
  if (charts.length === 0) return buffer;

  const zip = await JSZip.loadAsync(buffer);

  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  const workbookRels = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  if (!workbookXml || !workbookRels) {
    throw new Error("injectCharts: workbook.xml or its relationships are missing");
  }

  const sheetPaths = resolveSheetPaths(workbookXml, workbookRels);

  const bySheet = new Map<string, ChartSpec[]>();
  for (const c of charts) {
    if (!sheetPaths.has(c.sheetName)) {
      throw new Error(
        `injectCharts: no worksheet named "${c.sheetName}" (have: ${Array.from(sheetPaths.keys()).join(", ")})`,
      );
    }
    const list = bySheet.get(c.sheetName) ?? [];
    list.push(c);
    bySheet.set(c.sheetName, list);
  }

  let contentTypes = await zip.file("[Content_Types].xml")?.async("string");
  if (!contentTypes) throw new Error("injectCharts: [Content_Types].xml is missing");

  // Numbering must continue past whatever the package already contains.
  // Starting at drawing1/chart1 unconditionally would overwrite an existing
  // part belonging to another sheet, corrupting it silently.
  const highestIndex = (dir: string, prefix: string) => {
    let max = 0;
    for (const name of Object.keys(zip.files)) {
      const m = new RegExp(`^${dir}/${prefix}(\\d+)\\.xml$`).exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max;
  };

  let drawingSeq = highestIndex("xl/drawings", "drawing");
  let chartSeq = highestIndex("xl/charts", "chart");
  let axisSeq = 100_000_000;
  const overrides: string[] = [];

  for (const [sheetName, specs] of Array.from(bySheet.entries())) {
    const sheetPath = sheetPaths.get(sheetName)!;
    const sheetXml = await zip.file(sheetPath)?.async("string");
    if (!sheetXml) throw new Error(`injectCharts: ${sheetPath} is missing`);
    if (/<drawing\b/.test(sheetXml)) {
      throw new Error(
        `injectCharts: worksheet "${sheetName}" already has a drawing; merging drawings is not supported`,
      );
    }

    drawingSeq += 1;
    const drawingPath = `xl/drawings/drawing${drawingSeq}.xml`;
    const drawingRelsPath = `xl/drawings/_rels/drawing${drawingSeq}.xml.rels`;

    // Chart parts, one per spec, each related from the sheet's drawing.
    const chartRels: string[] = [];
    specs.forEach((spec, i) => {
      chartSeq += 1;
      const chartPath = `xl/charts/chart${chartSeq}.xml`;
      const catAxId = axisSeq++;
      const valAxId = axisSeq++;
      zip.file(chartPath, chartXml(spec, catAxId, valAxId));
      overrides.push(`<Override PartName="/${chartPath}" ContentType="${CT_CHART}"/>`);
      chartRels.push(
        `<Relationship Id="rId${i + 1}" Type="${REL_CHART}" Target="../charts/chart${chartSeq}.xml"/>`,
      );
    });

    zip.file(drawingPath, drawingXml(specs));
    zip.file(
      drawingRelsPath,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        chartRels.join("") +
        `</Relationships>`,
    );
    overrides.push(`<Override PartName="/${drawingPath}" ContentType="${CT_DRAWING}"/>`);

    // Relate the drawing from the worksheet, reusing its rels part if present.
    const sheetFile = sheetPath.split("/").pop()!;
    const sheetRelsPath = sheetPath.replace(sheetFile, `_rels/${sheetFile}.rels`);
    const existingRels = await zip.file(sheetRelsPath)?.async("string");

    // Pick an id the sheet's existing relationships do not already use —
    // a duplicate Id makes Excel reject the whole package.
    let drawingRelId = `rIdDrawing${drawingSeq}`;
    if (existingRels) {
      let suffix = 0;
      while (existingRels.includes(`Id="${drawingRelId}"`)) {
        suffix += 1;
        drawingRelId = `rIdDrawing${drawingSeq}_${suffix}`;
      }
    }
    const drawingRel = `<Relationship Id="${drawingRelId}" Type="${REL_DRAWING}" Target="../drawings/drawing${drawingSeq}.xml"/>`;

    if (existingRels) {
      zip.file(sheetRelsPath, existingRels.replace("</Relationships>", `${drawingRel}</Relationships>`));
    } else {
      zip.file(
        sheetRelsPath,
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          drawingRel +
          `</Relationships>`,
      );
    }

    // `<drawing>` sits near the end of CT_Worksheet's sequence — after
    // pageSetup and friends, before legacyDrawing. Nothing ExcelJS emits comes
    // after it in the schema, so appending at the end is valid.
    zip.file(sheetPath, sheetXml.replace("</worksheet>", `<drawing r:id="${drawingRelId}"/></worksheet>`));
  }

  contentTypes = contentTypes.replace("</Types>", `${overrides.join("")}</Types>`);
  zip.file("[Content_Types].xml", contentTypes);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
