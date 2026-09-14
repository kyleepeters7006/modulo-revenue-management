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
AI_INSIGHTS="$ROOT/screenshots/slide-ai-insights.jpg"
ANALYTICS="$ROOT/screenshots/formatted-analytics.jpg"

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

  # Show the complete 16:9 capture with generous space around it. Keeping the
  # scaled screen centered prevents the interface from feeling cropped.
  ffmpeg -hide_banner -loglevel error -y \
    -loop 1 -i "$image" \
    -f lavfi -i "color=c=$BG:s=${W}x${H}:r=$FPS:d=$duration" \
    -filter_complex "\
[0:v]scale=1000:562:flags=lanczos,unsharp=5:5:0.45:5:5:0,format=rgba,drawbox=x=0:y=0:w=1000:h=562:color=white@0.85:t=2[screen];\
[1:v]format=rgba[bg];\
[bg]drawbox=x=80:y=58:w=1120:h=2:color=${TEAL}@0.7:t=fill,\
drawtext=fontfile=${SANS}:text='${chapter}':fontcolor=${TEAL}:fontsize=14:x=80:y=15,\
drawtext=fontfile=${SERIF}:text='${title}':fontcolor=${INK}:fontsize=25:x=270:y=9,\
drawtext=fontfile=${SANS}:text='${body}':fontcolor=${MUTED}:fontsize=12:x=700:y=21[header];\
[header][screen]overlay=x=140:y=104,\
fade=t=in:st=0:d=0.35:alpha=1,fade=t=out:st=$(awk "BEGIN{print $duration-0.45}"):d=0.45:alpha=1,\
format=yuv420p[v]" \
    -map "[v]" -an -t "$duration" -r "$FPS" -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$out"
}

render_closing() {
  local out="$1"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=$BG:s=${W}x${H}:r=$FPS:d=4.2" \
    -vf "format=rgba,\
drawbox=x=120:y=130:w=1040:h=2:color=${TEAL}@0.75:t=fill,\
drawbox=x='120+min(t/2.2,1)*1040':y=130:w=2:h=2:color=${GOLD}:t=fill,\
drawtext=fontfile=${SANS}:text='THE CORE PHILOSOPHY':fontcolor=${TEAL}:fontsize=17:x=120:y=177,\
drawtext=fontfile=${SERIF}:text='AI finds the opportunity.':fontcolor=${INK}:fontsize=52:x=120:y=235,\
drawtext=fontfile=${SERIF}:text='Operators own the decision.':fontcolor=${GOLD}:fontsize=52:x=120:y=305,\
drawtext=fontfile=${SANS}:text='Elasticity informs the action. Outcomes improve the next recommendation.':fontcolor=${MUTED}:fontsize=18:x=120:y=420,\
drawtext=fontfile=${SANS}:text='MODULO  /  REVENUE MANAGEMENT':fontcolor=${MUTED}:fontsize=15:x=120:y=650,\
fade=t=in:st=0:d=0.4:alpha=1,fade=t=out:st=3.7:d=0.5:alpha=1" \
    -an -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$out"
}

# Screen chapters: titles are deliberately concise so the page itself stays readable.
render_title "$TMP_DIR/01-title.mp4"
render_ui_scene "$TMP_DIR/02-signal.mp4" "$OVERVIEW" \
  "01  /  DECOMPOSE" "Turn scale into signal" "OCCUPANCY  •  RATES  •  DEMAND  •  MARKET POSITION" \
  35 455 1210 125 "PORTFOLIO SIGNAL" 5.8 470 630 835 635
render_ui_scene "$TMP_DIR/03-ai.mp4" "$AI_INSIGHTS" \
  "02  /  PRIORITIZE" "Surface the highest-impact moves" "REVENUE GOAL  •  ELASTICITY  •  MACHINE LEARNING" \
  35 330 1210 220 "AI PRIORITIZATION" 5.8 470 615 790 625
render_ui_scene "$TMP_DIR/04-decision.mp4" "$CONTROLS" \
  "03  /  CONTROL" "Make the logic reviewable" "TARGETS  •  GUARDRAILS  •  OPERATOR APPROVAL" \
  35 430 1210 130 "TARGET + GUARDRAIL" 5.8 470 615 790 625
render_ui_scene "$TMP_DIR/05-impact.mp4" "$ANALYTICS" \
  "04  /  LEARN" "Measure the outcome" "RATE GROWTH  •  OCCUPANCY  •  REVENUE  •  NEXT DECISION" \
  35 305 1210 245 "MEASURE THE EFFECT" 5.8 820 515 925 455
render_closing "$TMP_DIR/06-close.mp4"

cat > "$TMP_DIR/concat.txt" <<EOF
file '01-title.mp4'
file '02-signal.mp4'
file '03-ai.mp4'
file '04-decision.mp4'
file '05-impact.mp4'
file '06-close.mp4'
EOF

ffmpeg -hide_banner -loglevel error -y \
  -f concat -safe 0 -i "$TMP_DIR/concat.txt" \
  -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p \
  "$TMP_DIR/visual.mp4"

DATA_VO="$ROOT/attached_assets/generated_audio/modulo-philosophy-data.mp3"
AI_VO="$ROOT/attached_assets/generated_audio/modulo-philosophy-ai.mp3"
CONTROL_VO="$ROOT/attached_assets/generated_audio/modulo-philosophy-control.mp3"
LEARNING_VO="$ROOT/attached_assets/generated_audio/modulo-philosophy-learning.mp3"
MUSIC="$ROOT/attached_assets/generated_audio/dynamic-pricing-demo-music.mp3"
FINAL="$OUT_DIR/modulo-pricing-intelligence-professional.mp4"
CAPTION_SRT="$TMP_DIR/dynamic-pricing-demo-signal-decision-impact-captioned.srt"
CAPTION_ASS="$TMP_DIR/dynamic-pricing-demo-signal-decision-impact-captioned.ass"

ffmpeg -hide_banner -loglevel error -y \
  -i "$TMP_DIR/visual.mp4" \
  -i "$DATA_VO" \
  -i "$AI_VO" \
  -i "$CONTROL_VO" \
  -i "$LEARNING_VO" \
  -stream_loop -1 -i "$MUSIC" \
  -filter_complex "\
[1:a]aresample=48000,volume=0.95,adelay=3100|3100[data];\
[2:a]aresample=48000,volume=0.95,adelay=8900|8900[ai];\
[3:a]aresample=48000,volume=0.95,adelay=14700|14700[control];\
[4:a]aresample=48000,volume=0.95,adelay=20500|20500[learning];\
[5:a]aresample=48000,volume=0.10,afade=t=out:st=28.0:d=2.0[music];\
[data][ai][control][learning][music]amix=inputs=5:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:attack=5:release=80[a]" \
  -map 0:v -map "[a]" -t 30 \
  -c:v copy -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$FINAL"

echo "Rendered: $FINAL"
ffprobe -v error -show_entries format=duration:stream=width,height,codec_name -of default=nw=1 "$FINAL"
