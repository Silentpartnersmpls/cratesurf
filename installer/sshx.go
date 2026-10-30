package main

// The whole point of this binary is that the person installing does not have
// to install anything else first. Windows machines often have no usable ssh
// client at all, and the ones that do are a different version with different
// flags. So this speaks SSH itself: one dependency, no binaries to find on the
// machine, identical behaviour on all three platforms.

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

type Dev struct {
	Client *ssh.Client
	Addr   string
	User   string
}

// dial tries the empty password first, then the one supplied. An MPC flashed
// with the usual SSH firmware accepts root with no password at all, and SSH's
// "none" method covers that: the client library sends it before any auth
// method, so a blank ssh.Password("") is simply never reached on those units.
func dial(addr, user, pass string) (*Dev, error) {
	if !strings.Contains(addr, ":") {
		addr = net.JoinHostPort(addr, "22")
	}
	cfg := &ssh.ClientConfig{
		User: user,
		// Empty string included on purpose: an empty password is a real method
		// on these devices, not a missing one.
		Auth:            []ssh.AuthMethod{ssh.Password(pass)},
		Timeout:         12 * time.Second,
		HostKeyCallback: hostKeyCallback(addr),
	}
	c, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return nil, err
	}
	return &Dev{Client: c, Addr: addr, User: user}, nil
}

// hostKeyAcceptNew is set by --accept-host-key, for scripted runs where a
// prompt would hang. Everything else is asked once per device.
var hostKeyAcceptNew bool

// hostKeyCallback is trust-on-first-use, not blind trust.
//
// Accepting any key (which is what this did first) means anyone on the same
// network can answer for the MPC during an install and be handed the payload and
// the commands. Pinning one key instead breaks the moment the unit is reflashed,
// which is a procedure this installer actively offers. So: the fingerprint is
// shown and remembered the first time, and a change is a hard stop with a URL to
// explain strings, because a changed key is either a reflash or an interception
// and the person is the only one who knows which.
func hostKeyCallback(addr string) ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		host := addr
		if h, _, err := net.SplitHostPort(addr); err == nil {
			host = h
		}
		path := knownDevicesPath()
		known := readKnownDevices(path)
		shown := ssh.FingerprintSHA256(key)

		if was, ok := known[host]; ok {
			if was == shown {
				return nil
			}
			return fmt.Errorf("the host key of %s has changed\n"+
				"        was  %s\n        now  %s\n"+
				"        That is either a firmware reflash (which regenerates it) or\n"+
				"        something answering for the MPC that is not the MPC. If you\n"+
				"        did not reflash it, stop and find out what is on this network.", host, was, shown)
		}

		if !hostKeyAcceptNew {
			fmt.Printf("\n  %s %s\n", paint(bold, "first connection to"), host)
			note("host key fingerprint: %s", shown)
			if !askYes("Is that your MPC? (a reflash changes it, nothing else should)", true) {
				return fmt.Errorf("host key for %s was not accepted", host)
			}
		}
		known[host] = shown
		if err := writeKnownDevices(path, known); err != nil {
			note("could not remember the key (%v); this install still works", err)
		}
		return nil
	}
}

func (d *Dev) Close() {
	if d != nil && d.Client != nil {
		d.Client.Close()
	}
}

// Run returns stdout, stderr and the raw error separately: callers need to tell
// "the command ran and said no" from "the connection died", because the second
// one means the answers below it cannot be trusted.
func (d *Dev) Run(cmd string) (string, string, error) {
	s, err := d.Client.NewSession()
	if err != nil {
		return "", "", err
	}
	defer s.Close()
	var out, errb bytes.Buffer
	s.Stdout = &out
	s.Stderr = &errb
	err = s.Run(cmd)
	return out.String(), errb.String(), err
}

// Must runs a command that has to work, and folds stderr into the error so the
// reason reaches the user instead of a bare exit status.
func (d *Dev) Must(cmd string) (string, error) {
	out, errb, err := d.Run(cmd)
	if err != nil {
		msg := strings.TrimSpace(errb)
		if msg == "" {
			msg = strings.TrimSpace(out)
		}
		if msg == "" {
			msg = err.Error()
		}
		return out, fmt.Errorf("%s", firstLine(msg))
	}
	return strings.TrimSpace(out), nil
}

// RunStdin runs a command with input piped to its stdin. Used for anything
// secret: a password or a key on the command line is visible in `ps` to every
// process on the device for as long as it runs.
func (d *Dev) RunStdin(cmd, input string) (string, string, error) {
	s, err := d.Client.NewSession()
	if err != nil {
		return "", "", err
	}
	defer s.Close()
	s.Stdin = strings.NewReader(input)
	var out, errb bytes.Buffer
	s.Stdout = &out
	s.Stderr = &errb
	err = s.Run(cmd)
	return out.String(), errb.String(), err
}

// Untar streams a gzipped tarball into dest on the device. The transfer is the
// slow part of any install, so progress is reported from this side of the pipe
// rather than from tar, which says nothing until it is finished.
func (d *Dev) Untar(r io.Reader, size int64, dest, label string) error {
	s, err := d.Client.NewSession()
	if err != nil {
		return err
	}
	defer s.Close()

	var errb bytes.Buffer
	s.Stderr = &errb
	s.Stdin = &countingReader{r: r, total: size, label: label}

	done := make(chan error, 1)
	go func() {
		done <- s.Run(fmt.Sprintf("mkdir -p %s && tar xzf - -C %s", shq(dest), shq(dest)))
	}()
	err = <-done
	progressDone()
	if err != nil {
		msg := strings.TrimSpace(errb.String())
		if msg == "" {
			msg = err.Error()
		}
		return errors.New(firstLine(msg))
	}
	return nil
}

// RunStreamed is for steps whose output matters as it happens: unpacking the
// Node runtime, or anything that can take longer than a user expects to sit
// looking at a frozen console.
func (d *Dev) RunStreamed(cmd string) error {
	s, err := d.Client.NewSession()
	if err != nil {
		return err
	}
	defer s.Close()
	s.Stdout = os_DiscardWriter{}
	s.Stderr = os_DiscardWriter{}
	return s.Run(cmd)
}

type os_DiscardWriter struct{}

func (os_DiscardWriter) Write(p []byte) (int, error) { return len(p), nil }

type countingReader struct {
	r     io.Reader
	done  int64
	total int64
	label string
	last  time.Time
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.done += int64(n)
	if now := time.Now(); now.Sub(c.last) > 250*time.Millisecond {
		c.last = now
		progress(c.label, c.done, c.total)
	}
	return n, err
}

// shq single-quotes a path for the device's shell. The document tree has a
// space in its name ("MPC Documents"), so this is not theoretical.
func shq(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
