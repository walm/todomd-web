#!/bin/sh
# Re-record docs/demo.gif. Requires: go, node, todomd, agent-browser, ffmpeg.
#   sh docs/demo/record.sh
#
# Everything happens in a temp dir against a scratch TODO.md; nothing outside
# it and docs/demo.gif is touched.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
# A fixed, tidy path: the board's header shows the file's directory, and
# mktemp's /var/folders/... noise would end up in the gif.
work=${DEMO_DIR:-/tmp/todomd-web-demo}
port=${DEMO_PORT:-7999}
server=""

cleanup() {
  [ -n "$server" ] && kill "$server" 2>/dev/null || true
  agent-browser close >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

rm -rf "$work"
mkdir -p "$work/bin" "$work/state"
# The UI bundle is committed, so this needs no npm build.
go build -o "$work/bin/todomd-web" "$repo"

# Keep the demo's change cursors and locks out of the real state dir, or the
# unread badges would depend on whatever the recorder did earlier today.
export XDG_STATE_HOME="$work/state"

if curl -fsS "http://127.0.0.1:$port/api/config" >/dev/null 2>&1; then
  echo "port $port is already in use — stop it or set DEMO_PORT" >&2
  exit 1
fi

task=$(sh "$here/seed.sh" "$work/TODO.md")

"$work/bin/todomd-web" --file "$work/TODO.md" --port "$port" >"$work/server.log" 2>&1 &
server=$!
until curl -fsS "http://127.0.0.1:$port/api/board" >/dev/null 2>&1; do sleep 0.2; done
# …and make sure it is *our* server answering, not a leftover on the same port
# serving someone else's file (which silently records the wrong board).
serving=$(curl -fsS "http://127.0.0.1:$port/api/config" | sed -n 's/.*"file":"\([^"]*\)".*/\1/p')
if [ "$serving" != "$work/TODO.md" ]; then
  echo "port $port is serving $serving, not $work/TODO.md" >&2
  exit 1
fi

node "$here/drive.mjs" \
  --url "http://127.0.0.1:$port/" \
  --file "$work/TODO.md" \
  --task "$task" \
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

# 860px wide at 10fps: readable in a README at half a megabyte;
# palettegen/paletteuse avoid the smeared colours of a naive conversion.
ffmpeg -loglevel error -y -i "$work/demo.webm" \
  -vf "fps=10,scale=860:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" \
  -loop 0 "$repo/docs/demo.gif"

echo "wrote $repo/docs/demo.gif ($(du -h "$repo/docs/demo.gif" | cut -f1))"
