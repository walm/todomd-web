#!/bin/sh
# Re-record the demo gifs. Requires: go, node, todomd, agent-browser, ffmpeg.
#
#   sh docs/demo/record.sh          # both themes
#   sh docs/demo/record.sh dark     # just one
#
# Everything happens in a scratch dir against a scratch TODO.md; nothing
# outside it and docs/demo*.gif is touched.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
# A fixed, tidy path: the board's header shows the file's directory, and
# mktemp's /var/folders/... noise would end up in the gif.
work=${DEMO_DIR:-/tmp/todomd-web-demo}
port=${DEMO_PORT:-7999}
themes=${1:-dark light}
server=""

cleanup() {
  [ -n "$server" ] && kill "$server" 2>/dev/null || true
  agent-browser close >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

rm -rf "$work"
mkdir -p "$work/bin"
# The UI bundle is committed, so this needs no npm build.
go build -o "$work/bin/todomd-web" "$repo"

if curl -fsS "http://127.0.0.1:$port/api/config" >/dev/null 2>&1; then
  echo "port $port is already in use — stop it or set DEMO_PORT" >&2
  exit 1
fi

record_theme() {
  theme=$1
  out=$2

  # Fresh board *and* fresh state dir per theme: change cursors left over from
  # the previous run would badge half the board before the demo starts.
  rm -rf "$work/state" "$work/TODO.md"
  mkdir -p "$work/state"
  export XDG_STATE_HOME="$work/state"

  task=$(sh "$here/seed.sh" "$work/TODO.md")

  "$work/bin/todomd-web" --file "$work/TODO.md" --port "$port" >"$work/server.log" 2>&1 &
  server=$!
  until curl -fsS "http://127.0.0.1:$port/api/board" >/dev/null 2>&1; do sleep 0.2; done
  # …and make sure it is *our* server answering, not a leftover on the same
  # port serving someone else's file (which silently records the wrong board).
  serving=$(curl -fsS "http://127.0.0.1:$port/api/config" | sed -n 's/.*"file":"\([^"]*\)".*/\1/p')
  if [ "$serving" != "$work/TODO.md" ]; then
    echo "port $port is serving $serving, not $work/TODO.md" >&2
    exit 1
  fi

  rm -f "$work/demo.webm"
  node "$here/drive.mjs" \
    --url "http://127.0.0.1:$port/" \
    --file "$work/TODO.md" \
    --task "$task" \
    --theme "$theme" \
    --trim "$work/trim.txt" \
    --video "$work/demo.webm"

  # Wait for the webm to stop growing: the recorder finalises it asynchronously
  # and converting a half-written file yields a two-frame gif.
  last=0
  while :; do
    size=$(wc -c <"$work/demo.webm" 2>/dev/null || echo 0)
    [ "$size" -gt 0 ] && [ "$size" -eq "$last" ] && break
    last=$size
    sleep 0.5
  done

  # The recording context decides the video size up front; if it did not take
  # the viewport, the board is cropped and the gif is quietly wrong.
  size=$(ffprobe -v error -show_entries stream=width,height -of csv=p=0 "$work/demo.webm")
  if [ "$size" != "1000,620" ]; then
    echo "recorded at $size, expected 1000,620 — the viewport did not apply" >&2
    exit 1
  fi

  # The driver reports how much of the head is setup (first paint in the
  # wrong theme, then the reload that fixes it); cut exactly that much.
  trim=$(cat "$work/trim.txt")

  # 860px wide at 10fps: readable in a README at well under a megabyte;
  # palettegen/paletteuse avoid the smeared colours of a naive conversion.
  # Trimming happens in the filter chain: the recorder's webm has loose
  # timestamps, and input seeking (-ss before -i) writes an empty gif.
  ffmpeg -loglevel error -y -i "$work/demo.webm" \
    -vf "trim=start=$trim,setpts=PTS-STARTPTS,fps=10,scale=860:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" \
    -loop 0 "$out"

  kill "$server" 2>/dev/null || true
  wait "$server" 2>/dev/null || true
  server=""
  # The port needs a moment before the next theme's server can claim it.
  until ! curl -fsS "http://127.0.0.1:$port/api/config" >/dev/null 2>&1; do sleep 0.2; done

  echo "wrote $out ($(du -h "$out" | cut -f1))"
}

for theme in $themes; do
  case "$theme" in
    dark) record_theme dark "$repo/docs/demo.gif" ;;
    light) record_theme light "$repo/docs/demo-light.gif" ;;
    *) echo "unknown theme: $theme (want dark or light)" >&2; exit 1 ;;
  esac
done
