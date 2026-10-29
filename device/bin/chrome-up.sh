#!/bin/sh
# Chromium kiosk on the running weston socket.
#   chrome-up.sh [url]        default: the local home page
# The wayland socket name is discovered, not assumed: the first free slot can be
# wayland-1 if a stale lock survived a previous session.
#
# The home page is served over http://127.0.0.1:8798 rather than file://, because
# extension content scripts do not run on file:// pages by default. The nav
# toolbar has to exist on the page you start from, or the first thing you can do
# after leaving the start page is get stuck.
R=/data/browser
S=$R/sysroot
URL=${1:-http://127.0.0.1:8798/home}

"$R/bin/chrome-down.sh"
"$R/bin/fix-prefs.sh"

# The profile caches the extension's service-worker registration together with the
# script it registered. Chromium reloads that cached script in preference to the
# file on disk, so a deploy that only touched bg.js looks applied and isn't: the
# REC button kept asking a worker that had never heard of it. The profile is
# disposable, so drop the registration and let the file be read again.
rm -rf "$R/sysroot/root/chrome-profile/Default/Service Worker"

setsid /usr/sbin/chroot "$S" /bin/sh -c "
  export XDG_RUNTIME_DIR=/run/xdg
  export HOME=/root
  # pulse-up.sh owns the socket; libpulse reads this instead of guessing.
  export PULSE_SERVER=unix:/run/pulse/native
  # Software raster on an RK3288 misses the audio clock too, so give the sink a
  # little more slack than the 10 ms default.
  export PULSE_LATENCY_MSEC=140
  for f in /run/xdg/wayland-*; do
    case \"\$f\" in *.lock) ;; *) [ -S \"\$f\" ] && WAYLAND_DISPLAY=\${f##*/} ;; esac
  done
  export WAYLAND_DISPLAY
  exec /usr/lib/chromium/chromium \\
    --ozone-platform=wayland --kiosk --no-sandbox --disable-gpu \\
    --disable-dev-shm-usage --no-first-run --user-data-dir=/root/chrome-profile \\
    --load-extension=/opt/kb-ext \\
    --autoplay-policy=no-user-gesture-required \\
    '$URL'
" > "$R/run/chrome.out" 2>&1 < /dev/null &
