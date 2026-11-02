package main

import "testing"

func TestBoardGen(t *testing.T) {
	cases := []struct {
		name       string
		arch       string
		compatible string
		model      string
		want       int
	}{
		{"one plus", "armv7l", "inmusic,acva2 inmusic,az05 rockchip,rk3288", "Akai Professional MPC One+", 1},
		{"live ii", "armv7l", "inmusic,acva2 rockchip,rk3288", "Akai Professional MPC Live II", 1},
		{"xl", "aarch64", "inmusic,acvc rockchip,rk3588", "Akai Professional MPC XL", 2},
		{"arm64 fallback", "aarch64", "", "", 2},
		{"unknown 32-bit", "armv7l", "", "", 1},
	}
	for _, c := range cases {
		if got := boardGen(c.arch, c.compatible, c.model); got != c.want {
			t.Errorf("%s: boardGen(%q, %q, %q) = %d, want %d", c.name, c.arch, c.compatible, c.model, got, c.want)
		}
	}
}

func TestProblemsRequiresMatchingArchitecture(t *testing.T) {
	enough := int64(2 * 1024 * 1024)
	for _, c := range []struct {
		name    string
		info    Info
		wantErr bool
	}{
		{"gen 1 armv7", Info{Arch: "armv7l", Gen: 1, FreeKB: enough}, false},
		{"gen 2 aarch64", Info{Arch: "aarch64", Gen: 2, FreeKB: enough}, false},
		{"gen 2 arm64 alias", Info{Arch: "arm64", Gen: 2, FreeKB: enough}, false},
		{"gen 2 32-bit", Info{Arch: "armv7l", Gen: 2, FreeKB: enough}, true},
		{"gen 1 64-bit", Info{Arch: "aarch64", Gen: 1, FreeKB: enough}, true},
	} {
		got := c.info.problems()
		if (len(got) > 0) != c.wantErr {
			t.Errorf("%s: problems() = %v, wantErr %v", c.name, got, c.wantErr)
		}
	}
}

func TestPayloadFor(t *testing.T) {
	old := []string{payloadURL, payloadSHA256, payloadURLARMHF, payloadSHA256ARMHF, payloadURLARM64, payloadSHA256ARM64}
	defer func() {
		payloadURL, payloadSHA256, payloadURLARMHF, payloadSHA256ARMHF, payloadURLARM64, payloadSHA256ARM64 =
			old[0], old[1], old[2], old[3], old[4], old[5]
	}()

	payloadURLARMHF, payloadSHA256ARMHF = "https://example.test/armhf.tar.gz", "aaa"
	payloadURLARM64, payloadSHA256ARM64 = "https://example.test/arm64.tar.gz", "bbb"

	for _, c := range []struct {
		name string
		info Info
		want string
	}{
		{"gen 1", Info{Arch: "armv7l", Gen: 1}, payloadURLARMHF},
		{"gen 2", Info{Arch: "aarch64", Gen: 2}, payloadURLARM64},
		{"gen 2 arm64 alias", Info{Arch: "arm64", Gen: 2}, payloadURLARM64},
		{"gen 2 wins over an odd arch", Info{Arch: "armv7l", Gen: 2}, payloadURLARM64},
	} {
		got, _, err := payloadFor(&c.info, "", "")
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		if got != c.want {
			t.Errorf("%s: payloadFor = %q, want %q", c.name, got, c.want)
		}
	}

	if got, _, err := payloadFor(&Info{Arch: "armv7l"}, "file.tar.gz", "sha"); err != nil || got != "file.tar.gz" {
		t.Errorf("explicit payload = %q, %v; want file.tar.gz, nil", got, err)
	}
	if _, gotSHA, err := payloadFor(&Info{Arch: "armv7l", Gen: 1}, "file.tar.gz", ""); err != nil || gotSHA != "aaa" {
		t.Errorf("explicit Gen 1 payload without --sha = %q, %v; want the baked armhf sha", gotSHA, err)
	}
	if _, gotSHA, err := payloadFor(&Info{Arch: "aarch64", Gen: 2}, "file.tar.gz", ""); err != nil || gotSHA != "bbb" {
		t.Errorf("explicit Gen 2 payload without --sha = %q, %v; want the baked arm64 sha", gotSHA, err)
	}

	payloadURLARM64 = ""
	if _, _, err := payloadFor(&Info{Arch: "aarch64", Gen: 2}, "", ""); err == nil {
		t.Error("a build without an arm64 payload should refuse an aarch64 device")
	}
}
