#!/bin/sh
# One-time (idempotent) Chromium profile seed inside the chroot.
#
# Downloads must land somewhere the MPC's own browser can see, and Chromium must
# not stop to ask where to put them (there is no dialog to answer in kiosk mode).
# The whole "MPC Documents" tree is bind-mounted at /downloads inside the chroot
# (see browse-up.sh), so the directory here is that root, and the folder a file
# lands in is the path in front of its name: "Samples/pack.zip". Chromium cannot be
# pointed at a folder per download - the extension only chooses a relative path -
# which is why the root, and not Samples itself, is the default.
S=/data/browser/sysroot
PROF=$S/root/chrome-profile
DL="/downloads"

mkdir -p "$PROF/Default" "$S$DL"

if [ ! -f "$PROF/Default/Preferences" ]; then
  cat > "$PROF/Default/Preferences" <<EOF
{
  "download": {
    "default_directory": "$DL",
    "prompt_for_download": false,
    "directory_upgrade": true
  },
  "savefile": {
    "default_directory": "$DL"
  },
  "profile": {
    "default_content_setting_values": {
      "automatic_downloads": 1,
      "notifications": 2,
      "geolocation": 2
    }
  },
  "browser": {
    "check_default_browser": false
  },
  "bookmark_bar": {
    "show_on_all_tabs": false
  }
}
EOF
fi

# Policies cover the same ground for anything that ignores the pref.
mkdir -p "$S/etc/chromium/policies/managed"
cat > "$S/etc/chromium/policies/managed/mpc-browse.json" <<EOF
{
  "DownloadDirectory": "$DL",
  "PromptForDownloadLocation": false,
  "DefaultBrowserSettingEnabled": false
}
EOF

echo "downloads -> $DL"
