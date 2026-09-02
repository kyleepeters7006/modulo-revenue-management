#!/usr/bin/env node
/**
 * Builds the 30-second dynamic pricing film.
 *
 * Design: real product screens presented inside a single browser window that
 * never moves. The page content dissolves from screen to screen, a spotlight
 * directs attention, and lower-third typography is cut to the narration.
 *
 * Every scene boundary is placed inside a pause in the voice track, so the
 * edit breathes with the narration instead of fighting it.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "attached_assets/generated_videos/reconcept");
const WORK = path.join(OUT_DIR, "build");
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const run = (bin, args) => {
  try {
    return execFileSync(bin, args, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    console.error(`\n${bin} failed:\n`, e.stderr?.toString?.().slice(-4000) || e.message);
    throw e;
  }
};
const magick = (args) => run("magick", args.map(String));
const ffmpeg = (args) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args.map(String)]);
const w = (f) => path.join(WORK, f);

/* ---------------------------------------------------------------- design */
// 31.0s, not 30: the closing line needs ~1.2s of hold after the last word for
// the end card to land. At 30.0s the film cut 0.12s after the narration.
const W = 1280, H = 720, FPS = 30, DUR = 31.0;

// The browser window. Fixed for the whole film.
// Height is kept even so the page track can be h.264 encoded.
const CARD = { x: 56, y: 32, w: 1168, h: 656, r: 14 };

const INK = "#F3F7F8";
const MUTED = "#93A7B0";
const TEAL = "#2DD4BF";
const GOLD = "#E8BE73";
const DEEP = "#050B12";

const FONT_KICKER = path.join(ROOT, "assets/fonts/Inter-SemiBold.ttf");
const FONT_BODY = path.join(ROOT, "assets/fonts/Inter-Medium.ttf");
const FONT_SERIF = path.join(ROOT, "assets/fonts/PlayfairDisplay.ttf");

// Body of the original read, with the closing sentence replaced: the original
// closer rose ~30Hz on its final syllable, so it sounded unfinished.
const NARRATION = path.join(ROOT, "attached_assets/generated_audio/dynamic-pricing-demo-narration-resolved.mp3");
const MUSIC = path.join(ROOT, "attached_assets/generated_audio/dynamic-pricing-demo-music.mp3");
const CURSOR_SRC = path.join(ROOT, "attached_assets/generated_videos/mouse-cursor.png");

const FULL = { cx: 0, cy: 0, cw: 1280, ch: 720 };

/**
 * Scenes are timed to the transcribed narration. Each boundary falls in a
 * silence, so the picture never cuts across a spoken word:
 *   0.00-4.87  one connected view of occupancy, rates, and demand
 *   5.34-8.04  compare each community against nearby competitors
 *   8.57-12.84 use the competitive chart to shape strategy
 *  13.31-19.02 build a targeted rule, preview impact, implement
 *  19.66-26.79 recommendations flow into reference data and the rate card
 *  27.33-29.88 smarter pricing, faster decisions
 */
const SCENES = [
  {
    img: "screenshots/belmont-analytics.jpg",
    start: 0.0, end: 5.05,
    crop: FULL,
    kicker: "01 — SIGNAL",
    headline: "One connected view",
    focus: [
      { rect: { x: 22, y: 240, w: 1234, h: 152 }, pill: "OCCUPANCY · RATES · DEMAND", pillAlign: "right", in: 1.1, out: 4.75 },
    ],
  },
  {
    img: "screenshots/belmont-competitors.jpg",
    start: 5.05, end: 8.45,
    crop: FULL,
    kicker: "02 — MARKET",
    headline: "Every community in context",
    focus: [
      { rect: { x: 27, y: 295, w: 1222, h: 136 }, pill: "NEARBY COMPETITORS", pillAlign: "right", in: 5.9, out: 8.15 },
    ],
  },
  {
    // Pushed in so the chart reads as a closer look rather than a repeat.
    img: "screenshots/belmont-analytics.jpg",
    start: 8.45, end: 13.1,
    // Shown full-frame: any push-in would slice through page text at the edges.
    crop: FULL,
    kicker: "03 — STRATEGY",
    headline: "Shaped by service line",
    focus: [
      // No pill here — nothing sits above this band that a label would not cover.
      { rect: { x: 22, y: 408, w: 1234, h: 62 }, in: 9.3, out: 12.8 },
    ],
  },
  {
    img: "screenshots/belmont-pricing-controls.jpg",
    start: 13.1, end: 19.35,
    crop: FULL,
    kicker: "04 — DECISION",
    headline: "Build a targeted rule",
    focus: [
      { rect: { x: 30, y: 330, w: 1220, h: 150 }, pill: "TARGETED SCOPE", pillAlign: "right", in: 13.9, out: 15.85 },
      { rect: { x: 884, y: 157, w: 208, h: 46 }, pill: "IMPLEMENT", in: 16.35, out: 19.05, at: [0.5, 0.5], click: 17.5 },
    ],
  },
  {
    img: "screenshots/belmont-rate-card.jpg",
    start: 19.35, end: DUR,
    crop: FULL,
    kicker: "05 — EXECUTION",
    headline: "A clear path to action",
    focus: [
      { rect: { x: 30, y: 428, w: 1220, h: 72 }, pill: "RATE CARD", pillAlign: "right", in: 20.1, out: 22.95 },
      { rect: { x: 882, y: 463, w: 176, h: 36 }, pill: "AUDITABLE HISTORY", in: 23.45, out: 26.85, at: [0.5, 0.5], click: 24.6 },
    ],
  },
];

const END_IN = 27.15;

// Screenshot pixel -> card pixel, honouring the per-scene crop.
// The page is resized with `!`, so the axes are scaled independently; reusing
// the horizontal factor vertically drifts every rect down the frame.
const toCard = (crop, r) => {
  const sx = CARD.w / crop.cw;
  const sy = CARD.h / crop.ch;
  const out = {
    x: Math.round((r.x - crop.cx) * sx),
    y: Math.round((r.y - crop.cy) * sy),
    w: Math.round(r.w * sx),
    h: Math.round(r.h * sy),
  };
  // A focus outline drawn outside the card bleeds onto the desktop background,
  // and one that reaches into the caption band collides with the type.
  const scrimTopInCard = SCRIM_TOP - CARD.y;
  if (out.x < 0 || out.y < 0 || out.x + out.w > CARD.w || out.y + out.h > CARD.h) {
    throw new Error(`focus rect escapes the card: ${JSON.stringify({ src: r, out })}`);
  }
  if (out.y + out.h > scrimTopInCard) {
    throw new Error(
      `focus rect reaches into the caption scrim (card y ${out.y + out.h} > ${scrimTopInCard}): ${JSON.stringify(r)}`,
    );
  }
  return out;
};

/* ------------------------------------------------------------ base plates */
console.log("• plates");

// Background: deep radial field.
magick(["-size", `${W}x${H}`, "radial-gradient:#12303F-#04090F", w("bg.png")]);

// Window chrome: background everywhere, punched open where the page shows,
// with a soft cast shadow and a hairline border.
magick(["-size", `${W}x${H}`, "xc:none", "-fill", "rgba(0,0,0,0.62)", "-strokewidth", "0",
  "-draw", `roundrectangle ${CARD.x},${CARD.y + 14} ${CARD.x + CARD.w},${CARD.y + CARD.h + 16} ${CARD.r},${CARD.r}`,
  "-blur", "0x22", w("shadow.png")]);
magick(["-size", `${W}x${H}`, "xc:none", "-fill", "white", "-strokewidth", "0",
  "-draw", `roundrectangle ${CARD.x},${CARD.y} ${CARD.x + CARD.w - 1},${CARD.y + CARD.h - 1} ${CARD.r},${CARD.r}`,
  w("hole.png")]);
magick([w("bg.png"), w("shadow.png"), "-compose", "Over", "-composite", w("chrome_a.png")]);
magick([w("chrome_a.png"), w("hole.png"), "-alpha", "set", "-compose", "DstOut", "-composite", w("chrome_b.png")]);
magick([w("chrome_b.png"), "-fill", "none", "-stroke", "rgba(255,255,255,0.16)", "-strokewidth", "1.5",
  "-draw", `roundrectangle ${CARD.x + 0.5},${CARD.y + 0.5} ${CARD.x + CARD.w - 1.5},${CARD.y + CARD.h - 1.5} ${CARD.r},${CARD.r}`,
  w("chrome.png")]);

// Page images, cropped per scene and fitted to the window.
SCENES.forEach((s, i) => {
  const c = s.crop;
  magick([path.join(ROOT, s.img), "-crop", `${c.cw}x${c.ch}+${c.cx}+${c.cy}`, "+repage",
    "-filter", "Lanczos", "-resize", `${CARD.w}x${CARD.h}!`, "-unsharp", "0x0.7+0.55+0.02", w(`page${i}.png`)]);
});

/* --------------------------------------------------- lower-third text plates */
// A short gradient dissolves into a near-solid caption band. The type sits
// entirely inside the solid part, so no page content can read through it.
const SCRIM_TOP = 496, GRAD_H = 60, SOLID_TOP = 556, SOLID_H = 130;
const KICKER_Y = 592, TICK_Y = 604, HEADLINE_Y = 656;

SCENES.forEach((s, i) => {
  magick(["-size", `${CARD.w}x${GRAD_H}`, `gradient:rgba(4,9,15,0)-rgba(4,9,15,0.94)`, w(`scrimA${i}.png`)]);
  magick(["-size", `${CARD.w}x${SOLID_H}`, `xc:rgba(4,9,15,0.94)`, w(`scrimB${i}.png`)]);

  magick(["-size", `${W}x${H}`, "xc:none", w(`t${i}.png`)]);
  magick([w(`t${i}.png`),
    w(`scrimA${i}.png`), "-geometry", `+${CARD.x}+${SCRIM_TOP}`, "-compose", "Over", "-composite",
    w(`scrimB${i}.png`), "-geometry", `+${CARD.x}+${SOLID_TOP}`, "-compose", "Over", "-composite",
    "-fill", TEAL, "-strokewidth", "0",
    "-draw", `rectangle ${CARD.x + 34},${TICK_Y} ${CARD.x + 60},${TICK_Y + 2}`,
    "-font", FONT_KICKER, "-pointsize", "14", "-kerning", "2.2", "-fill", TEAL,
    "-annotate", `+${CARD.x + 34}+${KICKER_Y}`, s.kicker,
    "-font", FONT_SERIF, "-pointsize", "42", "-kerning", "0", "-fill", INK,
    "-annotate", `+${CARD.x + 32}+${HEADLINE_Y}`, s.headline,
    w(`text${i}.png`)]);
});

/* ------------------------------------------------------------ focus plates */
const focusPlates = [];
SCENES.forEach((s, si) => {
  s.focus.forEach((f, fi) => {
    const r = toCard(s.crop, f.rect);
    const id = `f${si}_${fi}`;
    const file = w(`${id}.png`);

    // Dim everything, then cut the region of interest back out.
    magick(["-size", `${CARD.w}x${CARD.h}`, "xc:rgba(4,10,16,0.58)", file]);
    magick(["-size", `${CARD.w}x${CARD.h}`, "xc:none", "-fill", "white", "-strokewidth", "0",
      "-draw", `roundrectangle ${r.x},${r.y} ${r.x + r.w},${r.y + r.h} 8,8`, w(`${id}_hole.png`)]);
    magick([file, w(`${id}_hole.png`), "-alpha", "set", "-compose", "DstOut", "-composite", file]);
    magick([file, "-fill", "none", "-stroke", TEAL, "-strokewidth", "2",
      "-draw", `roundrectangle ${r.x},${r.y} ${r.x + r.w},${r.y + r.h} 8,8`, file]);

    // Caption pill, parked outside the highlighted region so product UI stays
    // legible. Right alignment is used where the left of that band holds live
    // controls the label would otherwise sit on top of.
    if (f.pill) {
      const label = f.pill;
      const fs = 13, pad = 12, ph = 26;
      const pw = Math.round(label.length * (fs * 0.60 + 1.35)) + pad * 2;
      const px = f.pillAlign === "right"
        ? Math.max(8, Math.min(r.x + r.w - pw, CARD.w - pw - 8))
        : Math.max(8, Math.min(r.x, CARD.w - pw - 8));
      let py = r.y - ph - 10;
      if (py < 8) py = r.y + r.h + 10;
      magick([file, "-fill", TEAL, "-strokewidth", "0",
        "-draw", `roundrectangle ${px},${py} ${px + pw},${py + ph} 13,13`,
        "-font", FONT_KICKER, "-pointsize", fs, "-kerning", "1.35", "-fill", "#05121A",
        "-annotate", `+${px + pad}+${py + 18}`, label, file]);
    }

    const cx = CARD.x + r.x + Math.round(r.w * (f.at?.[0] ?? 0.35));
    const cy = CARD.y + r.y + Math.round(r.h * (f.at?.[1] ?? 0.55));
    focusPlates.push({ file, in: f.in, out: f.out, cursor: { x: cx, y: cy }, click: f.click });
  });
});

/* --------------------------------------------------------------- end card */
// A restrained rising-trend motif balances the type block on the right.
magick([w("bg.png"),
  "-fill", "none", "-stroke", "rgba(255,255,255,0.07)", "-strokewidth", "1",
  "-draw", "line 744,258 1184,258", "-draw", "line 744,336 1184,336",
  "-draw", "line 744,414 1184,414", "-draw", "line 744,492 1184,492",
  "-stroke", "rgba(45,212,191,0.30)", "-strokewidth", "2",
  "-draw", "polyline 762,486 850,452 938,466 1026,398 1114,340 1170,272",
  "-stroke", TEAL, "-strokewidth", "2.5",
  "-draw", "polyline 762,486 850,452 938,466 1026,398 1114,340 1170,272",
  "-stroke", "none", "-fill", "rgba(45,212,191,0.85)",
  "-draw", "circle 850,452 850,455", "-draw", "circle 938,466 938,469",
  "-draw", "circle 1026,398 1026,401", "-draw", "circle 1114,340 1114,343",
  "-fill", GOLD, "-draw", "circle 1170,272 1170,279",
  "-fill", "rgba(232,190,115,0.22)", "-draw", "circle 1170,272 1170,290",
  "-fill", TEAL, "-strokewidth", "0", "-draw", "rectangle 120,196 356,198",
  "-font", FONT_KICKER, "-pointsize", "15", "-kerning", "2.6", "-fill", TEAL,
  "-annotate", "+120+248", "THE OUTCOME",
  "-font", FONT_SERIF, "-pointsize", "64", "-kerning", "0", "-fill", INK,
  "-annotate", "+120+340", "Smarter pricing.",
  "-font", FONT_SERIF, "-pointsize", "64", "-fill", GOLD,
  "-annotate", "+120+424", "Faster decisions.",
  "-font", FONT_BODY, "-pointsize", "20", "-kerning", "0.2", "-fill", MUTED,
  "-annotate", "+122+498", "One connected view. One auditable path.",
  "-font", FONT_KICKER, "-pointsize", "14", "-kerning", "2.4", "-fill", "#6B7F89",
  "-annotate", "+122+656", "MODULO · REVENUE MANAGEMENT",
  w("end.png")]);

/* ------------------------------------------------------- cursor and ripple */
magick([CURSOR_SRC, "-resize", "26x26", w("cursor.png")]);
magick(["-size", "76x76", "xc:none", "-fill", "none", "-stroke", TEAL, "-strokewidth", "2.5",
  "-draw", "circle 38,38 38,12", "-blur", "0x0.6", w("ring.png")]);

/* --------------------------------------------- pass 1: the page dissolves */
console.log("• page track");
const T = 0.4;
const contentArgs = [];
SCENES.forEach((s, i) => {
  const hold = (s.end - s.start) + (i < SCENES.length - 1 ? T : 0);
  contentArgs.push("-loop", "1", "-t", hold.toFixed(3), "-i", w(`page${i}.png`));
});
let cf = SCENES.map((_, i) => `[${i}:v]fps=${FPS},format=rgba,setsar=1[p${i}]`).join(";");
let prev = "p0", off = 0;
for (let i = 1; i < SCENES.length; i++) {
  off += SCENES[i].start - SCENES[i - 1].start;
  const out = i === SCENES.length - 1 ? "pages" : `x${i}`;
  // fadeblack, not a straight dissolve: two dense UI screens cross-fading on top
  // of each other reads as ghosting. Dipping through black keeps each cut clean.
  cf += `;[${prev}][p${i}]xfade=transition=fadeblack:duration=${T}:offset=${(SCENES[i].start).toFixed(3)}[${out}]`;
  prev = out;
}
ffmpeg([...contentArgs, "-filter_complex", cf, "-map", "[pages]", "-t", DUR,
  "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", w("pages.mp4")]);

/* ------------------------------------------------ pass 2: full composition */
console.log("• composite");
const inputs = [];
const add = (args) => { inputs.push(...args); return (inputs.filter((a) => a === "-i").length) - 1; };

const iBg = add(["-loop", "1", "-framerate", FPS, "-t", DUR, "-i", w("bg.png")]);
const iPages = add(["-i", w("pages.mp4")]);
const iChrome = add(["-loop", "1", "-framerate", FPS, "-t", DUR, "-i", w("chrome.png")]);
const iFocus = focusPlates.map((f) => add(["-loop", "1", "-framerate", FPS, "-t", DUR, "-i", f.file]));
const iRing = focusPlates.map((f) => (f.click ? add(["-loop", "1", "-framerate", FPS, "-t", DUR, "-i", w("ring.png")]) : -1));
const iCursor = focusPlates.map(() => add(["-loop", "1", "-framerate", FPS, "-t", DUR, "-i", w("cursor.png")]));
const iText = SCENES.map((_, i) => add(["-loop", "1", "-framerate", FPS, "-t", DUR, "-i", w(`text${i}.png`)]));
// The window is cleared to plain background first, then the closing type fades
// up. Fading the end card straight over live UI leaves both readable at once.
const iBgCover = add(["-loop", "1", "-framerate", FPS, "-t", DUR, "-i", w("bg.png")]);
const iEnd = add(["-loop", "1", "-framerate", FPS, "-t", DUR, "-i", w("end.png")]);
const iNar = add(["-i", NARRATION]);
const iMus = add(["-stream_loop", "-1", "-i", MUSIC]);

const fadeIn = (st, d = 0.3) => `fade=t=in:st=${st.toFixed(2)}:d=${d}:alpha=1`;
const fadeOut = (st, d = 0.3) => `fade=t=out:st=${st.toFixed(2)}:d=${d}:alpha=1`;
const ease = (t0, dur, a, b) =>
  `(${a}+(${b}-${a})*(pow(min(max((t-${t0.toFixed(2)})/${dur},0),1),2)*(3-2*min(max((t-${t0.toFixed(2)})/${dur},0),1))))`;

const fc = [];
fc.push(`[${iBg}:v]format=rgba,setsar=1[bg]`);
fc.push(`[${iPages}:v]format=rgba,setsar=1[pg]`);
fc.push(`[bg][pg]overlay=${CARD.x}:${CARD.y}:format=auto[b0]`);
fc.push(`[${iChrome}:v]format=rgba,setsar=1[ch]`);
fc.push(`[b0][ch]overlay=0:0:format=auto[b1]`);

let node = "b1", n = 0;

focusPlates.forEach((f, k) => {
  fc.push(`[${iFocus[k]}:v]format=rgba,setsar=1,${fadeIn(f.in)},${fadeOut(f.out)}[fp${k}]`);
  fc.push(`[${node}][fp${k}]overlay=${CARD.x}:${CARD.y}:format=auto[n${++n}]`);
  node = `n${n}`;
});

focusPlates.forEach((f, k) => {
  if (iRing[k] < 0) return;
  fc.push(`[${iRing[k]}:v]format=rgba,setsar=1,${fadeIn(f.click, 0.18)},${fadeOut(f.click + 0.22, 0.3)}[rg${k}]`);
  fc.push(`[${node}][rg${k}]overlay=${f.cursor.x - 38}:${f.cursor.y - 38}:format=auto[n${++n}]`);
  node = `n${n}`;
});

focusPlates.forEach((f, k) => {
  const t0 = Math.max(0, f.in - 0.3);
  const fromX = f.cursor.x - 170, fromY = f.cursor.y - 96;
  fc.push(`[${iCursor[k]}:v]format=rgba,setsar=1,${fadeIn(t0, 0.25)},${fadeOut(f.out, 0.25)}[cu${k}]`);
  fc.push(`[${node}][cu${k}]overlay=x='${ease(t0, 1.35, fromX, f.cursor.x)}':y='${ease(t0, 1.35, fromY, f.cursor.y)}':format=auto[n${++n}]`);
  node = `n${n}`;
});

const TEXT_T = [
  [0.35, 4.7], [5.5, 8.1], [8.9, 12.75], [13.55, 19.0], [19.8, 26.8],
];
SCENES.forEach((_, i) => {
  const [a, b] = TEXT_T[i];
  fc.push(`[${iText[i]}:v]format=rgba,setsar=1,${fadeIn(a, 0.4)},${fadeOut(b, 0.35)}[tx${i}]`);
  fc.push(`[${node}][tx${i}]overlay=x=0:y='${ease(a, 0.6, 14, 0)}':format=auto[n${++n}]`);
  node = `n${n}`;
});

fc.push(`[${iBgCover}:v]format=rgba,setsar=1,${fadeIn(26.9, 0.32)}[bgc]`);
fc.push(`[${node}][bgc]overlay=0:0:format=auto[n${++n}]`);
node = `n${n}`;
fc.push(`[${iEnd}:v]format=rgba,setsar=1,${fadeIn(END_IN + 0.15, 0.5)}[endc]`);
fc.push(`[${node}][endc]overlay=0:0:format=auto[n${++n}]`);
node = `n${n}`;

fc.push(
  `[${node}]drawbox=x=${CARD.x}:y=702:w=${CARD.w}:h=2:color=white@0.10:t=fill,` +
  `drawbox=x=${CARD.x}:y=702:w='${CARD.w}*min(t/${DUR},1)':h=2:color=${TEAL.replace("#", "0x")}@0.85:t=fill,` +
  `eq=contrast=1.03:saturation=1.04,vignette=PI/7,noise=alls=3:allf=t,` +
  `fade=t=in:st=0:d=0.5,format=yuv420p[v]`
);

fc.push(
  // The narration fade must sit AFTER the last word (29.80), not across it —
  // fading from 29.6 was itself clipping the final word.
  `[${iNar}:a]aresample=48000,volume=1.05,afade=t=out:st=30.6:d=0.4[nar]`,
  // Music is 30.04s; a 3% stretch covers 31.0s with no loop seam, and is
  // inaudible at this level. It resolves under the held end card.
  `[${iMus}:a]aresample=48000,atempo=0.969,volume=0.11,afade=t=in:st=0:d=1.2,afade=t=out:st=29.2:d=1.8[mus]`,
  `[nar][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.94[a]`
);

const FINAL = path.join(OUT_DIR, "dynamic-pricing-demo-signal-decision-impact.mp4");
ffmpeg([...inputs, "-filter_complex", fc.join(";"),
  "-map", "[v]", "-map", "[a]", "-t", DUR, "-r", FPS,
  "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-profile:v", "high", "-level", "4.0",
  "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
  "-movflags", "+faststart", FINAL]);

console.log("✓", FINAL);
console.log(run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration,nb_frames:format=duration,size", "-of", "default=nw=1", FINAL]));
