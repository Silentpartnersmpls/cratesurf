#!/bin/sh
# Leave browse mode: stop the browser stack, hand the panel back to the MPC app.
R=/data/browser
S=$R/sysroot

"$R/bin/chrome-down.sh"
"$R/bin/weston-down.sh"
# Stop the sound server before the MPC app starts: the codec is exclusive, and
# an acvs that cannot open hw:1,0 comes back mute.
"$R/bin/pulse-down.sh"

if [ -f "$R/run/exit.pid" ]; then
  kill "$(cat "$R/run/exit.pid")" 2>/dev/null
  rm -f "$R/run/exit.pid"
fi

sleep 1

unbind() {
  grep -qs " $S/$1 " /proc/mounts && umount "$S/$1"
}
unbind downloads
unbind run/udev
unbind media
unbind sys
unbind proc
unbind dev

rm -f "$R/run/mode" "$S/run/chrome.pid" "$S/run/weston.pid"

systemctl start acvs
echo "browse mode down"
