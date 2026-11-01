#!/bin/sh
# Enter browse mode: pause the MPC app, bring up weston + Chromium kiosk.
#
# The MPC application (acvs.service) holds DRM master while it runs, so it has to
# stop before a compositor can own the panel. Nothing of the user's is touched:
# the MPC comes back exactly as it was when browse mode exits, because the app
# reloads its current project on start.
R=/data/browser
S=$R/sysroot
# This project's own runtime, put there by deploy/install-node.sh. It used to point at
# /data/mpc-agent/runtime/node/bin/node, which is another project's business and absent
# on any MPC that does not have it.
NODE=$R/node/bin/node

# A hand-run call has to detach from the caller's cgroup, not just its session.
#
# `setsid` below gives weston and Chromium their own session, which is why they
# survive the shell that started them, but it does not move them out of the
# *cgroup*: systemd puts an ssh login in its own scope and kills the whole scope
# when the connection ends. So `ssh mpc /data/browser/bin/browse-up.sh` used to
# bring the browser up and have it die a few seconds later with nothing in any
# log, because the death is a SIGKILL to a cgroup, not a crash. Hours went into
# blaming the 3.10 firmware for that.
#
# The service path does not have the problem: its cgroup lives as long as the
# service, which is why the phone toggle and the three-finger hold always worked.
# INVOCATION_ID is set by systemd for anything it starts, so its absence is the
# signal that this was typed at a prompt and needs a unit of its own.
if [ -z "${INVOCATION_ID:-}" ] && [ -z "${BROWSE_STACK:-}" ] && command -v systemd-run >/dev/null 2>&1; then
  exec systemd-run --unit=mpc-browse-stack --collect --quiet \
    /bin/sh -c "BROWSE_STACK=1 '$R/bin/browse-up.sh' ${1:-}; exec sleep infinity"
  # exec'd, so nothing below runs in the caller's scope.
fi

mkdir -p "$R/run" "$S/run/xdg"
chmod 700 "$S/run/xdg"
# The chroot needs a writable, sticky /tmp. Chromium puts its ProcessSingleton
# socket there and aborts at launch without it ("Failed to create socket
# directory"), and weston and PulseAudio log there. Payloads leave tmp out, and
# the 0.1.0-alpha release payload shipped with no tmp at all, so every install
# from it switched modes and then showed nothing. Made here on every entry so an
# install from that payload repairs itself.
mkdir -p "$S/tmp"
chmod 1777 "$S/tmp"
rm -f "$S/run/weston.pid" "$S/run/chrome.pid"

if [ "$(cat "$R/run/mode" 2>/dev/null)" = browse ]; then
  WPID=$(cat "$S/run/weston.pid" 2>/dev/null)
  if [ -n "$WPID" ] && kill -0 "$WPID" 2>/dev/null; then
    echo "already in browse mode"
    exit 0
  fi
  # The mode file is only a claim; weston dying leaves it stale. Rebuild rather
  # than refusing to start and leaving a black panel.
  echo "previous session is gone, rebuilding the stack"
fi

# The chroot needs the host's device, proc, sys and udev trees, plus the sample folder.
bind() {
  grep -qs " $S/$1 " /proc/mounts || {
    mkdir -p "$S/$1"
    mount --bind "/$1" "$S/$1"
  }
}
bind dev
bind proc
bind sys
bind run/udev

# Downloads must land in the MPC's own document tree, which lives on the content
# image. Bind that tree in explicitly at /downloads: binding /media as a whole is
# not reliable here because /media is itself a tmpfs of mount points, and a browser
# writing into a stale copy of it looks like a working download that never reaches
# the MPC.
#
# It used to be just Samples, because that is where every download went. The whole
# tree is mounted now because the destination is chosen per download and written as
# a path under this root ("Samples/pack.zip"), so anything the MPC itself shows has
# to exist in here or the browser cannot write to it.
DOCS="/nvme/MPC Documents"
# /proc/mounts escapes the space in that path; the plain string would never match.
DOCS_ESC=$(printf '%s' "$DOCS" | sed 's/ /\\040/g')
mkdir -p "$S/downloads"
if ! grep -qs " $S/downloads " /proc/mounts; then
  mount --bind "$DOCS" "$S/downloads"
elif ! grep -qs "^$DOCS_ESC $S/downloads " /proc/mounts; then
  # An older session left Samples bound here. Replace it, or the picker would offer
  # folders the browser still cannot see.
  umount "$S/downloads" 2>/dev/null && mount --bind "$DOCS" "$S/downloads"
fi

systemctl stop acvs
sleep 2

# The app does not save the project as it exits, so a switch used to throw away
# everything done since the last manual save. Turn on the MPC's own autosave while
# it is down (it cannot be changed while the app runs: the app rewrites its
# settings from memory on exit). On the way back, the app offers the auto-saved
# copy to merge. Already on is the normal case and costs nothing.
"$R/bin/mpc-autosave.sh" || \
  echo "WARNING: MPC autosave is off, unsaved work will not survive this switch"

# Audio first. Chromium has no ALSA backend, so it needs a PulseAudio server
# already listening on the socket it will be pointed at. A failure here is
# reported and does not block browsing: no sound is bad, a dead panel is worse.
"$R/bin/pulse-up.sh" || echo "WARNING: pulseaudio did not start, browse mode will be silent"

# The DRM node must be free before weston claims master.
"$R/bin/weston-up.sh"

i=0
while [ $i -lt 30 ]; do
  ls "$S"/run/xdg/wayland-* >/dev/null 2>&1 && break
  sleep 0.5
  i=$((i + 1))
done

"$R/bin/setup-profile.sh"
"$R/bin/chrome-up.sh" "$1"

# The pid file lives on /data, so it outlives a reboot or a power cut taken in
# browse mode. Trusting its existence alone meant the next session started no exit
# server at all, and the MPC button and EXIT BROWSE MODE did nothing. Only a pid
# that is running the exit server counts: after a reboot the number can belong to
# something else entirely.
EPID=$(cat "$R/run/exit.pid" 2>/dev/null)
if [ -n "$EPID" ] && ! tr '\0' ' ' < "/proc/$EPID/cmdline" 2>/dev/null | grep -q 'exit-server.js'; then
  rm -f "$R/run/exit.pid"
fi
if [ -x "$NODE" ] && [ ! -f "$R/run/exit.pid" ]; then
  "$NODE" "$R/bin/exit-server.js" > "$R/run/exit.out" 2>&1 &
  echo $! > "$R/run/exit.pid"
fi

echo browse > "$R/run/mode"
echo "browse mode up"
