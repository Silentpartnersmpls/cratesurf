# Where this is going

No dates. This is a list of what is actually queued, in roughly the order it matters, written down
so nobody has to guess whether a thing is planned or just absent.

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

This is the real reason most people close the tab. "Build an armhf chroot on a Debian box, then
`scp` it to the MPC" is a fair description of the work and an unfair thing to ask before someone
sees a browser.

- **The installer. Done.** `installer/` is one binary for Windows, macOS and Linux, with its own SSH
  client and nothing to install first: type the MPC's IP, press Enter, and it checks the device,
  streams the payload, installs the toggle, writes the boot copy and then verifies its own work. It
  also walks through rooting a stock unit, which is a firmware image on a USB stick because that is
  the only way in. What is still missing is the release itself: the payload has to be published
  somewhere with its checksum and the binaries have to be built with that URL baked in
  (`installer/make-payload.sh` and `build.sh` do both). Until then the installer takes a local
  tarball with `--payload`.
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
keyboard plugged into the MPC, or (on the MPC Live II, at least) a Bluetooth mouse.

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
- **Bluetooth keyboard support. Next.** On the same Live II a Bluetooth keyboard does not work in
  the browser yet. This is the next thing being worked on. On the One+, a paired Bluetooth keyboard
  does register as an HID input node that weston opens like a USB one, which is a reason to think it
  will land once pairing is done from the MPC's own Bluetooth screen - the unit has no
  `bluetoothctl` or `btmgmt` to pair with from a shell, and that is the part still open. Until then,
  a USB keyboard plugged into the MPC does work.

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
