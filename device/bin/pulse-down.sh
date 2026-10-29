#!/bin/sh
# Stop PulseAudio, leaving the ALSA device free for the MPC app to take back.
# Matched by process name only -- the MPC app must never be caught by mistake.
R=/data/browser
"$R/bin/killproc.sh" pulseaudio "$R/sysroot/run/pulse.pid"
