#!/bin/sh
# Enter browse mode: pause the MPC app, bring up weston + Chromium kiosk.
#
# The MPC application (acvs.service) holds DRM master while it runs, so it has to
# stop before a compositor can own the panel. Nothing of the user's is touched:
# the MPC comes back exactly as it was when browse mode exits, because the app
# reloads its current project on start.
R=/data/browser
S=$R/sysroot
NODE=/data/mpc-agent/runtime/node/bin/node

mkdir -p "$R/run" "$S/run/xdg"
chmod 700 "$S/run/xdg"
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

# Downloads must land in the MPC's own sample library, which lives on the content
# image. Bind that one directory in explicitly at /downloads: binding /media as a
# whole is not reliable here because /media is itself a tmpfs of mount points, and
# a browser writing into a stale copy of it looks like a working download that
# never reaches the library.
mkdir -p "$S/downloads"
grep -qs " $S/downloads " /proc/mounts || \
  mount --bind "/media/acvs-content/MPC Documents/Samples" "$S/downloads"

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

if [ -x "$NODE" ] && [ ! -f "$R/run/exit.pid" ]; then
  "$NODE" "$R/bin/exit-server.js" > "$R/run/exit.out" 2>&1 &
  echo $! > "$R/run/exit.pid"
fi

echo browse > "$R/run/mode"
echo "browse mode up"
