#!/bin/bash
# Build a Debian sysroot the browser runs in, then ship it to the MPC.
#
# Two generations, one builder:
#   Gen 1  ARCH=armhf DISTRO=bookworm   (default; RK3288, armv7l)
#   Gen 2  ARCH=arm64 DISTRO=trixie    (RK3588, aarch64, Mesa/panthor)
#
# The MPC's OS has no package manager, no X, no Wayland, no GTK and no SDL. It does
# have a modern kernel, and the chroot carries its own libc, so Debian packages for
# the matching architecture run unmodified. This builds a chroot out of .deb
# packages and copies it to /data.
#
# Why a chroot rather than LD_LIBRARY_PATH: weston locates its modules, and
# Chromium its resources, by absolute compiled-in paths. A chroot makes those
# paths true. The device's own rootfs is never modified.
#
# Sandbox apt: no system packages are installed and no foreign architecture is
# registered on this PC. Everything lands in $WORK. The source is marked
# trusted=yes because only the Debian archive keyring is missing here; traffic is
# still over https to deb.debian.org.
#
# Build both without clobbering one another:
#   WORK=/tmp/mpcsys-armhf ./build-sysroot.sh
#   WORK=/tmp/mpcsys-arm64 ARCH=arm64 DISTRO=trixie ./build-sysroot.sh
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ARCH=${ARCH:-armhf}
DISTRO=${DISTRO:-bookworm}
WORK=${WORK:-/tmp/mpcsys}
HOST=${MPC_HOST:-root@mpc-one-mk2}
DEST=/data/browser/sysroot
CACHE_ONLY=${CACHE_ONLY:-0}

case "$ARCH" in
  armhf|armv7l|armv7) DEB_ARCH=armhf ;;
  arm64|aarch64)      DEB_ARCH=arm64 ;;
  *)
    echo "FAIL: ARCH must be armhf (or armv7l) or arm64 (or aarch64), not '$ARCH'" >&2
    exit 2
    ;;
esac

case "$DISTRO" in
  bookworm|trixie) ;;
  *)
    echo "FAIL: DISTRO must be bookworm or trixie, not '$DISTRO'" >&2
    exit 2
    ;;
esac

# Gen 2 needs the Mesa DRI/EGL userspace for panthor. The Gen 1 bookworm sysroot
# intentionally keeps the smaller package set it has always shipped with.
EXTRA_PACKAGES=
if [ "$DEB_ARCH" = arm64 ]; then
  EXTRA_PACKAGES="libgl1-mesa-dri libegl1"
fi

APT=(
  apt-get
  -o Dir::State="$WORK/var/lib/apt"
  -o Dir::State::status="$WORK/var/lib/apt/lists/status"
  -o Dir::Cache="$WORK/var/cache/apt"
  -o Dir::Etc="$WORK/etc/apt"
  -o Dir::Etc::sourcelist="$WORK/etc/apt/sources.list"
  -o Dir::Etc::sourceparts="$WORK/etc/apt/sources.list.d"
  -o APT::Architecture="$DEB_ARCH"
  -o APT::Architectures::="$DEB_ARCH"
  -o APT::Sandbox::User=root
  -o APT::Get::Download-Only=true
)

# chromium + weston, plus the runtime bits a chroot needs that a package
# dependency chain does not express: the C library itself, a shell, coreutils,
# grep/sed, and seatd (weston 10 on Debian has no weston-launch).
# dmz-cursor-theme is what puts an actual arrow on screen once a mouse is plugged
# in: weston finds cursor images by theme name under /usr/share/icons and shows
# nothing at all when no theme resolves.
#
# pulseaudio is not optional: Chromium on Linux has no ALSA backend at all, it
# speaks PulseAudio and nothing else. Without a sink, every <audio> element and
# every embedded player stays silent with no error anywhere. alsa-utils brings
# amixer, which is how the codec's mixer is checked and set from inside the
# chroot (the MPC's own rootfs has no amixer).
#
# The mesa packages are added for arm64 only (see EXTRA_PACKAGES above).
PACKAGES="chromium weston xkb-data dmz-cursor-theme fonts-dejavu-core fontconfig
          libc6 libc-bin libgcc-s1 dash coreutils grep sed seatd libseat1
          pulseaudio pulseaudio-utils alsa-utils libasound2 $EXTRA_PACKAGES"

echo "== $DEB_ARCH / $DISTRO sandbox at $WORK"
rm -rf "$WORK"
mkdir -p "$WORK"/{etc/apt,var/lib/apt/lists/partial,var/cache/apt/archives/partial,root}
touch "$WORK/var/lib/apt/lists/status"
cat > "$WORK/etc/apt/sources.list" <<EOF
deb [arch=$DEB_ARCH trusted=yes] https://deb.debian.org/debian $DISTRO main
EOF

"${APT[@]}" update 2>&1 | tail -2
echo "== resolving and downloading"
# shellcheck disable=SC2086
"${APT[@]}" install --reinstall --no-install-recommends -y $PACKAGES 2>&1 | tail -3

echo "== unpacking"
mkdir -p "$WORK/root"
n=0
for d in "$WORK"/var/cache/apt/archives/*.deb; do
  dpkg-deb -x "$d" "$WORK/root"
  n=$((n + 1))
done
echo "$n packages unpacked"

# Docs, locales and icons are dead weight on a 7" kiosk; keeping them costs ~60 MB.
rm -rf "$WORK/root/usr/share/doc" "$WORK/root/usr/share/man" \
       "$WORK/root/usr/share/locale" "$WORK/root/usr/share/perl" \
       "$WORK/root/var/lib/dpkg" "$WORK/root/var/cache" "$WORK/root/etc/init.d"
# Keep the cursor theme, drop every other icon set (that is where the 60 MB of
# app icons lives). weston-up.sh asks for DMZ-White by name.
if [ -d "$WORK/root/usr/share/icons" ]; then
  find "$WORK/root/usr/share/icons" -mindepth 1 -maxdepth 1 ! -name 'DMZ-White' -exec rm -rf {} +
  ln -sfn DMZ-White "$WORK/root/usr/share/icons/default"
fi
find "$WORK/root" -name '*.a' -delete

# A chroot has no /etc/passwd of its own, and seatd refuses to start without a
# group database. These are minimal but valid.
# pulseaudio runs as root here (Chromium also runs as root), so it has to be
# started with --system, which makes it drop to the `pulse` user it finds in
# /etc/passwd. A missing pulse entry there kills the server before it opens the
# sink, and a missing audio membership means it cannot open /dev/snd at all.
cat > "$WORK/root/etc/passwd" <<'EOF'
root:x:0:0:root:/root:/bin/sh
pulse:x:998:998:PulseAudio:/var/run/pulse:/bin/sh
nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin
EOF
cat > "$WORK/root/etc/group" <<'EOF'
root:x:0:
video:x:44:
input:x:1000:
tty:x:5:
audio:x:29:pulse
render:x:107:
pulse:x:998:
pulse-access:x:999:pulse
EOF
printf 'passwd: files\ngroup: files\nhosts: files dns\n' > "$WORK/root/etc/nsswitch.conf"
printf '127.0.0.1 localhost\n' > "$WORK/root/etc/hosts"

du -sh "$WORK/root"

if [ "$CACHE_ONLY" = "1" ]; then
  echo "CACHE_ONLY=1: sysroot left at $WORK/root, nothing shipped"
  exit 0
fi

echo "== shipping to $HOST:$DEST"
ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$HOST" "mkdir -p $DEST"
tar -C "$WORK/root" -c . | gzip -1 | \
  ssh -o BatchMode=yes -o StrictHostKeyChecking=no "$HOST" "cd $DEST && tar xzf -"

echo "== done. now: ./deploy.sh && ./deploy/install-service.sh"
