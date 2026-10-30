#!/bin/sh
# Leave browse mode: stop the browser stack, hand the panel back to the MPC app.
R=/data/browser
S=$R/sysroot

# Never run inside the stack unit this script is about to stop.
#
# A stack started by hand lives in the transient unit mpc-browse-stack (see
# browse-up.sh), and so does everything browse-up.sh starts, including the exit
# server behind the bar's MPC button and EXIT BROWSE MODE. When that server runs
# this script, `systemctl stop mpc-browse-stack` below kills the whole cgroup,
# this script included, before it reaches `systemctl start acvs`: the browser
# goes, the MPC app never comes back, and the panel stays black. So when we find
# ourselves in that cgroup, hand the work to a unit of our own and let that one
# finish. Started any other way (the toggle service, a shell) this is skipped.
if [ -z "${BROWSE_DOWN_DETACHED:-}" ] && grep -qs 'mpc-browse-stack' /proc/self/cgroup \
   && command -v systemd-run >/dev/null 2>&1; then
  exec systemd-run --unit=mpc-browse-down --collect --quiet \
    --setenv=BROWSE_DOWN_DETACHED=1 /bin/sh "$R/bin/browse-down.sh"
fi

"$R/bin/chrome-down.sh"
"$R/bin/weston-down.sh"
# Stop the sound server before the MPC app starts: the codec is exclusive, and
# an acvs that cannot open hw:1,0 comes back mute.
"$R/bin/pulse-down.sh"

# A stack started by hand lives in its own transient unit (see browse-up.sh), so
# the unit is what has to go, not just the processes. Stopping it also takes the
# cgroup with it, which is the point.
if systemctl is-active --quiet mpc-browse-stack 2>/dev/null; then
  systemctl stop mpc-browse-stack 2>/dev/null
fi

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
