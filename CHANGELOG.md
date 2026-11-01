# Changelog

All notable changes to CrateSurf. Dates are the day the change landed on the tested unit.

The project is alpha: expect the feature list below to move faster than the version numbers.

## [0.1.2-alpha] - 2026-10-31

### Added

- **A Bluetooth keyboard types in the browser once it is paired from the MPC itself.** The unit has
  no `bluetoothctl` or `btmgmt`; pairing belongs to Akai's own Bluetooth screen. After that the
  keyboard appears as an ordinary HID input node, libinput decodes it, and it types exactly like the
  USB keyboard - including making the on-screen keyboard stand down. Confirmed on the MPC One+ on
  2026-10-31. The earlier Live II report (a paired keyboard did not type) predates this pairing route
  and has not been retried.

### Changed

- **GPU raster was tried, measured, and backed out the same night.** `chrome-up.sh` had passed
  `--disable-gpu` since the first build, on a documented belief that the Mali here had no usable
  stack. That belief was wrong: the chroot has Mesa EGL on Panfrost (`Mali-T760`) and weston already
  hands Chromium a wayland socket. Removing the flag is 30x faster on paper, 561 ms median between
  frames down to 16.6 ms, 1.7 fps to 60.2, three runs, same page both times.
- **And it tears.** On the glass, scrolling feels wrong and a page load shows whole black frames and
  half-drawn frames with the nav bar missing. The benchmark that endorsed it measured frame timing
  and never inspected a single frame, which is why it passed a build that is unusable by hand. Speed
  that tears is worse than a page that is slow, so the flag is back and software raster is the
  default.
- **The GPU is now opt-in behind a file, not a script edit.** `touch /data/browser/run/chrome-gpu-raster`
  drops `--disable-gpu` on the next start and `rm` puts it back. `run/chrome-flags` remains additive
  for anyone testing `--disable-gpu-compositing`, `--use-gl=egl` or a newer Mesa against this driver.

## [0.1.1-alpha] - 2026-10-30

### Fixed

- **Browse mode switched over and then showed nothing.** The 0.1.0-alpha payload had no `/tmp` in the
  chroot, so Chromium aborted the moment it launched ("Failed to create socket directory": its
  ProcessSingleton socket lives in `/tmp`), and weston and PulseAudio could not open their logs. The
  MPC app stopped, the mode said `browse`, and the panel stayed empty. `browse-up.sh` now creates a
  sticky `/tmp` in the chroot on every entry, which also repairs units installed from the 0.1.0-alpha
  payload the next time they enter browse mode, and `make-payload.sh` ships an empty `sysroot/tmp`
  and refuses to pack without one. The new payload is the 0.1.0-alpha payload with exactly those two
  changes: the patched scripts and one empty directory.
- **Leaving browse mode could leave the panel black.** When browse mode was started by hand
  (`ssh root@<mpc> /data/browser/bin/browse-up.sh`, which the README documents), the stack and its exit
  server lived in the transient unit `mpc-browse-stack`. Tapping **MPC** or **EXIT BROWSE MODE** ran
  `browse-down.sh` from inside that unit, and its `systemctl stop mpc-browse-stack` killed the script
  along with everything else before it reached `systemctl start acvs`. The browser went, the MPC app
  never came back. `browse-down.sh` now moves itself into a unit of its own when it finds itself in
  that cgroup, so it always finishes. Browse mode started by the three-finger hold, the phone toggle or
  Ctrl+Alt+B was not affected.
- **The MPC button could do nothing after a reboot.** `browse-up.sh` started the exit server only when
  `run/exit.pid` did not exist, and that file lives on `/data`, so a reboot or power cut taken in
  browse mode left it behind with nothing running. Every later session then had no exit server and no
  working way out from the panel. It now checks that the pid really is a running exit server.

## [Unreleased]

### Docs

- **Confirmed on two models.** The README now lists the MPC One+ (Gen 1), confirmed up to firmware
  3.10 (and on 3.9.1 and 3.4.2.13), and the MPC Live II, confirmed up to firmware 3.9.1, both on
  rooted firmware. INSTALL.md's
  prerequisites say the same, and the Live II moves out of "might work on".
- **The MPC XL is confirmed working**, on rooted firmware. It is in the README's table, badge and
  header and in INSTALL.md's prerequisites. Its firmware version is not recorded yet.
- **Planned input features on the roadmap:** an on-screen keyboard and Bluetooth keyboard support.
- **Bluetooth mouse confirmed working** on the MPC Live II, with nothing added. A **Bluetooth keyboard
  does not work yet** on the same unit; it is the next item on the roadmap and is listed in
  KNOWN-ISSUES.md.

### Added

- **A keyboard for the glass.** The panel has no keyboard and this Chromium build ships no
  virtual-keyboard extension (`usr/lib/chromium/extensions` is empty), so the OSK switch bought
  nothing and every text box on every site was unusable - searching Freesound, logging in, naming a
  file. The bar carries a keyboard key (extension 1.6.0) and a panel of its own above it: number row,
  three full letter rows, Shift, Backspace, Enter, Space, a symbols page, and Esc / Tab / arrows in
  the title strip. It opens by itself when a text box is tapped, and never on a page's own autofocus,
  so an empty search box cannot pop it up unbidden. It goes away on a tap elsewhere, on navigation,
  and the instant a real keyboard types. Keys go in as `insertText`, with `setRangeText` for a field
  that refuses it; Enter, Tab, Esc and the arrows are dispatched as real key events, so a site's own
  search box answers them. Verified on the unit with no keyboard attached: typed into the start
  page's LOCATION field through the symbols page and back, submitted its form with ENTER, then ran a
  real search on Freesound by sending it Enter (17,002 results), and closed itself when a key arrived
  from the virtual HID keyboard. The first build stopped its letter rows at `l` and produced
  `treesouhd.org` for `freesound.org` - caught by reading the text back off the screen, not by any
  of the reasoning before it.
- **A one-step installer for Windows, macOS and Linux.** One binary, its own SSH client, no runtime to
  install first: run it, type the MPC's IP, press Enter. It probes the device and refuses anything it
  does not recognise, verifies and streams the ~315 MB payload into `/data/browser`, seeds the
  browser profile, installs the toggle, writes the unit into the read-only firmware rootfs, and then
  checks that the service is running, that 8798 is listening and that the browser binary is really
  there before it says it worked. Option 2 in its menu roots a stock unit the only way that exists:
  it checks the firmware image, puts it on a USB stick and gives you the MPC-side keystrokes. It
  deliberately does not download or bundle a firmware image. `installer/make-payload.sh` builds the
  payload from a working unit or from a sysroot build, so a release is one file and one checksum.
- **Root SSH is closed at the end of an install.** These units ship with an empty root password and
  sshd configured to accept it, so anyone on the same network is root with no credentials - that is
  how the installer gets in, and leaving it like that ships a back door. The last step sets a random
  24-character root password, proves it works by logging in with it and checking it is root, and
  restores the old `/etc/shadow` if it does not. It also installs a key at `~/.cratesurf/id_ed25519`
  with one `Host` entry in `~/.ssh/config`, so repeat installs and the repo's own scripts keep
  working. Secrets travel over stdin, never argv, so they are not visible in `ps` on the device.
  `--harden-only` applies it to an existing install, `--no-harden` skips it.
- **The root password is saved on your computer, not just printed.** Losing the key file (new laptop,
  tidied home directory, a restore that skipped dotfiles) used to be the same thing as being locked
  out of your own MPC, because the password appeared once on screen and nowhere else. It is now
  written to `~/.cratesurf/root-<host>.txt` (0600) beside the key, and the installer tries it before
  prompting on later runs. If both are gone, the documented way back is a reflash of the SSH image,
  which leaves `/data` untouched. Related and fixed in the same pass: the installer installed a key
  for "the next run" and then never offered it, so a second install from the same computer demanded
  a password it had no way to know. The proof that a new password works is still made with the
  password alone, so a key cannot make a broken password look good.
- **The host key is remembered instead of ignored.** The first connection shows the fingerprint and
  asks; after that a changed key is a hard stop, since a change means either a reflash or something
  answering for the MPC. `--accept-host-key` for scripted runs.
- **The release payload never touches a device.** `make-payload.sh --release --sysroot` builds from a
  `build-sysroot.sh` tree plus the files in git plus the pinned Node download, so a published
  artifact is reproducible from the repository alone. The device route stays for internal testing and
  says on screen that its output must not be published. `var/run` is excluded from both: it carried a
  live PulseAudio cookie from the unit that built the first payload.
- **Manual browse mode stops dying when the SSH session ends.** `browse-up.sh` run from a shell now
  re-execs into a transient unit of its own, and `browse-down.sh` stops that unit. See Fixed.

### Fixed

- **An unpack could sit at `unpacking 0 of 156` for ever, with no error and no way back.** The row
  stayed on the zip, the counter never moved, and pressing **UNPACK** again joined the same dead job:
  the extract hung inside its own process, before the first file was written, with only the archive's
  descriptor open. Nothing in the stream path explained it, and the identical call finished the
  identical pack in a fresh process, so the pipeline was replaced instead of guessed at:
  `device/bin/unpack.js` now reads each entry's compressed bytes positionally with `readSync`,
  inflates them with `zlib.inflateRawSync` on the calling thread, checks the size and the CRC, and
  writes the file, with **one** descriptor for the whole archive and a yield every 8 files so the
  panel's progress poll is still answered. There is no stream, no thread-pool thread and no deadlock
  surface left, and it is faster for it. Behind it, a watchdog: a job whose progress has not moved in
  45 s is marked failed with *"it stopped making progress"*, so the next thing that stalls costs 45
  seconds and an honest message instead of lying at 0 % for ever, and the row offers **UNPACK**
  again. Measured on the unit with a real pack: 156 files, 530 MB, unpacked into `MPC Documents/
  Samples` in 87 s with the counter moving the whole way, every CRC checked, scratch folder gone and
  the zip untouched; pressing it a second time made `… 2` beside the first.
- **A release payload had no start page, no nav bar and no `weston.ini`.** `deploy.sh` copies
  `device/ext`, the four `.html` pages and `device/weston.ini` into the chroot by hand, so a unit
  that had been deployed to was fine and a payload built from a `build-sysroot.sh` tree was not: the
  chroot half was there and the half that makes it CrateSurf was missing, which on a fresh install
  would have meant a portrait panel with no rotation, no bar and a 404 where `/home` should be.
  `make-payload.sh` now stages those files from the repo on both routes, and fails instead of
  packing if any of them is absent.
- **A browser started over SSH died seconds later, with nothing in any log.** `setsid` gives weston
  and Chromium a new session but does not move them out of their systemd *cgroup*, and sshd's session
  is its own scope: when the connection closed, systemd killed the scope and took the whole stack with
  it. The service path was never affected, which is why the phone toggle and the three-finger hold
  always worked and this looked like a firmware bug. Diagnosed on 3.10.0.49 by starting the stack
  three ways and watching which one survived.

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

- **Verified on firmware 3.10.0.49.** The October 2026 update left `/data` untouched, so the chroot,
  the Node runtime and the scripts came through exactly as they were; the only casualty was the boot
  copy of the unit in the read-only rootfs, which is the documented firmware-update behaviour and
  what `deploy/install-rootfs-unit.sh` puts back. `mmcblk0p6`, `acvs.service`, `DSI-1`, `hw:1,0` and
  the settings path were identical, so the install itself did not have to change. The one thing that
  did: 3.10's `/usr/bin/MPC` carries no version string, so the probe reads the firmware from
  `/usr/share/Akai/SME0/VERSION` and falls back to the old `strings` grep on 3.4.2.13.
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
