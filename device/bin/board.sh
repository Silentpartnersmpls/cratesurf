#!/bin/sh
# CrateSurf's board profile.
#
# Source this from the device scripts; it sets the values that differ between the
# two generations of MPC hardware. It is deliberately a shell library and not a
# service: browse-up.sh, weston-up.sh, pulse-up.sh and chrome-up.sh all have to
# agree on the same board, and the cheapest way to guarantee that is for them to
# read the same file.
#
#   Gen 1 - MPC One+ / MPC Live II: RK3288, 32-bit armv7l, Mali-T760
#   Gen 2 - MPC XL / MPC Live III: RK3588, 64-bit aarch64, Mali-G610
#
# Detection is from the device tree first, then the CPU architecture. A Gen 2
# board that reports a compatible string we have not seen still gets the Gen 2
# profile if it is aarch64, because the 32-bit binaries cannot run there at all;
# the profile is a starting point, not a claim that every Gen 2 unit has been
# tested.
#
# Override for a test machine or a probe:
#   CRATESURF_BOARD=gen1 . /data/browser/bin/board.sh
#   CRATESURF_BOARD=gen2 ...
#
# This file only sets variables. It does not mount, stop, start or write anything.

BOARD_COMPAT=$(tr '\0' ' ' 2>/dev/null < /proc/device-tree/compatible || true)
BOARD_MODEL=$(tr -d '\0' 2>/dev/null < /proc/device-tree/model || true)
BOARD_ARCH=$(uname -m 2>/dev/null || echo unknown)

case "${CRATESURF_BOARD:-}" in
  gen1|1|armv7|armhf) BOARD_GEN=1 ;;
  gen2|2|arm64|aarch64|xl) BOARD_GEN=2 ;;
  '')
    case "$BOARD_ARCH $BOARD_COMPAT $BOARD_MODEL" in
      *aarch64*|*arm64*|*rk3588*|*inmusic,acvc*|*"MPC XL"*|*"MPC Live III"*)
        BOARD_GEN=2
        ;;
      *)
        BOARD_GEN=1
        ;;
    esac
    ;;
  *)
    echo "board.sh: unknown CRATESURF_BOARD='$CRATESURF_BOARD', using Gen 1" >&2
    BOARD_GEN=1
    ;;
esac

if [ "$BOARD_GEN" = 2 ]; then
  BOARD_NAME=mpc-gen2
  BOARD_DOCS=${MPC_DOCS_ROOT:-${CRATESURF_DOCS:-/nvme/MPC Documents}}
  BOARD_AUDIO_DEVICE=${CRATESURF_AUDIO_DEVICE:-plughw:0,0}
  BOARD_AUDIO_RATE=${CRATESURF_AUDIO_RATE:-44100}
  BOARD_AUDIO_CHANNELS=${CRATESURF_AUDIO_CHANNELS:-2}
  BOARD_AUDIO_EXTRA=${CRATESURF_AUDIO_EXTRA:-fragments=4 fragment_size=8192}
  BOARD_WESTON_TTY=
  BOARD_WESTON_OUTPUT=${CRATESURF_WESTON_OUTPUT:-DSI-1}
  BOARD_WESTON_TRANSFORM=${CRATESURF_WESTON_TRANSFORM:-rotate-270}
  # The XL's Mesa 25/panthor stack is the reason the 64-bit build uses trixie,
  # and it is the Gen 2 default here. This tree has not revalidated the GPU path
  # on an XL yet; keep the file-based escape hatch for a panel/driver regression:
  #   touch /data/browser/run/chrome-software-raster
  BOARD_GPU_DEFAULT=${CRATESURF_GPU_DEFAULT:-1}
  BOARD_BOOT=hook
  BOARD_NODE_ARCH=arm64
  BOARD_DEB_ARCH=arm64
  BOARD_DISTRO=trixie
else
  BOARD_NAME=mpc-gen1
  BOARD_DOCS=${MPC_DOCS_ROOT:-${CRATESURF_DOCS:-/media/acvs-content/MPC Documents}}
  BOARD_AUDIO_DEVICE=${CRATESURF_AUDIO_DEVICE:-hw:1,0}
  BOARD_AUDIO_RATE=${CRATESURF_AUDIO_RATE:-48000}
  BOARD_AUDIO_CHANNELS=${CRATESURF_AUDIO_CHANNELS:-2}
  BOARD_AUDIO_EXTRA=${CRATESURF_AUDIO_EXTRA:-}
  # weston 10 wants --tty=1; Gen 2's weston 14 does not. An explicit override
  # below works for either generation when a test machine needs it.
  BOARD_WESTON_TTY=--tty=1
  BOARD_WESTON_OUTPUT=${CRATESURF_WESTON_OUTPUT:-DSI-1}
  BOARD_WESTON_TRANSFORM=${CRATESURF_WESTON_TRANSFORM:-rotate-90}
  # Software raster is the shipped default on the RK3288: the Mali-T760
  # Panfrost path tears and drops the nav bar during page loads. Opt in with
  #   touch /data/browser/run/chrome-gpu-raster
  BOARD_GPU_DEFAULT=${CRATESURF_GPU_DEFAULT:-0}
  BOARD_BOOT=systemd
  BOARD_NODE_ARCH=armv7l
  BOARD_DEB_ARCH=armhf
  BOARD_DISTRO=bookworm
fi

if [ -n "${CRATESURF_WESTON_TTY+x}" ]; then
  BOARD_WESTON_TTY=$CRATESURF_WESTON_TTY
fi

BOARD_FILES=${MPC_FILES_ROOT:-$BOARD_DOCS/Samples}

# A short line for logs. The scripts print it once when a session starts.
BOARD_DESC="gen$BOARD_GEN ($BOARD_ARCH, $BOARD_NAME)"
