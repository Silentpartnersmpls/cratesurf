#!/bin/sh
# Install the browse toggle as a service on the MPC.
#   ./install-service.sh          /etc copy only, survives reboots of systemd state
#   ./install-service.sh --boot    also add the unit to the firmware rootfs, so it
#                                  starts at boot (see install-rootfs-unit.sh)
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
HOST=${MPC_HOST:-root@mpc-one-mk2}
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no"
SCP="scp -q -o BatchMode=yes -o StrictHostKeyChecking=no"
BOOT=${1:-}

# The unit's ExecStart is /data/browser/node/bin/node, so make sure that binary is there.
# Without this, install-service.sh on its own leaves an active-but-crashing unit.
"$HERE/install-node.sh"

$SCP "$HERE/../device/mpc-browse.service" "$HOST:/data/browser/mpc-browse.service"
$SCP "$HERE/install-rootfs-unit.sh" "$HOST:/data/browser/install-rootfs-unit.sh"

$SSH "$HOST" "chmod +x /data/browser/install-rootfs-unit.sh
  cp /data/browser/mpc-browse.service /etc/systemd/system/mpc-browse.service
  chmod 644 /etc/systemd/system/mpc-browse.service
  systemctl daemon-reload
  systemctl enable mpc-browse.service >/dev/null 2>&1 || true
  systemctl restart mpc-browse.service
  sleep 2
  systemctl is-active mpc-browse.service"

if [ "$BOOT" = "--boot" ]; then
  $SSH "$HOST" "/data/browser/install-rootfs-unit.sh"
fi

# /proc/net/tcp lists ports in hex, 8798 = 0x225E (this used to read 22B6 and
# always report 0, which looked like a dead toggle).
$SSH "$HOST" 'echo "-- listen on 8798: $(grep -c ":225E" /proc/net/tcp 2>/dev/null)"' || true

echo
echo "toggle: http://mpc-one-mk2:8798/"
echo "leave browse mode from a shell: $HOST /data/browser/bin/browse-down.sh"
