# Known issues

**Version 0.1.0-alpha.** Everything below is true of the current code on the one unit it has been
run on (MPC One+ Gen 1, firmware 3.4.2.13). Nothing here is a rumour; each item says how it was
found, what it does to you, and what to do about it.

Severity: **[HIGH]** data loss or a dead panel, **[MED]** you will hit it in normal use,
**[LOW]** cosmetic or rare.

---

## Data loss and the MPC app

### [HIGH] Switching into browse mode can lose up to five minutes of work
Browse mode stops the MPC application, and the application does not save the project when it exits.
CrateSurf turns the firmware's own autosave on before it stops the app, so the copy survives, but
autosave writes on a timer: **up to `AutoSaveTimeout` seconds of work can be missing** (300 s by
default). On the next launch the MPC offers to merge the autosaved copy.

**Workaround:** save before you switch. That is the only reliable protection. You can shorten the
window in **Preferences → Project Load/Save → Auto Save Timeout** (one, two, five or ten minutes).

### [HIGH] A project that has never been saved is not protected at all
The MPC has no file path to autosave to, logs `Autosave for project with no file path`, and skips
it. **Name and save once before your first browse-mode switch.**

### [MED] The MPC comes back on its template picker, not on your project
The app does not reload the last project on launch. You have to pick it again (and merge the
autosave copy). `az01-launch-MPC` forwards arguments to `/usr/bin/MPC`, so a project-autoload route
may exist, but nobody has built it.

---

## Security

### [HIGH, by design] The port 8798 toggle has no authentication
It is a LAN-only convenience: anyone who can reach the port can start or stop browse mode on the
MPC. There is no login and no token.

**Do not port-forward it, do not expose it to the internet, do not put the MPC on an untrusted
network with it running.** The sample-library routes (`/files`, `/files/<name>`) and the recorder
routes (`/rec/*`) are stricter: they refuse anything that is not `127.0.0.1`, so the library is
never handed to the LAN.

### [LOW] Chromium runs as root with `--no-sandbox` inside the chroot
That is how `chrome-up.sh` launches it today (see the flags in that file), so Chromium's own
sandbox is off: an exploit on a malicious page is contained by nothing but the chroot. Turning the
sandbox on inside a chroot where every process is root is an open question here, not a solved one.
Browse the sample sites, not the open sewer.

---

## Hardware paths

What is proven with real hardware in the loop and what is not, kept honest in both directions.

### [MED] No physical mouse has been in a port on the tested unit
**A keyboard has, and it works**, including hotplug in the middle of a session and `Ctrl+Alt+B` as a
way in; that is tested with a real keyboard, not only synthetic HID. The pointer is the one that has
only been proven through the kernel's own input stack with a synthetic HID device over `/dev/uhid`,
which is the same path a real mouse takes (`usbhid` → `hid-generic` → libinput → weston). What is
unproven for a mouse is the last inch: a cable in a port.

If an input device does nothing, that is a fact worth reporting, and `device/keys.html` on the
device (`file:///opt/keys.html` once browse mode is up) shows whether events are arriving at all.

### [LOW] The three-finger launch gesture: works with a real hand, but it is duration-only
**This one is tested and it works.** Three real fingers on the glass for 2.5 s launches browse mode,
repeatedly, and it has been done that way many times on the tested unit. It is also unit-tested
(`touch-launcher.js --test`, nine cases) and fired from a synthetic digitizer holding its contacts
about 90 units apart, which is where a hand puts them.

The catch is the next section: because position is not part of the gesture any more, a hand resting
on the panel can satisfy it.

**If a hold is refused, raise `HOLD_MS`** in `device/bin/touch-launcher.js`. Do not re-add the
spatial rules that were removed; they were removed because a real hand fails them.

### [MED] The gesture can fire from a hand resting on the panel
With position no longer part of the gesture, duration is the only thing separating a deliberate
hold from a hand sitting still on three keys for 2.5 s. This is a known, accepted trade. The knob
is `HOLD_MS`, and the cooldown is 20 s.

### [LOW] The pointer arrow has never been seen
It moves and clicks at the right coordinates, and weston logs no cursor-theme failure, but the
cursor is drawn on a hardware plane and the screenshot path reads only the primary framebuffer, so
no capture shows it.

### [LOW] There is no hardware volume control
**Audio itself is tested and it works**: it has been listened to on the unit's own output, not only
measured at the signal level (`pactl` shows the `codec` sink RUNNING with a `Chromium` sink-input and
the ALSA PCM under PulseAudio has `hw_ptr` advancing).
What is missing is a knob. Card 1 exposes no ALSA mixer elements, so PulseAudio's sink volume is the
only control there is, and if a particular page comes out quiet there is nothing on the device to
turn up.

---

## Things that behave in a way you might not expect

### [MED] Back and forward are never greyed out
`navigation.canGoBack` reads false on sites that navigate client-side (Freesound among them), and
disabling the arrow on that basis made it a dead tap on exactly the sites this browser is for. So
the arrows are always live, and back falls through to the start page when there is no history.

### [MED] A site's video player may refuse to play
`requestFullscreen` is replaced with a rejecting stub, in the page's own world, before any page
script runs. In kiosk mode there is no browser UI and no Esc key, so a player that goes fullscreen
takes the panel and every control with it. The trade is deliberate.

### [MED] Downloads are invisible if you do not use the bar
Kiosk mode paints no download shelf or bubble, and there is no way to turn one on. The bar's
download button carries a count badge and the panel opens by itself when a download starts. If the
bar is missing on a page (it does not run on `file://`), use the start page's downloads link.

### [LOW] Unpacking is zip only, and only the parts of zip a sample pack uses
A finished `.zip` gets an **UNPACK** button and the pack lands in the sample folder as a folder the
MPC can read. Inside a zip it handles stored and deflate entries, which is what sample packs are.
Refused before anything is written, with the reason on the row: a password, a compression method
zlib does not have (PPMd, LZMA, bzip2 inside a zip), a multi-disk archive, an entry name that would
write outside the folder, and a pack bigger than the free space. There is no tar, gzip or rar.

The unpack runs on the device's own CPU, one file at a time: a 700 MB pack is minutes, not seconds,
and the row's counter is the only progress there is. Member names are read as UTF-8 whatever the
archive's flag says, so a pack made by an old Windows tool with non-ASCII names may unpack them as
mojibake.

### [MED] Some downloads will simply be refused
Chromium blocks downloads from `file://` pages, and blocks `.zip`-style downloads served over
plain `http://`. Sample sites are HTTPS; `127.0.0.1` counts as secure. Nothing to fix, just expect
it.

### [LOW] Memory over long sessions is unmeasured
The tested unit has 2 GB of RAM and reported about 1.3 GB available at idle, so there is headroom,
but nobody has run it for an hour on heavy pages. If it dies, `/data/browser/run/chrome.out` and
the journal will say whether it was the OOM killer.

### [LOW] The browser profile is disposable
All state lives in `/data/browser/sysroot/root/chrome-profile`. A sysroot rebuild replaces it, so
logins and history go with it. `chrome-up.sh` also deletes the extension's cached service worker
before every launch, because Chromium reloads the registered copy instead of the file on disk.

---

## Installation and upkeep

### [LOW] The Node runtime is a 105 MB download this project owns
The firmware ships no Node, and an earlier version borrowed the one at
`/data/mpc-agent/runtime/node/bin/node`, which quietly made CrateSurf depend on that other project
being installed. `deploy/install-node.sh` now fetches a pinned official armv7 build (v22.23.4,
sha256 checked) to `/data/browser/node/bin/node`, so the install needs no second project, but it does
cost ~105 MB on `/data` and a ~25 MB download on your computer the first time.

The path is still written in two files, `device/bin/browse-up.sh` and `device/mpc-browse.service`.
Collapsing it into one setting is an obvious first contribution; nothing breaks by leaving it.

### [MED] A firmware update will wipe the boot entry
`install-service.sh --boot` writes the unit into the read-only firmware rootfs, because a unit that
only exists in the `/data` overlay never starts at boot on this firmware. A firmware update replaces
that partition, so re-run `./deploy/install-service.sh --boot` afterwards. Everything on `/data`
survives, but a new firmware may also move the partition the installer writes to; the script refuses
to guess and will fail loudly if `/dev/mmcblk0p6` is not what it expects.

### [MED] The project assumes firmware 3.4.2.13
`/dev/mmcblk0p6` as the firmware rootfs, `acvs.service` as the MPC app, `DSI-1` as the panel
connector, `hw:1,0` as the audio codec and `/data/Settings/MPC/MPC.settings` as the settings file
are all facts about this build. A different firmware build may differ in any of them.

### [LOW] `deploy.sh` does not restart the service
A live browsing session survives a deploy (`KillMode=process` is set for exactly that reason), and
script changes are picked up on the next switch. If you changed `device/mpc-browse.service`, run
`deploy/install-service.sh` again.

### [LOW] Documentation hostname
Examples use `root@mpc-one-mk2` as the default host. Set `MPC_HOST` and every script follows it.

---

## Missing features

Not bugs, absences. These are the things people ask for first. The ones with real work behind them
are tracked in [ROADMAP.md](ROADMAP.md), which is where to look for the download manager, archive
unpacking and the graphical installer.

- **No tabs and no omnibox.** One page at a time. The bar covers back/forward/reload/home, and the
  start page covers typed addresses.
- **No address bar on arbitrary pages.** Typing a URL means going back to the start page or
  pressing `/` / Ctrl+L there.
- **No hardware volume.** Card 1 exposes no ALSA mixer elements, so PulseAudio's sink level is the
  only control.
- **No microphone recording.** REC captures the browser's own output through PulseAudio's monitor,
  not an input.
- **The MPC's pads, knobs and data wheel do nothing here.** They are not Linux input devices on
  this unit.
- **No extensions you can install yourself.** The one bundled extension is loaded by the launcher.
- **No side-by-side with the MPC.** Browse mode owns the panel; that is the DRM constraint, not an
  oversight.
- **No CI, no automated tests that run without the hardware.** There is no emulator for this
  device's panel or input stack.
- **Only a link can be asked about first.** A tap on a file link gets the size card; a download the
  page starts from script, a `blob:` link, or a file served from a URL whose path has no extension
  never reaches that check and still starts with no size shown. The card also asks the site with a
  `HEAD` request of its own, so a site that only hands a pack to a request it recognises may answer
  "size unknown" - or refuse the probe - while the download itself would have worked; and the saved
  file is fetched by the browser's download manager rather than by the page, which is untested
  against sites that gate downloads on the referer.
- **No tar or rar.** Unpacking is zip only; a `.tar.gz` pack still needs a computer in the middle.
- **A download the page starts itself lands at the top of `MPC Documents`.** Only a file *link* goes
  through the save card, and only the card knows which folder you picked, so a download a script
  starts - or a `blob:` link - still starts blind and lands in the root of the document tree instead
  of in `Samples`. Nothing is lost: the top level is the first page `FILES` shows. It is the price of
  choosing a folder per file rather than per profile.
- **`SAVE TO` lists the top level only.** The picker offers the folders directly under `MPC
  Documents`, so a download cannot be aimed at `Samples/Butcher Stems` directly; it lands in
  `Samples` and you move it on the MPC if you want it deeper.
- **The remembered folder is one folder, not one per site.** Choosing `Expansions` for an expansion
  pack means the next sample pack also goes to `Expansions` unless you change it back. Per-site
  memory was the other option and was not what was asked for.
- **No graphical installer.** The install is scripts and SSH, and that is the biggest reason people
  close the tab.

---

## Reporting an issue

Include, at minimum:

```sh
./tools/probe-device.sh > probe.txt     # device shape
uname -a                                # on the MPC
strings /usr/bin/MPC | grep -m1 '^3\.'  # firmware version
```

plus what you did, what you expected, and the relevant bit of `journalctl -b --no-pager | tail -100`
or `/data/browser/run/chrome.out`. "Does not work on my MPC Live II" is a genuinely useful report
**if** it comes with the probe output, because the probe says which axis does not match.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development side.
