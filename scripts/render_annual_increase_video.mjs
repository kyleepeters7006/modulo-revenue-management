import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "attached_assets/generated_videos/annual-increase");
const tmp = join(out, "tmp");
mkdirSync(tmp, { recursive: true });

const W = 1280, H = 720;
const bg = "#071722", ink = "#f5f7f6", muted = "#9aadb2", teal = "#43d0c0", gold = "#e9bd65";
const navy = "#123044", line = "#dbe4e7", paper = "#f7f9f9", dark = "#183446";
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const text = (x, y, value, size = 16, color = dark, weight = 400, anchor = "start") =>
  `<text x="${x}" y="${y}" font-family="DejaVu Sans,Arial" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(value)}</text>`;
const box = (x, y, w, h, fill = "#fff", stroke = line, r = 10) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const header = (chapter, title, body) => `
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect x="80" y="58" width="1120" height="2" fill="${teal}" opacity=".7"/>
  ${text(80, 34, chapter, 14, teal, 700)}
  ${text(270, 38, title, 25, ink, 500)}
  ${text(1198, 35, body, 12, muted, 500, "end")}`;
const frame = (body) => `<rect width="${W}" height="${H}" fill="${bg}"/>
  <g transform="translate(128 72) scale(.8)">${body}</g>
  <rect x="128" y="72" width="1024" height="576" rx="4" fill="none" stroke="#ffffff" opacity=".7"/>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;

const scenes = [
  {
    name: "01-title", duration: 3.0,
    svg: svg(`<rect width="${W}" height="${H}" fill="${bg}"/>
      <rect x="120" y="138" width="72" height="3" fill="${teal}"/>
      ${text(120, 108, "MODULO  /  ADVANCED ANNUAL INCREASE METHODOLOGY", 16, teal, 700)}
      ${text(120, 245, "Predict turnover.", 57, ink, 500)}
      ${text(120, 325, "Blend the rates.", 57, ink, 500)}
      ${text(120, 405, "Hit the target.", 57, gold, 500)}
      <rect x="120" y="492" width="1040" height="1" fill="${teal}" opacity=".35"/>
      ${text(120, 529, "LOS ESTIMATES    •    RATE BLEND    •    REVENUE GROWTH", 16, muted, 500)}
      ${text(120, 660, "MODULO  /  REVENUE MANAGEMENT", 15, muted, 500)}`)
  },
  {
    name: "02-los-turnover", duration: 5.5,
    svg: svg(frame(`${header("01  /  PREDICT", "Estimate turnover from length of stay", "LOS  •  SERVICE LINE  •  TIMING")}
      <rect x="80" y="70" width="1120" height="610" fill="${paper}"/>
      ${text(112, 112, "Length of stay becomes a turnover forecast", 23, dark, 700)}
      ${text(112, 140, "Resident tenure curves estimate when each service line will reset to a new Street Rate.", 12, "#667b85")}
      ${box(112, 174, 680, 390)}
      ${text(138, 207, "EXPECTED RESIDENT RETENTION", 11, "#667b85", 700)}
      <line x1="158" y1="500" x2="756" y2="500" stroke="#9dafb6"/><line x1="158" y1="244" x2="158" y2="500" stroke="#9dafb6"/>
      <path d="M158 260 C270 276 350 315 432 357 S620 449 756 476" fill="none" stroke="${teal}" stroke-width="5"/>
      <path d="M158 275 C290 300 390 350 476 405 S655 474 756 490" fill="none" stroke="${gold}" stroke-width="4"/>
      ${text(713, 458, "AL", 12, "#087f78", 700)} ${text(713, 506, "HC", 12, "#946c16", 700)}
      ${text(158, 526, "MOVE-IN", 10, "#667b85", 700)} ${text(452, 526, "LENGTH OF STAY", 10, "#667b85", 700, "middle")} ${text(756, 526, "LATER", 10, "#667b85", 700, "end")}
      ${box(822, 174, 346, 390)}
      ${text(850, 208, "Predicted annual turnover", 15, dark, 700)}
      ${[["AL","28%","#2F6B95"],["SL","24%","#B06D32"],["HC","41%","#388194"]].map((r,i)=>`
        ${text(850,266+i*88,r[0],13,dark,700)}
        <rect x="904" y="${246+i*88}" width="214" height="22" rx="11" fill="#e3e9eb"/>
        <rect x="904" y="${246+i*88}" width="${Number(r[1].slice(0,-1))*4.7}" height="22" rx="11" fill="${r[2]}"/>
        ${text(1132,264+i*88,r[1],15,dark,700,"end")}`).join("")}
      ${text(850, 508, "Timing, not a flat assumption.", 12, "#087f78", 700)}
      ${text(850, 532, "Forecast by service line.", 12, "#667b85", 500)}
    `))
  },
  {
    name: "03-blend", duration: 5.5,
    svg: svg(frame(`${header("02  /  BLEND", "Combine Street and in-house rate growth", "TURNOVER  •  RETAINED  •  WEIGHTED")}
      <rect x="80" y="70" width="1120" height="610" fill="${paper}"/>
      ${text(112, 112, "One quarterly rate path, built from two resident groups", 23, dark, 700)}
      ${text(112, 140, "The mix changes as predicted turnover moves residents from in-house rates to current Street Rates.", 12, "#667b85")}
      ${box(112, 180, 450, 330, "#fff")}
      ${text(140, 216, "RETAINED RESIDENTS", 11, "#667b85", 700)}
      ${text(140, 267, "72%", 48, dark, 700)}
      ${text(260, 256, "Planned in-house increase", 13, "#536a74", 600)}
      ${text(260, 284, "+4.4%", 25, "#375F3D", 700)}
      <rect x="140" y="324" width="376" height="24" rx="12" fill="#e4eaec"/><rect x="140" y="324" width="271" height="24" rx="12" fill="#44546A"/>
      ${text(140, 390, "Existing residents remain on the", 12, "#667b85")} ${text(140, 413, "planned annual increase path.", 12, "#667b85")}
      ${box(606, 180, 450, 330, "#fff")}
      ${text(634, 216, "PREDICTED TURNOVER", 11, "#667b85", 700)}
      ${text(634, 267, "28%", 48, "#087f78", 700)}
      ${text(754, 256, "New Street Rate growth", 13, "#536a74", 600)}
      ${text(754, 284, "+7.0%", 25, "#087f78", 700)}
      <rect x="634" y="324" width="376" height="24" rx="12" fill="#e4eaec"/><rect x="634" y="324" width="105" height="24" rx="12" fill="${teal}"/>
      ${text(634, 390, "Move-ins reset to the latest", 12, "#667b85")} ${text(634, 413, "revenue-accretive Street Rate.", 12, "#667b85")}
      ${box(350, 538, 470, 76, "#edf9f7", "#90c9c1")}
      ${text(585, 568, "WEIGHTED BLEND", 10, "#087f78", 700, "middle")}
      ${text(585, 596, "5.1% effective rate growth", 21, dark, 700, "middle")}
    `))
  },
  {
    name: "04-target", duration: 5.5,
    svg: svg(frame(`${header("03  /  SOLVE", "Reconcile rate and revenue to the target", "QUARTERS  •  RATE  •  REVENUE")}
      <rect x="80" y="70" width="1120" height="610" fill="${paper}"/>
      ${text(112, 112, "The solver works backward from the growth target", 23, dark, 700)}
      ${text(112, 140, "It coordinates both pricing levers until every quarter clears the required trajectory.", 12, "#667b85")}
      ${box(112, 174, 1056, 378)}
      <line x1="164" y1="480" x2="1116" y2="480" stroke="#9dafb6"/><line x1="164" y1="230" x2="164" y2="480" stroke="#9dafb6"/>
      <line x1="164" y1="330" x2="1116" y2="330" stroke="${gold}" stroke-width="2" stroke-dasharray="9 7"/>
      ${text(1108, 320, "6.0% TARGET", 11, "#946c16", 700, "end")}
      <polyline points="164,432 390,372 616,323 842,286 1116,260" fill="none" stroke="${teal}" stroke-width="5"/>
      <polyline points="164,447 390,393 616,340 842,300 1116,274" fill="none" stroke="#44546A" stroke-width="4"/>
      ${["Q1","Q2","Q3","Q4","YEAR END"].map((q,i)=>text([164,390,616,842,1116][i],510,q,11,"#667b85",700,i===4?"end":"middle")).join("")}
      ${text(850, 252, "RATE GROWTH", 11, "#087f78", 700)}
      ${text(850, 296, "REVENUE GROWTH", 11, dark, 700)}
      ${box(330, 578, 620, 60, "#edf9f7", "#90c9c1")}
      ${text(640, 615, "ALL ELSE EQUAL, THE PLAN HITS THE TARGET.", 16, "#087f78", 700, "middle")}
    `))
  },
  {
    name: "05-new-year", duration: 5.5,
    svg: svg(frame(`${header("04  /  TRANSITION", "The new year activates the plan", "BASELINE  •  EXECUTE  •  LEARN")}
      <rect x="80" y="70" width="1120" height="610" fill="${paper}"/>
      ${text(112, 112, "The annual plan sets the opening position", 23, dark, 700)}
      ${text(112, 140, "Then live occupancy, demand, competitive position, and move-ins take over.", 12, "#667b85")}
      <line x1="150" y1="350" x2="1110" y2="350" stroke="#b8c5ca" stroke-width="4"/>
      <circle cx="260" cy="350" r="54" fill="#44546A"/>${text(260,342,"ANNUAL",12,"white",700,"middle")}${text(260,365,"PLAN",18,"white",700,"middle")}
      <circle cx="560" cy="350" r="54" fill="${teal}"/>${text(560,342,"JAN 1",12,dark,700,"middle")}${text(560,365,"GO LIVE",16,dark,700,"middle")}
      <circle cx="880" cy="350" r="54" fill="${gold}"/>${text(880,342,"DYNAMIC",12,dark,700,"middle")}${text(880,365,"PRICING",16,dark,700,"middle")}
      <path d="M314 350 L506 350" stroke="${teal}" stroke-width="5"/><polygon points="506,350 488,340 488,360" fill="${teal}"/>
      <path d="M614 350 L826 350" stroke="${gold}" stroke-width="5"/><polygon points="826,350 808,340 808,360" fill="${gold}"/>
      ${text(260, 453, "Target-aligned baseline", 13, "#536a74", 700, "middle")}
      ${text(560, 453, "New rates take effect", 13, "#536a74", 700, "middle")}
      ${text(880, 453, "Signals update every move", 13, "#536a74", 700, "middle")}
      ${box(316, 536, 548, 72, "#edf9f7", "#90c9c1")}
      ${text(590, 580, "FROM PLAN TO CONTINUOUS EXECUTION", 16, "#087f78", 700, "middle")}
    `))
  },
  {
    name: "06-close", duration: 5.0,
    svg: svg(`<rect width="${W}" height="${H}" fill="${bg}"/>
      <rect x="120" y="130" width="1040" height="2" fill="${teal}" opacity=".75"/>
      ${text(120, 194, "DYNAMIC PRICING  /  REVENUE MANAGEMENT", 17, teal, 700)}
      ${text(120, 278, "Read every signal.", 52, ink, 500)}
      ${text(120, 348, "Price every move.", 52, ink, 500)}
      ${text(120, 418, "Grow revenue with intent.", 52, gold, 500)}
      ${text(120, 485, "Always betting the next decision will be revenue accretive.", 18, muted, 500)}
      ${text(120, 660, "MODULO  /  REVENUE MANAGEMENT", 15, muted, 500)}`)
  },
];

for (const scene of scenes) {
  const svgPath = join(tmp, `${scene.name}.svg`);
  const pngPath = join(tmp, `${scene.name}.png`);
  const mp4Path = join(tmp, `${scene.name}.mp4`);
  writeFileSync(svgPath, scene.svg);
  execFileSync("ffmpeg", ["-hide_banner","-loglevel","error","-y","-i",svgPath,"-frames:v","1",pngPath]);
  execFileSync("ffmpeg", [
    "-hide_banner","-loglevel","error","-y","-loop","1","-i",pngPath,
    "-vf",`fade=t=in:st=0:d=0.3,fade=t=out:st=${scene.duration - 0.45}:d=0.45,format=yuv420p`,
    "-t",String(scene.duration),"-r","30","-c:v","libx264","-preset","veryfast","-crf","18",mp4Path,
  ]);
}

const concat = scenes.map((s) => `file '${s.name}.mp4'`).join("\n");
writeFileSync(join(tmp, "concat.txt"), concat);
execFileSync("ffmpeg", [
  "-hide_banner","-loglevel","error","-y","-f","concat","-safe","0","-i",join(tmp,"concat.txt"),
  "-c","copy",join(tmp,"visual.mp4"),
]);

const narration = join(root, "attached_assets/generated_audio/annual-increase-process-narration-advanced.mp3");
const music = join(root, "attached_assets/generated_audio/dynamic-pricing-demo-music.mp3");
const final = join(out, "modulo-annual-increase-process.mp4");
execFileSync("ffmpeg", [
  "-hide_banner","-loglevel","error","-y",
  "-i",join(tmp,"visual.mp4"),"-i",narration,"-stream_loop","-1","-i",music,
  "-filter_complex",
  "[1:a]aresample=48000,atempo=1.12,volume=.98,adelay=500|500[vo];[2:a]aresample=48000,volume=.09,afade=t=out:st=28:d=2[music];[vo][music]amix=inputs=2:duration=first:normalize=0,apad,alimiter=limit=.95[a]",
  "-map","0:v","-map","[a]","-t","30","-c:v","copy","-c:a","aac","-b:a","192k","-ar","48000","-movflags","+faststart",final,
]);

const poster = join(out, "modulo-annual-increase-process-poster.jpg");
execFileSync("ffmpeg", [
  "-hide_banner","-loglevel","error","-y","-ss","22.8","-i",final,"-frames:v","1","-q:v","2",poster,
]);
copyFileSync(final, join(root, "client/public/media/modulo-annual-increase-process.mp4"));
copyFileSync(poster, join(root, "client/public/media/modulo-annual-increase-process-poster.jpg"));
console.log(final);