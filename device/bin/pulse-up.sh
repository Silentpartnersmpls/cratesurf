#!/bin/sh
# PulseAudio for the browser, on the MPC's own codec.
#
# Chromium on Linux has no ALSA backend at all. It speaks PulseAudio and nothing
# else, so with no server running every <audio> element and every site player is
# silent with no error shown anywhere in the page or in chrome://media-internals.
#
# Chromium runs as root inside this chroot, and pulseaudio refuses to run as root
# unless it is a system instance, so this is --system: the server drops to the
# `pulse` user (uid 998, a member of `audio` in the chroot's /etc/group) and opens
# /dev/snd from there. Clients connect anonymously over a unix socket because
# there is no session bus and no per-user cookie in a kiosk.
#
# The sink is board-specific. Gen 1 uses hw:1,0 = card 1 "ACVA", the inmusic
# codec that drives the headphones and main outs; card 0 is "MPC One +" USB audio,
# the box presenting itself to a connected computer, not an output. Gen 2 uses
# plughw:0,0, because the RK3588 codec is card 0 and it needs 44.1 kHz with a
# larger ALSA buffer to stay clean. board.sh owns the values; this script only
# turns them into the module argument.
R=/data/browser
S=$R/sysroot
. "$R/bin/board.sh"

AUDIO_ARGS="device=$BOARD_AUDIO_DEVICE sink_name=codec rate=$BOARD_AUDIO_RATE channels=$BOARD_AUDIO_CHANNELS tsched=0"
if [ -n "$BOARD_AUDIO_EXTRA" ]; then
  AUDIO_ARGS="$AUDIO_ARGS $BOARD_AUDIO_EXTRA"
fi
export CRATESURF_AUDIO_ARGS="$AUDIO_ARGS"

"$R/bin/pulse-down.sh"

mkdir -p "$S/run/pulse"
chown 998:998 "$S/run/pulse" 2>/dev/null

setsid /usr/sbin/chroot "$S" /bin/sh -c '
  export HOME=/root
  echo $$ > /run/pulse.pid
  exec /usr/bin/pulseaudio --system --daemonize=no --disallow-exit --exit-idle-time=-1 \
    --realtime=0 -n --log-target=file:/tmp/pulse.log \
    --load="module-native-protocol-unix auth-anonymous=1 socket=/run/pulse/native" \
    --load="module-alsa-sink $CRATESURF_AUDIO_ARGS" \
    --load="module-null-sink sink_name=silent"
' > "$R/run/pulse.out" 2>&1 < /dev/null &

# Nothing downstream works without the socket, so wait for it rather than racing.
i=0
while [ $i -lt 40 ]; do
  [ -S "$S/run/pulse/native" ] && break
  sleep 0.25
  i=$((i + 1))
done

[ -S "$S/run/pulse/native" ] || {
  echo "FAIL: pulseaudio did not create a socket; see $R/run/pulse.out"
  exit 1
}
echo "pulseaudio up on unix:/run/pulse/native"
