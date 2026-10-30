#!/bin/sh
# Build the release payload: one tarball that unpacks into /data/browser.
#
#   ./make-payload.sh --from-device root@mpc-one-mk2
#   ./make-payload.sh --sysroot /tmp/mpcsys/root
#
# --from-device is the honest default: the tree on a unit that has been running
# is a tree that works on that firmware. Building from .debs gives you the same
# files in theory and a different Chromium build whenever Debian rolls one,
# which is how an installer ends up shipping a browser nobody has ever run.
#
# The output is named with the sha256 beside it, because the downloader refuses
# anything that does not match and a release with no checksum is a release with
# no check.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/.." && pwd)
OUT=${OUT:-$HERE/dist}
SRC_DEVICE=""
SYSROOT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --from-device) SRC_DEVICE=$2; shift 2 ;;
    --sysroot)     SYSROOT=$2; shift 2 ;;
    *) echo "usage: $0 --from-device root@ip | --sysroot /path/to/root"; exit 2 ;;
  esac
done

[ -n "$SRC_DEVICE" ] || [ -n "$SYSROOT" ] || {
  echo "usage: $0 --from-device root@ip | --sysroot /path/to/root"
  exit 2
}

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT" "$STAGE/node" "$STAGE/bin"

echo "== collecting the device side of the tree from $REPO"
cp "$REPO"/device/bin/*.sh "$REPO"/device/bin/*.js "$STAGE/bin/" 2>/dev/null || true
chmod +x "$STAGE"/bin/*.sh
# The unit the installer copies into /etc, and the script that puts it into the
# read-only rootfs. Both are read from /data/browser at install time, so they
# have to be in the tarball at exactly that path.
cp "$REPO/device/mpc-browse.service" "$STAGE/mpc-browse.service"
cp "$REPO/deploy/install-rootfs-unit.sh" "$STAGE/install-rootfs-unit.sh"
chmod +x "$STAGE/install-rootfs-unit.sh"

if [ -n "$SRC_DEVICE" ]; then
  SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no"
  echo "== pulling the sysroot from $SRC_DEVICE (this is the slow part)"
  # --exclude for every bind mount: those are the host's /proc, /dev and
  # /media mounted inside the chroot, and archiving them either fails or
  # produces a tarball full of somebody else's device nodes.
  $SSH "$SRC_DEVICE" 'cd /data/browser && tar cf - --exclude=./run \
      --exclude=./sysroot/root/chrome-profile --exclude=./sysroot/tmp \
      --exclude=./sysroot/proc --exclude=./sysroot/sys --exclude=./sysroot/dev \
      --exclude=./sysroot/downloads --exclude=./sysroot/media \
      --exclude=./sysroot/run ./sysroot ./node' | tar -C "$STAGE" -xf -
else
  echo "== staging the sysroot from $SYSROOT"
  mkdir -p "$STAGE/sysroot"
  cp -a "$SYSROOT"/. "$STAGE/sysroot/"
  rm -rf "$STAGE/sysroot/proc" "$STAGE/sysroot/sys" "$STAGE/sysroot/dev" \
         "$STAGE/sysroot/root/chrome-profile" "$STAGE/sysroot/tmp"
  echo "note: the Node runtime is not in a sysroot build."
  echo "      run deploy/install-node.sh against the device, or copy node/ in by hand."
fi

[ -x "$STAGE/node/bin/node" ] || echo "warn: no node/bin/node in the payload"
[ -x "$STAGE/sysroot/usr/lib/chromium/chromium" ] || echo "warn: no chromium binary in the payload"

NAME=${NAME:-cratesurf-payload}
VER=$(date +%Y%m%d)
TGZ="$OUT/$NAME-$VER.tar.gz"
echo "== packing"
tar -C "$STAGE" -czf "$TGZ" .
( cd "$OUT" && sha256sum "$(basename "$TGZ")" > "$(basename "$TGZ").sha256" )

du -h "$TGZ" | awk '{print "== " $1 "  " $2}'
cat "$TGZ.sha256"
echo
echo "publish that file and its .sha256, then build the installer with:"
echo "  PAYLOAD_URL=<url> PAYLOAD_SHA256=<sha> ./build.sh"
