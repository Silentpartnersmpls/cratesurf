#!/bin/sh
# Turn on the MPC's own project autosave, with the MPC app stopped.
#
# This is what makes leaving the MPC app for browse mode non-destructive. The app
# has to stop so weston can own the panel, and it does not save the project on the
# way out, so anything since the last manual save is gone. With autosave on, the
# app keeps a copy in <Project>_[AutoSave] and offers it back on the next launch:
#   "Caution! You have an auto-saved version of this project. ... Do you want to
#    merge the auto-saved changes now, ignore them this time, or delete them?"
#
# The firmware ships AutoSaveEnabled=0, AutoSaveTimeout=300 (seconds), so a fresh
# device silently loses work on every switch.
#
# It must run while the app is down: the app rewrites MPC.settings from memory as
# it exits, so an edit underneath a running app is thrown away on its next exit,
# and an edit made while it runs looks applied until then.
#
# What it still cannot save, both worth knowing before trusting it:
#   - a project that was never saved has no file path, and the app logs
#     "Autosave for project with no file path" and skips it;
#   - up to AutoSaveTimeout seconds of work may be missing from the copy.
#
#   mpc-autosave.sh [timeout_seconds]        default 300
SETTINGS=${MPC_SETTINGS:-/data/Settings/MPC/MPC.settings}
TIMEOUT=${1:-300}

[ -f "$SETTINGS" ] || { echo "mpc-autosave: no $SETTINGS"; exit 1; }

# Matched on process name, never the command line: this script's own argv would
# contain the word MPC and the check would always trip.
for p in /proc/[0-9]*; do
  if [ "$(cat "$p/comm" 2>/dev/null)" = MPC ]; then
    echo "mpc-autosave: the MPC app is running, it would overwrite this edit on exit"
    exit 2
  fi
done

read_val() {
  sed -n "s/.*name=\"$1\" val=\"\\([^\"]*\\)\".*/\\1/p" "$SETTINGS"
}

if [ "$(read_val AutoSaveEnabled)" = 1 ] && [ "$(read_val AutoSaveTimeout)" = "$TIMEOUT" ]; then
  echo "mpc-autosave: already on (${TIMEOUT}s)"
  exit 0
fi

cp -a "$SETTINGS" "$SETTINGS.bak-autosave" 2>/dev/null

sed -i "s/name=\"AutoSaveEnabled\" val=\"[^\"]*\"/name=\"AutoSaveEnabled\" val=\"1\"/" "$SETTINGS"
sed -i "s/name=\"AutoSaveTimeout\" val=\"[^\"]*\"/name=\"AutoSaveTimeout\" val=\"$TIMEOUT\"/" "$SETTINGS"

# Read it back: a silent sed that matched nothing would leave autosave off while
# this script reported success, which is worse than failing loudly.
if [ "$(read_val AutoSaveEnabled)" != 1 ] || [ "$(read_val AutoSaveTimeout)" != "$TIMEOUT" ]; then
  echo "mpc-autosave: FAILED, $SETTINGS does not contain the expected values"
  exit 1
fi

echo "mpc-autosave: enabled, ${TIMEOUT}s (previous file kept as $SETTINGS.bak-autosave)"
