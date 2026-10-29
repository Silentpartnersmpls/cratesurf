// The kiosk navigation bar, injected into every page.
//
// Kiosk mode is deliberately chromeless: no omnibox, no back button, and the MPC's
// own hardware BACK belongs to the MPC app, which is stopped while browsing. This
// is that missing chrome. It lives in a shadow root so a site's CSS cannot restyle
// or hide it, and it is sized for a finger on a 7" panel.
//
// Two rules learned the hard way:
//   - Back and forward are never disabled. The Navigation API says canGoBack false
//     on sites that navigate client-side (Freesound and friends), which turned the
//     button into a dead tap on exactly the sites this thing is for.
//   - The bar re-raises itself above page overlays. An ad that covers the whole
//     screen with a fixed div used to swallow every tap, including the escape.
(() => {
  if (window.top !== window) return;
  if (document.getElementById('mpc-nav-host')) return;

  const HOME = 'http://127.0.0.1:8798/home';
  const FILES = 'http://127.0.0.1:8798/files';
  const EXIT = 'http://127.0.0.1:8799/exit';
  const COLLAPSE_KEY = 'mpcNavCollapsed';
  const TOP_Z = '2147483647';

  // Fullscreen is blocked, but the patch cannot live here: a content script runs
  // in an isolated world, so patching Element.prototype does nothing the page can
  // see. That is main.js, declared with "world": "MAIN".
  const host = document.createElement('div');
  host.id = 'mpc-nav-host';
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
    <style>
      :host { all: initial; }
      /* The UA rule for [hidden] is display:none at zero specificity, and every
         element below sets its own display, so it has to be forced or the panel
         and the collapsed tab stay on screen. */
      [hidden] { display: none !important; }

      /* CrateSurf by SPS. Still one bar of finger-sized slabs floating over the
         page, but cut as a Navigator toolbar: raised 1px bevel on every button,
         sea-teal accent, a wordmark plate at the head. Dark chrome, because this
         sits over sites all night and 1995 silver would be a lamp. */
      .wrap {
        position: fixed; right: 16px; bottom: 16px; z-index: ${TOP_Z};
        font: 16px/1.2 "DejaVu Sans", system-ui, sans-serif;
        user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
      }
      button {
        font: inherit; color: #dfe6f2;
        background: linear-gradient(#3a4356, #2b3242);
        border: 1px solid #535e75; border-radius: 4px; cursor: pointer;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10),
                    inset 0 -1px 0 rgba(0, 0, 0, 0.55), 0 1px 0 #0a0d12;
        display: inline-flex; align-items: center; justify-content: center;
        position: relative;
      }
      button:active {
        background: #1d2331; transform: translateY(1px);
        box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.7);
      }
      .bar {
        display: flex; gap: 7px; padding: 8px; border-radius: 6px;
        background: linear-gradient(#333a49, #232833);
        border: 1px solid #5a6478;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10),
                    inset 0 -1px 0 rgba(0, 0, 0, 0.55),
                    0 10px 30px rgba(0, 0, 0, 0.6);
      }
      .bar button { width: 72px; height: 60px; font-size: 26px; }
      .bar button.home { color: #00c8b4; }

      /* The wordmark plate doubles as the way home, so it is a button and not
         decoration: nothing on this bar is a dead tap. */
      .bar button.plate {
        flex-direction: column; gap: 3px; width: 96px; padding: 0;
        background: linear-gradient(#2c3342, #202530);
        border-color: #4a5568;
      }
      .bar button.plate svg { width: 22px; height: 22px; display: block; }
      .bar button.plate .wm {
        font: 700 9px/1 "DejaVu Sans", sans-serif; letter-spacing: 1.6px; color: #e8eefb;
      }
      .bar button.plate .sps {
        font: 700 8px/1 "DejaVu Sans", sans-serif; letter-spacing: 1.4px; color: #00c8b4;
      }

      .bar button.exit {
        color: #ffd9e0; background: linear-gradient(#8a2033, #631726); border-color: #a3293f;
        font: 700 14px/1 "DejaVu Sans", sans-serif; letter-spacing: 1.5px;
      }
      .bar button.exit:active { background: #4e1120; }
      .bar button.rec {
        flex-direction: column; overflow: hidden;
        color: #ffd9e0; background: linear-gradient(#3d1a24, #28111b); border-color: #5e2635;
      }
      .bar button.rec .lbl {
        font: 700 13px/1 "DejaVu Sans", sans-serif; letter-spacing: 1px;
        position: relative; z-index: 1;
      }
      .bar button.rec .meter {
        position: absolute; left: 0; right: 0; bottom: 0; height: 0;
        background: linear-gradient(#ff5f76, #ffa9b6); opacity: 0.55;
      }
      .bar button.rec.on { background: linear-gradient(#8d1f33, #6d1526); border-color: #c2384f; }

      .toast {
        position: absolute; right: 0; bottom: 100%; margin-bottom: 10px;
        background: #20252f; border: 1px solid #5a6478; border-radius: 4px;
        padding: 9px 13px; color: #dbe3f0; font: 12px "DejaVu Sans Mono", monospace;
        white-space: nowrap;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 8px 24px rgba(0, 0, 0, 0.6);
      }
      .badge {
        position: absolute; top: -5px; right: -5px; min-width: 21px; height: 21px;
        padding: 0 5px; border-radius: 11px; background: #00c8b4; color: #06110f;
        font: 700 12px/21px "DejaVu Sans", sans-serif; text-align: center;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
      }
      .tab {
        width: 62px; height: 62px; font-size: 24px;
        background: linear-gradient(#333a49, #232833); border-color: #5a6478;
      }

      /* The downloads panel is a little raised window, title strip and all. */
      .panel {
        width: 400px; max-height: 50vh; margin: 0 0 10px auto;
        display: flex; flex-direction: column;
        background: #1a1f28; border: 1px solid #5a6478; border-radius: 5px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 12px 34px rgba(0, 0, 0, 0.65);
        overflow: hidden;
      }
      .phead {
        display: flex; align-items: center; gap: 8px; padding: 8px 9px 8px 11px;
        background: linear-gradient(#39414f, #2a303c);
        border-bottom: 1px solid #12161e; color: #dfe6f2;
        font: 700 11px "DejaVu Sans", sans-serif; letter-spacing: 1.8px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
      }
      .phead .sp { flex: 1; }
      .phead button { width: auto; height: 26px; padding: 0 10px; font: 700 10.5px "DejaVu Sans", sans-serif; letter-spacing: 1.2px; }
      .phead .files { color: #a9f2e8; border-color: #0a6f64; background: linear-gradient(#0f8d7f, #0a6b61); }
      .plist {
        overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 7px;
        background: #151a22; box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.5);
      }
      .row {
        padding: 9px 10px; border-radius: 3px;
        background: linear-gradient(#242b38, #1b212c);
        border: 1px solid #3a4358;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
      }
      .name { color: #d6dfee; font-size: 13px; overflow: hidden;
              text-overflow: ellipsis; white-space: nowrap; }
      .meta { color: #7f8ba0; font: 11px "DejaVu Sans Mono", monospace; margin-top: 4px; }
      .bar2 { height: 6px; border-radius: 2px; background: #12161e; margin-top: 7px; overflow: hidden;
              box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.8); }
      .fill { height: 100%; width: 0; background: linear-gradient(90deg, #009e8d, #00c8b4); transition: width 0.25s linear; }
      .empty { padding: 14px; color: #5a6577; font: 11.5px "DejaVu Sans Mono", monospace; text-align: center; }
      .err { color: #ff8fa2; }
    </style>
    <div class="wrap">
      <div class="toast" hidden></div>
      <div class="panel" hidden>
        <div class="phead">
          <span>DOWNLOADS</span><span class="sp"></span>
          <button class="files">FILES</button>
          <button class="pclose">&#10005;</button>
        </div>
        <div class="plist"><div class="empty">nothing yet</div></div>
      </div>
      <div class="bar">
        <button data-act="home" class="plate" title="CrateSurf by SPS - start page">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.2" fill="#0e2226"
                  stroke="#00c8b4" stroke-width="1.8"/>
            <path d="M3.8 18.8L21 4.9M3.8 4.9L21 18.8" stroke="#0a6d64" stroke-width="1.6"/>
          </svg>
          <span class="wm">CRATESURF</span>
          <span class="sps">BY SPS</span>
        </button>
        <button data-act="back" title="Back">&#8249;</button>
        <button data-act="fwd" title="Forward">&#8250;</button>
        <button data-act="reload" title="Reload">&#8635;</button>
        <button data-act="home" class="home" title="Start page">&#8962;</button>
        <button data-act="dl" title="Downloads">&#10515;<span class="badge" hidden></span></button>
        <button data-act="rec" class="rec" title="Record what is playing"><span class="meter"></span><span class="lbl">REC</span></button>
        <button data-act="exit" class="exit" title="Back to the MPC">MPC</button>
        <button data-act="hide" title="Hide">&#215;</button>
      </div>
      <button class="tab" hidden title="Show bar">&#9776;</button>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const panel = $('.panel');
  const bar = $('.bar');
  const tab = $('.tab');
  const badge = $('.badge');
  const plist = $('.plist');

  // A page opened cold has nothing to go back to, so back falls through to the
  // start page instead of doing nothing, and neither arrow is ever disabled.
  const goBack = () => {
    if (history.length > 1) history.back();
    else location.assign(HOME);
  };

  const collapsed = () => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (_) { return false; }
  };
  const setCollapsed = (on) => {
    bar.hidden = on;
    tab.hidden = !on;
    panel.hidden = on ? true : panel.dataset.open !== '1';
    try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch (_) {}
  };

  // The start page's title strip carries a minimise box. A page cannot reach into
  // this isolated world, but a DOM event is shared by both, so that is the channel:
  // CrateSurf asks the bar to get out of the way, and the collapsed tab brings it
  // back. Without this the box would be a dead tap.
  document.addEventListener('cratesurf-bar', (e) => {
    if (e.detail === 'hide') setCollapsed(true);
  }, true);

  const fmtBytes = (n) => {
    if (!n) return '0 B';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const renderList = (items) => {
    if (!items.length) {
      plist.innerHTML = '<div class="empty">nothing downloaded yet</div>';
      return;
    }
    plist.innerHTML = items.map((d) => {
      const pct = d.total ? Math.min(100, Math.round((d.done / d.total) * 100)) : 0;
      const label = d.state === 'complete'
        ? fmtBytes(d.done) + ' saved'
        : d.state === 'interrupted'
          ? '<span class="err">' + esc(d.error || 'failed') + '</span>'
          : fmtBytes(d.done) + (d.total ? ' of ' + fmtBytes(d.total) + ' · ' + pct + '%' : '');
      const barHtml = d.state === 'in_progress'
        ? '<div class="bar2"><div class="fill" style="width:' + pct + '%"></div></div>' : '';
      return '<div class="row"><div class="name">' + esc(d.name) + '</div>' +
             '<div class="meta">' + label + '</div>' + barHtml + '</div>';
    }).join('');
  };

  // chrome.downloads is only reachable from the extension's worker, so every
  // refresh is a round trip. lastError has to be read or Chromium logs an
  // unchecked error on every poll while the worker wakes.
  const askDownloads = () => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ kind: 'downloads' }, (res) => {
        void chrome.runtime.lastError;
        resolve(Array.isArray(res) ? res : []);
      });
    } catch (_) { resolve([]); }
  });

  // ---- recorder ------------------------------------------------------------
  // The capture itself runs on the device (control-server + parec on the sink's
  // monitor). The bar only needs a timer and a level, and it has to keep showing
  // them across page loads, because navigating mid-take is normal.
  const recBtn = $('.rec');
  const recLbl = $('.rec .lbl');
  const recMeter = $('.rec .meter');
  const toast = $('.toast');
  let recState = { recording: false, seconds: 0, level: 0 };
  let recBusy = false;
  let toastTimer = null;

  const mmss = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  // Every call settles: the worker can be asleep, and a message with no answer
  // must not freeze the button. toggleRec holds a busy flag across this await.
  const askRec = (action) => new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r || {});
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'the bar is not answering' }), 7000);
    try {
      chrome.runtime.sendMessage({ kind: 'rec', action }, (r) => {
        void chrome.runtime.lastError;
        finish(r);
      });
    } catch (_) { finish({ ok: false, error: 'no extension channel' }); }
  });

  const say = (text) => {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 5000);
  };

  const paintRec = (st) => {
    const on = Boolean(st && st.recording);
    recBtn.classList.toggle('on', on);
    recLbl.textContent = on ? mmss(st.seconds || 0) : 'REC';
    recMeter.style.height = on ? Math.min(100, st.level || 0) + '%' : '0';
  };

  const pollRec = async () => {
    const st = await askRec('status');
    if (!st || typeof st.recording !== 'boolean') return;
    const was = recState.recording;
    recState = st;
    paintRec(st);
    if (was && !st.recording && st.last) {
      say('saved ' + st.last.name + ' · ' + st.last.seconds + 's');
    }
  };

  const toggleRec = async () => {
    if (recBusy) return;
    recBusy = true;
    try {
      const st = await askRec(recState.recording ? 'stop' : 'start');
      if (st && st.ok === false) say(st.error || 'recording failed');
      else if (!recState.recording) say('recording what you hear');
      await pollRec();
    } finally {
      recBusy = false;
    }
  };

  // 1 s while a take is running, 4 s when idle: the worker has to wake either way.
  const recLoop = async () => {
    await pollRec();
    setTimeout(recLoop, recState.recording ? 1000 : 4000);
  };

  let lastActive = 0;
  const poll = async () => {
    const items = await askDownloads();
    const active = items.filter((d) => d.state === 'in_progress').length;
    if (active > 0) {
      badge.hidden = false;
      badge.textContent = String(active);
    } else {
      badge.hidden = true;
    }
    // A download starting is exactly when progress becomes interesting, so open
    // the panel for it the first time, and only once.
    if (active > lastActive && panel.dataset.open !== '1' && !bar.hidden) openPanel();
    lastActive = active;
    if (panel.dataset.open === '1') renderList(items);
  };

  const openPanel = () => {
    panel.dataset.open = '1';
    panel.hidden = false;
    askDownloads().then(renderList);
  };
  const closePanel = () => {
    panel.dataset.open = '0';
    panel.hidden = true;
  };

  // Keep the bar above whatever the page paints. A full-screen ad overlay uses the
  // same trick (position fixed, huge z-index), and the tie is broken by DOM order,
  // so re-appending the host puts it back on top. Hit-test first so this does not
  // churn the DOM on every tick.
  const raise = () => {
    const el = bar.hidden ? tab : bar;
    const r = el.getBoundingClientRect();
    const over = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (over !== host) {
      document.documentElement.appendChild(host);
      host.style.zIndex = TOP_Z;
      host.style.position = 'fixed';
    }
  };

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    e.stopPropagation();
    e.preventDefault();
    const act = btn.dataset.act;
    if (act === 'back') goBack();
    else if (act === 'fwd') history.forward();
    else if (act === 'reload') location.reload();
    else if (act === 'home') location.assign(HOME);
    else if (act === 'exit') location.assign(EXIT);
    else if (act === 'dl') (panel.dataset.open === '1' ? closePanel() : openPanel());
    else if (act === 'rec') toggleRec();
    else if (act === 'hide') setCollapsed(true);
    else if (btn.classList.contains('tab')) setCollapsed(false);
    else if (btn.classList.contains('pclose')) closePanel();
    else if (btn.classList.contains('files')) location.assign(FILES);
  }, true);

  // The page's own handlers must not see presses on the bar: sites use
  // document-level pointerdown for menus and lightboxes, and a tap on BACK
  // would otherwise open one instead of going back.
  ['pointerdown', 'pointerup', 'touchstart', 'mousedown'].forEach((ev) => {
    root.addEventListener(ev, (e) => {
      if (e.target.closest('button')) { e.stopPropagation(); }
    }, true);
  });

  setCollapsed(collapsed());
  document.documentElement.appendChild(host);
  poll();
  setInterval(poll, 2000);
  setInterval(raise, 800);
  recLoop();
})();
