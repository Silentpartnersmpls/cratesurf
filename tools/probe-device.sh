#!/bin/sh
# probe-device.sh - read-only compatibility check for a device CrateSurf has never seen.
#
#   ./tools/probe-device.sh                 uses MPC_HOST, default root@mpc-one-mk2
#   MPC_HOST=root@192.168.1.50 ./tools/probe-device.sh
#
# It reads; it writes, mounts, stops and installs nothing. Every line it prints is a
# fact the project depends on, and the verdict at the end is whether this device has
# the same shape as the one unit CrateSurf was built and verified on (MPC One+ Gen 1,
# firmware 3.4.2.13).
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
say identity os "$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-$NAME}")"
say identity glibc "$(strings /lib/libc.so.6 2>/dev/null | sed -n 's/.*release version \([0-9][0-9.]*[0-9]\).*/\1/p' | sed -n 1p)"
say identity firmware "$(strings /usr/bin/MPC 2>/dev/null | sed -n 's/^\(3\.[0-9.]*\) (.*/\1/p' | sed -n 1p)"
say identity ssh_user "$(id -un) uid=$(id -u)"
say identity ram_mb "$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo)"
say identity cpus "$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo) online"

# armv7 hard-float and a glibc new enough for Debian bookworm (2.36) is the whole trick.
m=$(uname -m)
if [ "$m" = "armv7l" ]; then
  say require arch "PASS armv7l"
else
  say require arch "FAIL $m, the sysroot is armv7 hard-float"
fi

g=$(strings /lib/libc.so.6 2>/dev/null | sed -n 's/.*release version \([0-9][0-9.]*[0-9]\).*/\1/p' | sed -n 1p)
gmaj=${g%%.*}; gmin=${g#*.}; gmin=${gmin%%.*}
if [ -n "$g" ] && { [ "${gmaj:-0}" -gt 2 ] || { [ "${gmaj:-0}" -eq 2 ] && [ "${gmin:-0}" -ge 36 ]; }; }; then
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

# /data: the chroot is ~775 MB and the browser profile wants room to breathe.
if [ -d /data ]; then
  free=$(df -k /data 2>/dev/null | awk 'NR==2 {print $4}')
  say require data_space "PASS $(( ${free:-0} / 1024 )) MB free on /data"
  if [ "${free:-0}" -lt 1048576 ]; then
    say require data_room "FAIL under 1 GB free, the chroot alone is ~775 MB"
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

# The firmware rootfs partition, hardcoded by install-rootfs-unit.sh.
if [ -b /dev/mmcblk0p6 ]; then
  say require fw_partition "PASS /dev/mmcblk0p6 exists"
  say identity root_mount "$(findmnt -n -o SOURCE,FSTYPE,OPTIONS / 2>/dev/null | sed -n 1p)"
else
  say require fw_partition "FAIL no /dev/mmcblk0p6, the boot unit is written there"
fi

# The panel: weston.ini names the connector DSI-1 and rotates it 90 degrees. On the
# tested unit it hangs off card1, so look for the connector name rather than a card.
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
if grep -qs 'ACVA\|acva' /proc/asound/cards 2>/dev/null; then
  say require audio "PASS ACVA codec present"
else
  say require audio "WARN no ACVA codec in /proc/asound/cards, sound may not work"
fi

NODE=/data/mpc-agent/runtime/node/bin/node
if [ -x "$NODE" ]; then
  say require node "PASS $("$NODE" --version 2>/dev/null)"
else
  say require node "FAIL no node at $NODE, see INSTALL.md prerequisites"
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
fails=$(printf '%s\n' "$OUT" | grep -c '^require|.*|FAIL' || true)
warns=$(printf '%s\n' "$OUT" | grep -c '^require|.*|WARN' || true)

if [ "${fails:-0}" -eq 0 ]; then
  echo "== verdict: shape matches the tested unit (MPC One+ Gen 1, firmware 3.4.2.13)"
  [ "${warns:-0}" -gt 0 ] && echo "   with $warns warning(s) above"
  echo "   README.md and INSTALL.md apply. Save your project before the first switch."
  exit 0
fi

echo "== verdict: $fails requirement(s) did not match. This is NOT the tested shape."
echo "   Read the FAIL lines: each one is something the install assumes and this device"
echo "   does not have. That does not mean it is impossible, it means nobody has done it."
echo "   Do not run build-sysroot.sh or install-service.sh --boot on a device that fails"
echo "   fw_partition or panel: those two are where damage would come from."
exit 1
