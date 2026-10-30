package main

// Root access on these units comes from a modified firmware image, and this
// program cannot obtain it over the network for the obvious reason: SSH is what
// it is trying to get. The honest version of a "root the MPC" button is
// therefore three things it can do, and one it cannot:
//
//   it can tell you which image you need and where it comes from
//   it can check the image you downloaded
//   it can put it on a USB stick correctly
//   it cannot press UPDATE on the MPC for you, because that screen is on the
//     device and the device reboots into a flashing mode
//
// It deliberately does not download or bundle a firmware image. Those are
// InMusic's files with a couple of files changed, so the person flashing one
// should get it from the people who made it, and see what it is.

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	kikgenPage    = "https://github.com/TheKikGen/MPC-LiveXplore"
	altFirmware   = "https://github.com/bonsaipanda/MPC-Force-SSH-Firmwares"
	minImageBytes = 100 << 20 // Akai's Gen 1 images are about 155 MB
)

// rootFlow returns a live connection when it ended with a rooted device, so the
// caller can carry straight on into the install instead of making the person
// type the address a second time.
func rootFlow() (*Dev, *Info, error) {
	headline("Rooting an MPC")
	note("An MPC One+ ships with SSH switched off, and with nothing to switch it")
	note("on with: that is what root would be for. The way in is to flash a")
	note("firmware image with SSH already enabled.")
	blank()
	note("Images: %s", kikgenPage)
	note("        %s", altFirmware)
	blank()
	note("Get the one for MPC One+ Gen 1 on your firmware version. Checked into")
	note("a version mismatch is how people end up downgrading for no reason.")
	blank()
	if !askYes("Do you have the .img file on this computer?", false) {
		note("Download it first, then run this again.")
		return nil, nil, nil
	}

	img := strings.Trim(strings.TrimSpace(ask("Path to the firmware image", "")), `"'`)
	if img == "" {
		return nil, nil, fmt.Errorf("no image given")
	}
	fi, err := os.Stat(img)
	if err != nil {
		return nil, nil, fmt.Errorf("cannot read %s: %v", img, err)
	}
	if fi.Size() < minImageBytes {
		return nil, nil, fmt.Errorf("%s is %s, which is too small to be a firmware image (expect about 155 MB)", filepath.Base(img), humanBytes(fi.Size()))
	}
	ok("image looks right: %s, %s", filepath.Base(img), humanBytes(fi.Size()))
	headline("The USB stick")
	note("The MPC reads the image from the root of a FAT32 or exFAT stick.")
	note("Nothing else needs to be on it, and it does not need to be big.")

	targets := removableTargets()
	if len(targets) == 0 {
		return nil, nil, fmt.Errorf("no removable drives found; plug the stick in and try again")
	}
	for i, t := range targets {
		note("%d) %s", i+1, t)
	}
	pick := ask("Which one", "1")
	idx := 0
	fmt.Sscanf(pick, "%d", &idx)
	if idx < 1 || idx > len(targets) {
		return nil, nil, fmt.Errorf("no such drive")
	}
	dst := filepath.Join(targets[idx-1], filepath.Base(img))

	if err := copyWithProgress(img, dst, fi.Size()); err != nil {
		return nil, nil, err
	}
	ok("copied to %s", dst)
	if runtime.GOOS != "linux" {
		warn("this program cannot check the filesystem from here; the MPC will")
		warn("only see the image if the stick is FAT32 or exFAT")
	}

	headline("On the MPC")
	note("1. Unplug the stick from this computer and plug it into the MPC.")
	note("2. Power the MPC from its 12 V adapter, not from a computer's USB port.")
	note("3. Preferences -> Info -> UPDATE -> USB Drive Update -> confirm.")
	note("4. It reboots into update mode and shows \"Updating Firmware\".")
	note("   Several minutes. Do not power it off and do not pull the stick.")
	blank()
	note("If the UPDATE button will not take it: power off, then hold")
	note("FULL LEVEL + BROWSE + PAD BANK C/G while powering on.")
	blank()
	pause("Press Enter once the MPC is back up and on your network.")

	addr := ask("MPC address", "mpc-one-mk2")
	d, err := connectWithRetry(addr, "root", "")
	if err != nil {
		return nil, nil, fmt.Errorf("still cannot get in: %v\n        If that image was the stock one, SSH stays closed and nothing is wrong with the flash", err)
	}
	info, err := probe(d)
	if err != nil {
		d.Close()
		return nil, nil, err
	}
	ok("root shell on %s", strings.TrimSpace(info.Model))
	info.describe()
	blank()
	if !askYes("Install CrateSurf on it now?", true) {
		d.Close()
		return nil, nil, nil
	}
	return d, info, nil
}

// removableTargets is a deliberately small list: the places a stick shows up on
// each platform, nothing clever. A wrong guess here writes 155 MB into the
// user's home folder and then blames them for not finding it.
func removableTargets() []string {
	var out []string
	switch runtime.GOOS {
	case "windows":
		for c := 'D'; c <= 'Z'; c++ {
			p := string(c) + ":\\"
			if _, err := os.Stat(p); err == nil {
				out = append(out, p)
			}
		}
	case "darwin":
		es, _ := os.ReadDir("/Volumes")
		for _, e := range es {
			if e.Name() == "Macintosh HD" {
				continue
			}
			out = append(out, filepath.Join("/Volumes", e.Name()))
		}
	default:
		// /proc/mounts gives the filesystem type in the third field, which is
		// the only way to tell a stick from a directory that happens to live
		// under /media.
		b, err := os.ReadFile("/proc/mounts")
		if err != nil {
			return nil
		}
		for _, line := range strings.Split(string(b), "\n") {
			f := strings.Split(line, " ")
			if len(f) < 3 {
				continue
			}
			mp, fs := f[1], f[2]
			if !strings.HasPrefix(mp, "/media/") && !strings.HasPrefix(mp, "/run/media/") && !strings.HasPrefix(mp, "/mnt/") {
				continue
			}
			if fs == "vfat" || fs == "exfat" {
				out = append(out, mp)
			} else {
				out = append(out, mp+"  ("+fs+", the MPC will not read this)")
			}
		}
	}
	return out
}

func copyWithProgress(src, dst string, size int64) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("writing to the stick: %v", err)
	}
	defer out.Close()

	cw := &progressWriter{total: size, label: "copying   "}
	if _, err := io.Copy(out, io.TeeReader(in, cw)); err != nil {
		os.Remove(dst)
		return fmt.Errorf("copying to the stick: %v", err)
	}
	progressDone()
	if err := out.Sync(); err != nil {
		return fmt.Errorf("the stick did not flush cleanly: %v", err)
	}
	return nil
}

type progressWriter struct {
	done  int64
	total int64
	label string
	last  time.Time
}

func (p *progressWriter) Write(b []byte) (int, error) {
	p.done += int64(len(b))
	if time.Since(p.last) > 200*time.Millisecond {
		p.last = time.Now()
		progress(p.label, p.done, p.total)
	}
	return len(b), nil
}
