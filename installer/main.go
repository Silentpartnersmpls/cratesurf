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
	"net"
	"os"
	"strings"
	"time"
)

// version is stamped by build.sh; "dev" means a local build that has no
// release behind it.
var version = "dev"

// noHarden is set from --no-harden. A package var rather than a parameter
// because the step it skips happens deep inside the install tail.
var noHarden bool

func main() {
	var (
		noHardenFlag = flag.Bool("no-harden", false, "leave root SSH as it is (skip the password and key step)")
		host         = flag.String("host", "", "MPC address (IP or hostname); skips the menu and installs")
		user         = flag.String("user", "root", "SSH user on the MPC")
		pass         = flag.String("password", "", "root password; leave empty for a unit with none")
		payload      = flag.String("payload", "", "local payload tarball, or a URL")
		sha          = flag.String("sha", payloadSHA256, "expected sha256 of the payload")
		check        = flag.Bool("check", false, "read-only probe: change nothing")
	)
	var acceptHost = flag.Bool("accept-host-key", false, "do not ask before trusting an unseen MPC host key (for scripted runs)")
	hardenOnly := flag.Bool("harden-only", false, "only set the root password and key; install nothing")
	flag.Parse()
	hostKeyAcceptNew = *acceptHost
	noHarden = *noHardenFlag

	banner()

	spec := *payload
	if spec == "" {
		spec = payloadURL
	}

	if *hardenOnly {
		if *host == "" {
			die(fmt.Errorf("--harden-only needs --host"))
		}
		runHardenOnly(*host, *user, *pass)
		return
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

// runHardenOnly closes root SSH on a device that is already set up. Same step
// the install ends with, split out because an existing install is exactly the
// case that most needs it: people ran the old instructions before this option
// existed, and their units are sitting there with an open root shell.
func runHardenOnly(host, user, pass string) {
	d, err := connectWithRetry(host, user, pass)
	if err != nil {
		die(fmt.Errorf("cannot reach %s: %v", host, err))
	}
	defer d.Close()
	if id, err := d.Must("id -u"); err != nil || strings.TrimSpace(id) != "0" {
		die(fmt.Errorf("that login is not root, so there is nothing to lock down"))
	}
	if err := maybeHarden(d); err != nil {
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

	if err := install(d, info, p); err != nil {
		return err
	}
	return maybeHarden(d)
}

// maybeHarden is the last question an install asks, and the answer matters more
// than the rest of it: a jailbreak image ships root with an empty password, which
// means anyone on the same network is already root on the device the moment the
// install finishes. Closing that is not optional hygiene, it is the difference
// between a browser and a back door with a browser in it.
func maybeHarden(d *Dev) error {
	if noHarden {
		warn("root SSH left as it was (--no-harden); anyone on this network can log in as root")
		return nil
	}

	headline("Root access")
	note("The SSH firmware on these units ships root with no password, so right now")
	note("anything on this network can log into the MPC as root. That is how the")
	note("installer got in, and it stays open unless something closes it.")
	blank()
	if !askYes("Set a root password on the MPC and install a key for this computer?", true) {
		warn("left open. Use --no-harden next time to skip this question entirely")
		return nil
	}

	host := d.Addr
	if h, _, err := net.SplitHostPort(d.Addr); err == nil {
		host = h
	}
	res, err := harden(d, host, d.User)
	if err != nil {
		// Not fatal to the install: the browser works either way, and failing the
		// whole run over this would throw away a good install for a security
		// setting that can be applied separately.
		bad("could not lock root SSH down: %v", err)
		return nil
	}
	printSecrets(res)
	return nil
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
