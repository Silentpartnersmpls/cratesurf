# Changelog

All notable changes to CrateSurf. Dates are the day the change landed on the tested unit.

The project is alpha: expect the feature list below to move faster than the version numbers.

## [Unreleased]

### Added

- **Delete the `.zip` once it has unpacked.** A pack is 30-300 MB and the unpacked folder is what you
  wanted, so keeping both doubles the cost of every download on a 16 GB card. The row offers **DELETE
  ZIP** after an unpack that finished, and behind it a new loopback `/rm` route that only accepts a
  zip this server actually unpacked (`jobs` is the guard, not the caller), so it cannot be talked
  into removing anything else; the row is erased with it, because a row for a file you chose to
  delete would just offer to fetch it back. The offer is re-read from the server on every page load,
  since an unpack outlives the page it was started from.
- **Choose where a download lands.** The save card's title strip now names the folder it will land in
  and is the thing you press to change it: the picker lists the folders that are really under `MPC
  Documents` on the unit, with the current one marked, and the choice is remembered on the device
  (`/data/browser/run/dest`, served by new `/dest` and `/dirs` routes) rather than in the page,
  because page storage is per site and the bar runs on every site. Changing the folder re-answers
  "does it fit" for that folder without asking the site again. Retry and **GET AGAIN** restore to the
  folder the file came from, **UNPACK** unpacks next to the file, and **PLAY** and the file page read
  the path under the document root, so nothing assumes the sample library any more.
- **The size of a file, before you commit to it.** A tap on a file link now raises a card with the
  name it will save under, its size and the free space in the sample folder, and the download starts
  only when **DOWNLOAD** is pressed - instead of the first size anyone saw being the percent of a
  transfer already running. The size is one `HEAD` request made by the device (new `/probe` route,
  `device/bin/probe.js`), with a one-byte ranged `GET` as the fallback for servers that refuse
  `HEAD`, so it costs seconds rather than the download. A pack that cannot fit is called out in red
  and the button reads **WON'T FIT** and cannot be pressed; the button is also shut while the answer
  is pending, because a press during the check is the blind commit this replaces. Only links the
  browser would save rather than show are caught - audio, images, PDFs and pages are untouched.
  Failures are reported in words ("could not reach that site: the connection was cut"), never as a
  runtime's error code.
- **Sizes over a gigabyte read in GB** in the panel and on the card, instead of "10240.0 MB".
- **Unpack a downloaded `.zip` on the device.** A finished zip row now offers **UNPACK**; the bar
  counts files and fills a bar while it runs, and the pack appears in the sample folder as a folder
  the MPC can read. `device/bin/unpack.js` reads the archive with Node's own `zlib` - the firmware's
  `unzip` is BusyBox and the Debian one lives only inside the chroot, so depending on either would
  have been a firmware detail or a sysroot rebuild for every install. It folds a pack's single top
  folder (no `Samples/Pack/Pack/`), keeps empty folders, verifies each file's CRC so a corrupted
  entry is not shipped as a click, refuses a password, a compression method zlib lacks, a
  multi-disk archive or a member name that escapes the destination before writing anything, checks
  free space against the unpacked size, and names a second unpack `Pack 2` instead of overwriting
  the first. Extraction happens in a scratch folder and is moved into place, so a half-unpacked
  folder never appears under the real name.
- **DROP on finished rows.** A download that has completed could never be removed from the list, so
  old rows accumulated with no way out. **DROP** is now on finished and gone rows too, and it still
  only forgets the row - the file is untouched.
- **A download manager in the bar.** The panel now treats running, stopped and finished downloads as
  three different things instead of printing the same row for all of them: running has percent and
  **CANCEL**, stopped has Chromium's error enum translated into plain words (`CRASH` reads "the
  browser closed before it finished") with **RETRY** and **DROP**, finished has its size, **PLAY**
  for audio and **GET AGAIN** when `exists` says the file has left the folder. Retry resumes the
  bytes already on disk when the server allows it, asks again when it does not, and removes the row
  it replaced so the same file is not listed twice.
- **Free space in the downloads panel**, from a new `/space` route on the control server, so a large
  pack is not started on a full sample folder and left to die at the end with a file error.

### Changed

- **The whole `MPC Documents` tree is mounted inside the chroot at `/downloads`, and the profile's
  download directory is that root instead of `Samples`.** Chromium has no per-download directory, so
  a folder can only be chosen by putting it in front of the file name, and that needs the root as the
  starting point. `browse-up.sh` replaces an older `Samples`-only bind when it finds one. The visible
  consequence, documented rather than hidden: a download the page starts itself now lands in the root
  of `MPC Documents` instead of in `Samples`.

### Fixed

- **A file page link saved under a name with the folder glued to it.** The `/files/<file>` route
  encodes a whole relative path into one URL segment (`Samples%2Fpack.zip`), and the name was taken
  from the raw path, so the card read `Samples/ui-test.zip` and the saved file would have been
  `Samples_ui-test.zip`. Decoded before the basename, in the probe and in the bar.
- **The downloads panel no longer says "nothing downloaded yet" right after a DOWNLOAD press.**
  Chromium's download table answers empty for a moment after its worker starts and again as a
  transfer begins, so the panel now waits for the row it just started instead of accepting that
  answer, and says "reading the list…" while it does.
- **CrateSurf no longer needs another project installed on the MPC.** The toggle unit and
  `browse-up.sh` pointed at `/data/mpc-agent/runtime/node/bin/node`, a Node runtime belonging to a
  different project, so an install on a device without that project produced a unit that could not
  start. `deploy/install-node.sh` now fetches the pinned official armv7 Node (v22.23.4, sha256
  checked, `bin/node` only) to `/data/browser/node/bin/node`, and `deploy.sh` and
  `deploy/install-service.sh` both call it. `install-rootfs-unit.sh` still recognises the old
  `ExecStart` so an existing install upgrades instead of refusing, and `probe-device.sh` reports the
  runtime as project state rather than as a requirement of the device.

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
