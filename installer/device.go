package main

// Everything the installer knows about the MPC is read from the MPC. No version
// table, no assumption that the device is the one this was developed on: the
// first release shipped a probe pinned to 3.4.2.13 and a single firmware update
// made it refuse a perfectly good device. Facts over expectations.

import (
	"fmt"
	"strconv"
	"strings"
)

type Info struct {
	Model    string
	Arch     string
	Firmware string
	FreeKB   int64
	TotalKB  int64
	NodeOK   bool
	UnitOK   bool
	Browser  bool
}

// probeOne gathers the facts in a single round trip. Each value is echoed with
// a distinct prefix rather than in a fixed order, so a missing file on a newer
// firmware shows up as an empty field instead of shifting every answer below it.
func probe(d *Dev) (*Info, error) {
	script := `
echo "M=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\000')"
echo "A=$(uname -m 2>/dev/null)"
echo "F=$(cat /tmp/com.akaipro.mpc.version 2>/dev/null)"
echo "D=$(df -k /data 2>/dev/null | awk 'NR==2{print $4}')"
echo "T=$(df -k /data 2>/dev/null | awk 'NR==2{print $2}')"
echo "N=$([ -x /data/browser/node/bin/node ] && echo 1 || echo 0)"
echo "U=$([ -f /data/browser/mpc-browse.service ] && echo 1 || echo 0)"
echo "B=$([ -d /data/browser/sysroot ] && echo 1 || echo 0)"
`
	out, err := d.Must(script)
	if err != nil {
		return nil, err
	}
	vals := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if i := strings.IndexByte(line, '='); i > 0 {
			vals[line[:i]] = strings.TrimSpace(line[i+1:])
		}
	}
	free, _ := strconv.ParseInt(vals["D"], 10, 64)
	total, _ := strconv.ParseInt(vals["T"], 10, 64)

	// A device with no readable model is not an MPC, whatever it answers. This
	// is the check that stops someone typing the IP of their router and getting
	// an install attempt on it.
	if vals["M"] == "" && vals["A"] == "" {
		return nil, fmt.Errorf("connected, but this does not look like an MPC (no model, no architecture)")
	}
	return &Info{
		Model:    vals["M"],
		Arch:     vals["A"],
		Firmware: vals["F"],
		FreeKB:   free,
		TotalKB:  total,
		NodeOK:   vals["N"] == "1",
		UnitOK:   vals["U"] == "1",
		Browser:  vals["B"] == "1",
	}, nil
}

// sysrootSizeKB is what the unpacked tree actually takes on the device. The
// figure is deliberately generous: 1003 MB was measured on a 3.10 unit with a
// browser profile in it, and a refusal that comes after a 300 MB download is
// worse than one that comes before it.
func regroomNeeded() int64 { return 1150 * 1024 }

// problems names the reasons a device cannot be installed on, in the words the
// user needs to hear. Empty means go.
func (i *Info) problems() []string {
	var p []string
	if i.Arch != "armv7l" {
		p = append(p, fmt.Sprintf("this device reports architecture %q, and the payload is built for armv7l", i.Arch))
	}
	if i.FreeKB > 0 && i.FreeKB < regroomNeeded() {
		p = append(p, fmt.Sprintf("/data has %s free and the browser needs about 1.2 GB", humanBytes(i.FreeKB*1024)))
	}
	return p
}

// describe is the read-only screen: what the installer found, before it changes
// anything.
func (i *Info) describe() {
	note("model       %s", strings.TrimSpace(i.Model))
	note("arch        %s", i.Arch)
	if i.Firmware != "" {
		note("firmware    %s", i.Firmware)
	} else {
		note("firmware    (not readable on this build)")
	}
	note("free on /data  %s of %s", humanBytes(i.FreeKB*1024), humanBytes(i.TotalKB*1024))
	if i.Browser && i.NodeOK && i.UnitOK {
		note("state       CrateSurf is already installed, this is an upgrade")
	} else {
		note("state       fresh install")
	}
	blank()
}

// verifiedEnds is the part that matters: not "the files copied" but "the thing
// the person asked for answers". Each line is a separate fact, because the
// whole failure mode this project keeps hitting is a service that is enabled
// and inactive, or a port that is open with nothing behind it.
func verify(d *Dev) []string {
	var fails []string

	if active, err := d.Must("systemctl is-active mpc-browse.service 2>/dev/null"); err != nil || active != "active" {
		fails = append(fails, "the toggle service is not running (systemctl is-active mpc-browse)")
	} else {
		ok("toggle service is running")
	}

	// /proc/net/tcp lists ports in hex: 8798 is 0x225E. Checking the listening
	// socket is not the same as checking the service, and only one of them means
	// the phone can actually reach it.
	if n, err := d.Must("grep -c ':225E' /proc/net/tcp 2>/dev/null || true"); err != nil || strings.TrimSpace(n) == "0" || n == "" {
		fails = append(fails, "nothing is listening on port 8798 (the phone toggle)")
	} else {
		ok("listening on port 8798")
	}

	if _, err := d.Must("test -x /data/browser/sysroot/usr/lib/chromium/chromium"); err != nil {
		fails = append(fails, "the browser binary is missing from the sysroot, the payload did not unpack completely")
	} else {
		ok("browser binary present in the sysroot")
	}

	if _, err := d.Must("grep -qs mmcblk0p6/etc/systemd/system/mpc-browse.service /proc/mounts || test -f /data/browser/install-rootfs-unit.sh"); err != nil {
		// Only a note: whether the boot copy landed is reported by the install
		// step itself, which is the only place that can see the rootfs.
		warn("could not confirm the boot copy from here")
	}
	return fails
}
