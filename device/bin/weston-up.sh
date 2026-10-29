#!/bin/sh
# Start weston on the MPC panel, inside the armhf chroot.
# The panel is a portrait 800x1280 DSI connector; weston.ini rotates it to 1280x800.
R=/data/browser
S=$R/sysroot

"$R/bin/weston-down.sh"
rm -f "$S/run/weston.pid"

setsid /usr/sbin/chroot "$S" /bin/sh -c '
  export XDG_RUNTIME_DIR=/run/xdg
  # weston loads its pointer images through libwayland-cursor, which looks the theme
  # up by name in /usr/share/icons. Without one there is no arrow on screen at all,
  # even though the pointer still moves.
  export XCURSOR_THEME=DMZ-White XCURSOR_SIZE=32
  echo $$ > /run/weston.pid
  exec /usr/bin/weston --tty=1 --config=/etc/xdg/weston/weston.ini --log=/tmp/weston.log
' > "$R/run/weston.out" 2>&1 < /dev/null &
