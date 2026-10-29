// Download state and recorder control for the on-page bar.
//
// chrome.downloads is only available to extension pages, so the content script
// asks this worker. The recorder is the same story for a different reason: the bar
// runs inside whatever site is on screen, and a fetch from there to 127.0.0.1
// would be cross-origin (and blocked outright as mixed content on an https page).
// From the worker, with host_permissions for that origin, it is allowed.
const API = 'http://127.0.0.1:8798';

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
      chrome.downloads.download({ url: d.url, conflictAction: 'uniquify' }, () => {
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
    fetch(`${API}/space`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => respond(j))
      .catch((e) => respond({ ok: false, error: e.message }));
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
