# Disclaimer and risk warning

**Read this before you install CrateSurf.** Installing it means you accept all of it.

## The short version

CrateSurf is free, alpha, experimental software that modifies the operating system of a device you
paid for. **The author is not responsible for any damage to your MPC, your computer, your SD card,
your samples, your projects, your warranty, or anything else.** Nothing here has bricked an MPC so
far, and that is not a promise that it cannot. You install it at your own risk, on your own device,
with your own eyes open.

## What it does to your device

- Adds about **775 MB of Debian userland** to `/data/browser/sysroot`.
- Installs **`mpc-browse.service`** into `/etc/systemd/system`.
- With `--boot`, adds **one unit file and one symlink** to the read-only firmware partition
  (`/dev/mmcblk0p6`), remounting it read-write for a few seconds to do it.
- Changes **two settings** in `/data/Settings/MPC/MPC.settings`: `AutoSaveEnabled` and
  `AutoSaveTimeout`, so the MPC's own autosave protects the work you have open when browse mode
  stops the app. A backup of the file is kept beside it.
- **Stops and starts the MPC application** every time you enter or leave browse mode, because the
  application holds DRM master and the panel can only have one owner.

## What can go wrong

- **Unsaved work can be lost.** The MPC app does not save on exit. Autosave reduces this to at most
  five minutes and protects nothing for a project you have never named and saved. Save first.
- **The panel can be left black.** If weston or Chromium dies in a strange way, the MPC app is
  stopped and the screen may be a dead browser. This is recoverable: SSH in and run
  `/data/browser/bin/browse-down.sh`, or power-cycle the unit.
- **A firmware update can break the install**, and a half-finished write to the firmware partition
  would be serious. The installer is deliberately conservative here: it refuses to overwrite a file
  it did not create, it verifies its own copy byte for byte, and it always remounts `/` read-only
  again. Do not interrupt it, and do not run it on a device whose partition layout differs from the
  tested unit (the probe in `tools/probe-device.sh` will tell you).
- **A malicious page is less contained than you are used to.** Chromium runs as root with
  `--no-sandbox` inside the chroot, because that is what it takes to draw on this panel.
- **The port 8798 toggle has no authentication.** Anyone on your network can switch the MPC into
  browse mode. Do not expose it beyond your LAN.

None of the above has happened on the tested unit. One of them is likely to happen to somebody
sooner or later, and that is what alpha means.

## No warranty, no liability

This software is provided **"as is", without warranty of any kind**, express or implied, including
but not limited to the warranties of merchantability, fitness for a particular purpose and
noninfringement. **In no event shall the author or copyright holder be liable for any claim, damages
or other liability**, whether in an action of contract, tort or otherwise, arising from, out of or
in connection with the software or the use or other dealings in the software.

That is the MIT licence's own wording, and it is the operative legal text. See [LICENSE](LICENSE).
This document explains the risk in plain English; it does not narrow or replace that licence.

## Your warranty

Installing third-party software on the MPC, and especially writing to the read-only firmware
partition, may void or complicate your warranty with Akai Professional or inMusic. That is between
you and them. CrateSurf is **not affiliated with, endorsed by, sponsored by or supported by Akai
Professional or inMusic**, and no support request about this project belongs in their inbox.

## Back up first

Before you install, save your projects, and copy anything on the MPC's card that you would be upset
to lose somewhere else. A backup you have not restored is a backup you have not tested, but any
backup is better than a good intention.

By installing CrateSurf you are saying: **I understand this is experimental, I have saved my work,
and if it goes wrong the responsibility is mine.**
