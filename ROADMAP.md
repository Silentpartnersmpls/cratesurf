# Where this is going

No dates. This is a list of what is actually queued, in roughly the order it matters, written down
so nobody has to guess whether a thing is planned or just absent.

## Rendering and scrolling, now

On Gen 1, software raster is the default because the GPU path tears the panel, and that trade is
written down in [the development unit](README.md#the-development-unit). The next pass is to make
scrolling usable without tearing. The first two switches are Panfrost AFBC
(`PAN_MESA_DEBUG=noafbc`, behind `/data/browser/run/panfrost-noafbc`) and weston's direct scanout of
a fullscreen client (`device/bin/scanout-toggle.sh` flips it for the session); then hold GPU
compositing back (`--disable-gpu-compositing`), keep GPU compositing but rasterise on the CPU
(`--disable-gpu-rasterization`), and try `--use-gl=egl` and a newer Mesa. Every candidate has to be
judged by the frames on the glass, not just the frame clock; the benchmark that endorsed the first
GPU build measured timing and missed whole black frames and a missing nav bar. Until a configuration
presents complete frames by hand, it stays behind `/data/browser/run/chrome-gpu-raster`.

On Gen 2 the profile starts from the other side: the trixie/Mesa 25/panthor tree exists for the
RK3588's Mali-G610, so GPU is the default there. That path still needs the same frame-content test
on an XL; `touch /data/browser/run/chrome-software-raster` drops it back to software while that is
worked out.

## The download side, next

Downloads work and land in `MPC Documents/Samples` where the MPC can see them. What is missing is
everything around them.

- **A real download manager. Done.** The panel lists running, stopped and finished downloads as
  three different things: running has percent and **CANCEL**, stopped has the reason in plain words
  with **RETRY** and **DROP**, finished has its size with **PLAY** for audio and **UNPACK** for a
  zip, plus **DROP** (forget the row, never the file) and **GET AGAIN** when the file has left the
  folder. Free space in the sample folder sits in the panel title, so a 300 MB pack is not started
  on 40 MB of room. **The size before you commit is in too:** a tap on a file link raises a card
  with the name, the size and the free space, and the download only starts when that is pressed.
  The size is one `HEAD` from the device (`/probe` on the control server, `device/bin/probe.js`),
  falling back to a one-byte ranged GET for sites that refuse `HEAD`; a pack that does not fit says
  so in red and the button reads **WON'T FIT**. It cannot see a download a page starts from script,
  a `blob:` link, or a URL with no extension - that is in
  [KNOWN-ISSUES.md](KNOWN-ISSUES.md#missing-features) rather than hidden here.
- **Unpack archives on the device. Done.** Half the sample packs on the internet are a `.zip` with
  folders in it, and that used to mean download it, go find a computer, come back. A finished zip
  now offers **UNPACK** and the pack appears in the sample folder in a form the MPC reads, folded
  out of its own single top folder rather than nested twice. The reading is `device/bin/unpack.js`
  on Node's own `zlib`, so there is no unzip binary to install and no firmware detail to depend on;
  it counts files while it runs, checks the CRC of every entry, checks free space first, refuses a
  password, an unsupported method, a multi-disk archive or a name that escapes the destination, and
  extracts into a scratch folder so a half-written pack never appears under the real name.
  **Deleting the `.zip` after a good unpack is in too:** the row offers **DELETE ZIP** once an unpack
  has finished, and the route behind it only accepts a zip this server actually unpacked, so it
  cannot be talked into removing anything else. The row goes with the file. Still open: the tar
  flavours.
- **Choose where a download goes. Done.** The save card carries **SAVE TO** in its title strip, the
  picker offers the folders that are really on the unit with the current one marked, and the choice
  is remembered on the device so the next file lands there too. It is one folder for everything, not
  one per site, and it lists the top level of `MPC Documents` only; both are in
  [KNOWN-ISSUES.md](KNOWN-ISSUES.md#missing-features). What it cost underneath: the whole document
  tree is bind-mounted at `/downloads` instead of just `Samples`, the profile's download directory is
  that root, and every download carries its folder as the front of its name, because Chromium has no
  per-download directory to offer.

## Making it installable by people who are not us

This is the real reason most people close the tab. "Build a Debian chroot on a PC, then `scp` it to
the MPC" is a fair description of the work and an unfair thing to ask before someone sees a browser.

- **The installer. Dual-payload source build done; a Gen 2 release waits on a hardware pass.**
  `installer/` is one binary for Windows, macOS and Linux, with its own SSH client and nothing to
  install first: type the MPC's IP, press Enter, and it checks the device, streams the matching
  payload, installs the toggle, writes the Gen 1 boot copy or the Gen 2 addin hook, and then
  verifies its own work. It also walks through rooting a stock unit, which is a firmware image on a
  USB stick because that is the only way in. The released 0.1.2-alpha pre-release is Gen 1 only,
  with its payload URL and checksum baked into the binaries; the source build here builds and
  selects both architectures and still takes a local tarball with `--payload`.
- **A USB stick route.** Build the sysroot on your computer, write it to a stick, plug the stick into
  the MPC, copy it into `/data`. That removes the build machine from the device's side of the job
  and makes a reinstall a stick instead of a `scp`.
  One honest caveat, because it is the part people trip on: **the first install still has to happen
  over SSH.** The MPC has no terminal app, so there is nothing on the device to run an installer
  from. The stick removes the transfer, not the first connection. The graphical installer is what
  makes that first connection one button instead of a paragraph of commands.
- **A one-line install script**, for the people who are comfortable with a shell and would rather
  not read three pages. Same steps, checked at runtime, refusing to continue when the device does
  not match. The installer's `--host` flag already covers the scripting case on any platform, so
  this is now a convenience rather than a gap.

## Planned: input

Right now the browser is driven by the touchscreen, an on-screen keyboard on the glass, a USB
keyboard plugged into the MPC, a Bluetooth keyboard paired from the MPC's own Bluetooth screen, or
(on the MPC Live II, at least) a Bluetooth mouse.

- **An on-screen keyboard. Done.** The bar carries a keyboard key, and a panel rises above the bar
  with a number row, three full letter rows, Shift, Backspace, Enter, Space, a symbols page and
  Esc/Tab/arrows in its title strip. It also comes up by itself when a text box is tapped - never on
  a page's own autofocus - and stands down on a tap elsewhere, on a navigation, or the moment a real
  keyboard types. It keys into the page (`insertText`, with `setRangeText` behind it) and sends real
  Enter, Tab, Esc and arrow key events, so a site's own search box answers them. It lives in
  `device/ext/nav.js` with the rest of the bar: kiosk Chromium ships no virtual-keyboard extension,
  so there was nothing to switch on and this is ours. Verified on the unit with no keyboard attached.
  Not covered: the PDF viewer, a cross-origin iframe, and paste - all three are in
  [KNOWN-ISSUES.md](KNOWN-ISSUES.md).
- **Bluetooth mouse support. Works.** Confirmed by a tester on an MPC Live II: a paired Bluetooth
  mouse points and clicks in the browser with nothing added. Not yet tried on the One+.
- **Bluetooth keyboard support. Works on the One+.** Pair it from the MPC's own Bluetooth screen,
  then come back into browse mode: it appears as an ordinary HID node and types like the USB keyboard,
  including making the on-screen keyboard stand down. Confirmed on the One+ on 2026-10-31. The unit
  has no `bluetoothctl` or `btmgmt`, so pairing from a shell is not an option. The earlier Live II
  report (a paired keyboard did not type) predates this pairing route and has not been retried; a USB
  keyboard is the fallback there.

## Gen 2 (MPC XL and Live III) in the main project

The MPC XL already runs CrateSurf through djru5h's community port (the `mpc-xl-gen2` branch of
their fork, see the [README](README.md#mpc-xl-and-live-iii-gen-2)). That branch was XL-only. The
per-board integration is now in this tree:

- [x] Detect the board at startup and pick the screen rotation, audio device, documents folder and
  weston options for it. `device/bin/board.sh` is the shell profile, `device/bin/board.js` is the
  Node half.
- [x] Fix the gesture and Ctrl+Alt+B reading input events at the wrong size on 64-bit. `EV_SIZE` is
  16 on armv7 and 24 on arm64.
- [x] Build a 64-bit payload alongside the 32-bit one from the same `build-sysroot.sh`
  (`ARCH=arm64 DISTRO=trixie`).
- [x] Teach the installer to take a 64-bit unit: it detects the board generation, picks the arm64
  payload and Node binary, and installs the Gen 2 `/data/mpc-addins` boot hook instead of the rootfs
  unit.

**Still open:** a hardware test pass on an XL and a Live III through this integration. The XL values
came from the community port, but this repository has only run the Gen 1 path so far. Do not treat a
Gen 2 release as confirmed until that pass happens.

## Later

The list in [KNOWN-ISSUES.md](KNOWN-ISSUES.md#missing-features) is the long version. The ones that
would change how the thing feels:

- Tabs, or at least a way to keep one page alive while you grab a link from another.
- An address bar on arbitrary pages without going back to the start page.
- A hardware volume control. Card 1 has no ALSA mixer elements, so this may need a different route
  entirely.
- Gesture tuning, if the three-finger hold turns out to fire when it should not.

## Helping

If one of these is the thing you want, say so in an issue, with the probe output. Priorities here
follow what people actually ask for, and "I would use this if it could unzip a pack" is a better
argument than a thumbs up.
