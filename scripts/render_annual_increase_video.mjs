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
      ${text(120, 108, "MODULO  /  ANNUAL IN-HOUSE INCREASES", 16, teal, 700)}
      ${text(120, 245, "Set the guardrails.", 57, ink, 500)}
      ${text(120, 325, "See the tradeoffs.", 57, ink, 500)}
      ${text(120, 405, "Share the decision.", 57, gold, 500)}
      <rect x="120" y="492" width="1040" height="1" fill="${teal}" opacity=".35"/>
      ${text(120, 529, "PARAMETERS    •    OCCUPANCY TIERS    •    EXECUTIVE PDF", 16, muted, 500)}
      ${text(120, 660, "MODULO  /  REVENUE MANAGEMENT", 15, muted, 500)}`)
  },
  {
    name: "02-parameters", duration: 7.2,
    svg: svg(frame(`${header("01  /  DEFINE", "Set the plan parameters", "SCOPE  •  TARGETS  •  GUARDRAILS")}
      <rect x="80" y="70" width="1120" height="610" fill="${paper}"/>
      ${text(112, 108, "In-House Rate Planning", 22, dark, 700)}
      ${text(112, 133, "Annual planning assumptions", 12, "#667b85", 500)}
      ${box(112, 154, 1056, 72)}
      ${text(136, 180, "CAMPUS", 10, "#657981", 700)} ${text(136, 204, "All campuses", 15, dark, 600)}
      ${text(500, 180, "SERVICE LINES", 10, "#657981", 700)} ${text(500, 204, "AL  •  SL  •  HC", 15, dark, 600)}
      ${text(914, 180, "PLAN YEAR", 10, "#657981", 700)} ${text(914, 204, "2027", 15, dark, 600)}
      ${box(112, 244, 510, 384)} ${box(640, 244, 528, 384)}
      ${text(136, 278, "Growth and timing", 16, dark, 700)}
      ${[
        ["Annual rate-growth target", "6.0%"],
        ["Annual resident turnover", "32.0%"],
        ["In-house effective date", "Feb 1, 2027"],
        ["Street Rate effective date", "Mar 1, 2027"],
      ].map(([a,b],i)=>`${text(136,318+i*62,a,13,"#536a74",500)}${box(452,295+i*62,142,38,"#f4f7f8")}${text(574,320+i*62,b,14,dark,700,"end")}`).join("")}
      ${text(664, 278, "Rate guardrails", 16, dark, 700)}
      ${[
        ["Minimum in-house increase", "2.0%"],
        ["Maximum in-house increase", "8.0%"],
        ["Street Rate increase range", "2.0–10.0%"],
        ["Maximum Street Rate YoY", "15.0%"],
        ["Position vs Top Competitor", "−3.0%"],
        ["Equalization strength", "Medium"],
      ].map(([a,b],i)=>`${text(664,316+i*49,a,12,"#536a74",500)}${box(986,292+i*49,154,34,"#f4f7f8")}${text(1122,315+i*49,b,13,dark,700,"end")}`).join("")}
      ${text(664, 609, "Only these explicit inputs shape the recommendation.", 11, "#657981", 500)}
    `))
  },
  {
    name: "03-tiers", duration: 5.3,
    svg: svg(frame(`${header("02  /  SCENARIOS", "Plan for occupancy", "LOW  •  TARGET  •  HIGH")}
      <rect x="80" y="70" width="1120" height="610" fill="${paper}"/>
      ${text(112, 112, "Occupancy-tier plan", 22, dark, 700)}
      ${text(112, 138, "Every service line is solved under all three policies. The measured tier drives totals.", 12, "#667b85")}
      ${box(112, 164, 1056, 430)}
      <rect x="112" y="164" width="1056" height="52" rx="10" fill="${navy}"/>
      ${["Service line","Measured occupancy","Tier","In-house increase","Street Rate increase","Target status"].map((v,i)=>text([134,310,500,660,842,1040][i],196,v,11,"#d8e8ea",700,i>2?"middle":"start")).join("")}
      ${[
        ["AL","91.4%","TARGET","4.3%","5.0%","On target"],
        ["SL","94.2%","HIGH","5.1%","6.0%","On target"],
        ["HC","87.6%","LOW","3.0%","2.5%","On target"],
      ].map((r,i)=>`<rect x="112" y="${216+i*104}" width="1056" height="104" fill="${i===1?"#edf9f7":"#fff"}"/>
        ${text(134,254+i*104,r[0],15,dark,700)}${text(310,254+i*104,r[1],14,dark,600)}
        <rect x="484" y="${234+i*104}" width="106" height="30" rx="15" fill="${i===1?teal:"#e7eef0"}" opacity="${i===1?".28":"1"}"/>
        ${text(537,254+i*104,r[2],11,i===1?"#087f78":"#526b75",700,"middle")}
        ${text(660,254+i*104,r[3],16,dark,700,"middle")}${text(842,254+i*104,r[4],16,dark,700,"middle")}
        ${text(1040,254+i*104,"✓  "+r[5],13,"#0b8a68",700,"middle")}
        ${i===1?text(134,285+i*104,"MEASURED TIER — USED IN EXECUTIVE TOTALS",10,"#087f78",700):""}`).join("")}
      ${text(112, 625, "The full grid remains visible so leaders can see how occupancy changes pricing power.", 12, "#667b85")}
    `))
  },
  {
    name: "04-interpret", duration: 5.3,
    svg: svg(frame(`${header("03  /  INTERPRET", "Understand the result", "VARIANCE  •  TURNOVER  •  REVENUE")}
      <rect x="80" y="70" width="1120" height="610" fill="${paper}"/>
      ${text(112, 110, "Why the quarterly result differs from the target", 21, dark, 700)}
      ${text(112, 136, "The bridge separates embedded growth from the actions being planned now.", 12, "#667b85")}
      ${[
        ["Prior-year realized rate","$4,512","The matched-quarter baseline"],
        ["Growth already embedded","+2.1%","Earlier pricing and resident mix"],
        ["Current Street variance","−7.4%","In-house remains below Street"],
        ["Turnover into new Street Rates","+1.2%","32% annual turnover replaces residents"],
      ].map((r,i)=>`${box(112+i%2*528,164+Math.floor(i/2)*112,510,92,i===3?"#edf9f7":"#fff")}
      ${text(134+i%2*528,192+Math.floor(i/2)*112,r[0],11,"#667b85",700)}
      ${text(134+i%2*528,226+Math.floor(i/2)*112,r[1],24,i===3?"#087f78":dark,700)}
      ${text(250+i%2*528,225+Math.floor(i/2)*112,r[2],11,"#667b85",500)}`).join("")}
      ${box(112, 408, 1056, 184)}
      ${text(136, 441, "Projected quarterly YoY growth", 14, dark, 700)}
      ${["Q1  6.0%","Q2  6.2%","Q3  6.4%","Q4  6.3%"].map((r,i)=>`${box(136+i*244,466,220,76,i===0?"#fff8e8":"#f4f8f8")}
        ${text(246+i*244,499,r,18,i===0?"#946c16":"#087f78",700,"middle")}
        ${text(246+i*244,524,i===0?"Binding quarter":"Meets target",10,"#667b85",600,"middle")}`).join("")}
      ${text(136, 574, "Interpretation: current pricing, new increases, and turnover reconcile to the same forecast.", 11, "#536a74", 600)}
    `))
  },
  {
    name: "05-report", duration: 6.0,
    svg: svg(frame(`${header("04  /  SHARE", "Open the executive report", "IN APP  •  PRINT  •  ONE-PAGE PDF")}
      <rect x="80" y="70" width="1120" height="610" fill="#dce5e7"/>
      <rect x="176" y="88" width="928" height="572" rx="3" fill="white" stroke="#c6d2d5"/>
      ${text(204, 122, "Annual In-House Increase Plan", 21, dark, 700)}
      ${text(204, 143, "All campuses  •  AL · SL · HC  •  Plan year 2027  •  Effective Feb 1", 9, "#667b85")}
      ${[
        ["AVG INCREASE","4.4%"],["CURRENT-YEAR IMPACT","+$1.84M"],["ANNUALIZED IMPACT","+$2.21M"],["CURRENT OCCUPANCY","91.2%"]
      ].map((r,i)=>`${box(204+i*218,164,202,66,"#f6f9f9")}${text(218+i*218,186,r[0],8,"#667b85",700)}${text(218+i*218,216,r[1],18,i===0?"#087f78":dark,700)}`).join("")}
      ${box(204, 246, 568, 202)}
      ${text(224, 270, "Street Rate vs In-House Rate", 11, dark, 700)}
      <line x1="236" y1="420" x2="744" y2="420" stroke="#cbd7da"/><line x1="236" y1="296" x2="236" y2="420" stroke="#cbd7da"/>
      <polyline points="236,392 332,378 428,359 524,338 620,314 744,288" fill="none" stroke="${teal}" stroke-width="3"/>
      <polyline points="236,408 332,398 428,386 524,365 620,350 744,330" fill="none" stroke="${gold}" stroke-width="3" stroke-dasharray="8 5"/>
      <line x1="524" y1="290" x2="524" y2="420" stroke="#6f838b" stroke-dasharray="3 4"/>
      ${text(532,306,"ANNUAL INCREASE",8,"#667b85",700)}
      ${text(600,438,"Solid Street  —  Dashed in-house",8,"#667b85",600)}
      ${box(790, 246, 286, 202)}
      ${text(810, 270, "Executive interpretation", 11, dark, 700)}
      ${text(810, 300, "• Measured tiers drive totals", 10, "#536a74")}
      ${text(810, 325, "• Variance remains intentional", 10, "#536a74")}
      ${text(810, 350, "• Turnover supports later quarters", 10, "#536a74")}
      ${text(810, 375, "• Every forecast reconciles", 10, "#536a74")}
      ${text(810, 413, "Status: CALCULATED", 10, "#087f78", 700)}
      ${box(204, 466, 872, 148)}
      ${text(224, 491, "Service line summary", 11, dark, 700)}
      ${["AL     4.3%     +$812K     −3.1% vs Street","SL     5.1%     +$944K     −2.6% vs Street","HC     3.0%     +$454K     −4.2% vs Street"].map((r,i)=>text(224,522+i*27,r,10,"#536a74",i===1?700:500)).join("")}
      <rect x="868" y="574" width="184" height="24" rx="12" fill="${navy}"/>${text(960,591,"DOWNLOAD PDF",9,"white",700,"middle")}
    `))
  },
  {
    name: "06-close", duration: 4.0,
    svg: svg(`<rect width="${W}" height="${H}" fill="${bg}"/>
      <rect x="120" y="130" width="1040" height="2" fill="${teal}" opacity=".75"/>
      ${text(120, 194, "ANNUAL INCREASE PLANNING", 17, teal, 700)}
      ${text(120, 278, "Explicit inputs.", 52, ink, 500)}
      ${text(120, 348, "Traceable recommendations.", 52, ink, 500)}
      ${text(120, 418, "Executive-ready decisions.", 52, gold, 500)}
      ${text(120, 485, "One calculation. Every interpretation. One-page PDF.", 18, muted, 500)}
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

const narration = join(root, "attached_assets/generated_audio/annual-increase-process-narration.mp3");
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