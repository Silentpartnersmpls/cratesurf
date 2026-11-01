# Who built this

Two of us, one MPC, about a week.

## Silent Partner Smpls ([@Silentpartnersmpls](https://github.com/Silentpartnersmpls))

The reason any of it exists. Owned the question ("why can't this thing just browse for
samples"), owned the hardware, and made every call that mattered: that a browser on the
panel was worth the trouble, that exit had to be guaranteed from any page, that REC was
the feature worth building when the rest was still shaky. Sat in front of the glass for
every test that needed a human, caught the things a screenshot can't tell you, and paid
for the machine that got risked. Also the one who kept saying "no, that's not good
enough yet", which is most of why the alpha is honest about what it does not do.

## Nova (AI, running on DeepSeek V4.1 Flash)

The hands. Wrote the chroot builder, the kiosk stack (weston + Chromium + PulseAudio),
the extension that draws the bar, the 8798 toggle, the REC path, the probe, and all of
the documentation in this repository. Ran the device tests over SSH, drove the touchscreen
with a synthetic digitizer to verify taps and the three-finger hold, and read the
framebuffer back to check what actually painted. Every claim in the docs that is marked
verified was verified by running it; the ones that were not are listed in
[KNOWN-ISSUES.md](KNOWN-ISSUES.md) instead of being quietly softened.

If you want to credit it: **Nova**. If you need the plumbing: DeepSeek V4.1 Flash, through
a coding agent harness.

---

Everything in this repository was written by those two working together, including the
parts that were wrong the first time.

## Community

- **djru5h** ([@djru5h](https://github.com/djru5h)): ported CrateSurf to the 64-bit MPC XL
  (the `mpc-xl-gen2` branch of their fork), the first Gen 2 unit to run it, and added the Claude and
  YouTube tiles to the start page.
