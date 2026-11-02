#!/bin/sh
# Start weston on the MPC panel, inside the chroot.
# The panel is a portrait 800x1280 DSI connector; the board profile rotates it to
# 1280x800. Gen 1's weston (10) takes --tty=1; Gen 2's weston (14) no longer does,
# so the tty flag is part of the profile rather than this script.
R=/data/browser
S=$R/sysroot
. "$R/bin/board.sh"

# Extra flags, one per line, from run/weston-flags. Same idea as run/chrome-flags:
# a renderer or backend can be tried on the unit without editing this script or the
# payload's copy of it. The variable is exported so it survives the chroot.
EXTRA=$(cat "$R/run/weston-flags" 2>/dev/null)
export WESTON_EXTRA="$EXTRA"

# Same Panfrost AFBC escape hatch as chrome-up.sh: both the compositor and the
# browser have to agree to stop allocating compressed buffers, or weston can still
# scan out an AFBC buffer Chromium made.
if [ -f "$R/run/panfrost-noafbc" ]; then
  PAN_MESA_DEBUG="${PAN_MESA_DEBUG:+$PAN_MESA_DEBUG,}noafbc"
  export PAN_MESA_DEBUG
fi

"$R/bin/weston-down.sh"
rm -f "$S/run/weston.pid"

# weston.ini is shared by both generations; only the output transform differs.
# Generate a run-time copy instead of shipping two files that can drift apart. The
# config is at /run/weston.ini inside the chroot, which is $S/run/weston.ini here.
BASE=$S/etc/xdg/weston/weston.ini
[ -f "$BASE" ] || { echo "FAIL: no weston config at $BASE"; exit 1; }
mkdir -p "$S/run"
sed \
  -e "s/^name=.*/name=$BOARD_WESTON_OUTPUT/" \
  -e "s/^transform=.*/transform=$BOARD_WESTON_TRANSFORM/" \
  "$BASE" > "$S/run/weston.ini"
grep -q "^transform=$BOARD_WESTON_TRANSFORM$" "$S/run/weston.ini" || \
  echo "WARNING: $BASE had no transform line; the panel may be upside down" >&2
export CRATESURF_WESTON_TTY="$BOARD_WESTON_TTY"

setsid /usr/sbin/chroot "$S" /bin/sh -c '
  export XDG_RUNTIME_DIR=/run/xdg
  # weston loads its pointer images through libwayland-cursor, which looks the theme
  # up by name in /usr/share/icons. Without one there is no arrow on screen at all,
  # even though the pointer still moves.
  export XCURSOR_THEME=DMZ-White XCURSOR_SIZE=32
  echo $$ > /run/weston.pid
  exec /usr/bin/weston $CRATESURF_WESTON_TTY --config=/run/weston.ini --log=/tmp/weston.log $WESTON_EXTRA
' > "$R/run/weston.out" 2>&1 < /dev/null &
