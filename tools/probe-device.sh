#!/bin/sh
# probe-device.sh - read-only compatibility check for a device CrateSurf has never seen.
#
#   ./tools/probe-device.sh                 uses MPC_HOST, default root@mpc-one-mk2
#   MPC_HOST=root@192.168.1.50 ./tools/probe-device.sh
#
# It reads; it writes, mounts, stops and installs nothing. Every line it prints is a
# fact the project depends on, and the verdict at the end is whether this device has
# a shape CrateSurf knows how to install on: Gen 1 (MPC One+/Live II, RK3288) or
# Gen 2 (MPC XL/Live III, RK3588).
#
# Exit status: 0 shape matches, 1 something required did not match, 2 could not reach
# the device at all.
#
# SPDX-License-Identifier: MIT
set -u

HOST=${MPC_HOST:-root@mpc-one-mk2}
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=8"

echo "== CrateSurf device probe"
echo "   host: $HOST"
echo

# Everything runs in one round trip so a slow link costs one connect, not twenty.
# The remote half is POSIX sh: this firmware's userland is busybox.
ERR=$(mktemp 2>/dev/null || echo /tmp/cratesurf-probe.$$)
OUT=$($SSH "$HOST" 'sh -s' 2>"$ERR" <<'REMOTE'
say() { printf '%s|%s|%s\n' "$1" "$2" "$3"; }

model=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null)
compat=$(tr '\0' ' ' < /proc/device-tree/compatible 2>/dev/null)
say identity model "${model:-unknown}"
say identity board "${compat:-unknown}"
say identity kernel "$(uname -r)"
say identity machine "$(uname -m)"
case "$(uname -m)" in
  aarch64|arm64) GEN=2 ;;
  armv7l)        GEN=1 ;;
  *)             GEN=0 ;;
esac
say identity generation "gen$GEN"
say identity os "$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-$NAME}")"
say identity glibc "$(strings /lib/libc.so.6 2>/dev/null | sed -n 's/.*release version \([0-9][0-9.]*[0-9]\).*/\1/p' | sed -n 1p)"
# 3.10 stopped putting a version string in /usr/bin/MPC, so read the file the firmware
# writes to disk and keep the old strings scrape only as the 3.4.x fallback.
FW=$(sed -n 1p /usr/share/Akai/SME0/VERSION 2>/dev/null | tr -d '\r')
[ -n "$FW" ] || FW=$(strings /usr/bin/MPC 2>/dev/null | sed -n 's/^\(3\.[0-9.]*\) (.*/\1/p' | sed -n 1p)
say identity firmware "${FW:-not readable}"
# Two builds have been through this. Naming them is the only thing that separates a
# supported device from one nobody has tried, and the version is now readable here.
case "$FW" in
  3.4.2.13|3.10.0.49|3.9.1|'') ;;
  *) say require firmware "WARN $FW has not been run; 3.4.2.13/3.10.0.49 (Gen 1) and 3.9.1 (Gen 2) have" ;;
esac
say identity ssh_user "$(id -un) uid=$(id -u)"
say identity ram_mb "$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo)"
say identity cpus "$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo) online"

# Gen 1's sysroot is armv7 hard-float; Gen 2's is aarch64. The architecture is
# the hard boundary, so an unknown machine stops here rather than guessing.
m=$(uname -m)
case "$m" in
  armv7l)        say require arch "PASS armv7l (Gen 1)" ;;
  aarch64|arm64) say require arch "PASS $m (Gen 2)" ;;
  *)             say require arch "FAIL $m, CrateSurf has armv7l and aarch64 payloads" ;;
esac

g=$(strings /lib/libc.so.6 2>/dev/null | sed -n 's/.*release version \([0-9][0-9.]*[0-9]\).*/\1/p' | sed -n 1p)
gmaj=${g%%.*}; gmin=${g#*.}; gmin=${gmin%%.*}
if [ "$GEN" = 2 ]; then
  # The trixie chroot carries its own libc; the device's libc only has to run
  # chroot and Node, not the browser. Report it, do not gate on a bookworm floor.
  say require glibc "PASS ${g:-not detected} (chroot supplies its own libc)"
elif [ -n "$g" ] && { [ "${gmaj:-0}" -gt 2 ] || { [ "${gmaj:-0}" -eq 2 ] && [ "${gmin:-0}" -ge 36 ]; }; }; then
  say require glibc "PASS $g (bookworm needs 2.36)"
else
  say require glibc "FAIL ${g:-not detected}, needs 2.36 or newer"
fi

if [ "$(id -u)" = 0 ]; then
  say require root_shell "PASS"
else
  say require root_shell "FAIL not root, everything here installs as root"
fi

if command -v systemctl >/dev/null 2>&1; then
  if systemctl list-unit-files 2>/dev/null | grep -q '^acvs\.service'; then
    say require acvs "PASS $(systemctl is-active acvs 2>/dev/null)"
  else
    say require acvs "FAIL no acvs.service, which is the MPC app this has to stop"
  fi
  say identity systemd "$(systemctl --version 2>/dev/null | sed -n 1p)"
else
  say require acvs "FAIL no systemctl, this firmware is not the shape this was built for"
fi

# /data: Gen 1's chroot is ~775 MB; Gen 2's arm64 tree is larger. Leave room for
# the browser profile and the MPC's own documents either way.
need_kb=1048576
[ "$GEN" = 2 ] && need_kb=1572864
if [ -d /data ]; then
  free=$(df -k /data 2>/dev/null | awk 'NR==2 {print $4}')
  say require data_space "PASS $(( ${free:-0} / 1024 )) MB free on /data"
  if [ "${free:-0}" -lt "$need_kb" ]; then
    say require data_room "FAIL under $(( need_kb / 1024 )) MB free"
  else
    say require data_room "PASS"
  fi
else
  say require data_space "FAIL no /data partition"
fi

# The MPC settings file, and whether its autosave is already on.
S=/data/Settings/MPC/MPC.settings
if [ -f "$S" ]; then
  say identity mpc_settings "$(sed -n 's/.*name="AutoSaveEnabled" val="\([^"]*\)".*/AutoSaveEnabled=\1/p' "$S") $(sed -n 's/.*name="AutoSaveTimeout" val="\([^"]*\)".*/AutoSaveTimeout=\1/p' "$S")"
else
  say require mpc_settings "FAIL no $S"
fi

# The firmware rootfs partition is Gen 1's boot route, hardcoded by
# install-rootfs-unit.sh. Gen 2 uses the /data/mpc-addins hook instead.
if [ "$GEN" = 2 ]; then
  if [ -d /data/mpc-addins ]; then
    say require fw_partition "PASS Gen 2 boot hook path /data/mpc-addins"
  else
    say require fw_partition "WARN no /data/mpc-addins yet; install-service.sh creates it, but the stuck autorun must scan it at boot"
  fi
elif [ -b /dev/mmcblk0p6 ]; then
  say require fw_partition "PASS /dev/mmcblk0p6 exists"
  say identity root_mount "$(findmnt -n -o SOURCE,FSTYPE,OPTIONS / 2>/dev/null | sed -n 1p)"
else
  say require fw_partition "FAIL no /dev/mmcblk0p6, the boot unit is written there"
fi

# The panel: weston.ini names the connector DSI-1. board.sh rotates it 90 degrees
# on Gen 1 and 270 on Gen 2.
conns=$(ls -d /sys/class/drm/card*-* 2>/dev/null | sed 's|.*/drm/||' | grep -v '^$' | tr '\n' ' ')
say identity drm_connectors "${conns:-none}"
dsi=$(ls -d /sys/class/drm/card*-DSI-1 2>/dev/null | sed -n 1p)
if [ -n "$dsi" ]; then
  modes=$(tr '\n' ' ' < "$dsi/modes" 2>/dev/null)
  say require panel "PASS ${dsi##*/} $(cat "$dsi/status" 2>/dev/null), modes: ${modes:-none reported}"
else
  say require panel "FAIL no DSI-1 connector, weston.ini is written for it"
fi

cards=$(sed -n 's/^ *[0-9]* \[\([^]]*\)\].*/\1/p' /proc/asound/cards 2>/dev/null | tr '\n' ' ')
say identity alsa_cards "${cards:-none}"
if [ "$GEN" = 2 ]; then
  if [ -d /proc/asound/card0 ]; then
    say require audio "PASS Gen 2 codec card 0 present"
  else
    say require audio "WARN no /proc/asound/card0, board.sh uses plughw:0,0"
  fi
elif grep -qs 'ACVA\|acva' /proc/asound/cards 2>/dev/null; then
  say require audio "PASS ACVA codec present"
else
  say require audio "WARN no ACVA codec in /proc/asound/cards, sound may not work"
fi

# Project state, not device shape: CrateSurf installs its own Node (deploy/install-node.sh),
# so a device without one is still the tested shape. Reported as identity for that reason, and
# an older borrowed runtime is named so an install that predates the move is obvious.
NODE=/data/browser/node/bin/node
LOCAL_NODE=/data/mpc-agent/runtime/node/bin/node
if [ -x "$NODE" ]; then
  say identity node "$("$NODE" --version 2>/dev/null) at $NODE"
elif [ -x "$LOCAL_NODE" ]; then
  say identity node "none at $NODE (borrowed $("$LOCAL_NODE" --version 2>/dev/null) at $LOCAL_NODE)"
else
  say identity node "not installed yet, deploy/install-node.sh fetches one"
fi
REMOTE
) || true

if [ -z "$OUT" ]; then
  echo "== could not reach $HOST"
  sed -n '1,5p' "$ERR" 2>/dev/null | sed 's/^/   /'
  echo "   check the host, the SSH key, and that the MPC is on the network"
  rm -f "$ERR"
  exit 2
fi
rm -f "$ERR"

printf '%s\n' "$OUT" | while IFS='|' read -r kind name value; do
  case "$kind" in
    identity) printf '   %-16s %s\n' "$name" "$value" ;;
    require)
      case "$value" in
        PASS*) printf -- '-- %-16s %s\n' "$name" "$value" ;;
        WARN*) printf -- '-- %-16s %s\n' "$name" "$value" ;;
        *)     printf -- '-- %-16s %s\n' "$name" "$value" ;;
      esac ;;
  esac
done

echo
GEN=$(printf '%s\n' "$OUT" | sed -n 's/^identity|generation|gen\([0-9]\).*/\1/p' | sed -n 1p)
fails=$(printf '%s\n' "$OUT" | grep -c '^require|.*|FAIL' || true)
warns=$(printf '%s\n' "$OUT" | grep -c '^require|.*|WARN' || true)

if [ "${fails:-0}" -eq 0 ]; then
  if [ "$GEN" = 2 ]; then
    echo "== verdict: shape matches Gen 2 (aarch64, /nvme documents, addin boot hook)"
  else
    echo "== verdict: shape matches Gen 1 (armv7l, /media documents, /etc unit)"
  fi
  [ "${warns:-0}" -gt 0 ] && echo "   with $warns warning(s) above"
  echo "   README.md and INSTALL.md apply. Save your project before the first switch."
  exit 0
fi

echo "== verdict: $fails requirement(s) did not match. This is NOT a shape CrateSurf knows."
echo "   Read the FAIL lines: each one is something the install assumes and this device"
echo "   does not have. That does not mean it is impossible, it means nobody has done it."
if [ "$GEN" = 1 ]; then
  echo "   Do not run build-sysroot.sh or install-service.sh --boot on a device that fails"
  echo "   fw_partition or panel: those two are where damage would come from."
else
  echo "   Do not install on a device that fails arch, panel or the boot hook path."
fi
exit 1
