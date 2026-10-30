#!/bin/sh
# Build the CrateSurf installer for every platform it claims to support.
#
#   ./build.sh                 build all targets into build/
#   ./build.sh linux           build one GOOS
#
# CGO is off on purpose: the SSH client is pure Go, so each of these is a single
# static binary that runs on a machine with nothing installed on it. That is the
# entire point of the thing.
#
#   PAYLOAD_URL=https://... PAYLOAD_SHA256=... ./build.sh
#
# bakes the release location into the binaries. Without them the build still
# works, but it will tell the user to pass --payload with a local file.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/build
NAME=cratesurf-installer
GO=${GO:-go}
VERSION=${VERSION:-0.1.0}

LDFLAGS="-s -w -X main.version=$VERSION"
if [ -n "${PAYLOAD_SHA256:-}" ]; then
  LDFLAGS="$LDFLAGS -X main.payloadSHA256=$PAYLOAD_SHA256"
fi
if [ -n "${PAYLOAD_URL:-}" ]; then
  LDFLAGS="$LDFLAGS -X main.payloadURL=$PAYLOAD_URL"
fi

mkdir -p "$OUT"
cd "$HERE"

build() {
  os=$1
  arch=$2
  ext=""
  [ "$os" = "windows" ] && ext=".exe"
  printf '%-14s ' "$os/$arch"
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch "$GO" build -trimpath -ldflags "$LDFLAGS" \
    -o "$OUT/$NAME-$os-$arch$ext" . || { echo FAILED; return 1; }
  echo "ok  $(du -h "$OUT/$NAME-$os-$arch$ext" | cut -f1)"
}

if [ $# -gt 0 ]; then
  case "$1" in
    windows) build windows amd64 ;;
    macos|darwin) build darwin amd64; build darwin arm64 ;;
    linux) build linux amd64; build linux arm64 ;;
    *) echo "usage: $0 [windows|macos|linux]"; exit 2 ;;
  esac
else
  build windows amd64
  build darwin amd64
  build darwin arm64
  build linux amd64
  build linux arm64
fi

echo
echo "built into $OUT"
