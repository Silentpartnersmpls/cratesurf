package main

import "testing"

func TestDetectModel(t *testing.T) {
	cases := []struct {
		name string
		info Info
		want string
	}{
		{"one plus", Info{Model: "Akai Professional MPC One+", Compatible: "inmusic,acva2 inmusic,az05 rockchip,rk3288", Gen: 1}, "oneplus"},
		{"live ii", Info{Model: "Akai Professional MPC Live II", Compatible: "inmusic,acva2 rockchip,rk3288", Gen: 1}, "live2"},
		{"xl", Info{Model: "Akai Professional MPC XL", Compatible: "inmusic,acvc rockchip,rk3588", Gen: 2}, "xl"},
		{"xl compatible only", Info{Compatible: "inmusic,acvc rockchip,rk3588", Gen: 2}, "xl"},
		{"live iii", Info{Model: "Akai Professional MPC Live III", Gen: 2}, "live3"},
		{"unknown gen 2", Info{Model: "Some New MPC", Compatible: "inmusic,az99 rockchip,rk3588", Gen: 2}, ""},
		{"unknown gen 1", Info{Model: "Some Old MPC", Compatible: "inmusic,az01 rockchip,rk3288", Gen: 1}, ""},
	}
	for _, c := range cases {
		got := detectModel(&c.info)
		key := ""
		if got != nil {
			key = got.key
		}
		if key != c.want {
			t.Errorf("%s: detectModel() = %q, want %q", c.name, key, c.want)
		}
	}
}

func TestKnownModels(t *testing.T) {
	seen := map[string]bool{}
	for i := range knownModels {
		m := &knownModels[i]
		if m.key == "" || m.name == "" {
			t.Errorf("known model %d has an empty key or name", i)
		}
		if seen[m.key] {
			t.Errorf("duplicate model key %q", m.key)
		}
		seen[m.key] = true
		if m.generation != 1 && m.generation != 2 {
			t.Errorf("%s has generation %d", m.name, m.generation)
		}
		wantArch := "armv7l"
		if m.generation == 2 {
			wantArch = "aarch64"
		}
		if m.arch != wantArch {
			t.Errorf("%s is Gen %d but reports arch %q, want %q", m.name, m.generation, m.arch, wantArch)
		}
	}
}
