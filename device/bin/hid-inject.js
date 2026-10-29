// Synthetic keyboard and mouse over /dev/uhid, for testing input on the MPC
// without plugging anything in.
//
// uhid is the same kernel path a USB keyboard takes once usbhid has it: a report
// descriptor goes in, hid-generic binds it, /dev/input/eventN appears, and
// libinput picks it up exactly like real hardware. Creating the device while
// weston is already running therefore also tests hotplug.
//
//   node hid-inject.js < commands       read commands from stdin, one per line:
//     type <text>        type ASCII text
//     key <name>         Enter, Esc, Tab, Backspace, Space, Up, Down, Left, Right,
//                        and chords: ctrl+r, alt+left, shift+tab
//     move <dx> <dy>     relative pointer move, in pixels
//     abs <x> <y>        put the pointer at a screen position (see below)
//     click [left|right|middle]
//     scroll <n>         wheel steps
//     pause <ms>         hold the devices open (for watching /dev/input)
//
// Everything is synchronous on purpose. An earlier version used readline and
// awaited stdin; it typed the right keys but then sat there forever holding the
// device open, which is useless over ssh.
//
// Pacing matters too: 18 ms between report and release was too fast on this
// RK3288, and the page received characters out of order with some duplicated.
// 40 ms holds.
'use strict';

const fs = require('fs');

const UHID_DESTROY = 10;
const UHID_CREATE2 = 11;
const UHID_INPUT2 = 12;
const UHID_MAX_DESCRIPTOR = 4096;
const EVENT_SIZE = 4 + 128 + 64 + 64 + 2 + 2 + 4 * 4 + UHID_MAX_DESCRIPTOR; // struct uhid_event
const HOLD = 40;

const sleepSync = (ms) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const KB_DESC = Buffer.from([
  0x05, 0x01, 0x09, 0x06, 0xa1, 0x01, 0x05, 0x07, 0x19, 0xe0, 0x29, 0xe7,
  0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02, 0x95, 0x01,
  0x75, 0x08, 0x81, 0x01, 0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01,
  0x29, 0x05, 0x91, 0x02, 0x95, 0x01, 0x75, 0x03, 0x91, 0x01, 0x95, 0x06,
  0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65,
  0x81, 0x00, 0xc0,
]);

const MS_DESC = Buffer.from([
  0x05, 0x01, 0x09, 0x02, 0xa1, 0x01, 0x09, 0x01, 0xa1, 0x00, 0x05, 0x09,
  0x19, 0x01, 0x29, 0x03, 0x15, 0x00, 0x25, 0x01, 0x95, 0x03, 0x75, 0x01,
  0x81, 0x02, 0x95, 0x01, 0x75, 0x05, 0x81, 0x01, 0x05, 0x01, 0x09, 0x30,
  0x09, 0x31, 0x15, 0x81, 0x25, 0x7f, 0x75, 0x08, 0x95, 0x02, 0x81, 0x06,
  0x09, 0x38, 0x15, 0x81, 0x25, 0x7f, 0x75, 0x08, 0x95, 0x01, 0x81, 0x06,
  0xc0, 0xc0,
]);

function createEvent(name, desc, vendor, product) {
  const b = Buffer.alloc(EVENT_SIZE);
  let o = 0;
  b.writeUInt32LE(UHID_CREATE2, o); o += 4;
  b.write(name, o, 127); o += 128;         // name[128]
  o += 64;                                  // phys[64]
  o += 64;                                  // uniq[64]
  b.writeUInt16LE(desc.length, o); o += 2;  // rd_size
  b.writeUInt16LE(0x03, o); o += 2;         // bus: USB, so it looks like real hardware
  b.writeUInt32LE(vendor, o); o += 4;
  b.writeUInt32LE(product, o); o += 4;
  b.writeUInt32LE(1, o); o += 4;            // version
  b.writeUInt32LE(0, o); o += 4;            // country
  desc.copy(b, o);
  return b;
}

class Device {
  constructor(name, desc, vendor, product) {
    this.fd = fs.openSync('/dev/uhid', 'r+');   // Node has no 'rw+'; 'r+' is read/write
    fs.writeSync(this.fd, createEvent(name, desc, vendor, product));
  }
  send(report) {
    const b = Buffer.alloc(6 + report.length);
    b.writeUInt32LE(UHID_INPUT2, 0);
    b.writeUInt16LE(report.length, 4);
    report.copy(b, 6);
    fs.writeSync(this.fd, b);
  }
  destroy() {
    try {
      const b = Buffer.alloc(EVENT_SIZE);
      b.writeUInt32LE(UHID_DESTROY, 0);
      fs.writeSync(this.fd, b);
    } catch (_) {}
    try { fs.closeSync(this.fd); } catch (_) {}
  }
}

// HID usage page 0x07 keycodes.
const NAMED = {
  enter: 40, esc: 41, escape: 41, backspace: 42, tab: 43, space: 44,
  '-': 45, '=': 46, '[': 47, ']': 48, '\\': 49, ';': 51, "'": 52,
  '`': 53, ',': 54, '.': 55, '/': 56,
  up: 82, down: 81, left: 80, right: 79, home: 74, end: 77,
  shift: 225, ctrl: 224, alt: 226, del: 76, delete: 76,
};
const SHIFTED = {
  '!': [30, 1], '@': [31, 1], '#': [32, 1], '$': [33, 1], '%': [34, 1],
  '^': [35, 1], '&': [36, 1], '*': [37, 1], '(': [38, 1], ')': [39, 1],
  _: [45, 1], '+': [46, 1], '{': [47, 1], '}': [48, 1], '|': [49, 1],
  ':': [51, 1], '"': [52, 1], '~': [53, 1], '<': [54, 1], '>': [55, 1], '?': [56, 1],
};

function keyFor(ch) {
  // Word-named keys first. Comparing a name like 'enter' against 'a' and 'z' with
  // >= and <= succeeds for every name starting with a letter, so doing the
  // single-character tests first made 'enter' resolve to the letter E.
  if (ch.length > 1) return ch in NAMED ? [NAMED[ch], 0] : null;
  if (ch >= 'a' && ch <= 'z') return [4 + ch.charCodeAt(0) - 97, 0];
  if (ch >= 'A' && ch <= 'Z') return [4 + ch.charCodeAt(0) - 65, 1];
  if (ch >= '1' && ch <= '9') return [29 + ch.charCodeAt(0) - 48, 0];
  if (ch === '0') return [39, 0];
  if (ch === ' ') return [44, 0];           // ' ' is a character, not a NAMED name
  if (SHIFTED[ch]) return SHIFTED[ch];
  if (ch in NAMED) return [NAMED[ch], 0];
  return null;
}

const out = (s) => process.stdout.write(s + '\n');

let kb, ms;

const MOD = { ctrl: 0x01, control: 0x01, shift: 0x02, alt: 0x04, gui: 0x08, meta: 0x08 };

function press(code, mods) {
  kb.send(Buffer.from([mods || 0, 0, code, 0, 0, 0, 0, 0]));
  sleepSync(HOLD);
  kb.send(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]));
  sleepSync(HOLD);
}

// "ctrl+r", "alt+left", "shift+Tab" -> { code, mods }. A plain name still works.
function spec(name) {
  const parts = name.split('+').filter(Boolean);
  const base = parts.pop().toLowerCase();
  const mods = parts.reduce((m, p) => m | (MOD[p.toLowerCase()] || 0), 0);
  const k = keyFor(base);
  if (!k) return null;
  return { code: k[0], mods: mods | (k[1] ? 0x02 : 0) };
}

function main() {
  const input = fs.readFileSync(0, 'utf8');
  const commands = input.split('\n').map((l) => l.trim()).filter(Boolean);

  kb = new Device('mpc-hid-test keyboard', KB_DESC, 0x1209, 0x0001);
  ms = new Device('mpc-hid-test mouse', MS_DESC, 0x1209, 0x0002);
  sleepSync(500);                        // let hid-generic bind both before events
  out('[ok] keyboard + mouse created (hotplug)');
  if (!commands.length) {
    out('[ok] no commands on stdin');
  }

  for (const line of commands) {
    const args = line.split(/\s+/);
    const cmd = args[0];

    if (cmd === 'type') {
      const text = line.slice(5);        // keep the spaces inside the text
      let typed = 0;
      for (const ch of text) {
        const k = keyFor(ch);
        if (!k) { out('[skip] no keycode for ' + JSON.stringify(ch)); continue; }
        press(k[0], k[1] ? 0x02 : 0);
        typed++;
      }
      out('[ok] typed ' + typed + ' chars: ' + JSON.stringify(text));
    } else if (cmd === 'key') {
      for (const name of args.slice(1)) {
        const s = spec(name);
        if (!s) { out('[skip] unknown key ' + name); continue; }
        press(s.code, s.mods);
      }
      out('[ok] key ' + args.slice(1).join('+'));
    } else if (cmd === 'move') {
      const dx = parseInt(args[1] || '0', 10);
      const dy = parseInt(args[2] || '0', 10);
      const steps = Math.max(Math.ceil(Math.abs(dx) / 60), Math.ceil(Math.abs(dy) / 60), 1);
      const sx = Math.trunc(dx / steps);
      const sy = Math.trunc(dy / steps);
      for (let i = 0; i < steps; i++) {
        ms.send(Buffer.from([0, sx & 0xff, sy & 0xff, 0]));
        sleepSync(16);
      }
      out('[ok] moved ' + dx + ',' + dy + ' in ' + steps + ' reports');
    } else if (cmd === 'abs') {
      // Relative reports go through libinput's adaptive acceleration, so a big
      // single move lands nowhere near where you meant: a 220,180 jump arrived
      // hundreds of pixels past the target. Pin the pointer to a corner first
      // (the screen edge clamps it, so where it started does not matter), then
      // walk to the target in 4 px steps at low speed, where the curve is ~1:1.
      const tx = parseInt(args[1] || '0', 10);
      const ty = parseInt(args[2] || '0', 10);
      for (let i = 0; i < 10; i++) {
        ms.send(Buffer.from([0, (-120) & 0xff, (-120) & 0xff, 0]));
        sleepSync(16);
      }
      let px = 0;
      let py = 0;
      let reports = 0;
      while (px < tx || py < ty) {
        const sx = px < tx ? Math.min(2, tx - px) : 0;
        const sy = py < ty ? Math.min(2, ty - py) : 0;
        ms.send(Buffer.from([0, sx & 0xff, sy & 0xff, 0]));
        px += sx;
        py += sy;
        reports++;
        // 2 px every 10 ms is ~200 px/s, slow enough that libinput's adaptive
        // curve sits at 1:1. At 4 px every 8 ms the pointer overshot by 27 %
        // (asked for 917,752 on a 1280x800 screen, got 1165,799).
        sleepSync(10);
      }
      sleepSync(120);
      out('[ok] pointer at ' + tx + ',' + ty + ' in ' + reports + ' reports');
    } else if (cmd === 'click') {
      const bit = { left: 1, right: 2, middle: 4 }[(args[1] || 'left').toLowerCase()] || 1;
      ms.send(Buffer.from([bit, 0, 0, 0]));
      sleepSync(60);
      ms.send(Buffer.from([0, 0, 0, 0]));
      sleepSync(60);
      out('[ok] click ' + (args[1] || 'left'));
    } else if (cmd === 'pause') {
      // Keep the devices alive for a while. A listener that watches /dev/input
      // needs the node to exist when it looks, and a device that lives for
      // 700 ms can be missed entirely.
      const ms = parseInt(args[1] || '1000', 10);
      sleepSync(ms);
      out('[ok] paused ' + ms + 'ms');
    } else if (cmd === 'scroll') {
      const n = parseInt(args[1] || '1', 10);
      for (let i = 0; i < Math.abs(n); i++) {
        ms.send(Buffer.from([0, 0, 0, (n > 0 ? 1 : -1) & 0xff]));
        sleepSync(30);
      }
      out('[ok] scroll ' + n);
    } else {
      out('[skip] unknown command ' + cmd);
    }
  }

  kb.destroy();
  ms.destroy();
  out('[ok] devices removed');
}

try {
  main();
  process.exit(0);
} catch (e) {
  try { if (kb) kb.destroy(); if (ms) ms.destroy(); } catch (_) {}
  process.stderr.write('FAIL: ' + (e.code || '') + ' ' + e.message + '\n');
  process.exit(1);
}
