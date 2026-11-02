#!/bin/sh
# Install the browse toggle as a service on the MPC.
#   ./install-service.sh          /etc copy only, survives reboots of systemd state
#   ./install-service.sh --boot    Gen 1 only: also add the unit to the firmware
#                                  rootfs, so it starts at boot
#
# Gen 2 has a read-only/dm-verity root filesystem. There is no /etc unit to install
# there; the control server is armed by /data/mpc-addins/cratesurf-browse/install.sh
# instead, which the SSH stick's autorun calls at boot. This script detects the
# architecture and takes the right path.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
HOST=${MPC_HOST:-root@mpc-one-mk2}
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -o BatchMode=yes -o StrictHostKeyChecking=no"
BOOT=${1:-}
R=/data/browser

# The unit's ExecStart is /data/browser/node/bin/node, so make sure that binary is there.
# Without this, install-service.sh on its own leaves an active-but-crashing unit.
"$HERE/install-node.sh"

remote_arch=$($SSH "$HOST" "uname -m 2>/dev/null" | tr -d '\r')
case "$remote_arch" in
  armv7l|armv7|armhf) GEN=1 ;;
  aarch64|arm64) GEN=2 ;;
  *)
    echo "FAIL: $HOST reports architecture '$remote_arch'; expected armv7l or aarch64"
    exit 1
    ;;
esac

if [ "$GEN" = 1 ]; then
  $SCP "$HERE/../device/mpc-browse.service" "$HOST:$R/mpc-browse.service"
  $SCP "$HERE/install-rootfs-unit.sh" "$HOST:$R/install-rootfs-unit.sh"

  $SSH "$HOST" "chmod +x $R/install-rootfs-unit.sh
    cp $R/mpc-browse.service /etc/systemd/system/mpc-browse.service
    chmod 644 /etc/systemd/system/mpc-browse.service
    systemctl daemon-reload
    systemctl enable mpc-browse.service >/dev/null 2>&1 || true
    systemctl restart mpc-browse.service
    sleep 2
    systemctl is-active mpc-browse.service"

  if [ "$BOOT" = "--boot" ]; then
    $SSH "$HOST" "$R/install-rootfs-unit.sh"
  fi
else
  [ -z "$BOOT" ] || echo "note: Gen 2 boots through the addin hook; --boot has nothing extra to install"
  $SCP "$HERE/../device/mpc-gen2-hook.sh" "$HOST:$R/mpc-gen2-hook.sh"
  $SSH "$HOST" "chmod +x $R/mpc-gen2-hook.sh
    mkdir -p /data/mpc-addins/cratesurf-browse
    cp $R/mpc-gen2-hook.sh /data/mpc-addins/cratesurf-browse/install.sh
    chmod +x /data/mpc-addins/cratesurf-browse/install.sh
    systemctl disable --now mpc-browse.service 2>/dev/null || true
    systemctl stop cratesurf-control 2>/dev/null || true
    systemctl reset-failed cratesurf-control 2>/dev/null || true
    /data/mpc-addins/cratesurf-browse/install.sh
    sleep 2
    systemctl is-active cratesurf-control"
fi

# /proc/net/tcp lists ports in hex, 8798 = 0x225E (this used to read 22B6 and
# always report 0, which looked like a dead toggle).
$SSH "$HOST" 'echo "-- listen on 8798: $(grep -c ":225E" /proc/net/tcp 2>/dev/null)"' || true

echo
echo "toggle: http://${HOST#*@}:8798/"
echo "leave browse mode from a shell: $HOST $R/bin/browse-down.sh"
