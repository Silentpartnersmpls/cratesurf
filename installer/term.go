package main

// Output is deliberately plain: one status word per line, aligned, and no
// spinner. The person running this is watching a 300 MB download over a home
// network and wants to know three things at any moment: what step it is on, how
// far along that step is, and whether it worked. Anything else is noise on a
// console they may be seeing for the first time.

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"golang.org/x/term"
)

const (
	bold  = "\033[1m"
	dim   = "\033[2m"
	green = "\033[32m"
	amber = "\033[33m"
	red   = "\033[31m"
	off   = "\033[0m"
)

var stdin = bufio.NewReader(os.Stdin)

// color says whether escape codes are worth emitting. Windows terminals before
// 10 handle them badly, and a piped log should not be full of them.
var color = os.Getenv("NO_COLOR") == "" && os.Getenv("TERM") != "dumb"

func paint(c, s string) string {
	if !color {
		return s
	}
	return c + s + off
}

func headline(s string) { fmt.Printf("\n%s\n", paint(bold, s)) }

func ok(format string, a ...any) {
	fmt.Printf("  %s  %s\n", paint(green, " ok "), fmt.Sprintf(format, a...))
}
func warn(format string, a ...any) {
	fmt.Printf("  %s %s\n", paint(amber, "warn"), fmt.Sprintf(format, a...))
}
func bad(format string, a ...any) {
	fmt.Printf("  %s %s\n", paint(red, "FAIL"), fmt.Sprintf(format, a...))
}
func note(format string, a ...any) { fmt.Printf("        %s\n", fmt.Sprintf(format, a...)) }
func blank()                       { fmt.Println() }

// progress prints an updating percentage on one line, and is safe to call from
// a goroutine as long as nothing else writes concurrently. All the callers are
// waiting on it, so this is only true by construction; there is no mutex.
//
// It only redraws when the whole percent changes. A terminal would overwrite the
// line either way, but anything piped to a log (a support transcript, a CI run)
// turns one line per call into thousands, and the interesting lines get buried.
var lastPct = -1

func progress(label string, done, total int64) {
	if total <= 0 {
		fmt.Printf("\r        %s %s", label, humanBytes(done))
		return
	}
	pct := int(done * 100 / total)
	if pct == lastPct {
		return
	}
	lastPct = pct
	fmt.Printf("\r        %s %3d%%  %s / %s   ", label, pct, humanBytes(done), humanBytes(total))
}

func progressDone() {
	lastPct = -1
	fmt.Print("\r" + strings.Repeat(" ", 72) + "\r")
}

func ask(label, def string) string {
	if def != "" {
		fmt.Printf("  %s [%s]: ", label, def)
	} else {
		fmt.Printf("  %s: ", label)
	}
	line, _ := stdin.ReadString('\n')
	line = strings.TrimSpace(line)
	if line == "" {
		return def
	}
	return line
}

// askSecret reads without echoing. bufio cannot do that, so it reads the fd
// directly; every caller has just consumed a full line, so nothing is sitting
// in stdin's buffer to be stranded.
func askSecret(label string) string {
	fmt.Printf("  %s: ", label)
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		b, err := term.ReadPassword(fd)
		fmt.Println()
		if err == nil {
			return string(b)
		}
	}
	line, _ := stdin.ReadString('\n')
	return strings.TrimSpace(line)
}

func askYes(label string, def bool) bool {
	d := "y/N"
	if def {
		d = "Y/n"
	}
	a := strings.ToLower(ask(label+" "+dim+"("+d+")"+off, ""))
	if a == "" {
		return def
	}
	return a == "y" || a == "yes"
}

func pause(label string) {
	fmt.Printf("  %s ", label)
	stdin.ReadString('\n')
}

func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for v := n / unit; v >= unit; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}
