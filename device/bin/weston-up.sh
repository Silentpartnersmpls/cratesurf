#!/bin/sh
# Start weston on the MPC panel, inside the armhf chroot.
# The panel is a portrait 800x1280 DSI connector; weston.ini rotates it to 1280x800.
R=/data/browser
S=$R/sysroot

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

setsid /usr/sbin/chroot "$S" /bin/sh -c '
  export XDG_RUNTIME_DIR=/run/xdg
  # weston loads its pointer images through libwayland-cursor, which looks the theme
  # up by name in /usr/share/icons. Without one there is no arrow on screen at all,
  # even though the pointer still moves.
  export XCURSOR_THEME=DMZ-White XCURSOR_SIZE=32
  echo $$ > /run/weston.pid
  exec /usr/bin/weston --config=/etc/xdg/weston/weston.ini --log=/tmp/weston.log $WESTON_EXTRA
' > "$R/run/weston.out" 2>&1 < /dev/null &
