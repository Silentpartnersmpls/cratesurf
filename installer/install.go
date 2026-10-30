package main

// This sequence is deploy.sh, install-node.sh and install-service.sh --boot
// collapsed into one path, in the order that survives an install over an
// existing one:
//
//   stop the toggle  -> the Node binary is about to be replaced underneath a
//                       running process, and a half-replaced interpreter is how
//                       you get a service that dies on the next restart
//   unpack           -> sysroot, node, scripts, kiosk pages, unit, all at once
//   install the unit -> /etc, so systemd sees it now
//   write the unit into the firmware rootfs -> so it also starts at boot
//   verify           -> the toggle answers, the browser exists
//
// The last step is not decoration. Every bug this project has had in the
// field was a service that reported success and did nothing.

import (
	"fmt"
	"net"
	"strings"
)

func install(d *Dev, info *Info, p *Payload) error {
	headline("Installing")

	// Unpacking a sysroot under a live weston and Chromium replaces the files
	// those processes are executing. Refuse rather than produce a session that
	// dies the moment it is touched.
	if mode, _, _ := d.Run("cat /data/browser/run/mode 2>/dev/null"); strings.TrimSpace(mode) == "browse" {
		return fmt.Errorf("the MPC is in browse mode right now: press EXIT BROWSE MODE on the device (or run /data/browser/bin/browse-down.sh) and start again")
	}

	if _, err := d.Must("systemctl stop mpc-browse.service 2>/dev/null || true"); err != nil {
		// Not fatal: on a fresh device there is nothing to stop.
		note("no existing toggle to stop")
	}

	r, err := p.Reader()
	if err != nil {
		return fmt.Errorf("reading the payload: %v", err)
	}
	defer r.Close()
	if err := d.Untar(r, p.Size, "/data/browser", "unpacking"); err != nil {
		return fmt.Errorf("unpacking on the device: %v", err)
	}
	ok("unpacked %s into /data/browser", humanBytes(p.Size))

	if _, err := d.Must("chmod +x /data/browser/bin/*.sh"); err != nil {
		return fmt.Errorf("making the scripts executable: %v", err)
	}

	// The profile is not in the payload on purpose (it carries first-boot state
	// from whichever machine built the tarball), so seed it here the same way
	// deploy.sh does. Without it Chromium asks where to save a download through
	// a GTK dialog that cannot appear on this device, and every download dies.
	if _, err := d.Must("mkdir -p /data/browser/run && sh /data/browser/bin/setup-profile.sh"); err != nil {
		return fmt.Errorf("seeding the browser profile: %v", err)
	}
	ok("browser profile seeded")

	// The unit goes into /etc first and is started here, so that a failure in
	// the rootfs step below still leaves a working install that survives
	// everything except a reboot.
	unitCmd := `cp /data/browser/mpc-browse.service /etc/systemd/system/mpc-browse.service &&
chmod 644 /etc/systemd/system/mpc-browse.service &&
systemctl daemon-reload &&
systemctl enable mpc-browse.service >/dev/null 2>&1 || true
systemctl restart mpc-browse.service
sleep 2
systemctl is-active mpc-browse.service`
	if active, err := d.Must(unitCmd); err != nil {
		return fmt.Errorf("starting the toggle service: %v", err)
	} else if active != "active" {
		return fmt.Errorf("the toggle service started and immediately stopped; check `journalctl -u mpc-browse` on the device")
	}
	ok("toggle service installed and running")

	bootOut, bootErr := d.Must("/data/browser/install-rootfs-unit.sh")
	for _, line := range strings.Split(strings.TrimSpace(bootOut), "\n") {
		if line != "" {
			note("%s", strings.TrimSpace(line))
		}
	}
	if bootErr != nil {
		// This one matters enough to be loud: without it the install works
		// until the next reboot and then silently stops.
		warn("the boot copy did not install: %v", bootErr)
		warn("CrateSurf will work now, but will not come back after a reboot")
	} else {
		ok("unit written into the firmware rootfs (survives a reboot)")
	}

	headline("Checking")
	fails := verify(d)
	if len(fails) > 0 {
		return fmt.Errorf("%s", strings.Join(fails, "\n        "))
	}
	_ = info

	host, _, err := net.SplitHostPort(d.Addr)
	if err != nil {
		host = d.Addr
	}
	headline("Done")
	note("Phone toggle:   http://%s:8798/", host)
	note("Three fingers on the glass, held about 2.5 seconds, also opens it.")
	note("First time in: the MPC app stops, and autosave is turned on for you")
	note("so a switch does not throw away the project you were working on.")
	return nil
}
