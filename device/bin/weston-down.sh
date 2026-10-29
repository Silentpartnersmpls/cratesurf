#!/bin/sh
# Stop weston by process name. Never by command-line pattern: that pattern also
# matches the killer's own command line when the killer arrives over ssh.
R=/data/browser
"$R/bin/killproc.sh" weston "$R/sysroot/run/weston.pid"
