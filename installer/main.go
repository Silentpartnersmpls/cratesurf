package main

// CrateSurf installer: one binary, no prerequisites on the machine it runs on.
//
// The interface is a terminal with a numbered menu because that is what works
// everywhere without shipping a GUI toolkit per platform, and because the two
// questions worth asking (address, password) fit in one line each. Everything
// after that is machine work with a progress line, which is the part the person
// installing should not have to think about.

import (
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

// version is stamped by build.sh; "dev" means a local build that has no
// release behind it.
var version = "dev"

func main() {
	var (
		host    = flag.String("host", "", "MPC address (IP or hostname); skips the menu and installs")
		user    = flag.String("user", "root", "SSH user on the MPC")
		pass    = flag.String("password", "", "root password; leave empty for a unit with none")
		payload = flag.String("payload", "", "local payload tarball, or a URL")
		sha     = flag.String("sha", payloadSHA256, "expected sha256 of the payload")
		check   = flag.Bool("check", false, "read-only probe: change nothing")
	)
	flag.Parse()

	banner()

	spec := *payload
	if spec == "" {
		spec = payloadURL
	}

	if *host != "" {
		runInstall(*host, *user, *pass, spec, *sha, *check)
		return
	}

	for {
		headline("What do you want to do?")
		note("1) Install CrateSurf on an MPC  (the MPC must already have root SSH)")
		note("2) Root an MPC first            (flash an SSH-enabled firmware image)")
		note("3) Just check a device          (read only, nothing is changed)")
		note("q) Quit")
		blank()
		switch strings.ToLower(ask("Choice", "1")) {
		case "1":
			runInstall("", *user, *pass, spec, *sha, false)
			return
		case "2":
			d, info, err := rootFlow()
			if err != nil {
				die(err)
			}
			if d == nil {
				return
			}
			// Straight into the install, reusing the connection and the facts
			// just read: retyping the address is exactly the kind of small
			// friction that makes people give up halfway.
			if err := doInstall(d, info, spec, *sha, false); err != nil {
				die(err)
			}
			return
		case "3":
			runInstall("", *user, *pass, spec, *sha, true)
			return
		case "q", "quit", "exit":
			return
		default:
			bad("no such choice")
		}
	}
}

func banner() {
	fmt.Println()
	fmt.Println(paint(bold, "  CrateSurf installer"))
	fmt.Println(paint(dim, "  a full browser on your MPC, from this computer"))
}

func runInstall(host, user, pass, spec, sha string, checkOnly bool) {
	if host == "" {
		headline("The MPC")
		note("You need its address and it must be on this network.")
		note("On the MPC: Preferences -> Info shows the IP.")
		host = ask("MPC address", "mpc-one-mk2")
		if host == "" {
			die(fmt.Errorf("no address given"))
		}
	}

	d, err := connectWithRetry(host, user, pass)
	if err != nil {
		die(fmt.Errorf("cannot reach %s: %v\n"+
			"        Things worth checking: the MPC is on the same network, its IP is\n"+
			"        right, and it has root SSH at all (menu option 2 if it does not)", host, err))
	}
	defer d.Close()

	info, err := probe(d)
	if err != nil {
		die(err)
	}
	ok("connected to %s", strings.TrimSpace(info.Model))
	info.describe()

	if checkOnly {
		fails := verify(d)
		if len(fails) > 0 {
			die(fmt.Errorf("%s", strings.Join(fails, "\n        ")))
		}
		ok("device looks right for CrateSurf")
		return
	}

	if err := doInstall(d, info, spec, sha, checkOnly); err != nil {
		die(err)
	}
}

// doInstall is the shared tail of both entry points: readiness, payload, then
// the sequence in install.go.
func doInstall(d *Dev, info *Info, spec, sha string, _ bool) error {
	if problems := info.problems(); len(problems) > 0 {
		for _, p := range problems {
			bad("%s", p)
		}
		return fmt.Errorf("this device cannot take the install as it stands")
	}

	headline("The payload")
	p, err := OpenPayload(spec, sha)
	if err != nil {
		return err
	}
	defer p.Close()
	if !strings.HasPrefix(spec, "http") {
		ok("%s (%s)", p.Path, humanBytes(p.Size))
	}

	return install(d, info, p)
}

// connectWithRetry asks for a password when the passwordless attempt is
// refused, rather than failing with "unable to authenticate" and leaving the
// person to guess that a password was the missing piece.
func connectWithRetry(host, user, pass string) (*Dev, error) {
	var lastErr error
	tries := 3
	for i := 1; i <= tries; i++ {
		d, err := dial(host, user, pass)
		if err == nil {
			return d, nil
		}
		lastErr = err
		if i < tries {
			time.Sleep(2 * time.Second)
		}
	}
	if strings.Contains(lastErr.Error(), "unable to authenticate") || strings.Contains(lastErr.Error(), "no supported methods") {
		note("that unit wants a password, it did not accept an empty one")
		pw := askSecret("root password")
		if pw != "" {
			if d, err := dial(host, user, pw); err == nil {
				return d, nil
			}
			return nil, fmt.Errorf("that password was refused too")
		}
	}
	return nil, lastErr
}

func die(err error) {
	blank()
	bad("%v", err)
	fmt.Println()
	os.Exit(1)
}
