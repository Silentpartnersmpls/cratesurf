# Changelog

All notable changes to CrateSurf. Dates are the day the change landed on the tested unit.

The project is alpha: expect the feature list below to move faster than the version numbers.

## [0.1.0-alpha] - 2026-10-29

First public release. Everything here has run on one MPC One+ (Gen 1, firmware 3.4.2.13) and
nothing else.

### Added

- **A browser on the MPC.** Chromium in an armhf Debian chroot on `/data/browser/sysroot`, drawn by
  weston 10 straight onto the DSI panel through DRM, rotated to 1280x800.
- **Browse mode as a mode switch.** `browse-up.sh` stops the MPC app (which holds DRM master),
  mounts what the chroot needs, starts PulseAudio, weston and Chromium kiosk; `browse-down.sh`
  reverses it and gives the panel back.
- **Three ways in:** three fingers held for 2.5 s on the glass, Ctrl+Alt+B on a USB keyboard, or the
  phone/PC toggle on port 8798.
- **The CrateSurf bar.** A Chromium extension injects navigation into every page in a shadow root:
  start page, back, forward, reload, downloads, REC, an MPC exit button and a collapse tab. It
  re-appends itself if something covers it, and it refuses fullscreen requests so a page cannot take
  the panel hostage.
- **Downloads that land in the library.** Chromium's download folder is bound to
  `MPC Documents/Samples`, with a download panel showing bytes and percent because kiosk mode paints
  no download UI at all.
- **REC.** Records the browser's own output through PulseAudio's monitor into
  `MPC Documents/Samples/Web Grab NNN.wav`, 44.1 kHz 16-bit stereo, header patched as it writes, 10
  minute cap.
- **Project autosave, turned on for you.** `mpc-autosave.sh` enables the firmware's own autosave
  while the MPC app is stopped, so switching into browse mode stops being a destructive action.
- **The CrateSurf look.** Netscape Navigator in dark chrome: raised bevels, title and menu strips, a
  sunken Location field, sea-teal accent, a crate mark that still reads at 19 px.
- **USB keyboard and mouse**, hotplugged, with `xkb-data` and a cursor theme in the chroot.
- `tools/probe-device.sh`, a read-only check of whether an unknown device has the shape this
  project assumes.
- `tools/touch3.c` and `tools/grabcheck.c`, the synthetic multi-touch digitizer and the input-holder
  probe used to test all of this without fingers.

### Verified on the device

Chromium and weston run and repaint; real sites (Freesound, SampleFocus) render; the touchscreen
reaches Chromium through libinput; a download lands in the sample folder (a 44.1 kHz WAV, and a
300 MB file with live progress); audio reaches the ACVA codec with `hw_ptr` advancing; the toggle
drives both directions over HTTP; stop-by-process-name leaves nothing behind; the toggle starts at
boot after two cold reboots; the bar survives an ad with `z-index: 2147483647`; a finger on REC
produces a WAV whose loudest bin is exactly the 440 Hz the page was playing; the launch gesture
fires four runs in a row from a synthetic digitizer spaced like a hand.

Also confirmed with real hardware in the loop, not a simulation: **the three-finger hold launches
browse mode with actual fingers, repeatedly**; **a USB keyboard** drives the bar and `Ctrl+Alt+B`,
including hotplug mid-session; and **downloads land as complete, playable files** in the sample
library, from ordinary sites, with a 300 MB transfer finishing in the panel with live progress; and
**sound has been listened to on the unit**, so audio is confirmed by ear and not only by `hw_ptr`
moving.

### Known gaps at this tag

See [KNOWN-ISSUES.md](KNOWN-ISSUES.md) for the full list. The ones worth repeating: no physical
mouse has been in a port, the 8798 toggle has no authentication, there is no hardware volume
control, and unsaved MPC projects are still only partly protected by autosave.

### Notes

- Only the MPC One+ Gen 1 on firmware 3.4.2.13 has been tested. Later firmware may move the
  partition the boot unit is written to; `install-rootfs-unit.sh` refuses to guess.
- There is no CI. Nothing here is checkable without the panel and the input stack.
