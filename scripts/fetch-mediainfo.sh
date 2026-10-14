#!/usr/bin/env bash
# Fetch the MediaInfo CLI that release builds bundle (see src-tauri/tauri.mediainfo.conf.json).
# Puts the binary in src-tauri/binaries/ under Tauri's sidecar names (mediainfo-<target-triple>),
# plus its license. Runs on macOS and on Windows (Git Bash). Pinned and checksummed.
set -euo pipefail

VERSION="26.05"
MAC_SHA256="507605a7c8f1054a6996d99a4ef5b5a0711cfbf2f8ca2ef5161d6ee701ea8015"
WIN_SHA256="f7f80620ce6d14f4995f0de6f98e3ef18ad29496db01899571152ee3311229f9"
BASE="https://mediaarea.net/download/binary/mediainfo/${VERSION}"

root="$(cd "$(dirname "$0")/.." && pwd)"
out="${root}/src-tauri/binaries"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$out"

verify() { # file expected-sha256
  local actual
  if command -v sha256sum >/dev/null; then actual=$(sha256sum "$1" | cut -d' ' -f1)
  else actual=$(shasum -a 256 "$1" | cut -d' ' -f1); fi
  if [ "$actual" != "$2" ]; then
    echo "Checksum mismatch for $1: got $actual, expected $2" >&2
    exit 1
  fi
}

case "$(uname -s)" in
  Darwin)
    dmg="${work}/mediainfo.dmg"
    curl -fsSL "${BASE}/MediaInfo_CLI_${VERSION}_Mac.dmg" -o "$dmg"
    verify "$dmg" "$MAC_SHA256"
    hdiutil attach -nobrowse -readonly -mountpoint "${work}/mnt" "$dmg" >/dev/null
    pkgutil --expand-full "${work}/mnt/mediainfo.pkg" "${work}/pkg" >/dev/null
    cp "${work}/mnt/License.html" "${out}/MediaInfo-License.html"
    hdiutil detach "${work}/mnt" -quiet
    bin="${work}/pkg/Payload/usr/local/bin/mediainfo"
    # One universal binary serves every macOS target, including Tauri's universal build.
    for triple in aarch64-apple-darwin x86_64-apple-darwin universal-apple-darwin; do
      cp "$bin" "${out}/mediainfo-${triple}"
      chmod +x "${out}/mediainfo-${triple}"
    done
    ;;
  MINGW* | MSYS* | CYGWIN*)
    zip="${work}/mediainfo.zip"
    curl -fsSL "${BASE}/MediaInfo_CLI_${VERSION}_Windows_x64.zip" -o "$zip"
    verify "$zip" "$WIN_SHA256"
    # MediaInfo.exe only loads LIBCURL.DLL for URLs, which Pixname never passes.
    unzip -oqj "$zip" MediaInfo.exe License.html -d "$work"
    cp "${work}/MediaInfo.exe" "${out}/mediainfo-x86_64-pc-windows-msvc.exe"
    cp "${work}/License.html" "${out}/MediaInfo-License.html"
    ;;
  *)
    echo "No bundled MediaInfo for $(uname -s)" >&2
    exit 1
    ;;
esac

echo "MediaInfo ${VERSION} ready in ${out}"
ls -la "$out"
