# CrateSurf by SPS

**A real web browser on your MPC.** Chromium on your MPC's own touchscreen, with sound,
downloads that land straight in `MPC Documents/Samples` and unpack there, and a navigation bar on
every page because kiosk mode has none. Dig for samples on the machine you are going to chop them
on, instead of shuttling files across from a computer.

[![status](https://img.shields.io/badge/status-0.1.1--alpha-e0243f?style=flat-square)](#read-this-first)
[![works on](https://img.shields.io/badge/works%20on-MPC%20One%2B%20%C2%B7%20MPC%20Live%20II-00c8b4?style=flat-square)](#confirmed-working)
[![made with](https://img.shields.io/badge/made%20with-a%20browser%20that%20should%20already%20be%20there-1f2937?style=flat-square)](#why-turning-it-on-means-turning-the-mpc-off)
[![licence](https://img.shields.io/badge/licence-MIT-3b82f6?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/badge/CI-needs%20the%20hardware-4b5563?style=flat-square)](#contributing)

**Version 0.1.1-alpha** · MIT licensed · confirmed on the MPC One+ (Gen 1) up to firmware 3.10 and the MPC Live II up to 3.9.1

![The CrateSurf start page on the MPC panel](docs/start-page.png)

> **Your MPC ships with no browser.** Samples live on the internet, the MPC is where you chop
them, and the wire between those two facts was a USB stick and a laptop. That is the whole
reason this exists.

---

## READ THIS FIRST

This is **alpha software that modifies your MPC**. It writes ~800 MB of Debian userland to
`/data`, installs a systemd unit, and (only if you ask it to, with `--boot`) adds a file to the
MPC's read-only firmware partition. It stops and starts the MPC application to borrow the screen.

**Nobody is responsible for what happens to your device except you.** Not the author, not Akai,
not inMusic, not anybody who helped write it. That includes a dead panel, a boot loop, a wiped
project, a reformatted card, a voided warranty, or a bricked MPC. Read [DISCLAIMER.md](DISCLAIMER.md)
before you install anything; it is short and it is not a joke.

Three real risks, in plain words:

1. **Browse mode stops the MPC app, and the MPC app does not save your project when it exits.**
   CrateSurf turns the firmware's own autosave on before it stops the app, which is what makes it
   survivable, but up to 5 minutes of work can still be missing from the autosaved copy, and a
   project you have never saved is not protected at all. **Save your project before switching into
   browse mode.** This is the risk that will actually bite you.
2. **`install-service.sh --boot` writes to the firmware rootfs.** It remounts `/` read-write for a
   few seconds, copies one unit file, and remounts read-only. It is additive and verified, and
   [INSTALL.md](INSTALL.md#uninstalling) has the reverse of every step, but it is still your
   firmware partition.
3. **The port 8798 toggle has no authentication.** It is meant for a home LAN. Do not port-forward
   it, do not put it on a public network, do not expose it through a tunnel.

If that is all fine by you: welcome. It is a genuinely good way to browse for samples.

---

## What it actually is

The MPC's OS is a Yocto image with no package manager, no X, no Wayland, no GTK, no SDL, and no
Node. It does, however, ship **glibc 2.39**, which is the whole opening: Debian bookworm armhf
binaries only need 2.36, so they run here unmodified.

So CrateSurf is an **armhf chroot** full of real Debian packages (Chromium 150 when this was built, weston 10,
libinput, PulseAudio, fonts, the cursor theme), built on your PC from `.deb` files and copied to
`/data/browser/sysroot` on the MPC. A chroot rather than `LD_LIBRARY_PATH` because weston finds its
modules, and Chromium its resources, by absolute compiled-in paths.

On the device, one always-on Node server (port 8798) does the switching, and a small Chromium
extension draws the bar. Nothing runs on your computer at runtime. **Nothing in this project talks
to the internet except the browser you are using**, and the build script, which fetches the
`.deb` files from `deb.debian.org`.

## Why turning it on means turning the MPC off

`/usr/bin/MPC` holds DRM master the whole time it runs, and DRM master is exclusive, so a
compositor cannot draw while the MPC app is up. Browse mode is therefore a **mode switch, not a
window**: the MPC app stops, the browser owns the panel, and leaving browse mode starts the MPC app
again. There is no side-by-side. Nothing about the app is modified, but it does come back on its
template picker rather than the project you had open, because it does not reload the last project
on launch.

## Confirmed working

Two models so far, both on rooted (SSH-enabled) firmware:

| Model | Confirmed up to firmware |
| --- | --- |
| **MPC One+** (Gen 1) | **3.10** (also 3.4.2.13) |
| **MPC Live II** | **3.9.1** |

"Up to" means the newest firmware someone has actually run it on, not a limit anyone knows about.
A newer firmware may well work; it just has not been checked yet. If you run it on a model or a
firmware that is not in this table, an issue saying so (good or bad, with the model and firmware
version) is how this table grows.

## The development unit

Everything was built and debugged on one MPC One+. This is that unit, in detail:

| | |
| --- | --- |
| Device | Akai Professional MPC One+ (the Gen 1 One+, board `inmusic,az05`) |
| SoC | Rockchip RK3288, armv7l, 2 GB RAM, 2 cores |
| MPC OS | **3.10.0.49** and **3.4.2.13** (build `33b99bdb8ac`) |
| Kernel | 6.18.44-az01-2026-08-10-rt6 on 3.10, 6.6.74-az01-2025-01-23-rt47 on 3.4.2.13, both PREEMPT_RT |
| Base OS | Yocto 5.0.18 (scarthgap) on 3.10, 5.0.5 on 3.4.2.13; glibc 2.39 and systemd on both |
| Panel | `DSI-1`, 800x1280 portrait, rotated by weston to 1280x800 landscape |
| Audio | card 1 `ACVA` (`hw:1,0`), behind PulseAudio |
| Browser | Chromium 150.0.7871.100 in the chroot, weston 10.0.1, `--disable-gpu` |

The MPC firmware version matters, and two of them have now been through it. Everything here was
found on 3.4.2.13 and re-verified on 3.10.0.49 after the October 2026 update: `/data` came through
untouched, so the chroot, the Node runtime and the scripts were exactly as they were, and the only
thing the update took out was the boot copy of the unit in the read-only rootfs, which
`deploy/install-rootfs-unit.sh` puts back. The rootfs partition, `acvs.service`, the panel
connector, the codec and the settings path were all the same on both builds. A third firmware can
still move any of them, which is what `tools/probe-device.sh` is for: run it after an update
instead of assuming.

## Might work on

**Untested. Assume it will not work until it does.** The thing that makes CrateSurf possible is a
specific combination, and a device has to have all of it:

- **armv7 (32-bit ARM) with a glibc of 2.36 or newer.** Check: `getconf GNU_LIBC_VERSION`.
- **A DRM panel that weston 10 can drive**, appearing as a connector (`card1-DSI-1` on the tested
  unit). Check: `ls /sys/class/drm`.
- **systemd, with an `/etc` overlay and a `/data` partition holding a couple of GB.** Check:
  `df -h /data`.
- **The MPC app present as `acvs.service`** and stoppable. Check:
  `systemctl status acvs`.
- **Root SSH access.** This project does not provide any way to get that; if you do not already
  have it, you are done before you start.
- **Nothing else installed.** The firmware ships no Node, so the project brings its own: one
  official armv7 binary, pinned and checksummed, at `/data/browser/node/bin/node`. Everything else
  runs from the Debian chroot the project builds. See
  [INSTALL.md](INSTALL.md#prerequisites).

The MPC One+ and the MPC Live II are confirmed (see [Confirmed working](#confirmed-working)).
Other RK3288-era MPCs (the first Live, the X) are the plausible next candidates, and they are
plausible rather than confirmed: different panel connectors, different partition layouts and different
firmware builds have all been seen across the range. Later MPCs on other SoCs are close to
certainly out.

There is a read-only probe for exactly this. Run it against your device before you touch anything:

```sh
./tools/probe-device.sh            # uses MPC_HOST, default root@mpc-one-mk2
```

It reports each of the axes above and prints `shape matches the tested unit` or names what does
not. It changes nothing on the device. If it says something does not match, that is not a bug
report we can act on; it is a device this has never been near.

## What it does not do

No tabs, no omnibox, no bookmarks, no extensions you can install yourself, and no PDF viewer you
would want. No hardware volume (card 1 exposes no ALSA mixer elements, so
PulseAudio's sink level is the only knob). The MPC's pads, knobs and data wheel cannot drive the
browser, because they are not Linux input devices on this unit. Fullscreen is refused on purpose,
so a video player that demands it will complain. Recording captures what the browser is playing,
not a microphone.

## Install

**Use the installer.** Download it for your computer, run it, type the MPC's IP, press Enter:

```
cratesurf-installer-windows-amd64.exe     Windows
cratesurf-installer-darwin-arm64          macOS (Apple silicon)
cratesurf-installer-linux-amd64           Linux
```

It needs nothing installed on your machine - not Python, not Node, not OpenSSH. It checks the device,
downloads and verifies the chroot, copies it over, installs the toggle, writes it into the firmware
rootfs so it starts at boot, and then checks its own work. See
**[installer/README.md](installer/README.md)**.

An MPC needs root SSH before any of this can happen, and a stock unit does not have it. Option 2 in
the installer's menu walks that through, including putting the firmware image on a USB stick.

### From source, if you would rather see the steps

You need: a computer that can `ssh` and `scp` to the MPC, root on the MPC, and a Debian or Ubuntu
machine to build the chroot on (any recent one; the script sandboxes `apt` and installs nothing
system-wide).

```sh
git clone <the URL from this repo's green Code button> cratesurf
cd cratesurf

export MPC_HOST=root@192.168.1.50     # or root@mpc-one-mk2 if mDNS resolves

./tools/probe-device.sh               # does the device look like the tested one?
./build-sysroot.sh                    # ~240 MB of armhf .debs -> /data/browser/sysroot (~750 MB)
./deploy.sh                           # scripts, extension, weston.ini, kiosk pages
./deploy/install-service.sh --boot    # the 8798 toggle, and start it at boot
```

Then, on the MPC itself, hold **three fingers on the glass for 2.5 seconds**, or open
`http://<mpc-ip>:8798/` from your phone and tap **BROWSE ON THE MPC**.

Every step, every prerequisite, what each one writes, how to verify it and how to remove it again
is in **[INSTALL.md](INSTALL.md)**. Follow that rather than improvising; the order matters.

**That block is the hard part**, and it is why the installer exists: it assumes root SSH on a device
with no terminal app, and a Debian box with a package manager on another machine. Both routes land in
the same place; the installer just does it without asking you to learn any of it.

![The REC button recording the browser's own output](docs/rec-take.png)

## Using it

**Getting in**, three ways, because the panel belongs to the MPC app until something takes it:

- **three fingers held for 2.5 s**, anywhere on the glass, however close together. This is the one
  that matters, because it needs no other device.
- **Ctrl+Alt+B** on a USB keyboard plugged into the MPC.
- **`http://<mpc-ip>:8798/`** from your phone or PC, then **BROWSE ON THE MPC**.

**The bar.** Kiosk mode has no browser chrome, so the extension puts one in the bottom right of
every page: start page, back, forward, reload, downloads, **REC**, **MPC**, and a minimize box that
collapses the bar to a tab. It lives in a shadow root so a site's CSS cannot restyle or hide it,
and it re-appends itself if an ad covers it. **MPC** is the guaranteed way out: one tap ends the
session and hands the panel back, whatever the page is doing.

**Downloads** land in `MPC Documents/Samples` by default, which is the MPC's own sample folder, and
**SAVE TO** on the save card sends one to any other folder under `MPC Documents` instead -
`Expansions`, `Tracks`, whatever is really on the unit rather than a hardcoded few. The choice is
remembered on the device, so the next file lands there too until you change it. Kiosk mode paints no
download bubble, so the bar's panel is the only download UI there is, and it carries the whole job:
what is running with percent and **CANCEL**, what stopped with the reason in plain words and
**RETRY** / **DROP**, what finished with its size and **PLAY** if it is audio, and **GET AGAIN** when
the file has since left the folder. **DROP** forgets the row, never the file. Free space in the
folder currently chosen is printed next to the title, and `FILES` opens the document tree itself.

**The size before you commit.** Tapping a file link - an archive, a sample pack, anything the
browser would save rather than show - puts a card in the corner *before* anything moves: the name it
will save under, where it is going, how big it is, and how much room that folder has left. A pack
that cannot fit
says so in red and the button reads **WON'T FIT** rather than starting a transfer that dies at the
end. The size is one `HEAD` request made by the device, so it costs seconds, not the download; the
button stays shut while it is being asked, and a site that will not answer gets **size unknown** and
your call. Links the browser would show - audio, images, a PDF, another page - are left alone.

**A downloaded `.zip` unpacks on the device.** The row offers **UNPACK**, the bar counts files while
it runs, and the pack lands in the sample folder as a folder of its own - `Samples/Pack/Drums/...`,
not `Samples/Pack/Pack/...` - so the MPC sees the whole pack without a computer in the middle. It
refuses what it cannot do honestly rather than half-doing it: a password, a compression method zlib
lacks, an archive whose member names try to write outside the folder, a pack bigger than the free
space. Unpacking reads the zip in the browser's own runtime, so there is no `unzip` to install and
no firmware detail to depend on. Once the pack is out, the row offers **DELETE ZIP** for the archive
itself - a 300 MB zip is the second copy nobody needs on a 16 GB card - and only after an unpack
that finished, because removing a zip that was never opened would be removing the only copy. The
unpacked folder is never touched.

**REC** records whatever the browser is playing, straight into the sample folder as
`Web Grab NNN.wav`, at 44.1 kHz 16-bit stereo. Press it, play the thing, press it again. A take
stops itself after 10 minutes. This is the feature people end up using most.

**Getting out**: `EXIT BROWSE MODE` on the start page, the **MPC** button in the bar, or from a
shell:

```sh
ssh root@<mpc-ip> /data/browser/bin/browse-down.sh
```

## Known issues

Alpha means there is a list, and it is written down instead of discovered by you:
**[KNOWN-ISSUES.md](KNOWN-ISSUES.md)**. The five that matter most:

1. Saving first is on you, always (see risk 1 at the top).
2. The port 8798 toggle has no authentication.
3. A **Bluetooth keyboard** does not work in the browser yet (confirmed on an MPC Live II); a USB
   keyboard does, hotplug and all. A **Bluetooth mouse** works on the Live II. A wired mouse has
   not been in a port on either unit yet.
4. The three-finger hold can fire from a hand resting on the panel. Duration is the only thing left
   separating a deliberate hold from a hand sitting still for 2.5 s, and that is an accepted trade.
   `HOLD_MS` in `device/bin/touch-launcher.js` is the knob.
5. Pages are usable, not snappy. There is no GPU: the Mali driver here is a vendor blob, so
   Chromium rasterises in software on an RK3288.

## What has actually been tested

On the unit, by a person, not simulated:

- **A USB keyboard**, plugged into the MPC, driving the browser and the bar, including hotplug in
  the middle of a session and `Ctrl+Alt+B` as a way in.
- **The three-finger hold**, with real fingers on the glass, repeatedly. It is also unit-tested and
  fires from a synthetic digitizer, but the fingers are the part that counts and they work.
- **Downloads**, from real sites, landing in `MPC Documents/Samples` and being there afterwards,
  including a 300 MB file with live progress in the panel. What lands is a complete, playable file,
  not a zero-byte stub.
- **Choosing where a file lands**, on the glass: the card opened on the folder remembered from the
  last time, the picker listed the fourteen folders that are really on the unit with the current one
  marked, a pack sent to `Tracks` arrived in `Tracks` and not in `Samples`, **UNPACK** put the pack
  next to it in `Tracks`, **GET AGAIN** after deleting the file restored it to `Tracks` rather than
  to the default, and the whole choice survived a browser restart.
- **Unpacking**, from the panel: a 28 MB pack of 101 files unpacked into the sample folder and then
  compared file by file against the tree it was zipped from, 101 of 101 identical by sha256, empty
  folder included, nothing left in a scratch folder. A zip whose names escape the destination was
  refused with the reason on the row and nothing written.
- **REC**, producing a WAV whose loudest bin is exactly the frequency the page was playing.
- **Getting back out**, by the MPC button and by the start page, with the MPC app returning.
- **Sound**, listened to on the unit's own output. Audio was already proven at the signal level
  (`hw_ptr` advancing); it has since been heard, so this is not a number pretending to be a sound.
- **Boot persistence**, surviving two cold reboots.

Since then, a tester confirmed on an **MPC Live II** that a **Bluetooth mouse** works in the
browser. A Bluetooth keyboard does not yet. What is left unproven is a wired mouse in a port. That
is in [KNOWN-ISSUES.md](KNOWN-ISSUES.md), along with the things that are missing rather than
untested.

## What is coming

[ROADMAP.md](ROADMAP.md) has the list. The short version, because these are the things people ask
for first: **choosing where a download goes** instead of everything landing in the library, and a
**graphical installer** so the first connection does not have to be a paragraph of shell.

And the one that matters most for anyone finding this repo cold: **a graphical installer**. The
build-a-chroot-over-SSH route above is honest and it works, but it is a lot to ask before you have
seen a browser, and we know it. A GUI installer and a USB-stick route are the next pass.

## Contributing

Yes please. This thing was built in a week against one unit and there is a lot of obvious surface
left: tabs, a keyboard-aware URL entry, better scrolling, tar archives, gesture tuning, and the
whole of the untested list above.

Read [CONTRIBUTING.md](CONTRIBUTING.md) first. It maps the code, explains how to test on the
device without breaking a session, and lists the landmines that already cost someone an evening,
so you do not pay for them twice. Issues and PRs both welcome, and "it does not work on my MPC
Live II" is a useful report as long as you say which model and firmware.

There is no CI. Everything here needs the hardware; a green checkmark would prove nothing.

## Uninstall

Every step is reversible and [INSTALL.md](INSTALL.md#uninstalling) has the exact commands,
including removing the unit from the firmware rootfs and putting the MPC back exactly as it was.

## Tip jar (optional, genuinely optional)

CrateSurf is free, MIT, and stays that way. It was built for the love of the thing, not for a
business plan, and nothing in it is gated behind money.

That said: bills are real, model tokens are real, and this project runs on an unreasonable
amount of caffeine. So if it saved you an evening of shuttling WAVs across a room and you feel
like throwing something at it, that pays for the next one. Don't feel obliged. Nobody is owed
a dime and there is nothing behind the door.

- **Link:** *[ add the tipping link here ]*
- ETH OR ETH MVs: 0x4a67aDC380dD13c592198285c10EA97de9243dBb

## Credits and license

**CrateSurf by SPS** (*silent partner smpls*).

Built by two of us: the human who owned the question, the hardware and every design call, and
the AI that wrote the code and ran the tests. Both are named in
[CONTRIBUTORS.md](CONTRIBUTORS.md).

MIT licensed, see [LICENSE](LICENSE). Do what you like with it, keep the copyright line.

Not affiliated with, endorsed by or supported by Akai Professional or inMusic. "MPC" is their
trademark; it is used here only to say what this runs on.

Chromium, weston, PulseAudio and the rest of the chroot are Debian packages fetched at build time
and are **not** vendored in this repository. Their licences travel with them into the sysroot you
build; if you redistribute the sysroot, redistribute those licences with it.
