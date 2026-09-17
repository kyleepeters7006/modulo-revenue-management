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
  "attached_assets/generated_audio/annual-increase-process-components.mp3",
);
const music = join(root, "attached_assets/generated_audio/dynamic-pricing-demo-music.mp3");

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
    duration: 3.75,
    kicker: "01  TRACE THE RATE INCREASE",
    title: "See Every Rate Component",
    subtitle: "Review YoY and prior-period components in the saved annual plan.",
    images: ["attached_assets/image_1789601040698.png"],
  },
  {
    duration: 4,
    kicker: "02  FOLLOW THE RATE PATH",
    title: "See Monthly Growth by Service Line",
    subtitle: "Projected realized rates move toward the Street Rate across each service line.",
    images: ["attached_assets/image_1789610918292.png"],
  },
  {
    duration: 5,
    kicker: "03  SET THE INCREASE TIERS",
    title: "Review Resident In-House Increases",
    subtitle: "Each service line shows how many residents receive each recommended increase tier.",
    images: ["attached_assets/image_1789611311839.png"],
  },
  {
    duration: 6.75,
    kicker: "04  CHECK THE PORTFOLIO",
    title: "Review Every Service Line",
    subtitle: "The plan keeps each recommendation visible by care level and resident population.",
    images: ["attached_assets/image_1789603743352.png"],
  },
  {
    duration: 5.25,
    kicker: "05  REVIEW THE REPORT",
    title: "Compare the Saved Rate Plan",
    subtitle: "Review the calculated plan before publishing the new annual rate path.",
    images: ["attached_assets/image_1789601040698.png"],
  },
  {
    duration: 5.25,
    kicker: "06  CREATE THE OPERATING RECORD",
    title: "Generate the Annual In-House Rate Plan",
    subtitle: "Save the combined recommendation and tier scenarios for approval.",
    images: ["attached_assets/image_1789601040698.png"],
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
  run([
    "-loop",
    "1",
    "-i",
    png,
    "-vf",
    `scale=1280:720:flags=lanczos,fade=t=in:st=0:d=0.12,fade=t=out:st=${scene.duration - 0.12}:d=0.12,format=yuv420p`,
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