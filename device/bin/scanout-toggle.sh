#!/bin/sh
# Toggle weston's overlay-plane / direct-scanout path for the current session.
#
# Weston binds mod+Shift+Space as a debug chord and the next key chooses the
# effect. V flips the DRM backend's sprites_are_broken flag, which stops it from
# handing a fullscreen client buffer straight to KMS. That is the path that shows
# black and half-drawn frames on this panel when Chromium uses the GPU. The flag
# is per-session and gone after a weston restart, so this is a test control, not a
# setting. See weston-bindings(7) and drm.c:planes_binding() in weston 10.
#
# Uses the same uhid keyboard as the input tests, so it needs a running weston and
# the Node runtime that deploy/install-node.sh puts on the unit.
R=/data/browser
printf 'key gui+shift+space\nkey v\n' | "$R/node/bin/node" "$R/bin/hid-inject.js"
