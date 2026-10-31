# Installing CrateSurf

**Short version: download the installer from [Releases](https://github.com/Silentpartnersmpls/cratesurf/releases) instead of following this document.** One binary for Windows, macOS or Linux, one
question (the MPC's IP), and it does everything below except root the MPC for you, which it walks
you through separately. See [`installer/`](installer/README.md) for its own notes. This document is
the long way round, and it is worth reading even if you use the installer, because it is what the
installer is doing.

Follow this in order. Every step is reversible, and [Uninstalling](#uninstalling) has the exact
reverse of everything this document adds.

If you have not read the warning at the top of [README.md](README.md), read it now. The short
version: **save your project before you switch into browse mode**, and if you brick your MPC that
is on you.

---

## Prerequisites

### The MPC

| Requirement | Why | How to check |
| --- | --- | --- |
| MPC One+ (Gen 1) up to firmware **3.10**, or MPC Live II up to firmware **3.9.1** | The models and firmware it is confirmed on (see [README.md](README.md#confirmed-working)); development was done on a One+ on 3.4.2.13 and 3.10.0.49 | Main menu → Preferences → Info, or `cat /usr/share/Akai/SME0/VERSION` on 3.10, or `strings /usr/bin/MPC \| grep -m1 '^3\.'` on 3.4 (the 3.10 binary carries no version string) |
| Root SSH into the MPC | Everything is installed over SSH | `ssh root@<mpc-ip> 'id -u'` prints `0` |
| About 1 GB free on `/data` | The chroot is ~775 MB, plus a browser profile | `ssh root@<mpc-ip> df -h /data` |
| MPC on the same LAN as your computer | `ssh`, `scp` and port 8798 | `ping <mpc-ip>` |

**Root SSH is not something this project provides.** If you do not already have it, stop here. If
you do, note that the usual SSH firmware leaves root with *no* password, which is how this gets in and
is a hole worth closing: the installer's last step does it for you (see [installer/README.md](installer/README.md)),
and `--harden-only` does the same on an install that already exists. It saves the password it sets to
`~/.cratesurf/root-<host>.txt` on your computer, so losing the key it installs is survivable; if that
file goes too, [KNOWN-ISSUES.md](KNOWN-ISSUES.md) has the way back.

**Nothing else has to be installed on the MPC.** The firmware ships no Node, so this project brings
its own: `deploy/install-node.sh` fetches the official armv7 build, checks it against a pinned
sha256, and puts the single `node` binary at `/data/browser/node/bin/node`, which is where
`browse-up.sh` and the unit look for it. `./deploy.sh` and `./deploy/install-service.sh` both call
that script, so there is no separate step; run it on its own to get the download out of the way
first. It is idempotent and prints one line when the pinned version is already installed.

That runtime is this project's own dependency, not a loan from anywhere else. Earlier versions
pointed at `/data/mpc-agent/runtime/node/bin/node`, which meant CrateSurf did not work unless
another project happened to be installed on the same device; `install-rootfs-unit.sh` still
recognises that old `ExecStart` so an earlier install upgrades instead of refusing.

The version and its checksum live at the top of `deploy/install-node.sh` (`VERSION`, `SHA256`).
Change both together, or the check deletes the download and fails before anything reaches the
device.

Everything else runs from the chroot this project builds, so the MPC needs no other software.

### The computer

| Requirement | Why |
| --- | --- |
| Debian or Ubuntu (or anything with `apt-get` and `dpkg-deb`; WSL2 and a container both work) | `build-sysroot.sh` drives `apt` to download armhf packages |
| `ssh`, `scp`, `tar`, `gzip`, `curl` | Copying things to the MPC |
| ~500 MB of scratch in `/tmp` | Package downloads, before trimming |

macOS can run every step except `build-sysroot.sh`, which needs `apt`. Build the sysroot on a
Linux box (a container is fine) and copy `/data/browser/sysroot` across, then carry on from step 3.

`build-sysroot.sh` installs **nothing** on your computer. It points `apt` at a sandbox under
`/tmp/mpcsys`, downloads armhf `.deb` files, and unpacks them with `dpkg-deb -x`. No `sudo`, no
foreign architecture registered, no system packages touched.

---

## Before you start

1. **Save your project on the MPC.** Twice. Browse mode stops the MPC app and the app does not
   save on exit. CrateSurf turns the firmware's autosave on to soften that, but autosave cannot
   protect a project you have never named and saved, and up to five minutes of work can be missing
   from what it keeps.
2. **Know how to get back to a shell.** You will want it if a step goes wrong. `ssh root@<mpc-ip>`.
3. **Set `MPC_HOST`** for this shell, so none of the scripts guess:

   ```sh
   export MPC_HOST=root@192.168.1.50
   ```

   Every script in this repo honours it. The default is `root@mpc-one-mk2`, which works if your
   network resolves the MPC's mDNS name.

---

## Step 1: probe the device

Read-only. Changes nothing.

```sh
./tools/probe-device.sh
```

```
== CrateSurf device probe
   host: root@mpc-one-mk2

   model            Akai Professional MPC One+
   board            inmusic,acva2 inmusic,az05 rockchip,rk3288
   kernel           6.18.44-az01-2026-08-10-rt6
   machine          armv7l
   os               az0x (inMusic Brands AZ0x base distribution) 5.0.18 (scarthgap)
   glibc            2.39
   firmware         3.10.0.49
   ...
-- arch             PASS armv7l
-- glibc            PASS 2.39 (bookworm needs 2.36)
...
-- panel            PASS card1-DSI-1 connected, modes: 800x1280
   node             not installed yet, deploy/install-node.sh fetches one

== verdict: shape matches the tested unit (MPC One+ Gen 1)
   README.md and INSTALL.md apply. Save your project before the first switch.
```

If the verdict is anything other than that, read what it complained about and decide whether you
want to be the first person to try this on that device. Nothing below is guaranteed on a shape
that does not match.

## Step 2: build the chroot

```sh
./build-sysroot.sh
```

This resolves and downloads Chromium, weston, PulseAudio and friends (about 240 MB of `.deb`s,
just over 320 packages), unpacks them into `/tmp/mpcsys/root`, trims docs, locales and icon sets,
then streams the result to `/data/browser/sysroot` on the MPC.

Expect, with the numbers moving a little as Debian updates bookworm:

```
== sandbox at /tmp/mpcsys
== resolving and downloading
== unpacking
321 packages unpacked
632M	/tmp/mpcsys/root
== shipping to root@...:/data/browser/sysroot
== done. now: ./deploy.sh && ./deploy/install-service.sh
```

The unpacked tree is about 630 MB and the folder on the MPC ends up around 700 to 800 MB once
Chromium has written a profile into it.

A few things that look like errors and are not:

- `W: GPG error ... NO_PUBKEY` from `apt`. The Debian keyring is not present in the sandbox, so
  the source is marked `trusted=yes` **for the sandbox only**. The traffic is still HTTPS to
  `deb.debian.org`.
- `W: Unable to read /tmp/mpcsys/etc/apt/preferences.d/` and other empty-directory complaints.
  The sandbox has only the directories it needs; `apt` notes the rest and carries on.
- `--no-install-recommends` means `apt` reports far fewer packages than a normal install would.

It takes a few minutes on a normal connection. It is idempotent: run it again and it rebuilds from
scratch. Set `CACHE_ONLY=1` to leave the tree in `/tmp/mpcsys/root` and ship nothing.

## Step 3: deploy the scripts and pages

```sh
./deploy.sh
```

Copies `device/bin/*`, the extension, `weston.ini`, the kiosk pages and the unit into
`/data/browser`, installs the Node runtime if it is missing, makes the shell scripts executable and
seeds the Chromium profile so downloads go to the sample folder without a dialog. A first run on a
device without Node starts with a `+ downloading node-v22.23.4-linux-armv7l (~25 MB)` line and then
`node v22.23.4 installed at /data/browser/node/bin/node`; after that it says
`node v22.23.4 already installed` and moves on. Expect `deployed`, then the two lines telling you
how to enter and leave browse mode.

## Step 4: install the toggle service

```sh
./deploy/install-service.sh --boot   # installs into /etc AND into the firmware rootfs
```

Run it once, with `--boot`. Without that flag the toggle only exists in the overlay on `/data`, which is
mounted about two seconds into boot, after systemd has already worked out what to start, so it
looks enabled and never runs. That is why the installer does the rootfs copy, and why it is careful:
it refuses to overwrite a file it did not put there, compares the copy byte for byte, and always
puts `/` back to read-only.

Expect:

```
unit installed: NNN bytes, symlink -> /etc/systemd/system/mpc-browse.service
root remounted: ro
OK
active
-- listen on 8798: 1
```

If the last line says `0`, the toggle is not listening. See
[If something goes wrong](#if-something-goes-wrong).

---

## Step 5: verify, in this order

Each of these has a visible answer. Do not skip to "open it and see".

**1. The toggle answers.**

```sh
curl -s http://<mpc-ip>:8798/ | head -5
```

You should get HTML for the phone page, with `BROWSE ON THE MPC` in it.

**2. The chroot is complete.**

```sh
ssh $MPC_HOST 'ls /data/browser/sysroot/usr/lib/chromium/chromium && du -sh /data/browser/sysroot'
```

The binary exists and the size is somewhere between 700 MB and 800 MB.

**3. Entering browse mode works from a shell.**

```sh
ssh $MPC_HOST /data/browser/bin/browse-up.sh
```Expect `mpc-autosave: already on (300s)` or `enabled`, then `browse mode up`. The panel should now be
the CrateSurf start page, and `systemctl is-active acvs` should say `inactive`.

`browse-up.sh` detaches itself when it is run this way (into the transient unit
`mpc-browse-stack`), because a stack left in the SSH session's cgroup is killed the moment the
connection closes, with nothing in any log. That is why this command may print only the two lines
from `mpc-autosave` and `pulse-up`, or nothing at all, and still be working. `browse-down.sh` stops
that unit too, so the two scripts stay a pair.

**4. Sound.** On the start page, tap a site card and play something. If it is silent, the sound
server failed to start: `ssh $MPC_HOST 'tail -20 /data/browser/run/pulse.out'`.

**5. Leaving works.**

```sh
ssh $MPC_HOST /data/browser/bin/browse-down.sh
```

Expect `browse mode down`, the MPC app back on the panel, and `systemctl is-active acvs` saying
`active`.

**6. The launch gesture.** Hold three fingers on the glass for 2.5 seconds. Browse mode should come
up on its own. This is the step nobody has proven with real fingers yet (see
[KNOWN-ISSUES.md](KNOWN-ISSUES.md)); if it does nothing, use the phone toggle or Ctrl+Alt+B and
report what you saw.

---

## Using it once it is installed

Three ways in:

- **three fingers, held 2.5 s**, anywhere on the glass
- **Ctrl+Alt+B** on a USB keyboard plugged into the MPC
- **`http://<mpc-ip>:8798/`** from your phone, then **BROWSE ON THE MPC**

Ways out: `EXIT BROWSE MODE` on the start page, the **MPC** button in the navigation bar, or

```sh
curl http://<mpc-ip>:8798/down
ssh $MPC_HOST /data/browser/bin/browse-down.sh
```

Downloads land in `MPC Documents/Samples` by default - the MPC's own sample library - and **SAVE
TO** on the save card puts one in another folder under `MPC Documents` instead, remembered for next
time. The bar's download button opens the list; `FILES` in that panel browses the document tree.
**REC** records whatever the browser is playing straight into the sample folder.

---

## If something goes wrong

**The panel is stuck on the browser and nothing responds.**

```sh
ssh $MPC_HOST /data/browser/bin/browse-down.sh
```

That stops Chromium, weston and PulseAudio by process name, releases the mounts and starts `acvs`.
If SSH itself is gone, power-cycle the MPC. Nothing on disk is half-written by a power cycle except
possibly a recording, and `recorder.js` patches the WAV header as it goes, so a truncated take is
still a valid file.

**The MPC app did not come back.**

```sh
ssh $MPC_HOST 'systemctl status acvs; systemctl start acvs'
```

**The toggle is dead** (8798 refuses connections):

```sh
ssh $MPC_HOST 'systemctl status mpc-browse; journalctl -u mpc-browse -n 40 --no-pager'
```

**The panel is black after BROWSE.** Usually weston failed to start because a stale lock or a
DRM holder is in the way. `browse-down.sh`, then `browse-up.sh` again; the scripts rebuild a dead
stack rather than believing the `mode` file.

**Chromium starts but every page is blank or crashes.** Check `/data/browser/run/chrome.out` on the
device. A sysroot that did not finish copying looks exactly like this.

**The nav bar is missing on a page.** It is injected by the extension and does not run on `file://`
pages. Sites served over `http://` and `https://` get it.

More symptom-to-cause pairs, including the ones that cost the most time during development, are in
[KNOWN-ISSUES.md](KNOWN-ISSUES.md) and [CONTRIBUTING.md](CONTRIBUTING.md#landmines-already-mapped).

---

## Updating

```sh
git pull
./deploy.sh
./deploy/install-service.sh      # only if device/mpc-browse.service changed
```

`deploy.sh` restarts nothing on purpose. A live browsing session survives it, and the new scripts
are picked up on the next switch. The extension is the exception: `chrome-up.sh` deletes Chromium's
cached service worker before every launch, because Chromium prefers the registered copy over the
file on disk and a stale worker makes the bar's buttons lie.

Rebooting after an update is always safe.

---

## Uninstalling

This returns the MPC to how it was. Do it from a shell, in this order.

**1. Leave browse mode, in case you are in it.**

```sh
ssh $MPC_HOST /data/browser/bin/browse-down.sh
```

**2. Stop and disable the toggle, and remove it from `/etc`.**

```sh
ssh $MPC_HOST 'systemctl disable --now mpc-browse.service; rm -f /etc/systemd/system/mpc-browse.service; systemctl daemon-reload'
```

**3. Remove the unit from the firmware rootfs** (this is the reverse of `--boot`). It remounts `/`
read-write, removes the unit and its `multi-user.target.wants` symlink, and puts `/` back to
read-only whatever happens:

```sh
ssh $MPC_HOST 'set +e
  mount -o remount,rw /
  mkdir -p /mnt/fw-root
  mount /dev/mmcblk0p6 /mnt/fw-root
  rm -f /mnt/fw-root/etc/systemd/system/mpc-browse.service \
        /mnt/fw-root/etc/systemd/system/multi-user.target.wants/mpc-browse.service
  sync
  umount /mnt/fw-root
  rmdir /mnt/fw-root
  mount -o remount,ro /
  findmnt -n -o OPTIONS /'
```

The last line must print `ro`. If it prints `rw`, run `mount -o remount,ro /` again.

**4. Delete the payload.**

```sh
ssh $MPC_HOST 'rm -rf /data/browser'
```

That removes the chroot, the scripts, the browser profile and any recordings still inside the
profile. Your actual samples in `MPC Documents/Samples` are not touched.

**5. Decide about autosave.** CrateSurf turns the MPC's project autosave on
(`AutoSaveEnabled=1`, `AutoSaveTimeout=300`) because browse mode would otherwise throw away unsaved
work every time. Uninstalling does not turn it back off: it is a good setting and it is your
project, so the choice is yours. To restore the shipped default, use **Preferences → Project
Load/Save → Auto Save** on the MPC, or:

```sh
ssh $MPC_HOST "sed -i 's/name=\"AutoSaveEnabled\" val=\"[^\"]*\"/name=\"AutoSaveEnabled\" val=\"0\"/' /data/Settings/MPC/MPC.settings"
```

The original file, as it was the first time `mpc-autosave.sh` ran, is kept beside it as
`MPC.settings.bak-autosave`. Do not copy that back wholesale unless you want to lose every setting
change since, because it contains all of them, not just these two.

**6. Reboot** if you want to be certain nothing is left running:

```sh
ssh $MPC_HOST reboot
```

---

## What gets written, in one place

For anyone who wants to know exactly what this touches:

| Path | What | Removed by |
| --- | --- | --- |
| `/data/browser/sysroot` | the Debian chroot, ~775 MB | step 4 |
| `/data/browser/node` | the pinned Node runtime, `bin/node` and its `LICENSE`, ~105 MB | step 4 |
| `/data/browser/bin` and `/data/browser/sysroot/opt` | the scripts, the extension, the kiosk pages, `weston.ini` | step 4 |
| `/data/browser/run` | pids, the `mode` file, logs | step 4 |
| `/etc/systemd/system/mpc-browse.service` | the toggle unit | step 2 |
| `/dev/mmcblk0p6` firmware rootfs | the same unit, for boot | step 3 |
| `/data/Settings/MPC/MPC.settings` | `AutoSaveEnabled`, `AutoSaveTimeout` | step 5 |
| `/data/Settings/MPC/MPC.settings.bak-autosave` | backup of that file | optional |
| `/media/acvs-content/MPC Documents` | downloads (in `Samples` unless you pick another folder) and recordings | you |

Nothing else on the MPC is written by installing or using CrateSurf. The MPC application binary,
its content, and the rest of the firmware are untouched.
