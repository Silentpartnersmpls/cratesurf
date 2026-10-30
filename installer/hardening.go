package main

// Closing the front door the jailbreak image left open.
//
// An MPC flashed with the usual SSH firmware comes with root's password field
// empty, and sshd asked to permit empty passwords. The result, measured on our
// own unit: `ssh root@mpc` answers `Authenticated ... using "none"` - no key, no
// password, nothing. On a home LAN that is a shrug. On venue Wi-Fi, at a show, in
// a studio with guests, it is a stranger owning the box, and every person who
// runs this installer inherits it unless something closes it.
//
// So the last step of an install sets a real password and installs a key of our
// own, in that order and for different reasons:
//
//   the password is what actually closes "none", because sshd only accepts that
//   method for an account whose password field is empty. A key alone would not.
//
//   the key is what makes the next install painless, and what keeps the existing
//   scripts (deploy.sh, install-service.sh, probe-device.sh) working, since they
//   all assume they can just ssh in.
//
// Everything secret goes over stdin, never argv: a password in a command string
// is visible in `ps` to anything on the device for as long as the command runs.

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
)

type result struct {
	Password string
	KeyPath  string
	CredPath string
}

func cratesurfDir() string {
	h, err := os.UserHomeDir()
	if err != nil {
		return ".cratesurf"
	}
	return filepath.Join(h, ".cratesurf")
}

func knownDevicesPath() string { return filepath.Join(cratesurfDir(), "known_devices") }

// credPath is where one device's generated root password is kept: a 0600 file
// per host, beside the installer's key.
func credPath(host string) string {
	return filepath.Join(cratesurfDir(), "root-"+host+".txt")
}

// saveCredential writes down the password this run generated.
//
// It used to be printed once and stored nowhere, which made losing the key file
// (a new laptop, a tidied home directory, a restore that skipped dotfiles) the
// same thing as being locked out of your own MPC. A 0600 file next to the key has
// exactly the audience the key already has, and the person who deleted the key is
// usually still the person who owns this file.
func saveCredential(host, pw, keyHint string) (string, error) {
	path := credPath(host)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# CrateSurf: root login for %s\n", host)
	fmt.Fprintf(&b, "# Saved %s, mode 0600, in the same folder as the installer's key.\n",
		time.Now().Format("2006-01-02 15:04"))
	fmt.Fprintf(&b, "# Either this password or %s logs in as root.\n", keyHint)
	b.WriteString("# If both are gone, KNOWN-ISSUES.md has the way back.\n")
	fmt.Fprintf(&b, "password=%s\n", pw)
	if err := os.WriteFile(path, []byte(b.String()), 0o600); err != nil {
		return "", err
	}
	return path, nil
}

// savedPassword reads back what saveCredential wrote, so a later run from this
// computer can log in without the person having to find the paper they wrote it
// on.
func savedPassword(host string) (string, string) {
	b, err := os.ReadFile(credPath(host))
	if err != nil {
		return "", ""
	}
	for _, line := range strings.Split(string(b), "\n") {
		if v, ok := strings.CutPrefix(strings.TrimSpace(line), "password="); ok && v != "" {
			return v, credPath(host)
		}
	}
	return "", ""
}

func readKnownDevices(path string) map[string]string {
	m := map[string]string{}
	b, err := os.ReadFile(path)
	if err != nil {
		return m
	}
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Fields(line)
		if len(f) == 2 {
			m[f[0]] = f[1]
		}
	}
	return m
}

func writeKnownDevices(path string, m map[string]string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	var b strings.Builder
	for h, k := range m {
		fmt.Fprintf(&b, "%s %s\n", h, k)
	}
	return os.WriteFile(path, []byte(b.String()), 0o600)
}

// genPassword avoids characters that need quoting in a shell, because this
// string is going to be typed by a person and pasted into a terminal eventually.
func genPassword() (string, error) {
	const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	for i := range raw {
		raw[i] = alphabet[int(raw[i])%len(alphabet)]
	}
	return string(raw), nil
}

// existingInstallerKey reads the key this installer keeps for itself, without
// creating one: dialling a device should not leave a new file behind with no key
// installed anywhere.
func existingInstallerKey() ssh.Signer {
	b, err := os.ReadFile(filepath.Join(cratesurfDir(), "id_ed25519"))
	if err != nil {
		return nil
	}
	s, err := ssh.ParsePrivateKey(b)
	if err != nil {
		return nil
	}
	return s
}

// installerKey loads the key this installer keeps for itself, creating it on
// first use. One key per computer, reused for every device, 0600 in ~/.cratesurf.
func installerKey() (string, ssh.Signer, error) {
	dir := cratesurfDir()
	path := filepath.Join(dir, "id_ed25519")
	if b, err := os.ReadFile(path); err == nil {
		if s, err := ssh.ParsePrivateKey(b); err == nil {
			return path, s, nil
		}
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", nil, err
	}
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", nil, err
	}
	block, err := ssh.MarshalPrivateKey(priv, "cratesurf-installer")
	if err != nil {
		return "", nil, err
	}
	if err := os.WriteFile(path, pem.EncodeToMemory(block), 0o600); err != nil {
		return "", nil, err
	}
	s, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		return "", nil, err
	}
	return path, s, nil
}

func harden(d *Dev, host, user string) (*result, error) {
	res := &result{}

	// --- 1. the password, which is what closes "none" -----------------------
	pw, err := genPassword()
	if err != nil {
		return nil, err
	}
	// The hash is made on the device with its own openssl, so the file format is
	// the device's idea of a password and not ours. A backup goes down first:
	// shadow is the one file where a bad edit means the difference between a
	// working box and a reflash, and it lives in the overlay on /data, so a copy
	// costs nothing.
	setShadow := `set -e
read -r PW
[ -n "$PW" ] || { echo "NO_PASSWORD"; exit 1; }
mkdir -p /data/browser/run
cp -p /etc/shadow /data/browser/run/shadow.bak
H=$(printf '%s' "$PW" | /usr/bin/openssl passwd -6 -stdin)
[ -n "$H" ] || { echo "NO_HASH"; exit 1; }
awk -v h="$H" 'BEGIN{FS=OFS=":"} $1=="root"{$2=h} {print}' /etc/shadow > /tmp/shadow.new
[ -s /tmp/shadow.new ] || { echo "EMPTY_RESULT"; exit 1; }
grep -q "^root:$H:" /tmp/shadow.new || { echo "ROOT_LINE_MISSING"; exit 1; }
chmod 600 /tmp/shadow.new
mv /tmp/shadow.new /etc/shadow
echo SET
`
	// sh -c with the script quoted, not `sh -s`: with -s the shell reads its
	// script from stdin, so the password line would be executed as a command and
	// `read` would find nothing. The first version did exactly that and failed
	// with an empty error message.
	out, errb, err := d.RunStdin("/bin/sh -c "+shq(setShadow), pw+"\n")
	if err != nil || !strings.Contains(out, "SET") {
		msg := strings.TrimSpace(errb)
		if msg == "" {
			msg = strings.TrimSpace(out)
		}
		return nil, fmt.Errorf("could not set the root password: %s", firstLine(msg))
	}
	ok("root password set")

	// Prove it before trusting it. If a password login does not work, the old
	// shadow goes straight back rather than leaving a device nobody can log in to.
	addr := d.Addr
	// Password only, on purpose: with the key in the list this check would pass on
	// a key and prove nothing about the password it is supposed to be testing.
	nd, err := dialPassword(addr, user, pw)
	if err != nil {
		d.Run("cp -p /data/browser/run/shadow.bak /etc/shadow")
		return nil, fmt.Errorf("the new password did not work, so the old shadow was put back (%v)", err)
	}
	if id, err := nd.Must("id -u"); err == nil && strings.TrimSpace(id) == "0" {
		ok("a password login works and is still root")
	} else {
		nd.Close()
		d.Run("cp -p /data/browser/run/shadow.bak /etc/shadow")
		return nil, fmt.Errorf("logged in with the new password but was not root; old shadow restored")
	}
	nd.Close()
	res.Password = pw

	// The password exists only in this process until it is written down here, and
	// it has just been proven, so this can never save one that does not work.
	keyHint := filepath.Join(cratesurfDir(), "id_ed25519")
	if p, err := saveCredential(host, pw, keyHint); err != nil {
		warn("could not save the password to %s: %v", credPath(host), err)
	} else {
		res.CredPath = p
	}

	// --- 2. the key, so the next run and the existing scripts still work -----
	keyPath, signer, err := installerKey()
	if err != nil {
		warn("could not create a key for repeat use: %v", err)
		return res, nil
	}
	pub := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey()))) + " cratesurf-installer"
	// /root/.ssh is on the read-only root filesystem, not the /etc overlay, so
	// the key needs the same remount dance the unit install does - and the same
	// guarantee that / goes back to read-only whichever way this ends.
	installKey := `set -e
read -r KEY
cleanup() { mount -o remount,ro / 2>/dev/null || true; }
trap cleanup EXIT INT TERM
mount -o remount,rw / || { echo "NO_RW"; exit 1; }
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
if grep -qF "$KEY" /root/.ssh/authorized_keys; then
  echo "ALREADY"
else
  printf '%s\n' "$KEY" >> /root/.ssh/authorized_keys
  echo "ADDED"
fi
chmod 600 /root/.ssh/authorized_keys
sync
`
	out, errb, err = d.RunStdin("/bin/sh -c "+shq(installKey), pub+"\n")
	if err != nil {
		warn("could not install the key: %s", firstLine(strings.TrimSpace(errb)))
		return res, nil
	}
	if !strings.Contains(out, "ADDED") && !strings.Contains(out, "ALREADY") {
		warn("the key install said nothing useful, skipping it")
		return res, nil
	}
	res.KeyPath = keyPath
	ok("key installed for repeat installs (%s)", keyPath)

	// The device's own tools have no idea about that key, so tell ssh about it
	// once. Without this, every script in the repo stops working the moment the
	// password goes on, which is a worse outcome than the hole it closed.
	if err := ensureSSHConfig(host, keyPath); err != nil {
		note("could not add a Host entry to ~/.ssh/config (%v)", err)
		note("use: ssh -i %s %s@%s", keyPath, user, host)
	}
	return res, nil
}

// ensureSSHConfig appends one Host block, once. It never rewrites an existing
// entry, because a config someone else wrote is not ours to reorganise.
func ensureSSHConfig(host, keyPath string) error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".ssh")
	path := filepath.Join(dir, "config")
	b, _ := os.ReadFile(path)
	if strings.Contains(string(b), "# cratesurf installer: "+host) {
		return nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	block := fmt.Sprintf("\n# cratesurf installer: %s\nHost %s\n    IdentityFile %s\n    IdentitiesOnly yes\n",
		host, host, keyPath)
	_, err = f.WriteString(block)
	return err
}

// printSecrets is the one place a generated password reaches the screen. It is
// printed once, never written to a file, and never sent anywhere.
func printSecrets(res *result) {
	if res == nil || res.Password == "" {
		return
	}
	headline("The MPC's new root password")
	note("%s", paint(bold, res.Password))
	blank()
	if res.CredPath != "" {
		note("Saved to %s, mode 0600, and shown here once.", res.CredPath)
	} else {
		note("Not saved: this screen is the only place it appears.")
	}
	note("It is what stops anyone else on the network logging into the MPC as root.")
	if res.KeyPath != "" {
		blank()
		note("This computer also has a key at %s, so you will not need the", res.KeyPath)
		note("password again from here, and the repo's scripts keep working.")
		blank()
		note("If the key is ever lost, that file is the way back in. If both go, the")
		note("MPC has to be reached by reflashing the SSH firmware image from a USB")
		note("stick: that resets root's password but leaves everything on /data, so")
		note("nothing installed is lost. KNOWN-ISSUES.md has the procedure.")
	}
}
