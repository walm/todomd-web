#!/bin/sh
# Render web/public/favicon.svg to the PNGs iOS and Android want. Requires
# agent-browser (the demo recorder already needs it) — headless Chrome is the
# one renderer that is definitely on this machine and definitely agrees with
# what a browser will show.
#
#   sh docs/icon/make.sh
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
svg="$repo/web/public/favicon.svg"
work=$(mktemp -d)
trap 'rm -rf "$work"; agent-browser close >/dev/null 2>&1 || true' EXIT INT TERM

# A page that is nothing but the icon, so a screenshot is the icon.
{
  echo '<!doctype html><meta charset="utf-8">'
  echo '<style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block;width:100vw;height:100vw}</style>'
  cat "$svg"
} >"$work/icon.html"

agent-browser open >/dev/null
for size in 180 192 512 logo; do
  case $size in
    180)  out="$repo/web/public/apple-touch-icon.png" ;;  # iOS home screen
    logo) out="$repo/docs/logo.png"; size=512 ;;          # the README header
    *)    out="$repo/web/public/icon-$size.png" ;;        # web app manifest
  esac
  agent-browser set viewport "$size" "$size" >/dev/null
  agent-browser open "file://$work/icon.html" >/dev/null
  agent-browser screenshot "$out" >/dev/null
  echo "wrote $out (${size}x${size})"
done
