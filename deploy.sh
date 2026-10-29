#!/bin/sh
# Copy the browse-mode scripts to the MPC and install them in place.
#   ./deploy.sh                 use MPC_HOST
#   MPC_HOST=root@ip ./deploy.sh
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
HOST=${MPC_HOST:-root@mpc-one-mk2}
R=/data/browser
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=no"

$SSH "$HOST" "mkdir -p $R/bin $R/run $R/sysroot/opt/kb-ext $R/sysroot/etc/xdg/weston"

# The toggle, the launcher, the exit endpoint and the recorder are Node scripts and the
# firmware has no Node, so the runtime is part of the deploy. Idempotent: it prints one
# line and exits when the pinned version is already on the device.
"$HERE/deploy/install-node.sh"

scp -q -o BatchMode=yes -o StrictHostKeyChecking=no "$HERE"/device/bin/*.sh "$HERE"/device/bin/*.js "$HOST:$R/bin/"
# The nav bar is an unpacked extension loaded with --load-extension, so the whole
# folder has to be there, not just the script it runs.
scp -q -o BatchMode=yes -o StrictHostKeyChecking=no "$HERE"/device/ext/* "$HOST:$R/sysroot/opt/kb-ext/"
scp -q -o BatchMode=yes -o StrictHostKeyChecking=no "$HERE"/device/weston.ini "$HOST:$R/sysroot/etc/xdg/weston/weston.ini"
scp -q -o BatchMode=yes -o StrictHostKeyChecking=no "$HERE"/device/home.html "$HOST:$R/sysroot/opt/home.html"
scp -q -o BatchMode=yes -o StrictHostKeyChecking=no "$HERE"/device/calib.html "$HOST:$R/sysroot/opt/calib.html"
scp -q -o BatchMode=yes -o StrictHostKeyChecking=no "$HERE"/device/keys.html "$HOST:$R/sysroot/opt/keys.html"
scp -q -o BatchMode=yes -o StrictHostKeyChecking=no "$HERE"/device/download-test.html "$HOST:$R/sysroot/opt/download-test.html"
scp -q -o BatchMode=yes -o StrictHostKeyChecking=no "$HERE"/device/mpc-browse.service "$HOST:$R/mpc-browse.service"

$SSH "$HOST" "chmod +x $R/bin/*.sh && $R/bin/setup-profile.sh && echo deployed"

echo
echo "enter browse mode:  $SSH $HOST $R/bin/browse-up.sh"
echo "leave  browse mode: $SSH $HOST $R/bin/browse-down.sh"
