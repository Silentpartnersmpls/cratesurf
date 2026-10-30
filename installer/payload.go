package main

// The payload is the reason an installer exists at all. Building the sysroot
// needs apt and an armhf sandbox, which nobody should have to learn to get a
// browser on their MPC, so the finished tree ships as one tarball laid out the
// way /data/browser expects: sysroot/, node/, bin/, the kiosk pages, the unit.
//
// The tarball is not in this repository. It is too big and it is a build
// artifact, so it lives wherever releases live, and this file is the only place
// that knows where.

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Filled in at build time with -X main.payloadURL=... and -X main.payloadSHA256=...
// An empty URL means this build cannot download anything, which is exactly what
// a developer build should say rather than pointing at a release that does not
// exist yet.
var (
	payloadURL    = ""
	payloadSHA256 = ""
)

const payloadName = "cratesurf-payload"

type Payload struct {
	Path string
	Size int64
	Tmp  bool // downloaded, so it should be removed afterwards
}

func OpenPayload(spec, wantSHA string) (*Payload, error) {
	if spec == "" {
		return nil, fmt.Errorf("no payload configured in this build; pass --payload with a local file")
	}
	if strings.HasPrefix(spec, "http://") || strings.HasPrefix(spec, "https://") {
		return download(spec, wantSHA)
	}
	fi, err := os.Stat(spec)
	if err != nil {
		return nil, fmt.Errorf("payload %s: %v", spec, err)
	}
	if fi.IsDir() {
		return nil, fmt.Errorf("payload %s is a directory, not a tarball", spec)
	}
	if wantSHA != "" {
		got, err := sha256File(spec)
		if err != nil {
			return nil, err
		}
		if !strings.EqualFold(got, wantSHA) {
			return nil, fmt.Errorf("payload checksum mismatch: expected %s, got %s", wantSHA, got)
		}
	}
	return &Payload{Path: spec, Size: fi.Size()}, nil
}

func (p *Payload) Close() {
	if p.Tmp && p.Path != "" {
		os.Remove(p.Path)
	}
}

func (p *Payload) Reader() (io.ReadCloser, error) {
	f, err := os.Open(p.Path)
	if err != nil {
		return nil, err
	}
	return f, nil
}

// download writes to a temp file rather than streaming straight to the device.
// Two reasons: the checksum has to be checked before anything is unpacked on
// the MPC, and a dropped connection halfway through a 300 MB transfer should
// cost a retry, not a half-installed sysroot.
func download(url, wantSHA string) (*Payload, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("downloading the payload: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("downloading the payload: %s answered %s", url, resp.Status)
	}

	tmp, err := os.CreateTemp("", payloadName+"-*.tar.gz")
	if err != nil {
		return nil, err
	}
	name := tmp.Name()

	var done int64
	total := resp.ContentLength
	last := time.Now()
	h := sha256.New()
	buf := make([]byte, 1<<20)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := tmp.Write(buf[:n]); werr != nil {
				tmp.Close()
				os.Remove(name)
				return nil, werr
			}
			h.Write(buf[:n])
			done += int64(n)
			if time.Since(last) > 200*time.Millisecond {
				last = time.Now()
				progress("downloading", done, total)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			tmp.Close()
			os.Remove(name)
			return nil, fmt.Errorf("download interrupted after %s: %v", humanBytes(done), rerr)
		}
	}
	progressDone()
	tmp.Close()

	got := hex.EncodeToString(h.Sum(nil))
	if wantSHA != "" && !strings.EqualFold(got, wantSHA) {
		os.Remove(name)
		return nil, fmt.Errorf("downloaded payload does not match its checksum: expected %s, got %s", wantSHA, got)
	}
	ok("downloaded %s (%s)", filepath.Base(url), humanBytes(done))
	if wantSHA == "" {
		warn("no checksum configured for this build; sha256 is %s", got)
	}
	return &Payload{Path: name, Size: done, Tmp: true}, nil
}

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}
