# CrateSurf on the MPC XL / Live III (Gen 2, RK3588, aarch64)

A port of [CrateSurf](https://github.com/Silentpartnersmpls/cratesurf) (by Silentpartnersmpls, MIT)
to the **Gen 2** Akai standalone boards — MPC XL / MPC Live III, Rockchip **RK3588, 64-bit**.
Upstream targets the Gen 1 RK3288 (32-bit). This branch runs a Chromium "browse mode" on the
Gen 2 panel, GPU-accelerated, with the three-finger gesture, the phone/PC toggle and Ctrl+Alt+B.

Tested on an MPC XL (board `inmusic,acvc`), MPC OS 3.9.1, kernel 6.18, root SSH.

## What's different from upstream (and why)

| File | Change | Why |
|---|---|---|
| `build-sysroot-arm64.sh` / `build-sysroot-trixie.sh` | New builders: Debian **arm64** (bookworm), and **trixie** for the GPU | Gen 2 is aarch64, not armhf. Use the **trixie** build: its Mesa 25 has `panthor_dri.so`, the driver for the RK3588 Mali-G610. bookworm's Mesa has no panthor, so the GPU is unusable and everything falls back to slow software rendering. |
| `device/bin/touch-launcher.js` | Architecture-aware `struct input_event` size (16 to **24** bytes on 64-bit; field offsets 16/18/20) | On 64-bit, `struct timeval` is 16 bytes, so each input event is 24 bytes, not 16. Hardcoding 16 misframes `/dev/input` and the gesture (and Ctrl+Alt+B) never fire. |
| `device/bin/weston-up.sh` | Drop `--tty=1` | weston **14** (trixie) removed that option - it's a `fatal: unhandled option`. |
| `device/bin/pulse-up.sh` | `device=plughw:0,0 rate=44100` (+ bigger buffer) | The XL's audio is one 32-channel / 44100 Hz bus on card 0 (the device MPC itself plays through). Forcing 48000 and plain stereo on `hw:0,0` resamples and mismatches, giving artifacts. `plughw` maps stereo onto the bus at the native rate. |
| `device/weston.ini` | `transform=rotate-270`, output `DSI-1` | The XL panel is mounted 180 degrees vs the One+, so it needs 270, not 90. |
| `device/bin/browse-up.sh` | downloads bind to `/nvme/MPC Documents` | Gen 2 keeps documents on the NVMe, not `/media/acvs-content`. |
| `deploy/install-node.sh` | arm64 Node tarball + sha256 | 64-bit runtime. |
| `deploy/mpc-xl-gen2-hook.sh` | **New** boot hook (see below) | Gen 2's rootfs is a **read-only dm-verity** partition, so you cannot install a systemd unit into `/etc` the way upstream's `--boot` does. |

## Boot persistence on a locked (verity) rootfs

On Gen 2 the rootfs is integrity-locked, so nothing can be added to `/etc`. The one boot hook
available is the SSH-stick autorun (it runs `/data/mpc-addins/*/install.sh` each boot). Install
`deploy/mpc-xl-gen2-hook.sh` as `/data/mpc-addins/cratesurf-browse/install.sh`. It starts the
control server under **`systemd-run`** (unit `cratesurf-control`, in `/system.slice`) - a plain
`node &` is SIGKILLed when the autorun scope is torn down, the same trap `browse-up.sh` documents.

## Install (summary)

1. Build the bundle on a Linux/WSL box: `CACHE_ONLY=1 WORK=~/sys ./build-sysroot-trixie.sh`
   (needs `apt-get` + `dpkg-deb`; ~950 MB tree, has `panthor_dri.so`).
2. `MPC_HOST=root@<ip>`; ship the sysroot to `/data/browser/sysroot`, then `./deploy.sh`
   (installs arm64 Node, scripts, weston.ini, profile).
3. `touch /data/browser/run/chrome-gpu-raster` to use the GPU in Chromium.
4. Install `deploy/mpc-xl-gen2-hook.sh` to `/data/mpc-addins/cratesurf-browse/install.sh` for boot start.
5. Enter browse mode: three-finger hold, `http://<ip>:8798/`, or Ctrl+Alt+B.

## Status & caveats

- Working: browser on the panel, **weston on the Mali-G610 GPU** (Mesa 25), smooth scrolling,
  clean audio, all three entry methods, survives reboot (confirm the stick prompt to arm it).
- These files hardcode XL values, so this branch is **XL-specific, not drop-in for Gen 1**. A
  generalized dual-generation version would make the arch/rate/rotation/connector conditional.
- The port keeps upstream's MIT license. Bundled Chromium/weston/Mesa/etc. carry their own.

*Ported by djru5h with Claude Code. Original CrateSurf (c) Silentpartnersmpls (MIT).*
