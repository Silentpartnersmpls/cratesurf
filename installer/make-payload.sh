#!/bin/sh
# Build the release payload: one tarball that unpacks into /data/browser.
#
#   ./make-payload.sh --release --sysroot /tmp/mpcsys/root
#   ./make-payload.sh --from-device root@mpc-one-mk2      (internal only)
#
# --release is what goes to other people. It builds from a sysroot that came out
# of build-sysroot.sh plus the files in git plus the pinned Node download, so the
# artifact is reproducible from things in the repository and nothing else. That
# matters for privacy as much as for reproducibility: a payload pulled off a
# working unit is a snapshot of somebody's filesystem, and "nothing personal was
# in it this time" is not a property you want to rely on for every release.
#
# --from-device is for testing a build of the scripts against a unit we are
# sitting in front of. It is not the release path and it says so.
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
ARCH=${ARCH:-armv7l}
. "$REPO/deploy/node-pins.sh"

case "$ARCH" in
  armv7l|armv7|armhf)
    NODE_ARCH=$NODE_ARCH_ARMHF
    NODE_SHA=$NODE_SHA256_ARMHF
    DEFAULT_NAME=cratesurf-payload
    ;;
  aarch64|arm64)
    NODE_ARCH=$NODE_ARCH_ARM64
    NODE_SHA=$NODE_SHA256_ARM64
    DEFAULT_NAME=cratesurf-payload-arm64
    ;;
  *)
    echo "FAIL: ARCH must be armv7l (or armhf) or aarch64 (or arm64), not '$ARCH'" >&2
    exit 2
    ;;
esac

RELEASE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --release)     RELEASE=1; shift ;;
    --from-device) SRC_DEVICE=$2; shift 2 ;;
    --sysroot)     SYSROOT=$2; shift 2 ;;
    *) echo "usage: $0 --release --sysroot DIR | --from-device root@ip"; exit 2 ;;
  esac
done

[ -n "$SRC_DEVICE" ] || [ -n "$SYSROOT" ] || {
  echo "usage: $0 --release --sysroot DIR | --from-device root@ip"
  exit 2
}

if [ "$RELEASE" = "1" ] && [ -n "$SRC_DEVICE" ]; then
  echo "FAIL: --release builds from a sysroot, not from a device"
  echo "      a payload pulled off a unit is a snapshot of that unit"
  exit 1
fi

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
# Gen 2 boots this from /data/mpc-addins/cratesurf-browse/install.sh; the
# installer copies it there when the probe reports aarch64.
cp "$REPO/device/mpc-gen2-hook.sh" "$STAGE/mpc-gen2-hook.sh"
chmod +x "$STAGE/mpc-gen2-hook.sh"

if [ -n "$SRC_DEVICE" ]; then
  SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no"
  echo "== INTERNAL BUILD: pulling the sysroot from $SRC_DEVICE"
  echo "   this is a snapshot of that unit. Do not publish it."
  # --exclude for every bind mount: those are the host's /proc, /dev and
  # /media mounted inside the chroot, and archiving them either fails or
  # produces a tarball full of somebody else's device nodes.
  # var/run is excluded for a different reason: it holds the PulseAudio cookie
  # from a live session on that device, which has no business in a public file.
  $SSH "$SRC_DEVICE" 'cd /data/browser && tar cf - --exclude=./run \
      --exclude=./sysroot/root/chrome-profile --exclude=./sysroot/tmp \
      --exclude=./sysroot/proc --exclude=./sysroot/sys --exclude=./sysroot/dev \
      --exclude=./sysroot/downloads --exclude=./sysroot/media \
      --exclude=./sysroot/run --exclude=./sysroot/var/run \
      --exclude=./sysroot/var/log \
      ./sysroot ./node' | tar -C "$STAGE" -xf -
else
  echo "== staging the sysroot from $SYSROOT"
  [ -x "$SYSROOT/usr/lib/chromium/chromium" ] || {
    echo "FAIL: $SYSROOT has no chromium binary; is that a build-sysroot.sh CACHE_ONLY=1 tree?"
    exit 1
  }
  # A payload with an arm64 Node and an armhf Chromium (or the reverse) unpacks
  # cleanly and fails at launch. Catch a mismatched ARCH/sysroot here, while the
  # error still says which one is wrong. readelf is optional: the build machine
  # may not have binutils, and this is a guard, not a requirement.
  if command -v readelf >/dev/null 2>&1; then
    machine=$(readelf -h "$SYSROOT/usr/lib/chromium/chromium" 2>/dev/null |
      sed -n 's/^[[:space:]]*Machine:[[:space:]]*//p')
    case "$ARCH:$machine" in
      armv7l:ARM|armv7:ARM|armhf:ARM|aarch64:AArch64|arm64:AArch64) ;;
      *) echo "FAIL: the sysroot chromium is '$machine' but ARCH=$ARCH; build the matching sysroot first" >&2; exit 1 ;;
    esac
  fi
  mkdir -p "$STAGE/sysroot"
  cp -a "$SYSROOT"/. "$STAGE/sysroot/"
  # Same list as the device route, plus anything a build leaves behind.
  rm -rf "$STAGE/sysroot/proc" "$STAGE/sysroot/sys" "$STAGE/sysroot/dev" \
         "$STAGE/sysroot/root/chrome-profile" "$STAGE/sysroot/tmp" \
         "$STAGE/sysroot/run" "$STAGE/sysroot/var/run" "$STAGE/sysroot/var/log"

  # The Node runtime is not part of a sysroot, so fetch the pinned build from
  # nodejs.org using the version and checksum deploy/node-pins.sh already owns.
  # Two copies of that pin would drift, and the drift would be silent.
  [ -n "$NODE_VERSION" ] && [ -n "$NODE_SHA" ] || { echo "FAIL: no Node pin in deploy/node-pins.sh"; exit 1; }
  PKG=node-$NODE_VERSION-linux-$NODE_ARCH
  CACHE=${TMPDIR:-/tmp}/$PKG.tar.xz
  if [ ! -f "$CACHE" ]; then
    echo "== fetching $PKG"
    curl -fsSL -o "$CACHE.part" "https://nodejs.org/dist/$NODE_VERSION/$PKG.tar.xz" \
      || { rm -f "$CACHE.part"; echo "FAIL: could not download $PKG"; exit 1; }
    mv "$CACHE.part" "$CACHE"
  fi
  echo "$NODE_SHA  $CACHE" | sha256sum -c - >/dev/null || { rm -f "$CACHE"; echo "FAIL: pinned Node sha256 mismatch"; exit 1; }
  mkdir -p "$STAGE/node/bin"
  tar -xJf "$CACHE" -C "$STAGE/node" --strip-components=1 "$PKG/bin/node" "$PKG/LICENSE"
fi

# The sysroot is only the Debian half. The start page, the nav-bar extension and
# weston.ini live in the chroot at /opt and /etc/xdg, and a plain build-sysroot.sh
# tree has neither: deploy.sh has always copied them onto a device by hand, which is
# why a unit deployed to works and a payload built from a sysroot did not. Without
# these a fresh install comes up on a portrait panel with no rotation, no bar and
# nothing to serve at /home. Taken from the repo in both routes, so a payload always
# carries the files that belong to the commit it was built from.
echo "== staging the page, the bar and the weston config"
mkdir -p "$STAGE/sysroot/opt/kb-ext" "$STAGE/sysroot/etc/xdg/weston"
cp "$REPO"/device/ext/* "$STAGE/sysroot/opt/kb-ext/"
cp "$REPO"/device/home.html "$REPO"/device/calib.html "$REPO"/device/keys.html \
   "$REPO"/device/download-test.html "$STAGE/sysroot/opt/"
cp "$REPO/device/weston.ini" "$STAGE/sysroot/etc/xdg/weston/weston.ini"

# Both routes above leave sysroot/tmp out, because a tmp from a build or a device
# holds somebody's leftovers. The directory itself has to exist, though: Chromium
# aborts at launch without a /tmp for its singleton socket, and the 0.1.0-alpha
# payload shipped without one. An empty, sticky, world-writable tmp is the
# standard shape. browse-up.sh also creates it, for installs from older payloads.
mkdir -p "$STAGE/sysroot/tmp"
chmod 1777 "$STAGE/sysroot/tmp"

[ -x "$STAGE/node/bin/node" ] || echo "warn: no node/bin/node in the payload"
[ -d "$STAGE/sysroot/tmp" ] || { echo "FAIL: no sysroot/tmp in the payload"; exit 1; }
[ -f "$STAGE/sysroot/opt/home.html" ] || { echo "FAIL: no start page in the payload"; exit 1; }
[ -f "$STAGE/sysroot/opt/kb-ext/manifest.json" ] || { echo "FAIL: no nav bar in the payload"; exit 1; }
[ -f "$STAGE/sysroot/etc/xdg/weston/weston.ini" ] || { echo "FAIL: no weston.ini in the payload"; exit 1; }
[ -f "$STAGE/bin/board.sh" ] || { echo "FAIL: no board profile in the payload"; exit 1; }
[ -f "$STAGE/bin/board.js" ] || { echo "FAIL: no Node board profile in the payload"; exit 1; }
[ -f "$STAGE/mpc-gen2-hook.sh" ] || { echo "FAIL: no Gen 2 boot hook in the payload"; exit 1; }
[ -x "$STAGE/sysroot/usr/lib/chromium/chromium" ] || echo "warn: no chromium binary in the payload"

NAME=${NAME:-$DEFAULT_NAME}
VER=$(date +%Y%m%d)
TGZ="$OUT/$NAME-$VER.tar.gz"
echo "== packing $ARCH payload"
tar -C "$STAGE" -czf "$TGZ" .
( cd "$OUT" && sha256sum "$(basename "$TGZ")" > "$(basename "$TGZ").sha256" )

du -h "$TGZ" | awk '{print "== " $1 "  " $2}'
cat "$TGZ.sha256"
echo
echo "publish that file and its .sha256, then build the installer with:"
echo "  PAYLOAD_URL_ARMHF=<url> PAYLOAD_SHA256_ARMHF=<sha> \\"
echo "  PAYLOAD_URL_ARM64=<url> PAYLOAD_SHA256_ARM64=<sha> ./build.sh"
