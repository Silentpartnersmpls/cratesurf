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

# Extra flags, one per line, from run/chrome-flags. Empty unless somebody put a file
# there, and that file is the point: a flag can be tried on the unit, and taken back
# out, without editing this script or the payload's copy of it. Whatever is in it is
# additive - the flags below are always there.
EXTRA=$(cat "$R/run/chrome-flags" 2>/dev/null)

# Software raster, on purpose, even though the GPU is faster.
#
# The chroot does have Mesa EGL on Panfrost (Mali-T760) and weston does hand Chromium
# a wayland socket, so taking --disable-gpu out works and measures well: the same
# card-grid page went from 1.7 fps (561 ms between frames) to 60.2 fps (16.6 ms median).
# On the glass it is not usable. Harlem, 2026-10-31: "when i go to scroll it goes a
# little crazy also our nav bar glitched out a bit when loading pages", and the
# framebuffer agrees - whole black frames and half-drawn frames with the nav bar
# missing during a page load. Speed that tears is worse than a page that is slow.
# The benchmark that sold it measured frame *timing* only, never frame *contents*.
# So software raster is the default, and the GPU stays behind a file for whoever wants
# to try a driver fix (--disable-gpu-compositing, --use-gl=egl, a newer Mesa).
#   touch run/chrome-gpu-raster    -> next start uses the GPU
#   rm    run/chrome-gpu-raster    -> back to software
RASTER=--disable-gpu
[ -f "$R/run/chrome-gpu-raster" ] && RASTER=""
export CHROME_RASTER="$RASTER"
export CHROME_EXTRA="$EXTRA"

# Panfrost's AFBC has a corruption mode on this GPU generation that shows up as
# black or half-drawn frames while a buffer is being scanned out. run/panfrost-noafbc
# turns it off for Chromium (and for weston, which reads the same marker in its own
# script) without editing either script. It is additive to any PAN_MESA_DEBUG that
# is already set.
if [ -f "$R/run/panfrost-noafbc" ]; then
  PAN_MESA_DEBUG="${PAN_MESA_DEBUG:+$PAN_MESA_DEBUG,}noafbc"
  export PAN_MESA_DEBUG
fi

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
  # An RK3288 misses the audio clock under load too, so give the sink a little more
  # slack than the 10 ms default.
  export PULSE_LATENCY_MSEC=140
  for f in /run/xdg/wayland-*; do
    case \"\$f\" in *.lock) ;; *) [ -S \"\$f\" ] && WAYLAND_DISPLAY=\${f##*/} ;; esac
  done
  export WAYLAND_DISPLAY
  exec /usr/lib/chromium/chromium \\
    --ozone-platform=wayland --kiosk --no-sandbox \$CHROME_RASTER \\
    --disable-dev-shm-usage --no-first-run --user-data-dir=/root/chrome-profile \\
    --load-extension=/opt/kb-ext \\
    --autoplay-policy=no-user-gesture-required \$CHROME_EXTRA \\
    '$URL'
" > "$R/run/chrome.out" 2>&1 < /dev/null &
