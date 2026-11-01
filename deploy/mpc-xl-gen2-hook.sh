#!/bin/sh
# MPC XL only. Lives at /data/mpc-addins/cratesurf-browse/install.sh.
# The SSH stick's mpc-extras.sh runs /data/mpc-addins/*/install.sh on every autorun (once the stick prompt
# is confirmed), so this starts the CrateSurf control server each boot: the port-8798 toggle (phone/PC) and
# the on-device gesture watcher (3-finger hold / Ctrl+Alt+B). It does NOT enter browse mode; it arms it.
# Browse mode itself (stop MPC -> weston+Chromium) is entered by the gesture or the toggle. Idempotent.
# Output lands in mpc-extras-result.txt on the stick. Args (-y -n -t <dir>) are passed by the caller and ignored.
# Undo: `systemctl stop cratesurf-control` and delete /data/mpc-addins/cratesurf-browse.
#
# Why systemd-run: the autorun runs us inside a transient scope that systemd TEARS DOWN (SIGKILL the cgroup)
# when the autorun finishes, so a plain `node ... &` dies seconds after boot. systemd-run gives the server its
# own system unit that outlives the autorun - the same fix browse-up.sh uses for the same trap.
R=/data/browser
[ -x "$R/node/bin/node" ] && [ -f "$R/bin/control-server.js" ] || { echo "cratesurf-browse: not installed, skipping"; exit 0; }
if systemctl is-active --quiet cratesurf-control 2>/dev/null; then
  echo "cratesurf-browse: control server already running (cratesurf-control)"
  exit 0
fi
# clear the unit name (a prior failed run) so --unit can reuse it; busybox pkill -f is unreliable, so find any
# stray control-server by scanning /proc and kill it by pid (normally none on a fresh boot).
systemctl reset-failed cratesurf-control 2>/dev/null
for pdir in /proc/[0-9]*; do
  [ "$(cat "$pdir/comm" 2>/dev/null)" = node ] || continue   # only node, never the shell running this
  grep -qa control-server.js "$pdir/cmdline" 2>/dev/null && kill -9 "${pdir#/proc/}" 2>/dev/null
done
systemd-run --unit=cratesurf-control --collect \
  --setenv="MPC_FILES_ROOT=/nvme/MPC Documents/Samples" \
  --setenv="MPC_DOCS_ROOT=/nvme/MPC Documents" \
  "$R/node/bin/node" "$R/bin/control-server.js" \
  && echo "cratesurf-browse: started control server (unit cratesurf-control) on :8798" \
  || echo "cratesurf-browse: systemd-run failed to start the control server"
exit 0
