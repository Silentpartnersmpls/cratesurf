#!/bin/sh
# Stop Chromium by the name the kernel gives it. Not by pidfile: Chromium itself
# rewrites /run/chrome.pid on a second launch and exits, so a live browser can be
# left running with a dead pid on record -- which is exactly what happened when
# the bar kept showing an old build after a deploy.
R=/data/browser
"$R/bin/killproc.sh" chromium
