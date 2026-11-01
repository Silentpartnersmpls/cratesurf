// Launch browse mode from the MPC's own hardware.
//
// The 8798 page is the normal way in, but needing a second device to open a
// browser on the MPC is exactly the friction that keeps it unused. Two triggers,
// both read straight from /dev/input:
//
//   three fingers held for 2.5 s                     (nothing to plug in)
//   Ctrl+Alt+B on a USB keyboard                     (faster, if one is attached)
//
// The gesture is deliberately plain: three or more fingers, held without moving
// them for 2.5 s. Nothing about where the fingers are. A spread requirement was
// tried and removed - a real hand on a 7" panel puts its fingers well under 200
// of the panel's units apart, so it never fired at all, and nothing about finger
// position was ever what separated a launch from a hand resting on the glass.
// What separates them is duration and stillness:
//
//   - the panel must have been clear for 1.2 s before the last finger landed, so
//     a hand already on the glass cannot grow into a launch mid-beat
//   - the hold is 2.5 s, six times longer than any tap or chord in the workflow
//   - once a three-finger set is down it either completes or is dead until every
//     finger lifts, so drumming on the panel cannot accumulate into a fire
//
// Measured from the real panel (tools/mtdump): X reports 0..2048, Y 0..1898,
// BTN_TOUCH toggles correctly, and the kernel suppresses the redundant
// ABS_MT_SLOT 0 for the first finger. A flat hand registers up to ten contacts,
// so the number of fingers alone proves nothing - duration does.
//
// This can read the touchscreen while the MPC app is running: the app opens
// /dev/input/event0 but does not take an exclusive EVIOCGRAB on it (checked with
// tools/grabcheck.c, which succeeded in grabbing event0 while acvs held it), so
// readers share the device. Nothing is taken away from the MPC app: evdev events
// are delivered to every open fd unless somebody grabs, and nobody does.
//
// Struct sizes matter: this is 32-bit arm, so struct input_event is
// 4 + 4 (timeval) + 2 (type) + 2 (code) + 4 (value) = 16 bytes.
const fs = require('fs');
const { execFile } = require('child_process');

const R = '/data/browser';
// struct input_event: struct timeval (2 longs) + type(2)+code(2)+value(4).
// 32-bit arm -> 8+8=16 bytes; 64-bit (arm64) -> 16+8=24. The MPC XL is arm64.
const LONG = (process.arch === "arm64" || process.arch === "x64") ? 8 : 4;
const EV_SIZE = LONG * 2 + 8;
const EV_TYPE_OFF = LONG * 2;
const EV_CODE_OFF = LONG * 2 + 2;
const EV_VALUE_OFF = LONG * 2 + 4;
const HOLD_MS = 2500;
const MIN_FINGERS = 3;
const QUIET_MS = 1200;    // the glass must be clear this long before the fingers land
const COOLDOWN_MS = 20000;

// Escape hatch for tests: point the launcher at a harmless command instead of
// browse-up.sh, so the gesture can be exercised without stopping the MPC app.
const LAUNCH = process.env.MPC_BROWSE_UP || `${R}/bin/browse-up.sh`;

const EV_KEY = 1;
const EV_ABS = 3;
const ABS_MT_SLOT = 0x2f;
const ABS_MT_POSITION_X = 0x35;
const ABS_MT_POSITION_Y = 0x36;
const ABS_MT_TRACKING_ID = 0x39;
const BTN_TOUCH = 0x14a;
const KEY_LEFTCTRL = 29;
const KEY_RIGHTCTRL = 97;
const KEY_LEFTALT = 56;
const KEY_RIGHTALT = 100;
const KEY_B = 48;

const westonAlive = () => {
  try {
    const pid = parseInt(fs.readFileSync(`${R}/sysroot/run/weston.pid`, 'utf8').trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (_) { return false; }
};

const alreadyBrowsing = () => {
  try {
    return fs.readFileSync(`${R}/run/mode`, 'utf8').trim() === 'browse' && westonAlive();
  } catch (_) { return false; }
};

function createDetector(opts) {
  const options = opts || {};
  const spawn = options.spawn || (() => {
    let out;
    try { out = fs.openSync(`${R}/run/launcher.log`, 'a'); } catch (_) { out = 'ignore'; }
    execFile('/bin/sh', [LAUNCH], { detached: true, stdio: ['ignore', out, out] },
      (err) => { if (err) console.error('launcher:', err.message); });
  });
  const browsing = options.browsing || alreadyBrowsing;

  const slots = new Map(); // slot -> true while that finger is down
  const keys = new Set();
  let slot = 0;
  let legacyTouch = false;
  let holdSince = 0;
  let holdQuiet = false;
  let armed = true;
  let wasEmpty = true;
  let emptySince = Date.now();
  let lastFire = 0;

  const activeTouches = () => (legacyTouch ? 1 : 0) + slots.size;

  const fire = (now) => {
    if (now - lastFire < COOLDOWN_MS) return false;
    lastFire = now;
    holdSince = 0;
    armed = false;     // nothing more from this set of fingers
    slots.clear();
    keys.clear();
    legacyTouch = false;
    if (browsing()) return false;
    spawn();
    return true;
  };

  const evaluate = (now) => {
    const touching = activeTouches();
    if (touching === 0) {
      // Record when the glass went clear: that timestamp is what the quiet gate
      // is measured against, so it has to be the transition, not every idle tick.
      if (!wasEmpty) emptySince = now;
      wasEmpty = true;
      holdSince = 0;
      armed = true;
      return false;
    }
    wasEmpty = false;
    if (!armed) return false;
    if (touching < MIN_FINGERS) {
      holdSince = 0;
      return false;
    }
    if (!holdSince) {
      holdSince = now;
      holdQuiet = now - emptySince >= QUIET_MS;
      return false;
    }
    if (!holdQuiet) {
      armed = false;
      return false;
    }
    if (now - holdSince >= HOLD_MS) return fire(now);
    return false;
  };

  const event = (type, code, value, now) => {
    if (type === EV_ABS) {
      if (code === ABS_MT_SLOT) {
        slot = value;
      } else if (code === ABS_MT_TRACKING_ID) {
        if (value >= 0) slots.set(slot, true);
        else slots.delete(slot);
      }
    } else if (type === EV_KEY) {
      if (code === BTN_TOUCH) legacyTouch = value > 0;
      else if (value === 1) {
        keys.add(code);
        if (keys.has(KEY_B) &&
            (keys.has(KEY_LEFTCTRL) || keys.has(KEY_RIGHTCTRL)) &&
            (keys.has(KEY_LEFTALT) || keys.has(KEY_RIGHTALT))) return fire(now);
      } else if (value === 0) keys.delete(code);
    }
    return evaluate(now);
  };

  // A device begins life in a known state: its current MT slot is 0 until it says
  // otherwise, and no button is held. This has to be reset when a device is
  // attached, because the kernel suppresses a redundant ABS_MT_SLOT event: a new
  // device's first finger sends no slot change at all, so without this its touch
  // is credited to whatever slot index the previous device finished on. That is
  // what made the gesture silently lose one of its four fingers, and it would hit
  // a real panel too the first time it is plugged in.
  const deviceStart = () => {
    slot = 0;
    legacyTouch = false;
  };

  return { event, evaluate, activeTouches, deviceStart };
}

function start() {
  const det = createDetector({});
  const buf = Buffer.alloc(EV_SIZE);
  const watched = new Map(); // path -> { fd, ino, dead }

  const inoOf = (path) => {
    try { return fs.statSync(path).ino; } catch (_) { return null; }
  };

  const retire = (rec) => {
    rec.dead = true;   // whatever its pending read returns is now not ours to use
    try { if (rec.fd !== undefined) fs.closeSync(rec.fd); } catch (_) {}
  };

  // Opened synchronously on purpose. Every event node here is a character
  // device, so open() cannot block, and doing it inline is what makes the swap
  // below safe: an fd number can only be reused after it is closed, so opening a
  // replacement while the old fd is still open guarantees the two never collide.
  // With an async open the retired reader kept the number and quietly consumed
  // the new device's first events.
  const attach = (path) => {
    let fd;
    try { fd = fs.openSync(path, 'r'); } catch (_) { watched.delete(path); return null; }
    let ino = null;
    try { ino = fs.fstatSync(fd).ino; } catch (_) {}
    const rec = { fd, ino, dead: false };
    watched.set(path, rec);
    det.deviceStart();
    const pump = () => fs.read(fd, buf, 0, EV_SIZE, null, (readErr, n) => {
      if (rec.dead) return;
      if (readErr || n !== EV_SIZE) {
        // Gone (unplugged) or erroring: forget it and let the scan re-add it if
        // it comes back, rather than keeping a dead fd forever.
        if (watched.get(path) === rec) watched.delete(path);
        retire(rec);
        return;
      }
      det.event(
        buf.readUInt16LE(EV_TYPE_OFF),
        buf.readUInt16LE(EV_CODE_OFF),
        buf.readInt32LE(EV_VALUE_OFF),
        Date.now());
      pump();
    });
    pump();
    return rec;
  };

  // Devices that appear after boot have to be picked up too. A keyboard plugged
  // in later is the normal case, and a fixed list taken at startup can never see
  // it - which is exactly how the first version of this missed a hotplugged
  // keyboard entirely.
  const scan = () => {
    let names;
    try { names = fs.readdirSync('/dev/input'); } catch (_) { return; }
    for (const name of names) {
      if (!/^event\d+$/.test(name)) continue;
      const path = `/dev/input/${name}`;
      const rec = watched.get(path);
      if (!rec) { attach(path); continue; }
      // A device that is removed and re-created comes back at the same name and
      // the same major/minor, but it is a different file, and on this kernel the
      // old fd goes silent instead of reporting EOF. So the name being already
      // watched proves nothing: the inode has to match too, or the launcher keeps
      // reading a dead device forever. That is what swallowed every synthetic
      // gesture after the first one.
      const ino = inoOf(path);
      if (ino !== null && rec.ino !== null && ino !== rec.ino) {
        attach(path);   // new fd first, so the numbers cannot collide
        retire(rec);    // then the old reader is told to stop and its fd released
      }
    }
  };
  scan();
  // inotify fires the moment a node appears, which matters because a device can
  // come and go between two polls: a synthetic test keyboard lives for well under
  // a second. The timer is only a safety net for missed events.
  // The watcher is parked in a variable a live timer keeps pointing at, because an
  // unreferenced FSWatcher can be garbage collected: when it is, the callback
  // stops firing with no error and no closure of the pump, so the launcher goes
  // quietly blind to every later device. That is exactly what happened here, and
  // it is why only the first synthetic touchscreen was ever seen.
  let dirWatcher = null;
  try { dirWatcher = fs.watch('/dev/input', () => scan()); } catch (_) {}
  if (dirWatcher && dirWatcher.on) dirWatcher.on('error', () => scan());
  // A slower safety net in case inotify misses one anyway.
  setInterval(() => { void dirWatcher; scan(); }, 1000).unref();

  // Three fingers held still send no further events after contact, so the hold
  // duration has to be measured on a clock, not inferred from event arrivals.
  setInterval(() => det.evaluate(Date.now()), 250).unref();
  return det;
}

// --test drives the detector with synthetic frames, so the timings and the key
// chord are checked without fingers on the glass.
function selfTest() {
  let fired = 0;
  let browsing = false;
  const det = createDetector({ spawn: () => { fired += 1; }, browsing: () => browsing });
  let t = 1_000_000;

  const touch = (index, down, x, y) => {
    det.event(EV_ABS, ABS_MT_SLOT, index, t);
    det.event(EV_ABS, ABS_MT_TRACKING_ID, down ? 100 + index : -1, t);
    if (x !== undefined) {
      det.event(EV_ABS, ABS_MT_POSITION_X, x, t);
      det.event(EV_ABS, ABS_MT_POSITION_Y, y, t);
    }
  };
  const move = (index, x, y) => {
    det.event(EV_ABS, ABS_MT_SLOT, index, t);
    det.event(EV_ABS, ABS_MT_POSITION_X, x, t);
    det.event(EV_ABS, ABS_MT_POSITION_Y, y, t);
  };
  const hold = (ms) => {
    const end = t + ms;
    while (t < end - 50) det.evaluate(t += 50);
    det.evaluate(t = end);
  };
  // Three fingertips where a hand actually puts them: a few tens of panel units
  // apart. Position is not part of the gesture any more, so bunched fingers have
  // to work - that is the whole point of dropping the spread requirement.
  const fingers3 = () => {
    touch(0, true, 900, 900); touch(1, true, 980, 900); touch(2, true, 940, 960);
  };
  const release = () => { touch(0, false); touch(1, false); touch(2, false); };
  const results = [];
  const check = (name, pass) => results.push([name, !!pass]);

  // The launcher needs the glass to have been clear for 1.2 s before it will
  // start a gesture, so every scenario below begins from an idle panel.
  hold(2000);

  touch(0, true, 512, 512); touch(1, true, 1536, 512);
  hold(4000);
  check('two fingers held for 4s do not fire', fired === 0);
  release();
  hold(2000);

  fingers3();
  hold(1500);
  check('a short three-finger press does not fire', fired === 0);
  hold(1400);
  check('three fingers held past 2.5s fire once', fired === 1);
  release();
  hold(2000);

  fingers3();
  hold(4000);
  check('a re-hold inside the cooldown is swallowed', fired === 1);
  release();

  touch(0, true, 700, 700);
  hold(200);
  touch(0, false);
  hold(200);
  fingers3();
  hold(4000);
  check('fingers landing straight after another touch do not fire', fired === 1);
  release();

  t += 30_000;   // past the cooldown, so the next scenario is about the gate itself
  hold(2000);
  fingers3();
  hold(600);
  move(1, 1400, 1400);   // the hand settles and slides while holding
  hold(4000);
  check('a hand that keeps moving still fires on duration alone', fired === 2);
  release();

  t += 30_000;
  det.event(EV_KEY, KEY_LEFTCTRL, 1, t);
  det.event(EV_KEY, KEY_LEFTALT, 1, t);
  det.event(EV_KEY, KEY_B, 1, t);
  check('ctrl+alt+b fires once the cooldown has passed', fired === 3);

  t += 30_000;
  det.event(EV_KEY, KEY_LEFTCTRL, 1, t);
  det.event(EV_KEY, KEY_LEFTALT, 1, t);
  browsing = true;
  det.event(EV_KEY, KEY_B, 1, t);
  check('ctrl+alt+b does not fire while already browsing', fired === 3);

  // A second device starts on slot 0 without announcing it, because the kernel
  // drops the redundant slot change. After the presses above the slot index was
  // left on 3, so this only works if attaching resets it.
  browsing = false;
  t += 30_000;
  hold(500);   // the 250 ms tick observes the clear glass and re-arms
  det.deviceStart();
  det.event(EV_ABS, ABS_MT_TRACKING_ID, 200, t);   // finger 0, no slot event
  det.event(EV_ABS, ABS_MT_POSITION_X, 400, t);
  det.event(EV_ABS, ABS_MT_POSITION_Y, 400, t);
  touch(1, true, 430, 400);
  touch(2, true, 415, 460);
  det.event(EV_KEY, BTN_TOUCH, 1, t);
  hold(3000);
  check('a device whose first finger announces no slot still fires', fired === 4);

  let ok = true;
  for (const [name, pass] of results) {
    if (!pass) ok = false;
    process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}\n`);
  }
  process.exit(ok ? 0 : 1);
}

module.exports = { start, createDetector, selfTest };

if (require.main === module) {
  if (process.argv.includes('--test')) selfTest();
  else start();
}
