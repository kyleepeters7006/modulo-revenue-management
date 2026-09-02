#!/usr/bin/env bash
set -euo pipefail

# Re-renderable source for the 30-second “Signal → Decision → Impact” product film.
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
ANALYTICS="$ROOT/screenshots/slide-analytics.jpg"

rm -f "$TMP_DIR"/*.mp4 "$TMP_DIR"/concat.txt

render_title() {
  local out="$1"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=$BG:s=${W}x${H}:r=$FPS:d=3.4" \
    -vf "format=rgba,\
drawbox=x=120:y=112:w=1040:h=1:color=${TEAL}@0.55:t=fill,\
drawbox=x='120+min(t/1.7,1)*1040':y=112:w=2:h=1:color=${GOLD}:t=fill,\
drawtext=fontfile=${SANS}:text='A PRICING SYSTEM IN MOTION':fontcolor=${TEAL}:fontsize=17:x=120:y=155,\
drawtext=fontfile=${SERIF}:text='Read the signal.':fontcolor=${INK}:fontsize=58:x=120:y=202,\
drawtext=fontfile=${SERIF}:text='Make the decision.':fontcolor=${INK}:fontsize=58:x=120:y=270,\
drawtext=fontfile=${SERIF}:text='Measure the impact.':fontcolor=${GOLD}:fontsize=58:x=120:y=338,\
drawtext=fontfile=${SANS}:text='SIGNAL  →  DECISION  →  IMPACT':fontcolor=${MUTED}:fontsize=18:x=120:y=455,\
drawtext=fontfile=${SANS}:text='MODULO  /  REVENUE MANAGEMENT':fontcolor=${MUTED}:fontsize=15:x=120:y=650,\
fade=t=in:st=0:d=0.45:alpha=1,fade=t=out:st=2.9:d=0.5:alpha=1" \
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

  # The page image is 1040×585, preserving the source aspect ratio with a 120px frame.
  # Its final position is x=120, y=116. The cursor is overlaid independently.
  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -i "$image" \
    -loop 1 -i "$CURSOR" \
    -f lavfi -i "color=c=$BG:s=${W}x${H}:r=$FPS:d=$duration" \
    -filter_complex "\
[0:v]scale=1040:585,format=rgba,drawbox=x=0:y=0:w=1040:h=585:color=white@0.92:t=2[screen];\
[1:v]scale=30:30,format=rgba[cursor];\
[2:v]format=rgba,\
drawbox=x=120:y=80:w=1040:h=1:color=${TEAL}@0.55:t=fill,\
drawbox=x=120:y=81:w=180:h=2:color=${TEAL}:t=fill,\
drawtext=fontfile=${SANS}:text='${chapter}':fontcolor=${TEAL}:fontsize=17:x=120:y=35,\
drawtext=fontfile=${SERIF}:text='${title}':fontcolor=${INK}:fontsize=33:x=120:y=51,\
drawtext=fontfile=${SANS}:text='${body}':fontcolor=${MUTED}:fontsize=15:x=120:y=88,\
drawbox=x=108:y=104:w=1064:h=609:color=black@0.28:t=fill,\
fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st=$(awk "BEGIN{print $duration-0.45}") :d=0.45:alpha=1[bg];\
[bg][screen]overlay=x='120-35*(1-min(t/0.55,1))':y=116:enable='gte(t,0.05)'[base];\
[base]drawbox=x=${focus_x}:y=${focus_y}:w=${focus_w}:h=${focus_h}:color=${TEAL}@0.95:t=3:enable='between(t,0.8,$(awk "BEGIN{print $duration-0.7}") )'[focused];\
[focused]drawbox=x=${focus_x}:y=${focus_y}:w='min(${focus_w}*(0.82+0.18*sin(6*t)),${focus_w})':h=3:color=${GOLD}@0.92:t=fill:enable='between(t,1.0,$(awk "BEGIN{print $duration-0.7}") )'[lined];\
[lined][cursor]overlay=x='${cursor_start_x}+(${cursor_end_x}-${cursor_start_x})*min(max((t-0.55)/1.9,0),1)':y='${cursor_start_y}+(${cursor_end_y}-${cursor_start_y})*min(max((t-0.55)/1.9,0),1)':enable='between(t,0.55,$(awk "BEGIN{print $duration-0.3}") )':eof_action=repeat,\
fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st=$(awk "BEGIN{print $duration-0.45}"):d=0.45:alpha=1,\
format=yuv420p[v]" \
    -map "[v]" -an -t "$duration" -r "$FPS" -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$out"
}

render_closing() {
  local out="$1"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=$BG:s=${W}x${H}:r=$FPS:d=3.8" \
    -vf "format=rgba,\
drawbox=x=120:y=130:w=1040:h=2:color=${TEAL}@0.75:t=fill,\
drawbox=x='120+min(t/2.2,1)*1040':y=130:w=2:h=2:color=${GOLD}:t=fill,\
drawtext=fontfile=${SANS}:text='THE OUTCOME':fontcolor=${TEAL}:fontsize=17:x=120:y=177,\
drawtext=fontfile=${SERIF}:text='A clearer signal.':fontcolor=${INK}:fontsize=55:x=120:y=225,\
drawtext=fontfile=${SERIF}:text='Faster decisions.':fontcolor=${GOLD}:fontsize=55:x=120:y=294,\
drawtext=fontfile=${SANS}:text='Pricing that moves with the market.':fontcolor=${MUTED}:fontsize=19:x=120:y=415,\
drawtext=fontfile=${SANS}:text='MODULO  /  REVENUE MANAGEMENT':fontcolor=${MUTED}:fontsize=15:x=120:y=650,\
fade=t=in:st=0:d=0.45:alpha=1,fade=t=out:st=3.0:d=0.6:alpha=1" \
    -an -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$out"
}

# Screen chapters: titles are deliberately concise so the page itself stays readable.
render_title "$TMP_DIR/01-title.mp4"
render_ui_scene "$TMP_DIR/02-signal.mp4" "$OVERVIEW" \
  "01  /  SIGNAL" "See the whole portfolio." "Occupancy, revenue, and opportunity in one view." \
  145 585 990 105 "PORTFOLIO SIGNAL" 5.7 470 630 835 635
render_ui_scene "$TMP_DIR/03-decision.mp4" "$CONTROLS" \
  "02  /  DECISION" "Turn movement into a plan." "Set targets and guardrails before the next rate move." \
  145 565 990 135 "TARGET + GUARDRAIL" 5.7 470 615 790 625
render_ui_scene "$TMP_DIR/04-action.mp4" "$RATE_CARD" \
  "03  /  ACTION" "Put the decision to work." "Review the recommendation. Apply it with intent." \
  145 510 430 100 "REVIEW  →  APPLY" 5.7 360 545 310 565
render_ui_scene "$TMP_DIR/05-impact.mp4" "$ANALYTICS" \
  "04  /  IMPACT" "Prove what changed." "Connect rate movement to occupancy and revenue opportunity." \
  145 423 990 255 "MEASURE THE EFFECT" 5.7 820 515 925 455
render_closing "$TMP_DIR/06-close.mp4"

cat > "$TMP_DIR/concat.txt" <<EOF
file '01-title.mp4'
file '02-signal.mp4'
file '03-decision.mp4'
file '04-action.mp4'
file '05-impact.mp4'
file '06-close.mp4'
EOF

ffmpeg -hide_banner -loglevel error -y \
  -f concat -safe 0 -i "$TMP_DIR/concat.txt" \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/visual.mp4"

NARRATION="$ROOT/attached_assets/generated_audio/dynamic-pricing-demo-british-no-location.mp3"
MUSIC="$ROOT/attached_assets/generated_audio/dynamic-pricing-demo-music.mp3"
FINAL="$OUT_DIR/dynamic-pricing-demo-signal-decision-impact.mp4"

ffmpeg -hide_banner -loglevel error -y \
  -i "$TMP_DIR/visual.mp4" \
  -i "$NARRATION" \
  -stream_loop -1 -i "$MUSIC" \
  -filter_complex "\
[1:a]aresample=48000,volume=1.0,afade=t=out:st=28.7:d=1.3[narration];\
[2:a]aresample=48000,volume=0.14,afade=t=out:st=27.5:d=2.5[music];\
[narration][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:attack=5:release=80[a]" \
  -map 0:v -map "[a]" -t 30 \
  -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$FINAL"

echo "Rendered: $FINAL"
ffprobe -v error -show_entries format=duration:stream=width,height,codec_name -of default=nw=1 "$FINAL"