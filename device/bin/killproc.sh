#!/bin/sh
# killproc.sh <comm> [pidfile]
#
# Stop a program by the name the kernel reports in /proc/<pid>/comm, not by a pid
# from a pidfile and not by a command-line pattern.
#
# Why: pidfiles under /data survive reboots, so a stale pid can point at anything,
# and Chromium rewrites the pidfile itself on a second launch ("Opening in existing
# browser session") which leaves a dead pid behind and let the old browser keep
# running for an hour without anyone noticing. A command-line pattern is worse
# still: the pattern also matches the ssh command that is doing the killing.
# /proc/<pid>/comm is the executable's own name, 15 chars, and cannot match a shell.
NAME=$1
PIDFILE=$2

[ -n "$PIDFILE" ] && rm -f "$PIDFILE"
[ -n "$NAME" ] || exit 1
SELF=$$

# Collect first, kill second: killing while iterating /proc can skip entries.
PIDS=""
for d in /proc/[0-9]*; do
  pid=${d#/proc/}
  [ "$pid" = "$SELF" ] && continue
  [ -r "$d/comm" ] || continue
  [ "$(cat "$d/comm" 2>/dev/null)" = "$NAME" ] && PIDS="$PIDS $pid"
done

[ -n "$PIDS" ] || exit 0

for pid in $PIDS; do
  kill "$pid" 2>/dev/null
done

i=0
while [ $i -lt 30 ]; do
  alive=0
  for pid in $PIDS; do
    [ -d "/proc/$pid" ] && alive=1
  done
  [ $alive -eq 0 ] && break
  sleep 0.2
  i=$((i + 1))
done

for pid in $PIDS; do
  [ -d "/proc/$pid" ] && kill -9 "$pid" 2>/dev/null
done

exit 0
