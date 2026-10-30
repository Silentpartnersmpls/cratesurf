package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The password used to exist only on screen after one print. This is the file
// that makes a deleted key survivable, so the round trip and the mode matter.
func TestCredentialRoundTrip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	keyHint := filepath.Join(home, ".cratesurf", "id_ed25519")

	path, err := saveCredential("mpc-one-mk2", "Test-Passw0rd-24chars", keyHint)
	if err != nil {
		t.Fatalf("saveCredential: %v", err)
	}

	fi, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if got := fi.Mode().Perm(); got != 0o600 {
		t.Errorf("credential file mode is %o, want 600", got)
	}

	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	for _, want := range []string{keyHint, "KNOWN-ISSUES.md", "mpc-one-mk2"} {
		if !strings.Contains(string(body), want) {
			t.Errorf("credential file does not mention %q", want)
		}
	}

	pw, from := savedPassword("mpc-one-mk2")
	if pw != "Test-Passw0rd-24chars" || from != path {
		t.Errorf("savedPassword = %q from %q, want the saved value from %q", pw, from, path)
	}

	// A host that was never hardened has nothing saved, and must not inherit
	// another device's password.
	if pw, _ := savedPassword("another-mpc"); pw != "" {
		t.Errorf("savedPassword for an unknown host returned %q", pw)
	}

	// A file that exists but carries no password line is not a password.
	if err := os.WriteFile(path, []byte("# overwritten by something else\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if pw, _ := savedPassword("mpc-one-mk2"); pw != "" {
		t.Errorf("a file without a password line returned %q", pw)
	}
}
