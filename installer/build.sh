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
#   PAYLOAD_URL_ARMHF=https://... PAYLOAD_SHA256_ARMHF=... \
#   PAYLOAD_URL_ARM64=https://... PAYLOAD_SHA256_ARM64=... ./build.sh
#
# bakes the release locations into the binaries. The installer chooses the armhf
# or arm64 payload after probing the device. The old PAYLOAD_URL/PAYLOAD_SHA256
# names still mean "armhf", so an older release command keeps working. Without
# them the build still works, but it will tell the user to pass --payload with a
# local file.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/build
NAME=cratesurf-installer
GO=${GO:-go}
VERSION=${VERSION:-0.1.0}

# Accept the old single-payload names as the armhf pair.
PAYLOAD_URL_ARMHF=${PAYLOAD_URL_ARMHF:-${PAYLOAD_URL:-}}
PAYLOAD_SHA256_ARMHF=${PAYLOAD_SHA256_ARMHF:-${PAYLOAD_SHA256:-}}
PAYLOAD_URL_ARM64=${PAYLOAD_URL_ARM64:-}
PAYLOAD_SHA256_ARM64=${PAYLOAD_SHA256_ARM64:-}

LDFLAGS="-s -w -X main.version=$VERSION"
if [ -n "$PAYLOAD_SHA256_ARMHF" ]; then
  LDFLAGS="$LDFLAGS -X main.payloadSHA256ARMHF=$PAYLOAD_SHA256_ARMHF"
  # Keep the legacy symbol populated too, for anyone building an older branch
  # against this tree.
  LDFLAGS="$LDFLAGS -X main.payloadSHA256=$PAYLOAD_SHA256_ARMHF"
fi
if [ -n "$PAYLOAD_URL_ARMHF" ]; then
  LDFLAGS="$LDFLAGS -X main.payloadURLARMHF=$PAYLOAD_URL_ARMHF"
  LDFLAGS="$LDFLAGS -X main.payloadURL=$PAYLOAD_URL_ARMHF"
fi
if [ -n "$PAYLOAD_SHA256_ARM64" ]; then
  LDFLAGS="$LDFLAGS -X main.payloadSHA256ARM64=$PAYLOAD_SHA256_ARM64"
fi
if [ -n "$PAYLOAD_URL_ARM64" ]; then
  LDFLAGS="$LDFLAGS -X main.payloadURLARM64=$PAYLOAD_URL_ARM64"
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
