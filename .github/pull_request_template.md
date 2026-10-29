## What this changes

<!-- One paragraph. What was wrong, what you changed, why this way. -->

## How it was tested

<!--
There is no CI here, so this section is the review. Be specific:
  - which device and firmware (paste ./tools/probe-device.sh around the verdict)
  - what you ran, what you expected, what you saw
  - whether you tested with a finger (tools/touch3.c) or only a mouse, if the change is a control
  - whether you tested with a real hand, a real keyboard or a real mouse, if the change is input
  - what is NOT tested. "Unverified, needs a device" is a fine answer.
-->

## Checklist

- [ ] Shell scripts I touched are POSIX `sh` and run on busybox
- [ ] Any Node I touched uses the standard library only
- [ ] If I touched the panel, the input stack or the mode switch, I said above how it was checked
- [ ] If this fixes a row in `KNOWN-ISSUES.md`, that row is updated in this PR
- [ ] If this adds a durable engineering lesson, it is in `CONTRIBUTING.md` under the right heading
- [ ] Nothing here claims verification I do not have

## Anything else

<!-- Screenshots or photographs of the panel are welcome and are the standard of evidence here. -->
