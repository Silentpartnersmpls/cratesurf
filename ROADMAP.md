# Where this is going

No dates. This is a list of what is actually queued, in roughly the order it matters, written down
so nobody has to guess whether a thing is planned or just absent.

## The download side, next

Downloads work and land in `MPC Documents/Samples` where the MPC can see them. What is missing is
everything around them.

- **A real download manager. Done, apart from one thing.** The panel lists running, stopped and
  finished downloads as three different things: running has percent and **CANCEL**, stopped has the
  reason in plain words with **RETRY** and **DROP**, finished has its size with **PLAY** for audio
  and **UNPACK** for a zip, plus **DROP** (forget the row, never the file) and **GET AGAIN** when
  the file has left the folder. Free space in the sample folder sits in the panel title, so a 300 MB
  pack is not started on 40 MB of room. Still missing: the size **before** you commit, which needs a
  request per link before the browser is asked for it, and a place on a page that is not ours to
  show the answer.
- **Unpack archives on the device. Done.** Half the sample packs on the internet are a `.zip` with
  folders in it, and that used to mean download it, go find a computer, come back. A finished zip
  now offers **UNPACK** and the pack appears in the sample folder in a form the MPC reads, folded
  out of its own single top folder rather than nested twice. The reading is `device/bin/unpack.js`
  on Node's own `zlib`, so there is no unzip binary to install and no firmware detail to depend on;
  it counts files while it runs, checks the CRC of every entry, checks free space first, refuses a
  password, an unsupported method, a multi-disk archive or a name that escapes the destination, and
  extracts into a scratch folder so a half-written pack never appears under the real name.
  Still open: the tar flavours, and offering to delete the `.zip` once it is unpacked.
- **Choose where a download goes.** Today every download goes to the sample library because that is
  the only place the MPC will look. That is right most of the time and wrong the rest of the time,
  so it needs a picker: the library by default, or a folder of your choosing, remembered per site if
  that turns out to be what people want.

## Making it installable by people who are not us

This is the real reason most people close the tab. "Build an armhf chroot on a Debian box, then
`scp` it to the MPC" is a fair description of the work and an unfair thing to ask before someone
sees a browser.

- **A graphical installer, which is what the next pass is about.** It runs on your computer, not on
  the MPC: the MPC has no desktop environment to run an installer in, and no place to put a window.
  A small app that checks your device, builds or downloads the sysroot, offers a USB stick or the
  network as the transfer route, copies everything over, installs the unit, and tells you plainly
  whether it worked. The scripts it would drive already exist; the installer is the missing front
  door.
- **A USB stick route.** Build the sysroot on your computer, write it to a stick, plug the stick into
  the MPC, copy it into `/data`. That removes the build machine from the device's side of the job
  and makes a reinstall a stick instead of a `scp`.
  One honest caveat, because it is the part people trip on: **the first install still has to happen
  over SSH.** The MPC has no terminal app, so there is nothing on the device to run an installer
  from. The stick removes the transfer, not the first connection. The graphical installer is what
  makes that first connection one button instead of a paragraph of commands.
- **A one-line install script**, for the people who are comfortable with a shell and would rather
  not read three pages. Same steps, checked at runtime, refusing to continue when the device does
  not match.

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
