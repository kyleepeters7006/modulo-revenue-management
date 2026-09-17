import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = resolve(process.cwd());
const outDir = join(root, "attached_assets/generated_videos/annual-increase");
const tmpDir = join(outDir, "actual-software");
const finalVideo = join(outDir, "modulo-annual-increase-process.mp4");
const oldVideo = join(outDir, "modulo-annual-increase-process.previous.mp4");
const narration = join(
  root,
  "attached_assets/generated_audio/annual-increase-process-aligned.mp3",
);
const music = join(root, "attached_assets/generated_audio/dynamic-pricing-demo-music.mp3");
const cursor = join(root, "attached_assets/generated_videos/mouse-cursor.png");
const screen = { x: 62, y: 158, w: 1164, h: 492 };

mkdirSync(tmpDir, { recursive: true });

function run(args) {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit",
  });
}

function mimeFor(file) {
  return extname(file).toLowerCase() === ".jpg" ? "image/jpeg" : "image/png";
}

function dataUri(relativePath) {
  const file = join(root, relativePath);
  return `data:${mimeFor(file)};base64,${readFileSync(file).toString("base64")}`;
}

function esc(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function imageDimensions(relativePath) {
  const file = join(root, relativePath);
  if (extname(relativePath).toLowerCase() === ".png") {
    const bytes = readFileSync(file);
    if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString("ascii", 1, 4) !== "PNG") {
      throw new Error(`Expected a PNG image: ${relativePath}`);
    }
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  const dimensions = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      file,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("x")
    .map(Number);
  if (dimensions.length !== 2 || dimensions.some((value) => !Number.isFinite(value))) {
    throw new Error(`Could not read image dimensions: ${relativePath}`);
  }
  return { width: dimensions[0], height: dimensions[1] };
}

function displayedImageRect(relativePath) {
  const { width, height } = imageDimensions(relativePath);
  const scale = Math.min(screen.w / width, screen.h / height);
  const w = width * scale;
  const h = height * scale;
  return {
    x: screen.x + (screen.w - w) / 2,
    y: screen.y + (screen.h - h) / 2,
    w,
    h,
  };
}

function imageFrame({ kicker, title, subtitle, images, index }) {
  const placements =
    images.length === 1
      ? [{ x: 54, y: 150, w: 1172, h: 500 }]
      : [
          { x: 54, y: 150, w: 1172, h: 235 },
          { x: 54, y: 405, w: 1172, h: 245 },
        ];

  const imageTags = images
    .map((src, imageIndex) => {
      const box = placements[imageIndex];
      return `
        <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="14"
          fill="#ffffff" stroke="#284753" stroke-width="2"/>
        <image href="${dataUri(src)}" x="${box.x + 8}" y="${box.y + 8}"
          width="${box.w - 16}" height="${box.h - 16}" preserveAspectRatio="xMidYMid meet"/>
`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#061822"/>
        <stop offset="100%" stop-color="#0c2a34"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity=".36"/>
      </filter>
    </defs>
    <rect width="1280" height="720" fill="url(#bg)"/>
    <circle cx="1180" cy="42" r="190" fill="#1dd3c7" opacity=".08"/>
    <text x="56" y="40" fill="#35d3c8" font-family="Arial, sans-serif"
      font-size="17" font-weight="700" letter-spacing="2">${esc(kicker)}</text>
    <text x="56" y="84" fill="#ffffff" font-family="Arial, sans-serif"
      font-size="34" font-weight="700">${esc(title)}</text>
    <text x="56" y="119" fill="#b9cbd1" font-family="Arial, sans-serif"
      font-size="18">${esc(subtitle)}</text>
    <g filter="url(#shadow)">${imageTags}</g>
    <image href="${dataUri("attached_assets/generated_videos/annual-increase/modulo-mark.png")}"
      x="1148" y="662" width="78" height="38" preserveAspectRatio="xMidYMid meet"/>
    <text x="56" y="692" fill="#7e959d" font-family="Arial, sans-serif"
      font-size="13">ACTUAL SOFTWARE</text>
  </svg>`;
}

const scenes = [
  {
    duration: 7.75,
    kicker: "01  SET THE INPUTS",
    title: "Set the Planning Assumptions",
    subtitle: "Choose scope, growth targets, turnover, and occupancy guardrails.",
    images: ["screenshots/inhouse-proposal-workflow.jpg"],
    cursor: { from: [0.12, 0.7], to: [0.72, 0.18] },
  },
  {
    duration: 4.5,
    kicker: "02  FOLLOW THE RATE PATH",
    title: "See Monthly Growth by Service Line",
    subtitle: "Projected realized rates move toward the Street Rate across each service line.",
    images: ["attached_assets/image_1789610918292.png"],
    cursor: { from: [0.1, 0.72], to: [0.76, 0.25] },
  },
  {
    duration: 3.25,
    kicker: "03  SET THE INCREASE TIERS",
    title: "Review Resident In-House Increases",
    subtitle: "See how many residents receive each recommended increase tier.",
    images: ["attached_assets/image_1789601966016.png"],
    cursor: { from: [0.82, 0.72], to: [0.28, 0.2] },
  },
  {
    duration: 5.1,
    kicker: "04  CHECK THE PORTFOLIO",
    title: "Inspect the Detailed Recommendations",
    subtitle: "Move from each tier to the resident rows behind the recommendation.",
    images: ["attached_assets/image_1789601910398.png"],
    cursor: { from: [0.8, 0.22], to: [0.56, 0.72] },
  },
  {
    duration: 3.4,
    kicker: "05  REVIEW THE REPORT",
    title: "Compare the Saved Rate Plan",
    subtitle: "Compare plan increase, prior period, and Total YoY before approval.",
    images: ["attached_assets/image_1789600788394.png"],
    cursor: { from: [0.14, 0.72], to: [0.72, 0.22] },
  },
  {
    duration: 6,
    kicker: "06  CREATE THE OPERATING RECORD",
    title: "Generate the Annual In-House Rate Plan",
    subtitle: "Save the combined recommendation and tier scenarios for approval.",
    images: ["attached_assets/image_1789603743352.png"],
    cursor: { from: [0.84, 0.72], to: [0.32, 0.2] },
  },
];

const clips = [];
for (let i = 0; i < scenes.length; i++) {
  const scene = scenes[i];
  const svg = join(tmpDir, `scene-${i + 1}.svg`);
  const png = join(tmpDir, `scene-${i + 1}.png`);
  const clip = join(tmpDir, `scene-${i + 1}.mp4`);
  writeFileSync(svg, imageFrame({ ...scene, index: i + 1 }));
  run(["-i", svg, "-frames:v", "1", png]);
  const cursorPath = scene.cursor ?? { from: [0.15, 0.7], to: [0.75, 0.2] };
  const imageRect = displayedImageRect(scene.images[0]);
  const progress = `min(t/${scene.duration},1)`;
  const cursorX = `${imageRect.x}+${imageRect.w}*(${cursorPath.from[0]}+(${cursorPath.to[0]}-${cursorPath.from[0]})*${progress})`;
  const cursorY = `${imageRect.y}+${imageRect.h}*(${cursorPath.from[1]}+(${cursorPath.to[1]}-${cursorPath.from[1]})*${progress})`;
  const showCursor = (i + 1) % 3 === 0;
  const cursorInputs = showCursor ? ["-loop", "1", "-i", cursor] : [];
  const cursorFilter = showCursor
    ? `;[1:v]format=rgba,scale=42:-1[mouse];[base][mouse]overlay=x='${cursorX}':y='${cursorY}':format=auto,format=yuv420p[v]`
    : `;[base]format=yuv420p[v]`;
  run([
    "-loop",
    "1",
    "-i",
    png,
    ...cursorInputs,
    "-filter_complex",
    `[0:v]format=rgba[base]${cursorFilter}`,
    "-map",
    "[v]",
    "-t",
    String(scene.duration),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    clip,
  ]);
  clips.push(clip);
}

const concatFile = join(tmpDir, "concat.txt");
writeFileSync(
  concatFile,
  clips.map((clip) => `file '${clip.replaceAll("'", "'\\''")}'`).join("\n"),
);
const visual = join(tmpDir, "visual.mp4");
run(["-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", visual]);

if (readFileSync(finalVideo).length > 0) {
  writeFileSync(oldVideo, readFileSync(finalVideo));
}

run([
  "-i",
  visual,
  "-i",
  narration,
  "-stream_loop",
  "-1",
  "-i",
  music,
  "-filter_complex",
  "[1:a]aresample=48000,atempo=1.0,volume=1.0,adelay=250|250[voice];[2:a]aresample=48000,volume=0.07,afade=t=out:st=28:d=2[music];[voice][music]amix=inputs=2:duration=first:normalize=0,apad,alimiter=limit=0.95[a]",
  "-map",
  "0:v:0",
  "-map",
  "[a]",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-t",
  "30",
  "-movflags",
  "+faststart",
  finalVideo,
]);

run([
  "-ss",
  "15",
  "-i",
  finalVideo,
  "-frames:v",
  "1",
  "-q:v",
  "2",
  join(outDir, "modulo-annual-increase-process-poster.jpg"),
]);

copyFileSync(finalVideo, join(root, "client/public/media/modulo-annual-increase-process.mp4"));
copyFileSync(
  join(outDir, "modulo-annual-increase-process-poster.jpg"),
  join(root, "client/public/media/modulo-annual-increase-process-poster.jpg"),
);

console.log(finalVideo);