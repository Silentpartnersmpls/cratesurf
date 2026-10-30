# Contributing to CrateSurf

This is an alpha built in a week against one MPC One+. There is more obvious work here than there
is finished work, and the fastest way to make it better is for somebody with a different MPC, a
different set of sample sites or a different pair of hands to try it and say what broke.

Issues and pull requests are both welcome. Please read the two sections that matter before you
start: [How to test](#how-to-test) and [Landmines already mapped](#landmines-already-mapped). Both
exist because someone already paid for the lesson.

## What is most useful

In rough order of value:

1. **A report from another MPC model.** Run `./tools/probe-device.sh`, attach the output, say what
   happened. Even "the probe says the panel is on `card1`, not `card0`" is a real contribution.
2. **Real fingers on the launch gesture.** The detector is proven with synthetic touch and never
   with a hand. If it fires, or refuses, say so and say what you were doing.
3. **Real keyboard or mouse in a real port.** Same story: everything except the cable is proven.
4. **Sites that break the bar.** A site whose CSS, iframes or z-index beat the injected bar, with
   the URL, is a bug with a clear fix.
5. **Any of [KNOWN-ISSUES.md](KNOWN-ISSUES.md)** that you feel like closing. The Node path being
   hardcoded in three places is the friendliest first one.

## Ground rules

- **Do not open a PR that claims hardware verification it does not have.** This project has a
  written record of exactly what was tested how; matching that standard is the whole culture.
  "Untested, needs a device" is a perfectly good status for a change.
- **The device is run by a busybox userland.** Shell scripts on the MPC are POSIX `sh`, not bash,
  and `head -1`, `pgrep`, `ss` and friends may not exist. Check what you use.
- **Node code is standard library only.** There is no `npm install`, no bundler and no dependency
  tree on the MPC. `http`, `fs`, `path`, `child_process` and nothing else.
- **No new runtime dependency that has to be fetched at boot.** The device has no package manager.
- **Keep the four visual surfaces in step.** The chrome colours are the same handful of literals in
  `device/home.html`, `device/ext/nav.js` and `device/bin/control-server.js`. Change one, change
  all, or it stops looking like one product.
- **Small diffs, explained.** Say what you changed, how you tested it, and what you could not test.

## The code, in one screen

```
build-sysroot.sh              builds the armhf Debian chroot on your PC, ships it to /data
deploy.sh                     copies device files to the MPC and seeds the Chromium profile
deploy/install-service.sh     installs the 8798 toggle; --boot also writes the firmware rootfs
deploy/install-rootfs-unit.sh runs ON the MPC, writes the unit into /dev/mmcblk0p6

device/bin/browse-up.sh       enter browse mode: autosave, mounts, stop acvs, pulse, weston, chromium
device/bin/browse-down.sh     leave browse mode: stop everything, unmount, start acvs
device/bin/chrome-up.sh       Chromium kiosk on the weston socket (kiosk flags live here)
device/bin/weston-up.sh       weston on DRM, discovers the wayland socket name
device/bin/pulse-up.sh        PulseAudio --system on hw:1,0, because Chromium has no ALSA backend
device/bin/fix-prefs.sh       re-injects the download prefs before every launch
device/bin/setup-profile.sh   one-time profile seed (download folder, policies)
device/bin/killproc.sh        the ONLY supported way to stop a program (by /proc/<pid>/comm)
device/bin/mpc-autosave.sh    turns the MPC app's own autosave on while the app is stopped
device/bin/control-server.js  the always-on server on 8798: toggle page, start page, files, rec, unpack, probe
device/bin/touch-launcher.js  the three-finger / Ctrl+Alt+B detector
device/bin/recorder.js        parec -> WAV in MPC Documents/Samples
device/bin/unpack.js          reads a .zip with Node's zlib and extracts it into the sample folder
device/bin/probe.js           HEADs a link so the bar can show its size and name before saving it
device/bin/exit-server.js     loopback endpoint behind the EXIT button
device/ext/                   the Chromium extension: bar (nav.js), worker (bg.js), main-world (main.js)
device/home.html              the kiosk start page
device/calib.html             prints touch coordinates, for checking the panel mapping
device/keys.html              prints key events, for checking a keyboard
device/weston.ini             connector DSI-1, rotate-90 to get 1280x800

tools/touch3.c                synthetic multi-touch digitizer (holds N fingers, or taps a point)
tools/grabcheck.c             who holds each input device exclusively, plus axis ranges
tools/probe-device.sh         read-only compatibility probe for an unknown MPC
```

The single most important architectural fact: **the MPC app holds DRM master, so it has to stop
before anything else can draw.** Browse mode is a mode switch. Any design that assumes a window,
an overlay or a second surface will not work.

The second: **Chromium is in a chroot, and the chroot has no `/dev`, `/proc` or network of its
own.** `browse-up.sh` binds them in. Anything that needs a device node must go through those binds.

## How to test

There is no CI and there will not be useful CI: nothing here can be checked without the panel, the
input stack and the MPC app. State what you actually ran.

**The loop**, once the thing is installed:

```sh
export MPC_HOST=root@<mpc-ip>
./deploy.sh                                   # scripts, extension, weston.ini, pages
ssh $MPC_HOST /data/browser/bin/browse-up.sh  # switch in
ssh $MPC_HOST /data/browser/bin/browse-down.sh
```

`deploy.sh` does not restart anything, so a live session survives it; the new scripts take effect on
the next switch. Shell script changes need a `browse-down` + `browse-up` cycle. Extension changes
need the same, and `chrome-up.sh` already clears Chromium's cached service worker, which is the
thing that makes a new `bg.js` look applied when it is not.

**Test control surfaces with a finger, not a mouse.** `tools/touch3.c` is a real multi-touch
digitizer over uinput; use `tap` mode for anything a user will tap. Every mouse test passed while
the real complaint (a disabled back arrow) was still true.

```sh
cc=...arm-buildroot-linux-gnueabihf-gcc        # any armv7 hard-float cross compiler
$cc -march=armv7-a -mfpu=neon-vfpv4 -mfloat-abi=hard -O2 -o build/touch3 tools/touch3.c
scp build/touch3 $MPC_HOST:/tmp/
ssh $MPC_HOST '/tmp/touch3 tap 972 744'        # one tap at screen 972,744
ssh $MPC_HOST '/tmp/touch3 hold 3000 3'        # 3 fingers, 3 s
```

Tap coordinates are screen coordinates. Under them is a rotation (`display_x = (max_y - y) *
1280/max_y`, `display_y = x * 800/max_x`), which the tool undoes for you.

**Test keyboard input without a keyboard.** `device/bin/hid-inject.js` creates a synthetic USB HID
keyboard and mouse over `/dev/uhid`:

```sh
printf 'type hi there\nkey ctrl+l\npause 500\n' | \
  ssh $MPC_HOST '/data/browser/node/bin/node /data/browser/bin/hid-inject.js'
```

`abs x y` exists because libinput's pointer acceleration makes straight relative moves overshoot;
it clamps to a corner and walks to the target where the curve is ~1:1.

**Test the gesture without stopping the MPC app.** The launcher takes `MPC_BROWSE_UP` as its
command, so point it at a stub that appends to a file:

```sh
ssh $MPC_HOST 'systemctl stop mpc-browse
  printf "#!/bin/sh\necho fired >> /tmp/gesture.log\n" > /tmp/fake-launch.sh
  chmod +x /tmp/fake-launch.sh
  MPC_BROWSE_UP=/tmp/fake-launch.sh /data/browser/node/bin/node /data/browser/bin/touch-launcher.js > /tmp/launcher.log 2>&1 &
  /tmp/touch3 hold 3500 3 ; cat /tmp/gesture.log ; systemctl start mpc-browse'
```

Leave 3 s between runs and mind the 20 s cooldown, or you cannot tell "did not fire" from "swallowed
by the cooldown". `touch-launcher.js --test` covers the timing cases that a live run cannot afford
to spend a minute each on.

**See the UI without switching the MPC.** The start page, files page and phone page are
self-contained HTML; render the file at the real size in a headless browser. For the injected bar,
put a throwaway page in `/tmp` that stubs `window.chrome = { runtime: { sendMessage() {} } }` and
loads a copy of `nav.js`; `#mpc-nav-host` has an open shadow root, so a harness can click into it.
Headless Chromium inside the chroot is a dead end: no browse mode, no `/dev`.

**Check the device shape before blaming the code.** `./tools/probe-device.sh`.

## Landmines already mapped

Every one of these cost time during development. None of them is obvious, and several look exactly
like a different bug.

**Killing things**

- **Never `kill` by command-line pattern.** A pattern matching `weston` also matches the `ssh`
  command line of the shell doing the killing, which kills your own session. It cost two sessions.
  Use `bin/killproc.sh`, which matches `/proc/<pid>/comm`.
- **A pidfile is not the process.** `run/*.pid` lives on `/data` and outlives a reboot, and Chromium
  rewrites the file itself on a second launch ("Opening in existing browser session") then exits,
  leaving a live browser with a dead pid on record. This is how a deploy landed on disk while the
  bar on screen kept running the old build and REC looked like a dead button.

**systemd on this firmware**

- **Never order anything after `network-online.target`.** connman owns the network here and
  `systemd-networkd-wait-online.service` never finishes, so the target never activates and every
  unit Wanted or ordered after it sits in a queued job forever: `is-enabled` says `enabled`, the
  rootfs files are perfect, and the journal says nothing at all.
- **A unit that only exists in the `/data` overlay never starts at boot.** `/etc` is an overlay
  mounted about two seconds in, after systemd has computed the boot transaction. That is why
  `install-rootfs-unit.sh` writes to `/dev/mmcblk0p6`.
- **`KillMode=process` is load-bearing.** `browse-up.sh` is spawned by `control-server.js`, so
  weston and Chromium land in `mpc-browse.service`'s cgroup, and the default `KillMode=control-group`
  kills a live browsing session every time the unit restarts.

**Panel, input and rotation**

- **`transform=270` is rejected** by this weston; the accepted spellings are `rotate-90` /
  `rotate-270`.
- **The wayland socket name is discovered, not assumed.** It can come up as `wayland-1` after a
  stale lock survives a crash.
- **weston needs `/run/udev` inside the chroot**, or libinput sees no devices and the backend
  refuses to start.
- **A synthetic touchscreen gets rotated by weston.** Declaring a landscape digitizer still produces
  a 90° mapping; the fit is in the touch3 section above.
- **A device list read once at startup misses every hotplug.** The launcher watches `/dev/input` with
  inotify and rescans every 5 s. It also has to keep the `FSWatcher` in a live reference: calling
  `fs.watch(...)` for its side effect gets the watcher collected, and the symptom is *it worked
  exactly once* with no error anywhere.
- **The kernel suppresses a redundant `ABS_MT_SLOT 0`.** A device that starts on slot 0 never says
  so, and the slot index is remembered across devices, so the first finger of a newly attached
  device gets credited to the last slot of the previous one. Reset it on every attach.
- **A device node is not identified by its name.** Deleted and re-created keeps the path and the
  major/minor but is a different file, and on this kernel the old fd goes silent instead of
  reporting EOF. Compare inodes, and open the replacement before closing the old one.
- **Word-named keys and single-letter keys collide in a lookup table.** Comparing `'enter'` against
  `'a'..'z'` with `>=`/`<=` succeeds, so `enter` resolved to `e` until the multi-character check
  moved first.
- **Reports need pacing on this hardware.** 18 ms between press and release dropped and duplicated
  characters on an RK3288; 40 ms is clean.
- **`fstat` is the only honest identity for an input device**, and a re-created node silently stops
  producing events rather than reporting EOF.

**Chromium**

- **Downloads from `file://` pages are blocked**, and `.zip`-style downloads over plain `http://`
  are blocked by the insecure-download policy. Test from `http://`; `127.0.0.1` counts as secure.
- **Chromium rewrites `Preferences` and drops keys it did not load**, so the download prefs are
  re-injected before every launch (`fix-prefs.sh`) instead of written once. Without them Chromium
  tries to open a GTK save dialog that cannot exist here, and the download dies.
- **Content scripts do not run on `file://` pages** without the "allow access to file URLs" toggle,
  which cannot be clicked in kiosk mode. That is why the start page and files page are served over
  `http://127.0.0.1:8798`.
- **Chromium caches the extension's service worker and prefers it to the file on disk.**
  `--load-extension` picks up a new `nav.js` on the next launch, but the worker is registered in the
  profile and reloaded from there. Symptom: `chrome.runtime.sendMessage` from the bar answers *"The
  message port closed before a response was received"* while a different message kind still works.
- **A message the worker never answers freezes the button that sent it.** `toggleRec` holds a busy
  flag across the await, so one unanswered `sendMessage` turned every later press into a silent
  no-op. Both ends carry a timeout now, and an empty answer is not success.
- **A content script cannot patch the page's prototypes.** Isolated worlds. Replacing
  `requestFullscreen` in `nav.js` looked correct and changed nothing; the block lives in `main.js`
  with `"world": "MAIN"` and `run_at: document_start`. Any future override of page behaviour goes
  there.
- **`[hidden]` loses to any `display` rule.** Both the downloads panel and the collapsed tab carry
  `hidden`, and `.panel { display: flex }` beat the UA stylesheet, so the panel was open on every
  load. `[hidden] { display: none !important }`.
- **`history.length` is the wrong question for a back button.** A page restored by a back navigation
  keeps the length it was loaded with. Use `navigation.canGoBack` / `canGoForward`.
- **`navigation.canGoBack` is a trap for a button anyway.** It reads false on client-side
  navigation, so a bar that disables the arrow on that basis is dead on the sites that need it most.
  The arrows stay live and back falls through to the start page.

**Audio**

- **Chromium on Linux has no ALSA backend at all.** PulseAudio only. With no server, every player is
  silent with no error in the page and none in `chrome://media-internals`.
- **PulseAudio as root needs `--system`**, and `--system` needs a `pulse` user in `/etc/passwd` and
  `pulse` in the `audio` group, or it dies before it opens the sink. Both are generated by
  `build-sysroot.sh`.
- **No D-Bus is fine.** PulseAudio logs "Unable to contact D-Bus" and works anyway.
- **The codec is exclusive.** `browse-down.sh` stops the sound server before starting `acvs`,
  because an `acvs` that cannot open `hw:1,0` comes back mute.

**Mounts and paths**

- **Do not bind `/media` wholesale.** It is a tmpfs of mount points here, so a browser writing into
  a stale copy looks like a working download that never reaches the library. `browse-up.sh` binds the
  whole `MPC Documents` tree at `/downloads`, and a download's folder is the path in front of its
  name (`Samples/pack.zip`), so any folder the MPC shows can be a destination without another mount.
  Chromium has no per-download directory - the extension only chooses a relative path - which is why
  the default directory is the root and not `Samples`.
- **A `mode` file is a claim, not a fact.** After weston dies the file still says `browse`, so
  `browse-up.sh` checks the weston pid and rebuilds rather than answering "already in browse mode"
  to a black screen.
- **`mpc-autosave.sh` must run while the MPC app is stopped.** The app rewrites `MPC.settings` from
  memory as it exits, so an edit underneath a running app is thrown away, and an edit made while it
  runs looks applied until the next exit.

**Testing itself**

- **A test that matches the requirement instead of the hardware proves nothing.** The gesture once
  required the two closest fingers to be 200 panel units apart, and the test tool put them a quarter
  screen apart, so every synthetic run passed while a real hand (fingertips ~90 units apart) could
  never fire it. Synthetic input must be spaced the way the real thing is.
- **A test tool that parses its own arguments wrong lies quietly.** `touch3` documented a `hold`
  verb it never parsed, so `touch3 hold 3200 4` read the hold as 0 ms and the fingers as 10, and
  every gesture test silently did nothing. Read the line the tool prints, not the arguments you
  passed.
- **Check the evidence, not the exit code.** `pgrep -c` does not exist in busybox (so a "0
  processes" count was an error message), and `$!` after `sleep 300 &` in a busybox `sh -c` gives
  the shell's pid, not the sleep's.
- **A mark that reads at 210 px can read as a warning sign at 19 px.** The first logo was a grid
  with a diagonal streak and looked exactly like "no entry" in the title strip. Render a logo at the
  size it ships in.

## Sending a pull request

1. Fork, branch, change something small enough to review.
2. Run it. Say in the PR body what you ran on, what you expected, what happened, and what is
   untested.
3. If it touches the panel, the input stack or the mode switch, say whether a recording or a photo
   of the panel backs it up. Photographing the MPC's screen over SSH is possible and has been done
   here; it is the standard of evidence this project tries to keep.
4. If it fixes a row in [KNOWN-ISSUES.md](KNOWN-ISSUES.md), update that row in the same commit.
5. If it adds a new gotcha worth knowing, put it in this file, under the right heading.

Nothing gets merged on a green checkmark, because there is no green checkmark. It gets merged on
someone saying what they saw.

## Licence

By contributing you agree your work is released under the MIT licence in [LICENSE](LICENSE).
