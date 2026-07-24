#!/bin/sh
# Install (or update to) the latest todomd-web release into ~/.local/bin:
#
#   curl -fsSL https://raw.githubusercontent.com/walm/todomd-web/main/install.sh | sh
#
# Override the destination with TODOMD_WEB_INSTALL_DIR.
#
# todomd-web drives the todomd CLI, so install that too:
#   curl -fsSL https://raw.githubusercontent.com/walm/todomd/main/install.sh | sh
set -eu

REPO="walm/todomd-web"
BIN="todomd-web"
INSTALL_DIR="${TODOMD_WEB_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux)  os="linux" ;;
  *) echo "$BIN: unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64)  arch="amd64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "$BIN: unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
if [ -z "$tag" ]; then
  echo "$BIN: could not determine the latest release" >&2
  exit 1
fi
version="${tag#v}"

asset="${BIN}_${version}_${os}_${arch}.tar.gz"
base="https://github.com/$REPO/releases/download/$tag"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

echo "downloading $BIN $tag ($os/$arch)…"
curl -fsSL "$base/$asset" -o "$tmp/$asset"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp" && grep " $asset\$" checksums.txt | sha256sum -c - >/dev/null)
elif command -v shasum >/dev/null 2>&1; then
  (cd "$tmp" && grep " $asset\$" checksums.txt | shasum -a 256 -c - >/dev/null)
else
  echo "$BIN: no sha256 tool found, skipping checksum verification" >&2
fi

tar -xzf "$tmp/$asset" -C "$tmp" "$BIN"
mkdir -p "$INSTALL_DIR"
mv "$tmp/$BIN" "$INSTALL_DIR/$BIN"
chmod +x "$INSTALL_DIR/$BIN"

echo "installed $("$INSTALL_DIR/$BIN" --version) to $INSTALL_DIR/$BIN"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) echo "note: $INSTALL_DIR is not in your PATH — add it with:" >&2
     echo "  export PATH=\"$INSTALL_DIR:\$PATH\"" >&2 ;;
esac

if ! command -v todomd >/dev/null 2>&1; then
  echo "note: todomd is not installed — todomd-web needs it. Install it with:" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/walm/todomd/main/install.sh | sh" >&2
fi
