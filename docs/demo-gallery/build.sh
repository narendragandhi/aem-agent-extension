#!/bin/bash
# Builds the AEM Agent synthetic walkthrough video.
# Depends on: scenes/*.html rendered to scenes/frames/*.png (1280x720 @2x), macOS `say` voice.
# Usage: ./build.sh   (fully self-contained — records narration, renders clips, muxes demo.mp4)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build

FPS=30
W=1280
H=720
CRF=18
VOICE="${VOICE:-Samantha}"

DURS=(7.5 12.5 8.5 10 11.5 10 6.0)          # seconds per scene
DELAYS=(400 7900 20400 28900 38900 50400 60400) # narration start (ms)
NAMES=(01 02 03 04 05 06 07)
FRAMES=(01-title 02-audit 03-logs 04-diff 05-content 06-webmcp 07-closing)
LINES=(
  "AEM Agent. Governed diagnostics and authoring assistance for Adobe Experience Manager, right in a Chrome side panel."
  "One, the governance audit. Every author page gets a live health score, ADA and SEO checks for missing alt text, heading structure and nesting, plus an MSM blast radius for live copies."
  "Two, Log Whisperer. Live Sling error logs filtered to high signal entries, with AI correlation when Gemini Nano is available."
  "Three, environment parity. A recursive JCR diff against your stage environment, with added, removed and changed properties highlighted inline."
  "Four, authoring. Create content fragments from real CF models, ghostwrite SEO titles, publish or unlock with confirmation, and generate Playwright tests from the live DOM."
  "Five, bring your own agent. The extension registers read only AEM tools for WebMCP, so SLICC and other assistants can inspect pages."
  "Free and open source. Load it unpacked in sixty seconds from the repository link below."
)

TOTAL=$(python3 -c "import sys; print(round(sum(float(x) for x in sys.argv[1:]),2))" "${DURS[@]}")

# 0) Record narration segments (idempotent — only if missing)
for i in "${!NAMES[@]}"; do
  f="build/seg${NAMES[$i]}.aiff"
  if [ ! -f "$f" ]; then
    say -v "$VOICE" -o "$f" "${LINES[$i]}"
    echo "recorded $f"
  fi
done

# 1) Render each still scene into a Ken Burns clip
CLIPS=()
for i in "${!NAMES[@]}"; do
  n="${NAMES[$i]}"
  dur="${DURS[$i]}"
  frames=$(( $(echo "$dur * $FPS" | bc -l | cut -d. -f1) ))
  dir="in"
  if (( i % 2 == 1 )); then dir="out"; fi
  vf="scale=1600:900:flags=lanczos,"
  vf+="zoompan=z='"
  if [ "$dir" = "in" ]; then
    vf+="min(1.0+0.10*on/${frames},1.10)"
  else
    vf+="max(1.10-0.10*on/${frames},1.0)"
  fi
  vf+="':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},fade=t=in:st=0:d=0.35,"
  vf+="fade=t=out:st=$(echo "$dur - 0.35" | bc -l):d=0.35,format=yuv420p"
  ffmpeg -y -loglevel error -loop 1 -framerate ${FPS} -t "${dur}" -i "scenes/frames/${FRAMES[$i]}.png" \
    -vf "$vf" -r ${FPS} -c:v libx264 -preset medium -crf ${CRF} "build/clip_${n}.mp4"
  CLIPS+=("build/clip_${n}.mp4")
done

# 2) Concat clips (identical codecs) -> silent video
: > build/concat.txt
for c in "${CLIPS[@]}"; do echo "file '$(basename "$c")'" >> build/concat.txt; done
ffmpeg -y -loglevel error -f concat -safe 0 -i build/concat.txt -c copy "build/video_silent.mp4"

# 3) Mix narration segments at scene offsets
FILTER=""
INS=""
for i in "${!NAMES[@]}"; do
  FILTER+="[${i}:a]aresample=44100,adelay=${DELAYS[$i]}:all=1[a${i}];"
  INS+="[a${i}]"
done
FILTER+="${INS}amix=inputs=${#NAMES[@]}:normalize=0:dropout_transition=0,apad,atrim=0:${TOTAL},volume=1.3[nar]"
INPUTS=()
for i in "${!NAMES[@]}"; do INPUTS+=("-i" "build/seg${NAMES[$i]}.aiff"); done
ffmpeg -y -loglevel error "${INPUTS[@]}" -filter_complex "${FILTER}" -map "[nar]" \
  -ar 44100 -ac 2 -c:a pcm_s16le -t "${TOTAL}" "build/narration.wav"

# 4) Mux narration + fast-start poster
ffmpeg -y -loglevel error -i build/video_silent.mp4 -i build/narration.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "demo.mp4"

ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 demo.mp4