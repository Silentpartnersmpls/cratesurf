#!/bin/sh
# CrateSurf's Gen 2 boot hook. Lives at
# /data/mpc-addins/cratesurf-browse/install.sh.
#
# Gen 2's root filesystem is read-only/dm-verity, so there is no /etc systemd unit
# to install. The SSH stick's mpc-extras.sh runs /data/mpc-addins/*/install.sh on
# every autorun (after the stick prompt is confirmed), so this starts the CrateSurf
# control server at boot instead. That server is the :8798 toggle for a phone/PC
# and the on-device gesture watcher (three-finger hold / Ctrl+Alt+B).
#
# It does NOT enter browse mode; it arms it. Browse mode itself (stop MPC ->
# weston + Chromium) is entered by the gesture or the toggle. Idempotent.
#
# Output lands in mpc-extras-result.txt on the stick. Args (-y -n -t <dir>) are
# passed by the caller and ignored.
#
# Undo:
#   systemctl stop cratesurf-control
#   rm -rf /data/mpc-addins/cratesurf-browse
#
# Why systemd-run: the autorun runs us inside a transient scope that systemd tears
# down (SIGKILLs the cgroup) when the autorun finishes, so a plain `node ... &`
# dies seconds after boot. systemd-run gives the server its own unit that outlives
# the autorun - the same fix browse-up.sh uses for the same trap.
R=/data/browser
[ -x "$R/node/bin/node" ] && [ -f "$R/bin/control-server.js" ] || {
  echo "cratesurf-browse: not installed, skipping"
  exit 0
}
# Take the documents path from the same board profile the runtime uses instead
# of copying /nvme here. On this hardware it resolves to Gen 2; if the hook is
# ever installed on a Gen 1 unit, it still starts the server on the right tree.
[ -r "$R/bin/board.sh" ] || {
  echo "cratesurf-browse: missing $R/bin/board.sh"
  exit 1
}
. "$R/bin/board.sh"

if systemctl is-active --quiet cratesurf-control 2>/dev/null; then
  echo "cratesurf-browse: control server already running (cratesurf-control)"
  exit 0
fi

# Clear the unit name after a prior failed run so --unit can reuse it. Busybox
# pkill -f is unreliable, so find any stray control-server by scanning /proc and
# kill it by pid (normally none on a fresh boot).
systemctl reset-failed cratesurf-control 2>/dev/null
for pdir in /proc/[0-9]*; do
  [ "$(cat "$pdir/comm" 2>/dev/null)" = node ] || continue
  grep -qa control-server.js "$pdir/cmdline" 2>/dev/null && kill -9 "${pdir#/proc/}" 2>/dev/null
done

# Match the Gen 1 unit's service settings. KillMode=process matters: the control
# server spawns browse-up.sh, so weston and Chromium live in this unit's cgroup.
# The default control-group kill would tear down a live browsing session whenever
# the toggle restarts; only the toggle itself should die here. Restart=always is
# the Gen 1 behaviour too, so a crashed server comes back without a reboot.
systemd-run --unit=cratesurf-control --collect \
  --property=KillMode=process \
  --property=Restart=always \
  --property=RestartSec=5 \
  --property=Nice=10 \
  --setenv="MPC_FILES_ROOT=$BOARD_FILES" \
  --setenv="MPC_DOCS_ROOT=$BOARD_DOCS" \
  "$R/node/bin/node" "$R/bin/control-server.js" \
  && echo "cratesurf-browse: started control server (unit cratesurf-control) on :8798" \
  || echo "cratesurf-browse: systemd-run failed to start the control server"
exit 0
