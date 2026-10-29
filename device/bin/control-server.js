// The MPC browser's little server.
//
// Three jobs, one process, because they all have to be up whether or not the
// browser is:
//
//   /            the toggle page you open from the phone or the PC
//   /home        the kiosk's start page, served over http so browser extensions
//                are allowed to run on it (content scripts are kept off file://)
//   /files       the download folder, listed - the "where did it go" page
//   /files/<f>   one file out of it, for playing a sample back in the browser
//
// It also watches the input devices so browse mode can be started from the MPC
// itself (three fingers held, or Ctrl+Alt+B) instead of from another device, and
// it runs the recorder: /rec/start and /rec/stop capture what the browser is
// playing into the MPC's sample folder (see recorder.js).
//
// LAN-only by design for the toggle: it has no auth, so do not expose it beyond
// the home network. The file routes are stricter than that and refuse anything
// that is not loopback, because they hand out the contents of the sample library.
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const launcher = require('./touch-launcher.js');
const { createRecorder } = require('./recorder.js');

const recorder = createRecorder();

const PORT = 8798;
const R = '/data/browser';
const MODE = `${R}/run/mode`;
const UP = `${R}/bin/browse-up.sh`;
const DOWN = `${R}/bin/browse-down.sh`;
const HOME_PAGE = `${R}/sysroot/opt/home.html`;
const FILES_ROOT = process.env.MPC_FILES_ROOT || '/media/acvs-content/MPC Documents/Samples';

const run = (script) => new Promise((resolve) => {
  execFile('/bin/sh', [script], { detached: true, timeout: 120000 }, (err, out, errout) => {
    resolve({ ok: !err, out: (out || '').trim(), err: (errout || '').trim() || (err && err.message) });
  });
});

// The mode file is only a claim. It survives a reboot while nothing else does, and
// weston can die and leave it behind, so trust it only while weston is actually
// alive: otherwise the page would offer BACK TO MPC for a session that is gone.
const westonAlive = () => {
  try {
    const pid = parseInt(fs.readFileSync(`${R}/sysroot/run/weston.pid`, 'utf8').trim(), 10);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch (_) { return false; }
};

const mode = () => {
  try {
    if (fs.readFileSync(MODE, 'utf8').trim() === 'browse' && westonAlive()) return 'browse';
  } catch (_) {}
  return 'mpc';
};

const localOnly = (req) => {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const bytes = (n) => {
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
};

const TYPES = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.aif': 'audio/x-aiff', '.aiff': 'audio/x-aiff', '.mid': 'audio/midi',
  '.zip': 'application/zip', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml'
};

// Everything under FILES_ROOT only. path.resolve plus a prefix check is what
// stops ../../ from walking out of the sample folder.
function resolveInRoot(rel) {
  const base = path.resolve(FILES_ROOT);
  const target = path.resolve(base, rel || '.');
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function listDir(rel) {
  const dir = resolveInRoot(rel);
  if (!dir) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return null;
  }
  const items = entries.map((e) => {
    const full = path.join(dir, e.name);
    let st = { size: 0, mtime: new Date(0) };
    try { st = fs.statSync(full); } catch (_) {}
    return { name: e.name, dir: e.isDirectory(), size: st.size, mtime: st.mtime };
  });
  items.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    return a.dir ? a.name.localeCompare(b.name) : b.mtime - a.mtime;
  });
  return items;
}

// CrateSurf by SPS (silent partner smpls). Both pages below wear the same chrome
// as the kiosk start page: dark Navigator slabs with a 1px raised bevel, a duct
// teal accent, mono for anything machine-written.
const MARK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.2" fill="#0e2226"
        stroke="#00c8b4" stroke-width="1.8"/>
  <path d="M3.8 18.8L21 4.9M3.8 4.9L21 18.8" stroke="#0a6d64" stroke-width="1.6"/>
</svg>`;

const FILES_CSS = `
  :root{color-scheme:dark}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{margin:0;background:#0b0e13;color:#dfe6f2;font:14px/1.4 "DejaVu Sans",system-ui,sans-serif}
  header{position:sticky;top:0;display:flex;gap:9px;align-items:center;padding:0 9px;height:54px;
         background:linear-gradient(#39414f,#2a303c);border-bottom:1px solid #12161e;
         box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 4px 14px rgba(0,0,0,.5)}
  header svg{width:20px;height:20px;flex:none}
  header .name{font:700 13px "DejaVu Sans",sans-serif;letter-spacing:2.6px;color:#eef4ff;flex:none}
  header .by{font:700 9.5px "DejaVu Sans",sans-serif;letter-spacing:1.6px;color:#00c8b4;flex:none;
             border-left:1px solid #4d576a;padding-left:9px}
  header .path{flex:1;min-width:0;display:flex;align-items:center;height:28px;padding:0 10px;
         background:#12161e;border:1px solid #0b0e13;border-radius:3px;
         box-shadow:inset 0 2px 5px rgba(0,0,0,.75);color:#8a94a6;
         font:12px "DejaVu Sans Mono",monospace;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  header a{flex:none;color:#cfd8e6;text-decoration:none;font:700 10.5px "DejaVu Sans",sans-serif;
         letter-spacing:1.4px;border:1px solid #535e75;border-radius:3px;padding:8px 11px;
         background:linear-gradient(#3a4356,#2b3242);
         box-shadow:inset 0 1px 0 rgba(255,255,255,.10),inset 0 -1px 0 rgba(0,0,0,.55)}
  header a:active{background:#1d2331}
  ul{margin:0;padding:10px 10px 70px;list-style:none;display:flex;flex-direction:column;gap:6px}
  li a{display:flex;gap:12px;align-items:center;padding:11px 12px;border-radius:3px;text-decoration:none;
       color:#d6dfee;background:linear-gradient(#242b38,#1b212c);border:1px solid #3a4358;
       box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
  li a:active{background:#161c26}
  .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .n.dir{color:#00c8b4}
  .m{color:#7f8ba0;font:11px "DejaVu Sans Mono",monospace;white-space:nowrap}
  .empty{padding:26px;color:#5a6577;font:12px "DejaVu Sans Mono",monospace;text-align:center}
`;

function filesPage(rel, items) {
  const parts = (rel || '').split('/').filter(Boolean);
  const crumbs = [`<a href="/files">SAMPLES</a>`];
  parts.forEach((p, i) => {
    const sub = parts.slice(0, i + 1).join('/');
    crumbs.push(`<a href="/files?d=${encodeURIComponent(sub)}">${esc(p)}</a>`);
  });
  let body = '';
  if (!items.length) {
    body = '<div class="empty">this folder is empty</div>';
  } else {
    body = '<ul>' + items.map((it) => {
      const sub = (rel ? rel + '/' : '') + it.name;
      // Archive.org-style sample packs unzip into folders of folders; only the
      // files are playable, so directories just link onward.
      if (it.dir) {
        return `<li><a href="/files?d=${encodeURIComponent(sub)}">📁<span class="n dir">${esc(it.name)}</span></a></li>`;
      }
      return `<li><a href="/files/${encodeURIComponent(sub)}">` +
        `<span class="n">${esc(it.name)}</span>` +
        `<span class="m">${bytes(it.size)}</span></a></li>`;
    }).join('') + '</ul>';
  }
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>CrateSurf - Samples</title>
<style>${FILES_CSS}</style></head><body>
<header>${MARK_SVG}<span class="name">CRATESURF</span><span class="by">BY SPS</span>
<span class="path">/samples/${esc(rel || '')}</span>
<a href="/home">START</a></header>${body}</body></html>`;
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CrateSurf by SPS</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  body{margin:0;min-height:100vh;background:#0b0e13;color:#dfe6f2;
       font:15px/1.4 "DejaVu Sans",system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center;padding:16px}
  .frame{width:min(460px,100%);border:1px solid #55617a;border-radius:5px;overflow:hidden;
       background:#232833;
       box-shadow:inset 0 1px 0 rgba(255,255,255,.10),0 0 0 1px #05070a,0 14px 40px rgba(0,0,0,.6)}
  .title{display:flex;align-items:center;gap:9px;padding:0 11px;height:38px;
       background:linear-gradient(#39414f,#2a303c);border-bottom:1px solid #12161e;
       box-shadow:inset 0 1px 0 rgba(255,255,255,.10)}
  .title svg{width:20px;height:20px;flex:none}
  .title .name{font:700 14px "DejaVu Sans",sans-serif;letter-spacing:3px;color:#eef4ff}
  .title .by{font:700 9.5px "DejaVu Sans",sans-serif;letter-spacing:1.8px;color:#00c8b4;
       border-left:1px solid #4d576a;padding-left:9px}
  .body{padding:15px;display:flex;flex-direction:column;gap:13px;background:#151a22;
       box-shadow:inset 0 2px 6px rgba(0,0,0,.5)}
  .state{font:12px "DejaVu Sans Mono",monospace;color:#a9f2e8;height:30px;display:flex;align-items:center;
       padding:0 10px;background:#12161e;border:1px solid #0b0e13;border-radius:3px;
       box-shadow:inset 0 2px 5px rgba(0,0,0,.75)}
  button{padding:17px;border-radius:3px;border:1px solid #535e75;
       font:700 15px "DejaVu Sans",sans-serif;letter-spacing:1.6px;color:#dfe6f2;
       background:linear-gradient(#3a4356,#2b3242);
       box-shadow:inset 0 1px 0 rgba(255,255,255,.10),inset 0 -1px 0 rgba(0,0,0,.55),0 1px 0 #0a0d12}
  button:active{background:#1d2331;transform:translateY(1px);box-shadow:inset 0 2px 5px rgba(0,0,0,.7)}
  #up{background:linear-gradient(#0f8d7f,#0a6b61);border-color:#0a6f64;color:#d8fffa;
       box-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -1px 0 rgba(0,0,0,.45),0 1px 0 #0a0d12}
  #up:active{background:#085c53}
  button:disabled{opacity:.38}
  .tip{font:11.5px/1.6 "DejaVu Sans Mono",monospace;color:#7f8ba0}
  .tip b{color:#00c8b4;font-weight:700}
  #log{font:11px/1.4 "DejaVu Sans Mono",monospace;color:#6f7c92;min-height:15px;white-space:pre-wrap}
  .status{display:flex;gap:8px;align-items:center;height:28px;padding:0 10px;
       background:linear-gradient(#282e3a,#1e232d);border-top:1px solid #454f62;
       box-shadow:inset 0 1px 0 rgba(255,255,255,.10);
       font:11px "DejaVu Sans Mono",monospace;color:#8a94a6}
  .status .sp{flex:1}
</style></head>
<body>
<div class="frame">
  <div class="title">${MARK_SVG}<span class="name">CRATESURF</span><span class="by">BY SPS</span></div>
  <div class="body">
    <div class="state" id="state">checking…</div>
    <button id="up">BROWSE ON THE MPC</button>
    <button id="down">BACK TO MPC</button>
    <div class="tip">no phone handy: hold <b>three fingers</b> on the MPC glass for <b>2.5 seconds</b>,
      or press <b>Ctrl+Alt+B</b> on a keyboard plugged into it. how far apart they are does not matter.</div>
    <div id="log"></div>
  </div>
  <div class="status"><span>silent partner smpls</span><span class="sp"></span><span>mpc-one-mk2:8798</span></div>
</div>
<script>
  const state = document.getElementById('state');
  const log = document.getElementById('log');
  const btns = [document.getElementById('up'), document.getElementById('down')];

  async function refresh() {
    try {
      const s = await (await fetch('/status')).json();
      state.textContent = s.mode === 'browse'
        ? '> browsing on the MPC screen'
        : '> MPC is running';
      document.getElementById('up').disabled = s.mode === 'browse';
      document.getElementById('down').disabled = s.mode !== 'browse';
    } catch (e) { state.textContent = '> cannot reach the MPC'; }
  }
  async function act(what) {
    btns.forEach(b => b.disabled = true);
    log.textContent = what === 'up' ? 'starting the browser…' : 'handing the panel back…';
    try {
      const r = await (await fetch('/' + what)).json();
      log.textContent = r.out || r.err || '';
    } catch (e) { log.textContent = String(e); }
    setTimeout(refresh, 1500);
  }
  document.getElementById('up').onclick = () => act('up');
  document.getElementById('down').onclick = () => act('down');
  refresh();
  setInterval(refresh, 4000);
</script>
</body></html>`;

const sendJson = (res, body) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;

  if (p === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  if (p === '/status') {
    sendJson(res, { mode: mode() });
    return;
  }
  // Free space where downloads land. The downloads panel shows it so a 300 MB
  // sample pack is not started on 40 MB of room, which otherwise fails at the end
  // with a file error that says nothing about disk space. Read-only and not
  // sensitive, so it answers on the LAN like /status does.
  if (p === '/space') {
    try {
      const st = fs.statfsSync(FILES_ROOT);
      sendJson(res, { ok: true, free: st.bavail * st.bsize, total: st.blocks * st.bsize });
    } catch (e) {
      sendJson(res, { ok: false, error: e.message });
    }
    return;
  }

  if (p === '/up' || p === '/down') {
    sendJson(res, { mode: mode(), ...(await run(p === '/up' ? UP : DOWN)) });
    return;
  }

  // The kiosk start page. Served from the sysroot copy so there is exactly one
  // file to edit, and reachable only from this machine like the rest of these.
  if (p === '/home') {
    if (!localOnly(req)) { res.writeHead(403); res.end(); return; }
    fs.readFile(HOME_PAGE, (err, buf) => {
      if (err) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('home page missing: ' + err.message);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(buf);
    });
    return;
  }

  if (p === '/files') {
    if (!localOnly(req)) { res.writeHead(403); res.end(); return; }
    const rel = u.searchParams.get('d') || '';
    const items = listDir(rel);
    if (!items) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no such folder');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(filesPage(rel, items));
    return;
  }

  // Recording is loopback-only like the file routes: the browser bar calls it
  // from inside the chroot's own loopback, and nothing else should be able to
  // start a capture on this device.
  if (p === '/rec/start' || p === '/rec/stop' || p === '/rec/status') {
    if (!localOnly(req)) { res.writeHead(403); res.end(); return; }
    if (p === '/rec/status') { sendJson(res, recorder.status()); return; }
    // Starts and stops are logged, polls are not: when a take goes missing the
    // first question is whether the press reached the device at all, and this is
    // the only place that can answer it (journalctl -u mpc-browse).
    const r = p === '/rec/start' ? recorder.start() : recorder.stop();
    const st = recorder.status();
    console.log(`rec ${p.slice(5)} -> ${st.recording ? st.name : (st.last ? st.last.name : 'idle')}`,
                JSON.stringify(r));
    sendJson(res, r);
    return;
  }

  if (p.startsWith('/files/')) {
    if (!localOnly(req)) { res.writeHead(403); res.end(); return; }
    const target = resolveInRoot(decodeURIComponent(p.slice('/files/'.length)));
    if (!target) { res.writeHead(403); res.end(); return; }
    fs.stat(target, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': st.size,
        // No range support: samples are small, and a partial-content parser here
        // would be more surface than the feature is worth.
        'accept-ranges': 'none'
      });
      const stream = fs.createReadStream(target);
      stream.on('error', () => { try { res.destroy(); } catch (_) {} });
      stream.pipe(res);
    });
    return;
  }

  res.writeHead(404);
  res.end();
}).listen(PORT, '0.0.0.0', () => {
  console.log(`mpc browse server on http://0.0.0.0:${PORT}/`);
  // Reads /dev/input while the MPC app runs, so browse mode can be opened from
  // the MPC's own glass. If it throws, the toggle page still works: input is a
  // convenience, not the only way in.
  try {
    launcher.start();
    console.log('hardware launcher watching /dev/input');
  } catch (e) {
    console.error('launcher did not start:', e.message);
  }
});
