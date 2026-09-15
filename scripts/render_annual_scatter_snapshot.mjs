import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(process.cwd());
const output = join(
  root,
  "attached_assets/generated_videos/annual-increase/all-campus-scatter.png",
);
const svgPath = output.replace(/\.png$/, ".svg");
const serviceLines = ["AL", "AL/MC", "HC", "HC/MC", "SL", "VIL"];
const colors = {
  AL: "#0f9f91",
  "AL/MC": "#2f5d8a",
  HC: "#d17b12",
  "HC/MC": "#237b9b",
  SL: "#22a447",
  VIL: "#58c9d5",
};

const params = new URLSearchParams({ serviceLines: serviceLines.join(",") });
const baseUrl = process.env.ANNUAL_SCATTER_BASE_URL ?? "http://127.0.0.1:5000";
const response = await fetch(
  `${baseUrl}/api/inhouse-planning/campus-plan-points?${params}`,
);
if (!response.ok) {
  throw new Error(`Campus scatter request failed: ${response.status} ${await response.text()}`);
}
const payload = await response.json();
const points = Array.isArray(payload.points) ? payload.points : [];
if (points.length === 0) throw new Error("Campus scatter request returned no points");

const esc = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");
const W = 1200;
const H = 500;
const panelTop = 136;
const panelHeight = 278;
const panelWidth = 520;
const gap = 74;
const left = 58;
const plotPad = { left: 52, right: 16, top: 30, bottom: 42 };

function domain(values, step, includeZero = false) {
  const finite = values.filter(Number.isFinite);
  let min = Math.floor(Math.min(...finite) / step) * step;
  let max = Math.ceil(Math.max(...finite) / step) * step;
  if (includeZero) min = Math.min(0, min);
  if (max <= min) max = min + step;
  return [min, max];
}

const [xMin, xMax] = domain(points.map((point) => Number(point.occupancy)), 5);

function chart(field, title, x) {
  const [yMin, yMax] = domain(points.map((point) => Number(point[field])), 2, true);
  const px = x + plotPad.left;
  const py = panelTop + plotPad.top;
  const pw = panelWidth - plotPad.left - plotPad.right;
  const ph = panelHeight - plotPad.top - plotPad.bottom;
  const sx = (value) => px + (value - xMin) / (xMax - xMin) * pw;
  const sy = (value) => py + ph - (value - yMin) / (yMax - yMin) * ph;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((step) => {
    const y = py + ph * (1 - step);
    const value = yMin + (yMax - yMin) * step;
    return `<line x1="${px}" y1="${y}" x2="${px + pw}" y2="${y}" stroke="#dce4e8" stroke-dasharray="3 4"/>
      <text x="${px - 8}" y="${y + 4}" text-anchor="end" class="tick">${value.toFixed(0)}%</text>`;
  }).join("");
  const dots = points.map((point) => {
    const occupancy = Number(point.occupancy);
    const increase = Number(point[field]);
    if (!Number.isFinite(occupancy) || !Number.isFinite(increase)) return "";
    return `<circle cx="${sx(occupancy).toFixed(2)}" cy="${sy(increase).toFixed(2)}" r="3.1"
      fill="${colors[point.serviceLine] ?? "#64748b"}" fill-opacity=".7"
      stroke="#ffffff" stroke-width=".55"><title>${esc(point.location)} · ${esc(point.serviceLine)}</title></circle>`;
  }).join("");
  return `<g>
    <text x="${x}" y="${panelTop - 14}" class="chart-title">${esc(title)}</text>
    <rect x="${x}" y="${panelTop}" width="${panelWidth}" height="${panelHeight}" rx="8" fill="#ffffff" stroke="#d2dce1"/>
    ${grid}
    <line x1="${px}" y1="${py}" x2="${px}" y2="${py + ph}" stroke="#7c8c94"/>
    <line x1="${px}" y1="${py + ph}" x2="${px + pw}" y2="${py + ph}" stroke="#7c8c94"/>
    <text x="${px}" y="${py + ph + 22}" class="tick">${xMin}%</text>
    <text x="${px + pw}" y="${py + ph + 22}" text-anchor="end" class="tick">${xMax}%</text>
    <text x="${px + pw / 2}" y="${py + ph + 37}" text-anchor="middle" class="axis">Occupancy</text>
    <text transform="translate(${x + 15} ${py + ph / 2}) rotate(-90)" text-anchor="middle" class="axis">Increase</text>
    ${dots}
  </g>`;
}

const counts = Object.fromEntries(serviceLines.map((line) => [
  line,
  points.filter((point) => point.serviceLine === line).length,
]));
const legend = serviceLines.map((line, index) => {
  const x = 58 + index * 125;
  return `<circle cx="${x}" cy="91" r="5" fill="${colors[line]}"/>
    <text x="${x + 10}" y="95" class="legend">${esc(line)} · ${counts[line]}</text>`;
}).join("");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>
    text { font-family: Arial, sans-serif; fill: #233945; }
    .title { font-size: 24px; font-weight: 700; }
    .subtitle { font-size: 13px; fill: #687b84; }
    .chart-title { font-size: 12px; font-weight: 700; letter-spacing: .6px; }
    .legend { font-size: 11px; font-weight: 700; }
    .tick { font-size: 9px; fill: #687b84; }
    .axis { font-size: 10px; fill: #687b84; }
    .foot { font-size: 11px; fill: #687b84; }
  </style>
  <rect width="${W}" height="${H}" fill="#f7f9fa"/>
  <text x="58" y="36" class="title">Pricing Position by Service Line</text>
  <text x="58" y="59" class="subtitle">Every dot is one campus/service-line calculation. Unknown occupancy readings are omitted.</text>
  ${legend}
  ${chart("inhouseIncrease", "IN-HOUSE RESIDENT RATE INCREASE", left)}
  ${chart("streetIncrease", "STREET RATE INCREASE", left + panelWidth + gap)}
  <text x="58" y="472" class="foot">${points.length} campus/service-line calculations shown from the saved planning results.</text>
</svg>`;

mkdirSync(dirname(output), { recursive: true });
writeFileSync(svgPath, svg);
execFileSync("ffmpeg", [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-i",
  svgPath,
  "-frames:v",
  "1",
  output,
]);
console.log(JSON.stringify({ output, points: points.length, counts }, null, 2));