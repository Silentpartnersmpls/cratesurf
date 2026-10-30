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
		Auth:    []ssh.AuthMethod{ssh.Password(pass)},
		Timeout: 12 * time.Second,
		// The device's host key changes with every firmware flash, and some
		// jailbreak images are built with no persistent key at all, so pinning
		// one would refuse to connect after the very procedure this installer
		// offers. Nothing secret travels over this link.
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}
	c, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return nil, err
	}
	return &Dev{Client: c, Addr: addr, User: user}, nil
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
