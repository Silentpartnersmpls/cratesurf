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
# Only bin/node is copied. npm, corepack and the headers are for building things
# on the device, which nothing here does. The version and its sha256 are pinned so
# an upstream re-release cannot change what runs on the device unnoticed, and the
# download is checked before anything is copied across.
#
# Idempotent: if the device already has the pinned version, this does nothing.
set -eu

HOST=${MPC_HOST:-root@mpc-one-mk2}
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -o BatchMode=yes -o StrictHostKeyChecking=no"

VERSION=v22.23.4
SHA256=c9057c6a3b8fbb9651ed115c1e96d4a7281b7b9c9ca89fa05865c98ed7ffd437
DIR=/data/browser/node
PKG=node-$VERSION-linux-armv7l

have=$($SSH "$HOST" "'$DIR/bin/node' --version 2>/dev/null || true" | tr -d '\r')
if [ "$have" = "$VERSION" ]; then
  echo "node $VERSION already installed at $DIR"
  exit 0
fi
[ -z "$have" ] || echo "replacing node $have with $VERSION"

# Keep the tarball between runs: a failed scp halfway through should not mean
# downloading 25 MB again.
CACHE=${TMPDIR:-/tmp}/$PKG.tar.xz
if [ ! -f "$CACHE" ]; then
  echo "+ downloading $PKG (~25 MB)"
  curl -fsSL -o "$CACHE.part" "https://nodejs.org/dist/$VERSION/$PKG.tar.xz" || {
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
  echo "FAIL: $CACHE is not a node-vX-linux-armv7l tarball"
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
[ "$got" = "$VERSION" ] || { echo "FAIL: device reports '$got', expected $VERSION"; exit 1; }

size=$($SSH "$HOST" "du -h $DIR/bin/node | cut -f1" | tr -d '\r')
echo "node $got installed at $DIR/bin/node ($size)"
