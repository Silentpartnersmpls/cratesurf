#!/bin/sh
# Put a Node runtime on the MPC, at the path CrateSurf owns.
#   ./deploy/install-node.sh                 uses MPC_HOST
#   MPC_HOST=root@ip ./deploy/install-node.sh
#
# The toggle, the launcher, the exit endpoint and the recorder are Node scripts,
# and the MPC firmware ships no Node of its own. Until now this project used a
# runtime another project happened to leave at /data/mpc-agent/runtime/node/bin/
# node, which meant CrateSurf did not work on a device that did not also have
# that other project installed. The runtime is now this project's own dependency,
# installed by this script, at /data/browser/node/bin/node.
#
# The architecture is read from the device, not assumed: Gen 1 is armv7l and
# Gen 2 is arm64. Binaries for the wrong CPU land fine and fail at exec, so the
# version is verified on the device at the end.
#
# Only bin/node is copied. npm, corepack and the headers are for building things
# on the device, which nothing here does. The version and its sha256 are pinned so
# an upstream re-release cannot change what runs on the device unnoticed, and the
# download is checked before anything is copied across.
#
# Idempotent: if the device already has the pinned version, this does nothing.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/node-pins.sh"

HOST=${MPC_HOST:-root@mpc-one-mk2}
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -o BatchMode=yes -o StrictHostKeyChecking=no"
DIR=/data/browser/node

remote_arch=$($SSH "$HOST" "uname -m 2>/dev/null" | tr -d '\r')
case "$remote_arch" in
  armv7l|armv7|armhf)
    NODE_ARCH=$NODE_ARCH_ARMHF
    SHA256=$NODE_SHA256_ARMHF
    ;;
  aarch64|arm64)
    NODE_ARCH=$NODE_ARCH_ARM64
    SHA256=$NODE_SHA256_ARM64
    ;;
  *)
    echo "FAIL: $HOST reports architecture '$remote_arch'; expected armv7l or aarch64"
    exit 1
    ;;
esac

have=$($SSH "$HOST" "'$DIR/bin/node' --version 2>/dev/null || true" | tr -d '\r')
if [ "$have" = "$NODE_VERSION" ]; then
  echo "node $NODE_VERSION ($NODE_ARCH) already installed at $DIR"
  exit 0
fi
[ -z "$have" ] || echo "replacing node $have with $NODE_VERSION ($NODE_ARCH)"

PKG=node-$NODE_VERSION-linux-$NODE_ARCH

# Keep the tarball between runs: a failed scp halfway through should not mean
# downloading 25 MB again. The architecture is in the filename, so the armhf and
# arm64 runtimes can coexist in the cache.
CACHE=${TMPDIR:-/tmp}/$PKG.tar.xz
if [ ! -f "$CACHE" ]; then
  echo "+ downloading $PKG (~25 MB)"
  curl -fsSL -o "$CACHE.part" "https://nodejs.org/dist/$NODE_VERSION/$PKG.tar.xz" || {
    rm -f "$CACHE.part"
    echo "FAIL: could not download $PKG from nodejs.org"
    exit 1
  }
  mv "$CACHE.part" "$CACHE"
fi

echo "$SHA256  $CACHE" | sha256sum -c - >/dev/null || {
  rm -f "$CACHE"
  echo "FAIL: $CACHE does not match the pinned sha256 (deleted, run again)"
  exit 1
}

EXTRACT=$(mktemp -d)
trap 'rm -rf "$EXTRACT"' EXIT
tar -xJf "$CACHE" -C "$EXTRACT" "$PKG/bin/node" "$PKG/LICENSE" 2>/dev/null || {
  echo "FAIL: $CACHE is not a $PKG tarball"
  exit 1
}

echo "+ copying node to $HOST:$DIR"
$SSH "$HOST" "mkdir -p $DIR/bin"
$SCP "$EXTRACT/$PKG/bin/node" "$HOST:$DIR/bin/node"
$SCP "$EXTRACT/$PKG/LICENSE" "$HOST:$DIR/LICENSE"
$SSH "$HOST" "chmod 755 $DIR/bin/node"

# "It copied" is not "it runs": a binary built for a different CPU or libc lands
# fine and dies on exec, so ask the device.
got=$($SSH "$HOST" "$DIR/bin/node --version" | tr -d '\r')
[ "$got" = "$NODE_VERSION" ] || { echo "FAIL: device reports '$got', expected $NODE_VERSION"; exit 1; }

size=$($SSH "$HOST" "du -h $DIR/bin/node | cut -f1" | tr -d '\r')
echo "node $got ($NODE_ARCH) installed at $DIR/bin/node ($size)"
