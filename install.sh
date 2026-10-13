#!/bin/bash
# Install or update Pixname on macOS:
#   curl -fsSL https://raw.githubusercontent.com/Pixwel/pixname/main/install.sh | bash
#
# Downloading with curl (rather than a browser) means macOS doesn't quarantine the app,
# so it opens without the "could not verify" prompt.
set -euo pipefail

URL="https://github.com/Pixwel/pixname/releases/latest/download/Pixname_universal.app.tar.gz"
DIR="${INSTALL_DIR:-/Applications}"

if [ "$(uname)" != "Darwin" ]; then
  echo "This installer is for macOS. On Windows, download:" >&2
  echo "  https://github.com/Pixwel/pixname/releases/latest/download/Pixname_x64-setup.exe" >&2
  exit 1
fi

# Standard (non-admin) users can't write to /Applications.
if [ ! -w "$DIR" ]; then
  DIR="$HOME/Applications"
  mkdir -p "$DIR"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Pixname…"
curl -fsSL "$URL" | tar -xz -C "$TMP"

osascript -e 'quit app "Pixname"' >/dev/null 2>&1 || true
rm -rf "$DIR/Pixname.app"
mv "$TMP/Pixname.app" "$DIR/Pixname.app"

VERSION="$(defaults read "$DIR/Pixname.app/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo "?")"
echo "Installed Pixname $VERSION to $DIR"

if ! command -v ffprobe >/dev/null 2>&1 && [ ! -x /opt/homebrew/bin/ffprobe ] && [ ! -x /usr/local/bin/ffprobe ]; then
  echo
  echo "Note: ffprobe wasn't found. Pixname needs it to read codec, resolution and frame rate."
  if command -v brew >/dev/null 2>&1; then
    echo "Install it with:  brew install ffmpeg"
  else
    echo "Install Homebrew (https://brew.sh), then run:  brew install ffmpeg"
  fi
fi

open "$DIR/Pixname.app"
