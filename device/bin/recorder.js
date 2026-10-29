// Record what the browser is playing, straight into the MPC's sample folder.
//
// The MPC's own REC button cannot be used for this: browse mode stops the MPC app
// (it owns the screen), so while the browser is up there is no sampler listening.
// What there is, is PulseAudio: the sink's monitor source carries exactly what
// Chromium is playing, so `parec` on `codec.monitor` captures it, and the file is
// written into `MPC Documents/Samples` - the MPC's own library. No transfer step:
// exit browse mode and the clip is already in the sample browser.
//
// Capture is 44.1 kHz 16-bit stereo, which is the sink's rate and the MPC's native
// sample rate, so nothing gets resampled on the way in or out.
//
// The WAV header is written by hand: parec streams raw PCM, we count the bytes, and
// the 44-byte header is patched in when the capture ends. Any file that exists has
// a valid header, even if the browser (or PulseAudio) died mid-recording.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SYSROOT = '/data/browser/sysroot';
const SAMPLES = process.env.MPC_FILES_ROOT || '/media/acvs-content/MPC Documents/Samples';
const RATE = 44100;
const CHANNELS = 2;
const BYTES_PER_FRAME = CHANNELS * 2;
const MAX_MS = 10 * 60 * 1000; // a forgotten recording should not fill the card

function wavHeader(dataBytes) {
  const b = Buffer.alloc(44);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);                        // PCM
  b.writeUInt16LE(CHANNELS, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * BYTES_PER_FRAME, 28);   // byte rate
  b.writeUInt16LE(BYTES_PER_FRAME, 32);          // block align
  b.writeUInt16LE(16, 34);                       // bits
  b.write('data', 36);
  b.writeUInt32LE(dataBytes, 40);
  return b;
}

function createRecorder() {
  let session = null;
  let last = null;

  const nextName = () => {
    // A counter, not a timestamp: the device clock runs UTC, and a file stamped a
    // day ahead is worse than one called 003.
    for (let n = 1; n < 10000; n += 1) {
      const name = `Web Grab ${String(n).padStart(3, '0')}.wav`;
      if (!fs.existsSync(path.join(SAMPLES, name))) return name;
    }
    return `Web Grab ${Date.now()}.wav`;
  };

  const status = () => ({
    recording: Boolean(session),
    name: session ? session.name : (last ? last.name : null),
    seconds: session ? Math.round((Date.now() - session.started) / 1000) : 0,
    level: session ? session.level : 0,
    bytes: session ? session.bytes : 0,
    error: session ? session.error : '',
    last
  });

  const finish = () => {
    if (!session) return;
    const s = session;
    session = null;
    try {
      // Patch the header in place; the data is already on disk.
      fs.writeSync(s.fd, wavHeader(s.bytes), 0, 44, 0);
    } catch (_) {}
    try { fs.closeSync(s.fd); } catch (_) {}
    last = {
      name: s.name,
      seconds: Math.round(s.bytes / BYTES_PER_FRAME / RATE * 10) / 10,
      bytes: s.bytes,
      error: s.error
    };
  };

  const stop = () => {
    if (!session) return { ok: true, ...status() };
    const child = session.child;
    try { child.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => {
      // Only if it is still the same session: finish() has usually run by now.
      if (session && session.child === child) {
        try { child.kill('SIGKILL'); } catch (_) {}
        finish();
      }
    }, 1500).unref();
    return { ok: true, stopping: true };
  };

  const start = () => {
    if (session) return { ok: true, ...status() };

    const name = nextName();
    const target = path.join(SAMPLES, name);
    let fd;
    try {
      fd = fs.openSync(target, 'w');
      fs.writeSync(fd, wavHeader(0));
    } catch (e) {
      return { ok: false, error: `cannot write to the sample folder (${e.code || e.message})` };
    }

    // parec lives inside the chroot, and the socket it talks to is the one
    // pulse-up.sh created. --raw because we write the container ourselves.
    const child = spawn('/usr/sbin/chroot', [
      SYSROOT, '/usr/bin/parec',
      '--device=codec.monitor',
      '--format=s16le',
      `--rate=${RATE}`,
      `--channels=${CHANNELS}`,
      '--raw'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PULSE_SERVER: 'unix:/run/pulse/native', PATH: '/usr/bin:/bin' }
    });

    session = { name, target, child, fd, bytes: 0, started: Date.now(), level: 0, error: '' };
    const current = session;

    child.stdout.on('data', (buf) => {
      if (session !== current) return;
      try {
        fs.writeSync(current.fd, buf);
      } catch (e) {
        current.error = `write failed (${e.code || e.message})`;
        stop();
        return;
      }
      current.bytes += buf.length;

      // Peak of this chunk, with decay, so the meter falls back between hits
      // instead of sticking at the loudest moment of the take.
      let peak = 0;
      for (let i = 0; i + 1 < buf.length; i += 2) {
        const v = Math.abs(buf.readInt16LE(i));
        if (v > peak) peak = v;
      }
      current.level = Math.min(100, Math.round((Math.max(current.level * 0.55, peak) / 32768) * 100));

      if (Date.now() - current.started > MAX_MS) stop();
    });

    child.stderr.on('data', (b) => {
      const text = String(b).trim();
      if (text && session === current) current.error = text.split('\n').pop();
    });

    child.on('error', (e) => {
      if (session === current) current.error = e.message;
      finish();
    });
    // PulseAudio going away (browse-down) ends parec: finalise, never lose the take.
    child.on('exit', finish);

    return { ok: true, ...status() };
  };

  return { start, stop, status, finish };
}

module.exports = { createRecorder, wavHeader, SAMPLES };
