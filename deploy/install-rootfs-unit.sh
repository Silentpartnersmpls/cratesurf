#!/bin/sh
# Install mpc-browse.service into the READ-ONLY firmware root filesystem.
#
# Same reason as mpc-agent's equivalent: / is /dev/mmcblk0p6 mounted ro, and /etc
# is an overlay whose upper layer lives on /data and is mounted about two seconds
# into boot, after systemd has already computed the multi-user.target transaction.
# A unit that exists only in the overlay is invisible at boot and never starts.
#
# Additive only: refuses to overwrite a unit it did not put there, verifies the
# copy byte for byte, and always puts / back to read-only via a trap.
#
# Run this ON THE MPC (deploy.sh copies it there with the unit).

set -eu

SRC=/data/browser/mpc-browse.service
DEV=/dev/mmcblk0p6
MNT=/mnt/fw-root
UNIT_PATH=etc/systemd/system/mpc-browse.service
WANT_PATH=etc/systemd/system/multi-user.target.wants/mpc-browse.service
# The ExecStart this unit was installed with before the Node runtime moved to
# /data/browser/node. Devices installed earlier still carry it in the rootfs, and
# refusing to replace it would leave a unit pointing at a path this project no
# longer owns (or, worse, at nothing at all).
LEGACY_EXEC='/data/mpc-agent/runtime/node/bin/node /data/browser/bin/control-server.js'

[ -f "$SRC" ] || { echo "FAIL: missing $SRC"; exit 1; }
grep -q '^ExecStart=/data/browser/node/bin/node /data/browser/bin/control-server.js$' "$SRC" \
  || { echo "FAIL: $SRC does not look like the mpc-browse unit"; exit 1; }

FREE_KB=$(df -k / | awk 'NR==2 {print $4}')
[ "$FREE_KB" -gt 256 ] || { echo "FAIL: only ${FREE_KB}KB free on /, refusing"; exit 1; }

cleanup() {
  umount "$MNT" 2>/dev/null || true
  rmdir "$MNT" 2>/dev/null || true
  mount -o remount,ro / 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "remounting / read-write"
mount -o remount,rw / || { echo "FAIL: could not remount / rw"; exit 1; }

mkdir -p "$MNT"
mount "$DEV" "$MNT" || { echo "FAIL: could not mount $DEV"; exit 1; }

mkdir -p "$(dirname "$MNT/$UNIT_PATH")"
mkdir -p "$(dirname "$MNT/$WANT_PATH")"

if [ -f "$MNT/$UNIT_PATH" ]; then
  if cmp -s "$SRC" "$MNT/$UNIT_PATH"; then
    echo "note: identical unit already present in the rootfs"
  else
    # A newer revision of this same unit is expected to differ (KillMode was
    # added that way). Overwrite only when the file on disk is provably ours:
    # same unit name, same ExecStart. Anything else is somebody else's file.
    OLD_EXEC=$(sed -n 's/^ExecStart=//p' "$MNT/$UNIT_PATH")
    NEW_EXEC=$(sed -n 's/^ExecStart=//p' "$SRC")
    if [ -n "$OLD_EXEC" ] && { [ "$OLD_EXEC" = "$NEW_EXEC" ] || [ "$OLD_EXEC" = "$LEGACY_EXEC" ]; }; then
      if [ "$OLD_EXEC" = "$LEGACY_EXEC" ]; then
        echo "note: replacing the revision that ran Node from /data/mpc-agent"
      else
        echo "note: replacing an older revision of our unit (ExecStart matches)"
      fi
    else
      echo "FAIL: $DEV/$UNIT_PATH exists and is not our unit, refusing to overwrite"
      echo "      on disk: ${OLD_EXEC:-<no ExecStart>}"
      echo "      ours:    ${NEW_EXEC:-<no ExecStart>}"
      exit 1
    fi
  fi
fi

cp "$SRC" "$MNT/$UNIT_PATH"
chmod 644 "$MNT/$UNIT_PATH"
ln -sfn /etc/systemd/system/mpc-browse.service "$MNT/$WANT_PATH"

cmp "$SRC" "$MNT/$UNIT_PATH" || { echo "FAIL: unit copy does not match source"; exit 1; }
LINK=$(readlink "$MNT/$WANT_PATH")
[ "$LINK" = "/etc/systemd/system/mpc-browse.service" ] || { echo "FAIL: bad symlink -> $LINK"; exit 1; }

sync
echo "unit installed: $(wc -c < "$MNT/$UNIT_PATH") bytes, symlink -> $LINK"

cleanup
trap - EXIT INT TERM
echo "root remounted: $(findmnt -n -o OPTIONS / | cut -d, -f1)"
echo "OK"
