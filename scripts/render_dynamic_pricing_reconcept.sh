#!/usr/bin/env bash
set -euo pipefail

# Re-renderable source for the restrained “Signal → Decision → Measure” product film.
# The source screenshots are kept intact and contained inside a consistent editorial frame.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/attached_assets/generated_videos/reconcept"
TMP_DIR="$OUT_DIR/tmp"
mkdir -p "$TMP_DIR"

FPS=30
W=1280
H=720
BG="#071722"
INK="#f5f7f6"
MUTED="#9aadb2"
TEAL="#43d0c0"
GOLD="#e9bd65"
SANS="$(fc-match -f '%{file}' 'DejaVu Sans')"
SERIF="$(fc-match -f '%{file}' 'DejaVu Serif')"
CURSOR="$ROOT/attached_assets/generated_videos/mouse-cursor.png"

OVERVIEW="$ROOT/screenshots/slide-overview.jpg"
CONTROLS="$ROOT/screenshots/slide-pricing-controls.jpg"
RATE_CARD="$ROOT/screenshots/slide-rate-card.jpg"
COMPETITORS="$ROOT/screenshots/slide-competitors.jpg"
ANALYTICS="$ROOT/screenshots/formatted-analytics.jpg"
LOGO="$ROOT/attached_assets/modulo_flat_blue_1786491120146.png"

rm -f "$TMP_DIR"/*.mp4 "$TMP_DIR"/concat.txt

render_title() {
  local out="$1"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=$BG:s=${W}x${H}:r=$FPS:d=2.6" \
    -vf "format=rgba,\
drawbox=x=120:y=138:w=72:h=3:color=${TEAL}:t=fill,\
drawtext=fontfile=${SANS}:text='MODULO  /  PRICING INTELLIGENCE':fontcolor=${TEAL}:fontsize=16:x=120:y=92,\
drawtext=fontfile=${SERIF}:text='Signal.':fontcolor=${INK}:fontsize=66:x=120:y=194,\
drawtext=fontfile=${SERIF}:text='Decision.':fontcolor=${INK}:fontsize=66:x=120:y=274,\
drawtext=fontfile=${SERIF}:text='Measure.':fontcolor=${GOLD}:fontsize=66:x=120:y=354,\
drawbox=x=120:y=492:w=1040:h=1:color=${TEAL}@0.35:t=fill,\
drawtext=fontfile=${SANS}:text='PORTFOLIO CONTEXT    •    OPERATOR CONTROL    •    MEASURED RESULTS':fontcolor=${MUTED}:fontsize=16:x=120:y=520,\
drawtext=fontfile=${SANS}:text='MODULO  /  REVENUE MANAGEMENT':fontcolor=${MUTED}:fontsize=15:x=120:y=650,\
fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st=2.15:d=0.45:alpha=1" \
    -an -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$out"
}

render_ui_scene() {
  local out="$1"
  local image="$2"
  local chapter="$3"
  local title="$4"
  local body="$5"
  local focus_x="$6"
  local focus_y="$7"
  local focus_w="$8"
  local focus_h="$9"
  local focus_label="${10}"
  local duration="${11}"
  local cursor_start_x="${12}"
  local cursor_start_y="${13}"
  local cursor_end_x="${14}"
  local cursor_end_y="${15}"

  # Show the complete 16:9 capture with generous space around it. Keep the
  # screen smaller than the editorial frame so the full interface reads as a
  # complete product view instead of filling and visually cropping the scene.
  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -i "$image" \
    -f lavfi -i "color=c=$BG:s=${W}x${H}:r=$FPS:d=$duration" \
    -filter_complex "\
[0:v]scale=900:506:flags=lanczos,unsharp=5:5:0.45:5:5:0,format=rgba,drawbox=x=0:y=0:w=900:h=506:color=white@0.85:t=2[screen];\
[1:v]format=rgba[bg];\
 [bg]drawbox=x=80:y=72:w=1120:h=2:color=${TEAL}@0.7:t=fill,\
      drawtext=fontfile=${SANS}:text='${chapter}':fontcolor=${TEAL}:fontsize=13:x=190:y=4,\
      drawtext=fontfile=${SERIF}:text='${title}':fontcolor=${INK}:fontsize=23:x=190:y=21,\
      drawtext=fontfile=${SANS}:text='${body}':fontcolor=${MUTED}:fontsize=11:x=190:y=50[header];\
[header][screen]overlay=x=190:y=132,\
fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st=$(awk "BEGIN{print $duration-0.45}"):d=0.45:alpha=1,\
format=yuv420p[v]" \
    -map "[v]" -an -t "$duration" -r "$FPS" -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$out"
}

render_closing() {
  local out="$1"
  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -i "$LOGO" \
    -vf "scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},\
    fade=t=in:st=0:d=0.5,fade=t=out:st=4.5:d=0.5,format=yuv420p" \
    -an -t 5.0 -r "$FPS" -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$out"
}

# Screen chapters: titles are deliberately concise so the page itself stays readable.
render_title "$TMP_DIR/01-title.mp4"
render_ui_scene "$TMP_DIR/02-signal.mp4" "$OVERVIEW" \
  "01  /  REVIEW" "Review the portfolio dashboard" "OCCUPANCY  •  RATES  •  REVENUE" \
  35 455 1210 125 "PORTFOLIO SIGNAL" 4.9 470 630 835 635
render_ui_scene "$TMP_DIR/03-ai.mp4" "$CONTROLS" \
  "02  /  PRIORITIZE" "Prioritize high-impact moves" "REVENUE GOAL  •  ELASTICITY  •  ML" \
  35 330 1210 220 "AI PRIORITIZATION" 5.0 470 615 790 625
render_ui_scene "$TMP_DIR/04-rates.mp4" "$RATE_CARD" \
  "03  /  APPLY" "Review every proposed rate" "CURRENT RATE  •  RULES RATE  •  OVERRIDES  •  EXPORT" \
  35 430 1210 130 "RATE REVIEW" 5.0 470 615 790 625
render_ui_scene "$TMP_DIR/05-market.mp4" "$COMPETITORS" \
  "04  /  BENCHMARK" "See local market position" "CARE-ADJUSTED RATES  •  COMPETITION" \
  35 305 1210 245 "MARKET CONTEXT" 5.0 820 515 925 455
render_ui_scene "$TMP_DIR/06-impact.mp4" "$ANALYTICS" \
  "05  /  LEARN" "Measure the outcome" "RATE GROWTH  •  OCCUPANCY  •  REVENUE" \
  35 305 1210 245 "MEASURE THE EFFECT" 5.0 820 515 925 455
render_closing "$TMP_DIR/07-close.mp4"

cat > "$TMP_DIR/concat.txt" <<EOF
file '01-title.mp4'
file '02-signal.mp4'
file '03-ai.mp4'
file '04-rates.mp4'
file '05-market.mp4'
file '06-impact.mp4'
file '07-close.mp4'
EOF

ffmpeg -hide_banner -loglevel error -y \
  -f concat -safe 0 -i "$TMP_DIR/concat.txt" \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/visual.mp4"

VOICEOVER="$ROOT/attached_assets/generated_audio/dynamic-pricing-demo-overview-aligned.mp3"
MUSIC="$ROOT/attached_assets/generated_audio/dynamic-pricing-demo-music.mp3"
FINAL="$OUT_DIR/modulo-pricing-intelligence-professional.mp4"
PUBLIC_VIDEO="$ROOT/client/public/media/modulo-pricing-intelligence.mp4"
POSTER="$ROOT/client/public/media/modulo-pricing-intelligence-poster.jpg"

ffmpeg -hide_banner -loglevel error -y \
  -i "$TMP_DIR/visual.mp4" \
  -i "$VOICEOVER" \
  -stream_loop -1 -i "$MUSIC" \
  -filter_complex "\
  [1:a]aresample=48000,atempo=1.08,volume=0.95,adelay=3100|3100[voiceover];\
[2:a]aresample=48000,volume=0.10,afade=t=out:st=30.5:d=2.0[music];\
[voiceover][music]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:attack=5:release=80[a]" \
  -map 0:v -map "[a]" -t 32.5 \
  -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$FINAL"

cp "$FINAL" "$PUBLIC_VIDEO"
ffmpeg -hide_banner -loglevel error -y -ss 3.6 -i "$FINAL" -frames:v 1 -q:v 2 "$POSTER"

echo "Rendered source: $FINAL"
echo "Updated public video: $PUBLIC_VIDEO"
echo "Updated poster: $POSTER"
ffprobe -v error -show_entries format=duration:stream=width,height,codec_name -of default=nw=1 "$FINAL"
