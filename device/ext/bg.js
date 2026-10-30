// Download state and recorder control for the on-page bar.
//
// chrome.downloads is only available to extension pages, so the content script
// asks this worker. The recorder is the same story for a different reason: the bar
// runs inside whatever site is on screen, and a fetch from there to 127.0.0.1
// would be cross-origin (and blocked outright as mixed content on an https page).
// From the worker, with host_permissions for that origin, it is allowed.
const API = 'http://127.0.0.1:8798';

// Where a file is saved is a path under the profile's download directory, and that
// directory is the root of the MPC's own document tree. So "Samples/pack.zip" is
// what puts a pack in the sample library, and the folder choice is just the front
// of the name: Chromium has no per-download directory of its own, only this.
//
// The segments are dropped rather than escaped. A page chooses nothing about this
// path, but the value reaches the browser as a path, and ".." is how a path stops
// being the folder someone meant.
const cleanDir = (dir) => String(dir || '').split('/')
  .filter((p) => p && p !== '.' && p !== '..').join('/');
const cleanName = (name) => String(name || '')
  .replace(/[\\/]+/g, '_').replace(/^\.+/, '').trim() || 'download';
const destPath = (dir, name) => {
  const d = cleanDir(dir);
  return d ? d + '/' + cleanName(name) : cleanName(name);
};

// Chromium reports where a file landed in full, so the folder a row belongs to is
// the part of that path below the profile's directory.
const DL_ROOT = '/downloads/';
const relOf = (abs) => {
  const s = String(abs || '');
  return s.indexOf(DL_ROOT) === 0 ? s.slice(DL_ROOT.length) : '';
};

// A fetch that never settles is worse than one that fails: the bar awaits this
// answer before it will accept another press, so a hung request leaves the REC
// button dead until the page is reloaded, with nothing on screen to say why.
const recCall = async (action) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch(`${API}/rec/${action}`, { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) throw new Error(`rec ${action}: HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `rec ${action}: no answer` : e.message);
  } finally {
    clearTimeout(timer);
  }
};

// Everything the panel needs to decide what to offer on a row. `state` alone is
// not enough: interrupted is four different situations (a dropped connection, a
// browser that closed, a full disk, a site that refused) and only one of them is
// worth retrying from here. canResume says whether the bytes already on disk can
// be reused, exactly says whether the finished file is still where it landed.
const shape = (d) => ({
  id: d.id,
  name: (d.filename || '').split('/').pop() || 'download',
  // The folder it was saved into, and its name under that folder: a row has to know
  // both, because PLAY, GET AGAIN and UNPACK all have to reach the same file again.
  rel: relOf(d.filename),
  dir: cleanDir(relOf(d.filename).split('/').slice(0, -1).join('/')),
  state: d.state,
  done: d.bytesReceived || 0,
  total: d.totalBytes || 0,
  error: d.error || '',
  reason: REASONS[d.error] || '',
  url: d.url || '',
  canResume: Boolean(d.canResume),
  fileSize: d.fileSize || 0,
  exists: d.exists,
  mime: d.mime || ''
});

// chrome.downloads reports errors as enum constants (CRASH, NETWORK_FAILED, ...).
// They went to the panel raw before, so a download interrupted by the browser
// closing read as the word "CRASH" with no explanation and no way forward.
const REASONS = {
  CRASH: 'the browser closed before it finished',
  NETWORK_FAILED: 'the connection dropped',
  NETWORK_TIMEOUT: 'the server stopped answering',
  NETWORK_DISCONNECTED: 'the network went away',
  NETWORK_SERVER_DOWN: 'the server is down',
  NETWORK_INVALID_REQUEST: 'the address was rejected',
  SERVER_FAILED: 'the server refused it',
  SERVER_NO_RANGE: 'the server does not allow resuming',
  SERVER_BAD_CONTENT: 'the server sent a damaged file',
  SERVER_UNAUTHORIZED: 'that site wants a login',
  SERVER_CERT_PROBLEM: 'the site certificate is not trusted',
  SERVER_FORBIDDEN: 'the site blocked the download',
  SERVER_UNREACHABLE: 'the site is not reachable from here',
  SERVER_CONTENT_LENGTH_MISMATCH: 'the file arrived short',
  SERVER_CROSS_ORIGIN_REDIRECT: 'the site redirected somewhere it will not share',
  FILE_NO_SPACE: 'the samples folder is full',
  FILE_ACCESS_DENIED: 'no permission to write there',
  FILE_NAME_TOO_LONG: 'that name is too long for the folder',
  FILE_TOO_LARGE: 'the file is bigger than the folder can hold',
  FILE_FAILED: 'the file could not be written',
  FILE_VIRUS_INFECTED: 'the browser flagged it',
  FILE_TRANSIENT_ERROR: 'the file was locked by something else',
  FILE_BLOCKED: 'the browser blocked the file',
  FILE_SECURITY_CHECK_FAILED: 'the browser would not verify the file',
  FILE_TOO_SHORT: 'the file arrived empty',
  FILE_HASH_MISMATCH: 'the file arrived corrupted',
  USER_CANCELED: 'you cancelled it',
  USER_SHUTDOWN: 'the device shut down mid-download',
  // Not enum constants. The panel asks for these itself when an action fails.
  GONE: 'that download is no longer in the list',
  NO_RETRY: 'this one was handed over by the page itself, so there is nothing to re-request'
};

const fail = (respond, e) => respond({ ok: false, error: REASONS[e] || String(e || 'that did not work') });

// Reads lastError. Without it Chromium logs an unchecked error for every call,
// and the bar gets `undefined` instead of a reason when something fails.
const errOf = (what) => {
  const e = chrome.runtime.lastError && chrome.runtime.lastError.message;
  return { ok: !e, error: e ? (what + ': ' + e) : undefined };
};

const withItem = (id, respond, fn) => {
  chrome.downloads.search({ id }, (items) => {
    const d = items && items[0];
    if (!d) return fail(respond, 'GONE');
    fn(d);
  });
};

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg) return false;

  if (msg.kind === 'downloads') {
    chrome.downloads.search({ orderBy: ['-startTime'], limit: 25 }, (items) => {
      void chrome.runtime.lastError;
      respond((items || []).map(shape));
    });
    return true;
  }

  // Stop a download that is running. Chromium keeps the partial file, so a
  // cancel followed by a retry resumes rather than starting the bytes again.
  if (msg.kind === 'dl-cancel') {
    chrome.downloads.cancel(msg.id, () => {
      const r = errOf('cancel');
      respond(r.error ? r : { ok: true });
    });
    return true;
  }

  // Retry is two different operations and the item decides which: resume the
  // bytes already on disk when the server still allows it, otherwise ask for the
  // file again. A blob: or data: URL only exists inside the page that made it, so
  // once that page is gone there is nothing to re-request.
  if (msg.kind === 'dl-retry') {
    withItem(msg.id, respond, (d) => {
      if (d.state === 'in_progress') return respond({ ok: false, error: 'still running' });

      // Chromium does not always continue an interrupted item in place: a resume
      // after a cancel comes back as a NEW item with a new id, and the old row
      // stays behind reading "you cancelled it" while the download runs right
      // above it. So after either kind of retry, look at the old id again and drop
      // it only if it is still sitting there interrupted.
      const eraseOld = () => chrome.downloads.erase({ id: msg.id }, () => respond({ ok: true }));
      const dropIfDead = () => chrome.downloads.search({ id: msg.id }, (items) => {
        const still = items && items[0];
        if (still && still.state === 'interrupted') return eraseOld();
        respond({ ok: true });
      });

      if (d.canResume) {
        chrome.downloads.resume(msg.id, () => {
          const r = errOf('resume');
          if (r.error) return respond(r);
          dropIfDead();
        });
        return;
      }
      if (!/^https?:/i.test(d.url || '')) return fail(respond, 'NO_RETRY');
      // Same folder and same name it was asked for the first time, or a retry would
      // quietly move a file the picker had already put somewhere.
      chrome.downloads.download({
        url: d.url, filename: relOf(d.filename) || undefined, conflictAction: 'uniquify'
      }, () => {
        const r = errOf('retry');
        if (r.error) return respond(r);
        // A fresh request replaces the row it was started from, interrupted or a
        // finished file that is no longer in the folder.
        eraseOld();
      });
    });
    return true;
  }

  // Remove a dead row from the list. This does not touch the file.
  if (msg.kind === 'dl-erase') {
    chrome.downloads.erase({ id: msg.id }, () => {
      const r = errOf('erase');
      respond(r.error ? r : { ok: true });
    });
    return true;
  }

  // Free space where downloads land. The bar cannot ask directly: it runs on the
  // page, so an https site makes this a mixed-content request.
  if (msg.kind === 'space') {
    fetch(`${API}/space?d=${encodeURIComponent(cleanDir(msg.dir))}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => respond(j))
      .catch((e) => respond({ ok: false, error: e.message }));
    return true;
  }

  // The folder downloads go to, and the way to change it. Kept on the device: the
  // page's own storage is per origin, so a choice made on one site would be gone
  // the moment the bar ran on another.
  if (msg.kind === 'dest') {
    fetch(`${API}/dest`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => respond(j))
      .catch((e) => respond({ ok: false, error: e.message }));
    return true;
  }
  if (msg.kind === 'dest-set') {
    fetch(`${API}/dest?d=${encodeURIComponent(cleanDir(msg.dir))}`, { method: 'POST', cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => respond(j))
      .catch((e) => respond({ ok: false, error: e.message }));
    return true;
  }

  // The folders a download can be sent to.
  if (msg.kind === 'dirs') {
    fetch(`${API}/dirs`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => respond(j))
      .catch((e) => respond({ ok: false, error: e.message }));
    return true;
  }

  // How big a file is, before the browser is asked for it. The device's server
  // makes the request rather than this worker: same machine either way, but Node
  // has no CORS to argue with and no page origin to be part of.
  if (msg.kind === 'probe') {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 16000);
    fetch(`${API}/probe?u=${encodeURIComponent(msg.url)}`, { cache: 'no-store', signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => respond(j))
      .catch((e) => respond({
        ok: false,
        error: e.name === 'AbortError' ? 'the site did not answer in time' : e.message
      }))
      .finally(() => clearTimeout(timer));
    return true;
  }

  // Start the download the bar has just been told to start. It comes from the
  // worker, not the page, because chrome.downloads is only here - and because the
  // folder the file lands in belongs to the profile.
  if (msg.kind === 'dl-start') {
    chrome.downloads.download({
      url: msg.url, filename: destPath(msg.dir, msg.name), conflictAction: 'uniquify'
    }, (id) => {
      const r = errOf('download');
      if (r.error) return respond(r);
      respond({ ok: true, id });
    });
    return true;
  }

  // Unpacking a downloaded zip happens on the device, next to the sample folder,
  // so it is the same story as the recorder: the page cannot reach 127.0.0.1 on
  // an https site (cross-origin, and mixed content on top of that), the worker
  // can. The answer is the job; progress is a separate poll because an unpack is
  // hundreds of files and a request that waits for it would just time out.
  if (msg.kind === 'unpack' || msg.kind === 'unpack-status') {
    const route = msg.kind === 'unpack' ? 'unpack' : 'unpack/status';
    fetch(`${API}/${route}?f=${encodeURIComponent(msg.rel || msg.name)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => respond(j))
      .catch((e) => respond({ state: 'failed', error: e.message }));
    return true;
  }

  // Delete a pack that has already been unpacked. The server decides whether it may:
  // only a zip it finished unpacking is deletable, so a mistake here cannot remove
  // anything but the archive the unpacked folder came from.
  if (msg.kind === 'rm') {
    fetch(`${API}/rm?f=${encodeURIComponent(msg.rel || '')}`, { method: 'POST', cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => respond(j))
      .catch((e) => respond({ ok: false, error: 'could not reach the device: ' + e.message }));
    return true;
  }

  if (msg.kind === 'rec') {
    recCall(msg.action)
      .then((j) => respond(j))
      .catch((e) => respond({ ok: false, error: e.message }));
    return true;
  }

  return false;
});
