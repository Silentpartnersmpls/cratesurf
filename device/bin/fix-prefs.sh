#!/bin/sh
# Chromium rewrites its Preferences store on shutdown and drops keys it did not
# load itself, so a one-time seed does not survive. Re-inject the download keys
# before every launch: without them Chromium asks where to save via a GTK dialog,
# which cannot appear here (no GTK, no window manager) and the download dies.
S=/data/browser/sysroot
PREF=$S/root/chrome-profile/Default/Preferences
DL="/downloads"

mkdir -p "$S/root/chrome-profile/Default" "$S$DL"

if [ -f "$PREF" ]; then
  grep -q '"prompt_for_download"' "$PREF" && exit 0
  # Preferences is one line of JSON; insert a key right after the opening brace.
  sed -i "1s|{|{\"download\":{\"default_directory\":\"$DL\",\"prompt_for_download\":false,\"directory_upgrade\":true},|" "$PREF"
else
  printf '{"download":{"default_directory":"%s","prompt_for_download":false,"directory_upgrade":true}}\n' "$DL" > "$PREF"
fi
