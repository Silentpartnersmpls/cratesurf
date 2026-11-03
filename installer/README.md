# CrateSurf installer

One program. You run it on your computer, type the MPC's IP, press Enter, and it
puts CrateSurf on the MPC. The current binaries are in
[GitHub Releases](https://github.com/Silentpartnersmpls/cratesurf/releases).

It needs nothing installed on your machine: no Python, no Node, no OpenSSH, no
package manager. It carries its own SSH client, so Windows, macOS and Linux all
behave the same way.

A release build from this tree has both payloads: armv7l for the MPC One+ /
Live II (Gen 1) and arm64 for the MPC XL / Live III (Gen 2). The installer probes
the unit, shows what it found, and asks you to confirm the model printed on the
unit before it downloads anything. It warns if that answer disagrees with the
probe, returns to the list when you say no, and refuses a Gen 1/Gen 2 cross-over;
there is no second build to choose. The published 0.1.2 binaries predate the Gen 2
payload, so use a release built from this tree for Gen 2. See
[README.md](../README.md#mpc-xl-and-live-iii-gen-2) for the hardware status (the
Gen 2 path has not been through this repository's hardware pass yet).

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
3. **Checks the device.** Model, architecture, board generation, firmware
   version, free space on `/data`, and whether CrateSurf is already there. It
   refuses to continue on a device it does not recognise rather than
   half-installing on it.
4. **Confirms the model.** It shows the model it read from the unit and asks you
   to choose the model printed on the unit: MPC One+, MPC Live II, MPC XL, or
   MPC Live III. It warns when the answer and the probe disagree. Answer `n` to
   go back to the list; a Gen 1/Gen 2 mismatch cannot be continued. The
   `--host` command-line path skips this question and trusts the probe, because
   scripts have no one to ask.
5. **Downloads the matching payload** (once, checksum-verified) and streams it
   into `/data/browser`. Gen 1 is armv7l/bookworm; Gen 2 is arm64/trixie.
6. **Installs the toggle service.** Gen 1 gets the unit in `/etc` plus a copy in
   the read-only firmware rootfs. Gen 2 installs
   `/data/mpc-addins/cratesurf-browse/install.sh` instead, because its root
   filesystem is dm-verity.
7. **Checks its own work.** The service is running, something is listening on
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
- **The password is saved, not just printed.** It goes to `~/.cratesurf/root-<host>.txt` (0600) on
  the computer that installed, and later runs of the installer try that before asking you anything.
  A lost key file is therefore survivable: that file is the way back in. If that file and the key
  are both gone, the unit has to be reached by reflashing the SSH firmware image, which resets
  root's password and leaves `/data` alone; [KNOWN-ISSUES.md](../KNOWN-ISSUES.md) has it in full.
- The key lives at `~/.cratesurf/id_ed25519` (0600) and one `Host` entry is appended to
  `~/.ssh/config` so plain `ssh root@<mpc>` keeps working. Nothing else on your machine is touched.
  The installer offers that key first on every later connection, which is what makes a second run
  from the same computer work without asking for the password again.
- The password is never sent anywhere. It is printed once, and the only file it goes into is the
  local `0600` file above.
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

`--payload` takes a local tarball or an `http(s)` URL, which is how local
testing works. A release build bakes one URL and checksum per architecture into
the binary with `-ldflags` (`PAYLOAD_URL_ARMHF` / `PAYLOAD_SHA256_ARMHF` and
`PAYLOAD_URL_ARM64` / `PAYLOAD_SHA256_ARM64`); the installer then has nothing to
configure and picks the pair from the detected board generation. The old
`PAYLOAD_URL`/`PAYLOAD_SHA256` names still mean armhf.

## How the payload is made

`make-payload.sh` builds the tarball, laid out the way `/data/browser` expects:

```
sysroot/            the Debian chroot: chromium, weston, pulseaudio
node/               the pinned Node runtime (armv7l or arm64)
bin/                the device scripts, including board.sh and board.js
mpc-browse.service  the Gen 1 unit
install-rootfs-unit.sh
mpc-gen2-hook.sh    copied to /data/mpc-addins/cratesurf-browse/install.sh on Gen 2
```

**Releases use `--release --sysroot`**, which builds from things that are in this repository and
nobody's computer: a `build-sysroot.sh CACHE_ONLY=1` tree, the files in git, and the pinned Node
download. That matters for privacy as much as reproducibility. A payload pulled off a working unit is
a snapshot of that unit's filesystem, and "nothing personal was in it this time" is not a property to
rely on for every release.

```sh
# Gen 1 (default name: cratesurf-payload-YYYYMMDD.tar.gz)
./make-payload.sh --release --sysroot /tmp/mpcsys/root

# Gen 2 (name: cratesurf-payload-arm64-YYYYMMDD.tar.gz)
ARCH=arm64 ./make-payload.sh --release --sysroot /tmp/mpcsys-arm64/root

# Internal only: snapshot of one unit. Set ARCH=arm64 if that unit is Gen 2.
./make-payload.sh --from-device root@mpc-one-mk2
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
PAYLOAD_URL_ARMHF=... PAYLOAD_SHA256_ARMHF=... \
PAYLOAD_URL_ARM64=... PAYLOAD_SHA256_ARM64=... ./build.sh     # with both releases baked in
```

The two pairs are independent: a Gen 1 install has no reason to download the
arm64 tree, and an XL must never be handed the armv7 one.

Needs Go 1.23 or newer, and nothing else. `CGO_ENABLED=0` for every target, so
each binary is static and self-contained.

## What this writes on the MPC

Exactly what `INSTALL.md` lists, and nothing else: `/data/browser` (the chroot,
the Node runtime, the scripts), the Gen 1 unit in `/etc/systemd/system/` and in
the firmware rootfs, or the Gen 2 hook under `/data/mpc-addins/cratesurf-browse`,
and the MPC's own autosave settings, so a switch into browse mode does not throw
away unsaved work. No audio, project, sample or plugin files are touched.
