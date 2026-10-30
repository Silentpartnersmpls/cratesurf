# CrateSurf installer

One program. You run it on your computer, type the MPC's IP, press Enter, and it
puts CrateSurf on the MPC.

It needs nothing installed on your machine: no Python, no Node, no OpenSSH, no
package manager. It carries its own SSH client, so Windows, macOS and Linux all
behave the same way.

```
cratesurf-installer-windows-amd64.exe
cratesurf-installer-darwin-arm64        # Apple silicon
cratesurf-installer-linux-amd64
```

## What it does

1. **Asks for the MPC's address.** IP or hostname. `Preferences → Info` on the
   MPC shows the IP.
2. **Connects as root.** Most units flashed with an SSH firmware accept root
   with no password; if yours was set up with one, it asks.
3. **Checks the device.** Model, architecture, firmware version, free space on
   `/data`, and whether CrateSurf is already there. It refuses to continue on a
   device it does not recognise rather than half-installing on it.
4. **Downloads the payload** (once, ~350 MB, checksum-verified) and streams it
   into `/data/browser`.
5. **Installs the toggle service**, including the copy in the read-only firmware
   rootfs, which is what makes it start at boot.
6. **Checks its own work.** The service is running, something is listening on
   port 8798, and the browser binary is really in the sysroot. If any of that is
   false it says so and exits non-zero.

When it finishes you have three ways in: three fingers held on the glass for
about 2.5 seconds, Ctrl+Alt+B on a USB keyboard, or `http://<mpc-ip>:8798/` from
your phone.

## The second option: rooting the MPC

An MPC One+ ships with SSH switched off and nothing on the device to switch it
on with. So if the installer cannot get in, the reason is almost always that the
unit is stock. Option 2 on the menu walks that through:

- it tells you where the SSH-enabled firmware images come from (**it does not
  download or bundle one**: those are InMusic's files with a few files changed,
  and the people flashing one should see where it came from)
- it checks the image you downloaded is a plausible size
- it finds your USB stick and copies the image to the root of it
- it gives you the exact MPC keystrokes, and the fallback button combination
- afterwards it tries to log in, so you find out immediately whether it worked

The one thing it cannot do is press UPDATE on the MPC. That screen is on the
device, and the device reboots into a flashing mode from there.

## Options

Anything the menu asks can be given on the command line, so it can be scripted:

```
cratesurf-installer --host 192.168.1.50              install
cratesurf-installer --host 192.168.1.50 --check      read-only probe
cratesurf-installer --host 192.168.1.50 --password hunter2
cratesurf-installer --host mpc --payload ./payload.tar.gz --sha <sha256>
```

`--payload` takes a local tarball or an `http(s)` URL, which is how a release
build works: `build.sh` bakes the release URL and checksum into the binary with
`-ldflags`, so the shipped installer has nothing to configure.

## How the payload is made

`make-payload.sh` builds the tarball, laid out the way `/data/browser` expects:

```
sysroot/            the Debian chroot: chromium, weston, pulseaudio
node/               the pinned Node runtime the toggle runs on
bin/                the device scripts
mpc-browse.service  the unit
install-rootfs-unit.sh
```

Two sources, and both are things we already have:

```sh
./make-payload.sh --from-device root@mpc-one-mk2       # pull the tree off a working unit
./make-payload.sh --sysroot /tmp/mpcsys/root           # or from ./build-sysroot.sh CACHE_ONLY=1
```

The device route is what the current release uses: the tree on a unit that has
been running for weeks is a tree that is known to work on that firmware, and it
takes a step out of the release process that could go wrong. The sysroot route
is for building from scratch on a machine that has `apt`.

The browser profile is deliberately left out. A profile carries a first-boot
Chromium state from one particular machine, and `setup-profile.sh` seeds the two
settings that actually matter (where downloads go) on every launch anyway.

## Building it

```sh
./build.sh                                                  # all five targets into build/
PAYLOAD_URL=... PAYLOAD_SHA256=... ./build.sh                # with a release baked in
```

Needs Go 1.23 or newer, and nothing else. `CGO_ENABLED=0` for every target, so
each binary is static and self-contained.

## What this writes on the MPC

Exactly what `INSTALL.md` lists, and nothing else: `/data/browser` (the chroot,
the Node runtime, the scripts), the unit in `/etc/systemd/system/`, the same unit
in the firmware rootfs for boot, and the MPC's own autosave settings, so a switch
into browse mode does not throw away unsaved work. No audio, project, sample or
plugin files are touched.
