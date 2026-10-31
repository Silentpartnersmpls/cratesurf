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

      /* Keyboard glyph on the bar. U+2328 is missing from DejaVu, so it is drawn. */
      .bar button.kbd svg { width: 30px; height: 30px; display: block; }
      .bar button.kbd.on { color: #06110f; background: linear-gradient(#00c8b4, #0a8f83); border-color: #0a6f64; }
      .bar button.kbd.on svg rect { stroke: #06110f; }

      /* ---- on-screen keyboard ------------------------------------------------
         A 7" panel has no keyboard, and the chroot's Chromium ships no
         virtual-keyboard extension, so the ChromeOS OSK switch has nothing to
         switch on. This is the replacement: the same slab as the bar, sitting on
         top of it so the page above stays readable. */
      .osk {
        /* Fixed width on purpose. A max-width of calc(100vw - 24px) was here for a
           narrower screen and was the only way this could ever shrink; every MPC One
           is 1280x800 and the bar itself is 820 wide, so 780 always fits. */
        width: 780px; margin: 0 0 10px auto;
        background: #1a1f28; border: 1px solid #5a6478; border-radius: 5px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 12px 34px rgba(0, 0, 0, 0.7);
        overflow: hidden;
      }
      .osk .ohead {
        display: flex; align-items: center; gap: 6px; padding: 5px 7px 5px 11px;
        background: linear-gradient(#39414f, #2a303c); border-bottom: 1px solid #12161e;
        color: #a9b6cb; font: 700 10.5px "DejaVu Sans", sans-serif; letter-spacing: 1.6px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
      }
      .osk .ohead .sp { flex: 1; }
      .osk .ohead .where {
        color: #6f7d93; letter-spacing: 0.4px; max-width: 200px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .osk .ohead button {
        width: auto; height: 28px; padding: 0 9px;
        font: 700 10px/1 "DejaVu Sans", sans-serif; letter-spacing: 1px;
      }
      .osk .ohead button.x { color: #ffd9e0; border-color: #5e2635; background: linear-gradient(#3d1a24, #28111b); }
      .osk .rows { display: flex; flex-direction: column; gap: 5px; padding: 7px; background: #151a22; }
      .osk .kr { display: flex; gap: 5px; }
      .osk .kr button { flex: 1 1 0; height: 42px; min-width: 0; font: 700 19px "DejaVu Sans", sans-serif; }
      .osk .kr button.mod { font: 700 11.5px "DejaVu Sans", sans-serif; letter-spacing: 0.8px; color: #bfe9e3; }
      .osk .kr button.on { color: #06110f; background: linear-gradient(#00c8b4, #0a8f83); border-color: #0a6f64; }
      .osk .kr button.enter { color: #d8fffa; background: linear-gradient(#0f8d7f, #0a6b61); border-color: #0a6f64; }

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
      .phead .free {
        font: 10.5px "DejaVu Sans Mono", monospace; color: #7f8ba0;
        letter-spacing: 0; white-space: nowrap;
      }
      /* Row actions sit below the bar, so a finger cannot be aiming at CANCEL and
         hit the row above it. */
      .acts { display: flex; gap: 6px; margin-top: 8px; }
      .acts button {
        width: auto; height: 30px; padding: 0 12px;
        font: 700 10.5px/1 "DejaVu Sans", sans-serif; letter-spacing: 1.2px;
      }
      .acts button.go { color: #d8fffa; border-color: #0a6f64; background: linear-gradient(#0f8d7f, #0a6b61); }
      .acts button.go:active { background: #085c53; }
      .acts button:disabled { opacity: 0.4; }

      /* The save card: what a file link actually is, asked before Chromium is
         asked for it. Same slab as the panel, one job - how big is this, and is
         there room for it. */
      .confirm {
        width: 400px; margin: 0 0 10px auto;
        background: #1a1f28; border: 1px solid #5a6478; border-radius: 5px; overflow: hidden;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 12px 34px rgba(0, 0, 0, 0.65);
      }
      .confirm .chead {
        display: flex; align-items: center; gap: 6px;
        padding: 6px 9px 6px 11px; background: linear-gradient(#39414f, #2a303c);
        border-bottom: 1px solid #12161e; color: #dfe6f2;
        font: 700 11px "DejaVu Sans", sans-serif; letter-spacing: 1.8px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.10);
      }
      /* Where it lands is part of the question the card asks, so the folder sits in
         the title strip and is the thing you press to change it. */
      .confirm .chead .cdest {
        width: auto; height: 26px; padding: 0 9px; margin-left: auto;
        color: #a9f2e8; border-color: #0a6f64;
        background: linear-gradient(#0f8d7f, #0a6b61);
        font: 700 10.5px/1 "DejaVu Sans", sans-serif; letter-spacing: 1.2px;
      }
      .confirm .chead .cdest:active { background: #085c53; }
      /* The folder list, open under the strip. A tap picks one and closes it. */
      .confirm .cpick { display: flex; flex-wrap: wrap; gap: 6px; }
      .confirm .cpick button {
        width: auto; height: 30px; padding: 0 10px;
        font: 700 10.5px/1 "DejaVu Sans", sans-serif; letter-spacing: 1px;
      }
      .confirm .cpick button.on {
        color: #d8fffa; border-color: #0a6f64; background: linear-gradient(#0f8d7f, #0a6b61);
      }
      .confirm .cpick .empty { padding: 4px 0; text-align: left; }
      .confirm .cbody { padding: 10px 11px 11px; display: flex; flex-direction: column; gap: 6px; }
      .confirm .cname {
        color: #d6dfee; font-size: 13px;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .confirm .cmeta { color: #7f8ba0; font: 11px "DejaVu Sans Mono", monospace; }
      /* .confirm .cmeta is two classes deep, so the panel's plain .err rule loses
         to it and the shortfall line came out grey. */
      .confirm .cmeta.err { color: #ff8fa2; }
      .confirm .cfree { color: #5f6a7d; font: 10.5px "DejaVu Sans Mono", monospace; }
      .confirm .cacts { display: flex; gap: 6px; margin-top: 3px; }
      .confirm .cacts button {
        width: auto; height: 34px; padding: 0 14px;
        font: 700 11px/1 "DejaVu Sans", sans-serif; letter-spacing: 1.2px;
      }
      .confirm .cacts button.go {
        color: #d8fffa; border-color: #0a6f64; background: linear-gradient(#0f8d7f, #0a6b61);
      }
      .confirm .cacts button.go:active { background: #085c53; }
      /* The only :disabled rule in this sheet was scoped to the download rows, so a
         disabled DOWNLOAD on the card blocked the press but still looked live. */
      .confirm .cacts button:disabled { opacity: 0.4; }
    </style>
    <div class="wrap">
      <div class="toast" hidden></div>
      <div class="panel" hidden>
        <div class="phead">
          <span>DOWNLOADS</span><span class="free"></span><span class="sp"></span>
          <button class="files">FILES</button>
          <button class="pclose">&#10005;</button>
        </div>
        <div class="plist"><div class="empty">nothing yet</div></div>
      </div>
      <div class="confirm" hidden>
        <div class="chead"><span>SAVE TO</span><button class="cdest"></button></div>
        <div class="cbody">
          <div class="cpick" hidden></div>
          <div class="cname"></div>
          <div class="cmeta"></div>
          <div class="cfree"></div>
          <div class="cacts">
            <button class="go cget">DOWNLOAD</button>
            <button class="cx">CANCEL</button>
          </div>
        </div>
      </div>
      <div class="osk" hidden>
        <div class="ohead">
          <span>KEYBOARD</span><span class="where"></span><span class="sp"></span>
          <button data-k="esc">ESC</button>
          <button data-k="tab">TAB</button>
          <button data-k="left">&#8592;</button>
          <button data-k="right">&#8594;</button>
          <button data-k="up">&#8593;</button>
          <button data-k="down">&#8595;</button>
          <button data-k="hide" class="x">&#10005;</button>
        </div>
        <div class="rows"></div>
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
        <button data-act="kbd" class="kbd" title="Keyboard">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2.2" y="6.4" width="19.6" height="11.6" rx="1.8" fill="#101a22"
                  stroke="#8fa4c4" stroke-width="1.4"/>
            <g fill="#8fa4c4">
              <rect x="4.6" y="9" width="2.4" height="2.2" rx="0.4"/>
              <rect x="8.2" y="9" width="2.4" height="2.2" rx="0.4"/>
              <rect x="11.8" y="9" width="2.4" height="2.2" rx="0.4"/>
              <rect x="15.4" y="9" width="2.4" height="2.2" rx="0.4"/>
              <rect x="6" y="12.8" width="12" height="2.2" rx="0.4"/>
            </g>
          </svg>
        </button>
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
  const freeEl = $('.phead .free');

  // Where the next download goes. The answer lives on the device (the control
  // server's run folder) because page storage is per origin and the bar runs on
  // every site; this is only the current value.
  const DEFAULT_DEST = 'Samples';
  let dest = DEFAULT_DEST;
  let allDirs = [];

  // Unpack jobs by file name. The list is redrawn from Chromium's download table
  // every two seconds, so anything a row needs to say beyond that has to live
  // somewhere that survives the redraw, or it disappears mid-unpack.
  const unpacked = new Map();
  let lastItems = [];
  let unpackTimer = null;

  // Unpack jobs outlive the page, so a zip row asks the server once (per page) what
  // became of it. Without this, navigating away during an unpack came back to a row
  // that had forgotten the pack was already out, and the offer to delete the
  // archive would have vanished with the page.
  const askedJobs = new Set();
  const catchUpJobs = async (items) => {
    for (const d of items) {
      const rel = d.rel || d.name;
      if (d.state !== 'complete' || !UNPACKABLE.test(d.name)) continue;
      if (unpacked.has(rel) || askedJobs.has(rel)) continue;
      askedJobs.add(rel);
      const j = await ask({ kind: 'unpack-status', rel });
      if (!j || !j.state || j.state === 'none') continue;
      unpacked.set(rel, j);
      if (j.state === 'running') {
        clearTimeout(unpackTimer);
        unpackTimer = setTimeout(unpackLoop, 1200);
      }
      if (panel.dataset.open === '1') renderList(lastItems);
    }
  };

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
    // The keyboard is anchored to the bar, so it goes with it rather than hanging
    // over the page with nothing to close it.
    if (on) hideOsk();
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
    if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Only these can be opened in the browser: an audio file plays in the tab, a zip
  // would just download itself again - so a zip gets unpacked instead.
  const PLAYABLE = /\.(wav|mp3|ogg|flac|m4a|aif|aiff|mid)$/i;
  const UNPACKABLE = /\.zip$/i;

  // rel is the file's name under the document root, folder included. PLAY and
  // UNPACK need it: with a destination to choose from, a file is no longer
  // necessarily in the one folder the bar used to assume.
  // The same file as a path in the file page. Every segment is escaped: the folders
  // here have spaces in their names ("Plugin Presets" is one of them).
  const relPath = (btn) => String(btn.dataset.rel || btn.dataset.name || '')
    .split('/').map((s) => encodeURIComponent(s)).join('/');

  const dlBtn = (act, d, text, go) =>
    '<button data-act="' + act + '" data-id="' + d.id + '" data-name="' + esc(d.name) + '"' +
    ' data-rel="' + esc(d.rel || d.name) + '"' + (go ? ' class="go"' : '') + '>' + text + '</button>';

  // Three states, three different things a person can do. Before this, every row
  // looked the same and the only one with a control on it was the browser's own
  // implicit one (click again and hope), so an interrupted download sat there as
  // the single word CRASH until the history was wiped.
  const renderList = (items) => {
    if (!items.length) {
      plist.innerHTML = '<div class="empty">nothing downloaded yet</div>';
      return;
    }
    plist.innerHTML = items.map((d) => {
      const pct = d.total ? Math.min(100, Math.round((d.done / d.total) * 100)) : 0;
      let label, acts = '', barHtml = '';
      if (d.state === 'complete') {
        const gone = d.exists === false;
        label = fmtBytes(d.done) + ' saved' +
          (gone ? ' · <span class="err">gone from the folder</span>' : '');
        // Same retry as an interrupted one: the file was deleted or moved after it
        // landed, and a row that only says so with no way forward is the dead end
        // this panel is meant to remove.
        if (gone) {
          acts = (/^https?:/i.test(d.url || '') ? dlBtn('dlretry', d, 'GET AGAIN', true) : '') +
            dlBtn('dlerase', d, 'DROP');
        } else if (PLAYABLE.test(d.name)) {
          acts = dlBtn('dlopen', d, 'PLAY', true) + dlBtn('dlerase', d, 'DROP');
        } else if (UNPACKABLE.test(d.name)) {
          const job = unpacked.get(d.rel || d.name);
          if (job && job.state === 'running') {
            const up = job.bytes ? Math.min(100, Math.round((job.written / job.bytes) * 100)) : 0;
            label = 'unpacking ' + job.done + ' of ' + job.count + ' files · ' + up + '%';
            acts = '<button disabled>UNPACKING</button>';
            barHtml = '<div class="bar2"><div class="fill" style="width:' + up + '%"></div></div>';
          } else {
            // Once the pack is out, the archive is dead weight - a 300 MB zip onto a
            // 16 GB card is the second copy nobody needs. The offer only appears after
            // a good unpack, because deleting a zip that was never unpacked would be
            // deleting the only copy.
            const done = Boolean(job && job.state === 'done');
            acts = (done ? dlBtn('dlrm', d, 'DELETE ZIP') : dlBtn('unpack', d, 'UNPACK', true)) +
              dlBtn('dlerase', d, 'DROP');
            if (done) label += ' · unpacked into ' + esc(job.dest);
            if (job && job.state === 'failed') {
              label += ' · <span class="err">' + esc(job.error) + '</span>';
            }
          }
        }
      } else if (d.state === 'interrupted') {
        // reason is the worker's plain-English version of Chromium's error enum.
        label = '<span class="err">' + esc(d.reason || d.error || 'it stopped') + '</span>';
        acts = dlBtn('dlretry', d, 'RETRY', true) + dlBtn('dlerase', d, 'DROP');
      } else {
        label = fmtBytes(d.done) + (d.total ? ' of ' + fmtBytes(d.total) + ' · ' + pct + '%' : ' of unknown size');
        acts = dlBtn('dlcancel', d, 'CANCEL');
      }
      if (d.state === 'in_progress') {
        barHtml = '<div class="bar2"><div class="fill" style="width:' + pct + '%"></div></div>';
      }
      return '<div class="row"><div class="name">' + esc(d.name) + '</div>' +
             '<div class="meta">' + label + '</div>' + barHtml +
             (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';
    }).join('');
  };

  // chrome.downloads is only reachable from the extension's worker, so every
  // refresh is a round trip. lastError has to be read or Chromium logs an
  // unchecked error on every poll while the worker wakes.
  const ask = (msg) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res || {});
      });
    } catch (_) { resolve({}); }
  });

  const askDownloads = async () => {
    const res = await ask({ kind: 'downloads' });
    return Array.isArray(res) ? res : [];
  };

  // How much room is left where these land. A sample pack can be 300 MB and the
  // failure without this number is a download that dies at 99% with a file error.
  const refreshSpace = async () => {
    const j = await ask({ kind: 'space', dir: dest });
    freeEl.textContent = j && j.ok ? fmtBytes(j.free) + ' free' : '';
    freeEl.title = j && j.ok ? 'free space in ' + dest : '';
  };

  // Cancel, retry and drop all answer through the worker, then the list is redrawn
  // from what Chromium actually did rather than from what was asked for.
  // Unpacking is the step that used to need a computer: the zip is on the device
  // and the folder the MPC reads is on the device, so the only missing part was
  // something to open it. A pack is hundreds of files, so the start answers with a
  // job and the loop below follows it - including when the panel is shut, because
  // the toast at the end is the only confirmation you get.
  const startUnpack = async (name) => {
    unpacked.set(name, { state: 'running', dest: '', count: 0, done: 0, written: 0, bytes: 0 });
    renderList(lastItems);
    const j = await ask({ kind: 'unpack', rel: name });
    if (j && j.state) unpacked.set(name, j);
    if (j && j.state === 'failed') say('unpack failed: ' + j.error);
    renderList(lastItems);
    clearTimeout(unpackTimer);
    unpackTimer = setTimeout(unpackLoop, 1200);
  };

  const unpackLoop = async () => {
    clearTimeout(unpackTimer);
    const running = [...unpacked.keys()].filter((n) => unpacked.get(n).state === 'running');
    for (const name of running) {
      const j = await ask({ kind: 'unpack-status', rel: name });
      if (!j || !j.state || j.state === 'none') continue;
      unpacked.set(name, j);
      if (j.state === 'failed') say('unpack failed: ' + j.error);
      if (j.state === 'done') say('unpacked ' + j.count + ' files into ' + j.dest);
    }
    if (panel.dataset.open === '1') renderList(lastItems);
    if ([...unpacked.values()].some((j) => j.state === 'running')) {
      unpackTimer = setTimeout(unpackLoop, 1200);
    }
  };

  // Remove the archive an unpack came from. The row goes with it: the file was the
  // only thing it offered, and a row for a file that is gone on purpose would just
  // read "gone from the folder" and offer to fetch back what you chose to delete.
  const deletePack = async (btn) => {
    const rel = btn.dataset.rel || btn.dataset.name;
    const id = Number(btn.dataset.id);
    btn.disabled = true;
    const r = await ask({ kind: 'rm', rel });
    if (r && r.ok === false) {
      btn.disabled = false;
      say(r.error || 'could not delete it');
      return;
    }
    unpacked.delete(rel);
    await ask({ kind: 'dl-erase', id });
    say('deleted ' + (rel.split('/').pop() || rel));
    renderList(await askDownloads());
  };

  const dlAction = async (kind, btn) => {
    const id = Number(btn.dataset.id);
    btn.disabled = true;
    const r = await ask({ kind, id });
    btn.disabled = false;
    if (r && r.ok === false) say(r.error || 'that did not work');
    renderList(await askDownloads());
    refreshSpace();
  };

  // ---- the size before you commit ------------------------------------------
  // A pack link used to go straight to Chromium, so the first number anyone saw
  // was the percent of a transfer already running. One HEAD request answers the
  // question that decides it on a 7" panel: how big is this, and does it fit.
  // Only formats the browser will not display are caught - a tap on an mp3 or a
  // pdf stays the page's business, because Chromium plays those in the tab and a
  // save card there would be a worse experience than the one it replaced.
  const SAVEABLE = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|zst|iso|dmg|exe|msi|deb|rpm|apk|xpn|xpm|akp|flp|mid|midi)$/i;
  const confirmEl = $('.confirm');
  const cName = $('.confirm .cname');
  const cMeta = $('.confirm .cmeta');
  const cFree = $('.confirm .cfree');
  const cGet = $('.confirm .cget');
  const cDest = $('.confirm .cdest');
  const cPick = $('.confirm .cpick');
  let pendingSave = null;

  const paintDest = () => {
    cDest.textContent = dest.toUpperCase() + ' \u25BE';
    cDest.title = 'save to ' + dest;
  };

  // Asked once per page load. A bar showing SAMPLES while the device had another
  // folder remembered would be quietly promising somewhere the file will not be.
  const loadDest = async () => {
    const j = await ask({ kind: 'dest' });
    if (j && j.ok && j.dir) dest = j.dir;
    paintDest();
  };

  const closeConfirm = () => {
    confirmEl.hidden = true;
    cPick.hidden = true;
    pendingSave = null;
  };

  // The card exists so the size is seen before the bytes move, so DOWNLOAD stays
  // shut until there is an answer - including an answer of "no answer", which is
  // still an answer. A press during the check is exactly the blind commit this
  // replaces: on the unit, a 6 s HEAD timeout plus a quick finger started a 10 GB
  // transfer with the size still reading "checking".
  const setGet = (text, enabled) => {
    cGet.textContent = text;
    cGet.disabled = !enabled;
  };

  // What the card says about size and room. Kept apart from the request that fills
  // it in, because the folder can change after the answer has landed: another
  // folder means another free number, and "does it fit" has to follow it without
  // asking the site a second time.
  const fit = () => {
    if (!pendingSave || !pendingSave.answered) return;
    const { size, free, note } = pendingSave;
    cFree.textContent = free ? fmtBytes(free) + ' free in ' + dest : '';
    cMeta.classList.toggle('err', Boolean(free && size && size > free));
    if (note) { cMeta.textContent = note; setGet('DOWNLOAD', true); return; }
    if (!size) { cMeta.textContent = 'size unknown'; setGet('DOWNLOAD', true); return; }
    // Saying the shortfall here is the whole point: the alternative is a download
    // that dies at 99% with a file error that never mentions disk space.
    if (free && size > free) {
      cMeta.textContent = 'needs ' + fmtBytes(size) + ', more than ' + dest + ' has left';
      // Not a warning over a live button: starting this one can only end in a
      // transfer that dies at the end, so the offer comes off the card, and the
      // button says which answer it is instead of going quietly dim.
      setGet("WON'T FIT", false);
      return;
    }
    cMeta.textContent = fmtBytes(size);
    setGet('DOWNLOAD', true);
  };

  const openConfirm = async (url, name) => {
    pendingSave = { url, name, size: 0, free: 0, answered: false, note: '' };
    cName.textContent = name;
    cMeta.textContent = 'checking size…';
    cMeta.classList.remove('err');
    cFree.textContent = '';
    cPick.hidden = true;
    paintDest();
    setGet('CHECKING…', false);
    confirmEl.hidden = false;
    const [j, sp] = await Promise.all([
      ask({ kind: 'probe', url }),
      ask({ kind: 'space', dir: dest })
    ]);
    // The answer can arrive after the card has been dismissed or replaced by a
    // link tapped behind it, and writing it now would put the wrong file on screen.
    if (!pendingSave || pendingSave.url !== url) return;
    pendingSave.free = sp && sp.ok ? sp.free : 0;
    if (j && j.ok && j.name) {
      pendingSave.name = j.name;
      cName.textContent = j.name;
    }
    if (j && j.ok) pendingSave.size = j.size || 0;
    else pendingSave.note = (j && j.error) || 'size unknown';
    pendingSave.answered = true;
    fit();
  };

  // The list is what is really on the device, so a folder added or renamed on the
  // MPC shows up here without a code change, and a folder that is gone cannot be
  // picked.
  const togglePicker = async () => {
    if (!cPick.hidden) { cPick.hidden = true; return; }
    cPick.hidden = false;
    if (!allDirs.length) {
      cPick.innerHTML = '<div class="empty">reading the folders…</div>';
      const j = await ask({ kind: 'dirs' });
      allDirs = j && j.ok && Array.isArray(j.dirs) ? j.dirs : [];
    }
    if (!allDirs.length) {
      cPick.innerHTML = '<div class="empty">no folders to choose</div>';
      return;
    }
    cPick.innerHTML = allDirs.map((d) =>
      '<button data-act="cdest-set" data-dir="' + esc(d) + '"' +
      (d === dest ? ' class="on"' : '') + '>' + esc(d.toUpperCase()) + '</button>').join('');
  };

  // A change of destination, not of file: nothing is downloaded here. The choice is
  // remembered on the device, and the card re-answers "does it fit" for the folder
  // it now names.
  const chooseDest = async (name) => {
    if (!name) return;
    dest = name;
    paintDest();
    cPick.hidden = true;
    const r = await ask({ kind: 'dest-set', dir: name });
    if (r && r.ok === false) say(r.error || 'could not remember that folder');
    refreshSpace();
    fit();
  };

  const startSave = async () => {
    if (!pendingSave) return;
    const url = pendingSave.url;
    const name = pendingSave.name || cName.textContent;
    const r = await ask({ kind: 'dl-start', url, dir: dest, name });
    closeConfirm();
    if (r && r.ok === false) {
      say(r.error || 'the download did not start');
      return;
    }
    say('saving ' + name + ' to ' + dest);
    openPanel();
    // Chromium's download table answers empty for a moment after the worker starts
    // and for a moment after a transfer begins, and a panel reading "nothing
    // downloaded yet" right after a DOWNLOAD press looks like the press was lost.
    // So keep asking until the row just started is actually in the answer - the
    // card's own "reading the list…" holds the panel meanwhile.
    for (let i = 0; i < 5; i++) {
      const items = await askDownloads();
      if (r && items.some((d) => d.id === r.id)) {
        lastItems = items;
        renderList(items);
        return;
      }
      await new Promise((res) => setTimeout(res, 400));
    }
    poll();
  };

  // Caught in the capture phase on window, before the page's own handlers: the
  // page would otherwise start the transfer in a way that cannot be un-asked.
  window.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const path = e.composedPath ? e.composedPath() : [e.target];
    if (path.includes(host)) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || !a.href || !/^https?:/i.test(a.href)) return;
    let p;
    try { p = new URL(a.href).pathname; } catch (_) { return; }
    // A download attribute is the page asking for a save whatever the type is.
    if (!a.hasAttribute('download') && !SAVEABLE.test(p)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    let guessed = 'download';
    // Decoded first. The file page puts a whole relative path in one segment
    // (/files/Samples%2Fpack.zip), and splitting before decoding leaves the folder
    // glued to the name, which then becomes the saved file name.
    try { guessed = decodeURIComponent(p).split('/').filter(Boolean).pop() || 'download'; } catch (_) {}
    openConfirm(a.href, guessed);
  }, true);

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
    lastItems = items;
    catchUpJobs(items);
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
    // The download list is a round trip to a worker that may have gone to sleep,
    // and on this CPU the first answer can take a moment. Saying that, instead of
    // leaving "nothing yet" on screen right after a download was started, is the
    // difference between a slow panel and a panel that looks broken.
    if (!lastItems.length) plist.innerHTML = '<div class="empty">reading the list…</div>';
    askDownloads().then((items) => { catchUpJobs(items); renderList(items); });
    refreshSpace();
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
    else if (act === 'kbd') (osk.hidden ? showOsk(false) : hideOsk());
    else if (act === 'rec') toggleRec();
    else if (act === 'dlcancel') dlAction('dl-cancel', btn);
    else if (act === 'dlretry') dlAction('dl-retry', btn);
    else if (act === 'dlerase') dlAction('dl-erase', btn);
    else if (act === 'dlopen') location.assign(FILES + '/' + relPath(btn));
    else if (act === 'unpack') startUnpack(btn.dataset.rel || btn.dataset.name);
    else if (act === 'dlrm') deletePack(btn);
    else if (act === 'cdest-set') chooseDest(btn.dataset.dir);
    else if (btn.classList.contains('cget')) startSave();
    else if (btn.classList.contains('cdest')) togglePicker();
    else if (btn.classList.contains('cx')) closeConfirm();
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

  // ---- on-screen keyboard -------------------------------------------------
  // It types into the page, which is where every text box on these sites lives. It
  // does not reach the PDF viewer or a cross-origin iframe (this script only runs in
  // the top frame), and it says so rather than pretending otherwise.
  const osk = $('.osk');
  const oskRows = $('.osk .rows');
  const oskWhere = $('.osk .where');
  const kbdBtn = $('.kbd');

  // Rows of keys. A string is a character to type; an object is one of the
  // modifiers below. w is how many character-widths the key takes.
  //
  // The three letter rows are the real thing, in full: q..p, a..l, z..m. A first cut
  // ended the alphabet at `l`, and nothing looked wrong until `freesound.org` came out
  // `treesouhd.org` on the glass.
  const LAYOUT = {
    abc: [
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', { k: 'bksp', l: 'DEL', w: 1.5 }],
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      [{ k: 'shift', l: 'SHIFT', w: 1.6 }, 'a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', "'"],
      [{ k: 'shift', l: 'SHIFT', w: 1.6 }, 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'],
      [{ k: 'pg', l: '123', w: 1.4 }, { k: 'ctrl', l: 'CTRL', w: 1.4 },
       { k: 'space', l: 'SPACE', w: 4 }, { k: 'enter', l: 'ENTER', w: 1.8 }]
    ],
    sym: [
      ['!', '@', '#', '$', '%', '&', '*', '(', ')', '_', { k: 'bksp', l: 'DEL', w: 1.5 }],
      ['-', '+', '=', '[', ']', '{', '}', '\\', '|', '/'],
      [{ k: 'shift', l: 'SHIFT', w: 1.6 }, ';', ':', '"', '~', '`', '<', '>', '^', '?'],
      [{ k: 'shift', l: 'SHIFT', w: 1.6 }, ',', '.', '/', "'", '\u00a3', '\u20ac', '\u00b0', '\u00a9', '\u2022'],
      [{ k: 'pg', l: 'ABC', w: 1.4 }, { k: 'ctrl', l: 'CTRL', w: 1.4 },
       { k: 'space', l: 'SPACE', w: 4 }, { k: 'enter', l: 'ENTER', w: 1.8 }]
    ]
  };

  let field = null;       // the page field the keys go into
  let shift = false;      // one-shot, like a phone keyboard
  let ctrl = false;
  let sym = false;
  let oskManual = false;  // opened from the bar button rather than by tapping a box
  let lastKeyAt = 0;
  let lastTapAt = 0;

  const editable = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return !/^(checkbox|radio|button|submit|reset|range|color|file|image|hidden|date|time)$/i
      .test(el.type || 'text');
  };

  // activeElement is the truth while it lasts; after a tap on the bar the field has
  // normally already been remembered, so a key pressed in that gap still lands in
  // the box the person was typing in instead of nowhere.
  const fieldOf = () => {
    const a = document.activeElement;
    if (editable(a)) { field = a; return a; }
    if (field && field.isConnected) return field;
    field = null;
    return null;
  };

  const paint = () => {
    const rows = sym ? LAYOUT.sym : LAYOUT.abc;
    oskRows.innerHTML = rows.map((row) => '<div class="kr">' + row.map((it) => {
      if (typeof it === 'string') {
        const c = shift && /[a-z]/.test(it) ? it.toUpperCase() : it;
        return '<button data-k="ch" data-c="' + esc(c) + '" style="flex:1 1 0">' +
               esc(c) + '</button>';
      }
      const on = (it.k === 'shift' && shift) || (it.k === 'ctrl' && ctrl);
      return '<button data-k="' + it.k + '" class="mod' +
             (it.k === 'enter' ? ' enter' : '') + (on ? ' on' : '') +
             '" style="flex:' + (it.w || 1) + ' 1 0">' + esc(it.l) + '</button>';
    }).join('') + '</div>').join('');
    kbdBtn.classList.toggle('on', !osk.hidden);
  };

  const where = () => {
    const el = fieldOf();
    oskWhere.textContent = el
      ? (el.placeholder || el.getAttribute('aria-label') || el.name ||
         (el.tagName === 'TEXTAREA' ? 'text area' : 'text box'))
      : 'tap a text box';
  };

  const hideOsk = () => {
    if (osk.hidden) return;
    osk.hidden = true;
    oskManual = false;
    paint();
  };

  // The keyboard takes the bottom of the screen, so a box behind it is a box whose
  // text cannot be read while it is being typed. Scroll the page instead.
  const nudge = () => {
    const el = fieldOf();
    if (!el || !el.getBoundingClientRect) return;
    const r = el.getBoundingClientRect();
    const top = osk.getBoundingClientRect().top;
    if (r.bottom > top - 8) {
      try { window.scrollBy({ top: r.bottom - top + 24, behavior: 'smooth' }); } catch (_) {}
    }
  };

  const showOsk = (auto) => {
    if (!auto) oskManual = true;
    if (!osk.hidden) { where(); return; }
    closePanel();      // two windows fighting over one corner
    osk.hidden = false;
    paint();
    where();
    requestAnimationFrame(nudge);
  };

  // ---- what the keys actually do -------------------------------------------
  const insert = (text) => {
    const el = fieldOf();
    if (!el) return false;
    if (document.activeElement !== el) el.focus();
    try { if (document.execCommand('insertText', false, text)) return true; } catch (_) {}
    // A field that refuses execCommand still has a value and a selection, so the text
    // is written there and the page is told: a value changed without an input event
    // is invisible to everything listening for one.
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        sel.deleteFromDocument();
        const r = sel.getRangeAt(0);
        const node = document.createTextNode(text);
        r.insertNode(node);
        r.setStartAfter(node);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } else {
      let s = null, e = null;
      try { s = el.selectionStart; e = el.selectionEnd; } catch (_) {}
      if (s == null) el.value = (el.value || '') + text;
      else el.setRangeText(text, s, e, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  };

  const backspace = () => {
    const el = fieldOf();
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) { sel.deleteFromDocument(); return; }
      // Stretch the caret back one character and cut the selection, rather than
      // trusting execCommand('delete') to guess which way to delete.
      if (sel && sel.modify) {
        sel.modify('extend', 'backward', 'character');
        if (!sel.isCollapsed) { sel.deleteFromDocument(); return; }
      }
      document.execCommand('delete', false);
      return;
    }
    let s = null, e = null;
    try { s = el.selectionStart; e = el.selectionEnd; } catch (_) {}
    if (s == null) {
      el.value = (el.value || '').slice(0, -1);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (s === 0 && e === 0) return;
    el.setRangeText('', s === e ? s - 1 : s, e, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const KEYS = {
    Enter: [13, 'Enter', 'Enter'],
    Tab: [9, 'Tab', 'Tab'],
    Escape: [27, 'Escape', 'Escape'],
    ArrowLeft: [37, 'ArrowLeft', 'ArrowLeft'],
    ArrowUp: [38, 'ArrowUp', 'ArrowUp'],
    ArrowRight: [39, 'ArrowRight', 'ArrowRight'],
    ArrowDown: [40, 'ArrowDown', 'ArrowDown']
  };

  // An untrusted key event has no default action, so the event goes to the page
  // first (anything that listens for Enter on a search box gets it) and the default
  // is then replayed by hand only if the page did not take the event.
  const sendKey = (name) => {
    const el = fieldOf();
    if (el) el.focus();
    const t = el || document.activeElement || document.body;
    const [code, key, codeName] = KEYS[name];
    const ev = new KeyboardEvent('keydown', {
      key, code: codeName, bubbles: true, cancelable: true, ctrlKey: ctrl, shiftKey: shift
    });
    Object.defineProperty(ev, 'keyCode', { get: () => code });
    Object.defineProperty(ev, 'which', { get: () => code });
    if (ctrl) { ctrl = false; paint(); }
    if (!t.dispatchEvent(ev)) return;
    if (name === 'Enter') submitField();
    else if (name === 'Tab') tabMove();
    else moveCaret(name);
  };

  // Enter in a single-line box belongs to the form around it.
  const submitField = () => {
    const el = fieldOf();
    if (!el || el.isContentEditable || el.tagName === 'TEXTAREA') return;
    const form = el.form;
    if (!form) return;
    try { form.requestSubmit ? form.requestSubmit() : form.submit(); } catch (_) {}
  };

  // Synthetic Tab moves nothing either, so the walk is done here and it wraps.
  const tabMove = () => {
    const list = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
      .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
    if (!list.length) return;
    const at = list.indexOf(document.activeElement);
    const next = list[(at + 1 + list.length) % list.length];
    if (next) next.focus();
  };

  const moveCaret = (name) => {
    const el = fieldOf();
    if (!el || el.isContentEditable) return;
    let s, e, v;
    try { s = el.selectionStart; e = el.selectionEnd; v = el.value || ''; } catch (_) { return; }
    if (s == null) return;
    let n = s;
    if (name === 'ArrowLeft') n = Math.max(0, s - 1);
    else if (name === 'ArrowRight') n = Math.min(v.length, e + 1);
    else if (name === 'ArrowUp' || name === 'ArrowDown') {
      // A line up or down with the column kept is what the key means in a textarea,
      // where arrow keys are worth having at all.
      const start = v.lastIndexOf('\n', s - 1) + 1;
      const col = s - start;
      if (name === 'ArrowUp') {
        if (start === 0) return;
        const prev = v.lastIndexOf('\n', start - 2) + 1;
        n = Math.min(start - 1, prev + col);
      } else {
        const end = v.indexOf('\n', s);
        if (end < 0) return;
        const next = v.indexOf('\n', end + 1);
        n = Math.min(next < 0 ? v.length : next, end + 1 + col);
      }
    }
    try { el.setSelectionRange(n, n); } catch (_) {}
  };

  const COMBOS = { a: 'selectAll', c: 'copy', x: 'cut', z: 'undo' };
  const sendCtrl = (c) => {
    const el = fieldOf();
    if (el) el.focus();
    const t = el || document.activeElement || document.body;
    const up = c.toUpperCase();
    const ev = new KeyboardEvent('keydown', {
      key: c, code: 'Key' + up, bubbles: true, cancelable: true, ctrlKey: true
    });
    Object.defineProperty(ev, 'keyCode', { get: () => up.charCodeAt(0) });
    if (!t.dispatchEvent(ev)) return;
    if (COMBOS[c]) { try { document.execCommand(COMBOS[c], false); } catch (_) {} }
  };

  const typeChar = (c) => {
    lastKeyAt = performance.now();
    if (ctrl) { sendCtrl(c); ctrl = false; paint(); return; }
    if (!insert(c)) {
      say('tap a text box first');
      if (shift) { shift = false; paint(); }
      return;
    }
    if (shift) { shift = false; paint(); }
  };

  const press = (k, btn) => {
    lastKeyAt = performance.now();
    switch (k) {
      case 'ch': typeChar(btn.dataset.c); break;
      case 'space': typeChar(' '); break;
      case 'shift': shift = !shift; paint(); break;
      case 'ctrl': ctrl = !ctrl; paint(); break;
      case 'pg': sym = !sym; shift = false; paint(); break;
      case 'bksp': backspace(); break;
      case 'enter': {
        const el = fieldOf();
        if (el && (el.isContentEditable || el.tagName === 'TEXTAREA')) insert('\n');
        else sendKey('Enter');
        break;
      }
      case 'tab': sendKey('Tab'); break;
      case 'esc': sendKey('Escape'); break;
      case 'left': sendKey('ArrowLeft'); break;
      case 'right': sendKey('ArrowRight'); break;
      case 'up': sendKey('ArrowUp'); break;
      case 'down': sendKey('ArrowDown'); break;
      case 'hide': hideOsk(); break;
    }
  };

  // Every key is handled on pointerdown, not click. Preventing the default there is
  // what keeps the caret in the page's text box: a <button> would otherwise take
  // focus on mousedown and the field would be gone by the time the key was sent.
  root.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('[data-k]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    press(btn.dataset.k, btn);
  }, true);

  // A field that grabs focus by itself (autofocus, a site's script) must not open the
  // keyboard on someone who did not ask for it, so the auto-open only follows a tap
  // that happened just before it.
  document.addEventListener('pointerdown', (e) => {
    const p = e.composedPath ? e.composedPath() : [e.target];
    if (!p.includes(host)) lastTapAt = performance.now();
  }, true);

  document.addEventListener('focusin', (e) => {
    if (!editable(e.target)) return;
    field = e.target;
    if (performance.now() - lastTapAt > 1200) return;
    showOsk(true);
  }, true);

  document.addEventListener('focusout', (e) => {
    if (e.target !== field) return;
    setTimeout(() => {
      if (performance.now() - lastKeyAt < 500) return;   // a tap on our own keys
      if (editable(document.activeElement)) return;
      if (oskManual) return;
      hideOsk();
    }, 200);
  }, true);

  // A real keyboard types past this thing. When one does, the on-screen one gets out
  // of the way instead of sitting there in the corner of the screen.
  document.addEventListener('keydown', (e) => {
    if (!e.isTrusted || osk.hidden) return;
    if (/^(Shift|Control|Alt|Meta|CapsLock)$/.test(e.key)) return;
    hideOsk();
  }, true);

  setCollapsed(collapsed());
  document.documentElement.appendChild(host);
  loadDest();
  poll();
  setInterval(poll, 2000);
  setInterval(raise, 800);
  recLoop();
})();
