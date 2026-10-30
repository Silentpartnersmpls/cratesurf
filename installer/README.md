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

## Security, spelled out

**Root SSH is closed at the end of an install.** An MPC flashed with the usual SSH firmware has an
empty root password, and sshd on it is configured to accept that: anyone on the same Wi-Fi can log in
as root with no credentials at all. The installer uses exactly that hole to get in, and then closes
it: it sets a random 24-character root password and prints it once, and it installs a key of its own
so this computer (and the scripts in this repo) keep working without it.

- The password is the part that matters. sshd only accepts the "none" method for an account whose
  password field is empty, so a key on its own would not close anything.
- The key lives at `~/.cratesurf/id_ed25519` (0600) and one `Host` entry is appended to
  `~/.ssh/config` so plain `ssh root@<mpc>` keeps working. Nothing else on your machine is touched.
- The password is never written to a file and never sent anywhere. It is printed, once, on screen.
- Before the new password is trusted, the installer logs in with it and checks it is root. If that
  fails, the old `/etc/shadow` is put back and it says so. A backup is left at
  `/data/browser/run/shadow.bak` on the device either way.

**The host key is remembered, not blindly accepted.** The first time it connects to a device it shows
the fingerprint and asks. After that a changed key is a hard stop, because a changed key is either a
reflash (which regenerates it) or something answering for the MPC that is not the MPC. That matters
here more than usual: this is the connection that carries the install.

**What it does not protect you from.** Port 8798 has no authentication by design (see
[KNOWN-ISSUES.md](../KNOWN-ISSUES.md)), Chromium runs as root inside the chroot without its sandbox,
and a rooted MPC's firmware has been modified by somebody else. Locking root down is the difference
between a browser and a back door with a browser in it; it is not a hardened appliance.

**No telemetry.** The only outbound request the installer makes is the payload download. It reports
nothing anywhere, and it contains no identifier of you or your device.

## Options

Anything the menu asks can be given on the command line, so it can be scripted:

```
cratesurf-installer --host 192.168.1.50              install
cratesurf-installer --host 192.168.1.50 --check      read-only probe
cratesurf-installer --host 192.168.1.50 --password hunter2
cratesurf-installer --host mpc --payload ./payload.tar.gz --sha <sha256>
cratesurf-installer --host 192.168.1.50 --harden-only    just the password and key step
cratesurf-installer --host 192.168.1.50 --no-harden      install, leave root SSH open
cratesurf-installer --host 192.168.1.50 --accept-host-key  never ask about an unseen host key
```

`--harden-only` is for units installed before this existed, which are sitting on a network with an
open root shell.

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
```**Releases use `--release --sysroot`**, which builds from things that are in this repository and
nobody's computer: a `build-sysroot.sh CACHE_ONLY=1` tree, the files in git, and the pinned Node
download. That matters for privacy as much as reproducibility. A payload pulled off a working unit is
a snapshot of that unit's filesystem, and "nothing personal was in it this time" is not a property to
rely on for every release.

```sh
./make-payload.sh --release --sysroot /tmp/mpcsys/root   # what gets published
./make-payload.sh --from-device root@mpc-one-mk2         # internal: snapshot of one unit
```

`--from-device` still exists for testing a build of the scripts against a unit we are sitting in
front of. It refuses to be combined with `--release`, and it says on screen that the result must not
be published.

Left out of both: the browser profile (a first-boot Chromium state from one machine, reseeded by
`setup-profile.sh` on every install), every bind-mount point, and `var/run`, which on a live unit
holds a PulseAudio cookie from a real session. That cookie turned up in the first payload built from
the device, which is exactly why the release path no longer starts from a device.

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
