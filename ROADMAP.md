# Where this is going

No dates. This is a list of what is actually queued, in roughly the order it matters, written down
so nobody has to guess whether a thing is planned or just absent.

## The download side, next

Downloads work and land in `MPC Documents/Samples` where the MPC can see them. What is missing is
everything around them.

- **A real download manager.** The bar's panel shows bytes and percent for the file running now, and
  that is it. What it needs: a list of what finished, what failed and why, retry, cancel, remove, and
  a way to see the file size before you commit to pulling 300 MB over wifi.
- **Unpack archives on the device.** Half the sample packs on the internet are a `.zip` with folders
  in it. Right now that means download it, then go find a computer, then come back. The plan is to
  unpack inside the browser: a `.zip` arrives, the bar offers to expand it into a folder in the
  sample library, and the MPC sees the whole pack. Same for the common tar flavours if they are
  worth the bytes.
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
