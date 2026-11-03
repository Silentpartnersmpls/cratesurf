package main

// The installer used to present the probe result as a fact and move on. That is
// fine when the probe identifies a unit, but it gives nobody a chance to catch
// the case where the wrong MPC is on the other end of the address. The model is
// an explicit question now: the list below is short and stable, the probe result
// is used as the default and as a cross-check, and a Gen 1/Gen 2 disagreement
// stops before a payload is downloaded.

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// errModelCancelled means the person backed out of the model question. Nothing
// has been changed at that point: this question is asked before the payload is
// opened or anything is unpacked.
var errModelCancelled = errors.New("model selection cancelled")

type mpcModel struct {
	key        string
	name       string
	generation int
	arch       string
}

var knownModels = []mpcModel{
	{key: "oneplus", name: "MPC One+", generation: 1, arch: "armv7l"},
	{key: "live2", name: "MPC Live II", generation: 1, arch: "armv7l"},
	{key: "xl", name: "MPC XL", generation: 2, arch: "aarch64"},
	{key: "live3", name: "MPC Live III", generation: 2, arch: "aarch64"},
}

func modelByKey(key string) *mpcModel {
	for i := range knownModels {
		if knownModels[i].key == key {
			return &knownModels[i]
		}
	}
	return nil
}

func (m *mpcModel) String() string {
	return fmt.Sprintf("%s (Gen %d, %s)", m.name, m.generation, m.arch)
}

// detectModel is deliberately conservative: it reads the model name the device
// reports, with two compatible-string fallbacks for the names we know. An
// unrecognised model is not guessed from the generation, because the point of
// the question is to make the person look at the unit. A blank result is a
// valid answer, and chooseModel says so.
func detectModel(info *Info) *mpcModel {
	s := strings.ToLower(strings.TrimSpace(info.Model) + " " + strings.TrimSpace(info.Compatible))
	switch {
	case strings.Contains(s, "mpc live iii"),
		strings.Contains(s, "mpc live 3"):
		return modelByKey("live3")
	case strings.Contains(s, "mpc xl"),
		strings.Contains(s, "inmusic,acvc"):
		return modelByKey("xl")
	case strings.Contains(s, "mpc live ii"),
		strings.Contains(s, "mpc live 2"):
		return modelByKey("live2")
	case strings.Contains(s, "mpc one+"):
		return modelByKey("oneplus")
	default:
		return nil
	}
}

func detectedModelLabel(info *Info) string {
	model := strings.TrimSpace(info.Model)
	if model == "" {
		model = "model name not reported"
	}
	return fmt.Sprintf("%s (Gen %d, %s)", model, info.Gen, info.Arch)
}

// chooseModel asks the question, then asks again if the answer and the probe
// disagree. Every "no" goes back to the list rather than forward into an
// install, and a generation mismatch only has a back option and a cancel
// option: the armv7l and aarch64 payloads are not interchangeable, so there is
// nothing useful to continue with.
func chooseModel(info *Info) (*mpcModel, error) {
	detected := detectModel(info)
	for {
		headline("The MPC model")
		note("Connected unit: %s", detectedModelLabel(info))
		if detected != nil {
			note("The installer reads this as %s.", detected)
		} else {
			warn("the model name is not one of the known names; use the label on the unit")
		}
		blank()
		note("Choose the model printed on the unit. The model decides whether this")
		note("install is Gen 1 (armv7l) or Gen 2 (aarch64).")
		blank()
		for i := range knownModels {
			m := &knownModels[i]
			note("%d) %-12s Gen %d  (%s)", i+1, m.name, m.generation, m.arch)
		}
		if detected != nil {
			note("d) Use detected model (%s)", detected.name)
		}
		note("q) Cancel without changing anything")
		blank()

		def := ""
		if detected != nil {
			def = "d"
		}
		answer := strings.ToLower(ask("Model", def))
		if answer == "" && detected != nil {
			answer = "d"
		}

		var chosen *mpcModel
		switch {
		case answer == "d" && detected != nil:
			chosen = detected
		case answer == "q" || answer == "quit" || answer == "exit":
			return nil, errModelCancelled
		default:
			n, err := strconv.Atoi(answer)
			if err == nil && n >= 1 && n <= len(knownModels) {
				chosen = &knownModels[n-1]
			}
		}
		if chosen == nil {
			if detected != nil {
				bad("no such model; choose 1-%d, d or q", len(knownModels))
			} else {
				bad("no such model; choose 1-%d or q", len(knownModels))
			}
			continue
		}

		if chosen.generation != info.Gen {
			blank()
			warn("MODEL MISMATCH")
			warn("You chose %s.", chosen)
			warn("The connected unit reports %s.", detectedModelLabel(info))
			warn("Gen 1 and Gen 2 use different CPU architectures and payloads, so this")
			warn("install cannot continue with the wrong model.")
			blank()
			note("1) Go back and choose again")
			note("q) Cancel without changing anything")
			switch strings.ToLower(ask("Choice", "1")) {
			case "q", "quit", "exit":
				return nil, errModelCancelled
			default:
				continue
			}
		}

		if detected == nil {
			warn("the connected unit did not report a known model name")
		} else if detected.key != chosen.key {
			warn("You chose %s, but the connected unit reports %s.", chosen, detected)
			warn("Both are Gen %d, so the same files would be installed; check the label before continuing.", info.Gen)
		} else {
			ok("the connected unit reports %s, which matches", detected.name)
		}
		blank()
		note("Check the model printed on the unit before continuing. A wrong Gen 1/Gen 2")
		note("choice is blocked above; a wrong model within one generation is not.")
		defYes := detected != nil && detected.key == chosen.key
		if !askYes(fmt.Sprintf("Use %s for this install?", chosen.name), defYes) {
			blank()
			continue
		}
		return chosen, nil
	}
}
