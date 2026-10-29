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

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (!msg) return false;

  if (msg.kind === 'downloads') {
    chrome.downloads.search({ orderBy: ['-startTime'], limit: 25 }, (items) => {
      respond((items || []).map((d) => ({
        id: d.id,
        name: (d.filename || '').split('/').pop() || 'download',
        state: d.state,
        done: d.bytesReceived || 0,
        total: d.totalBytes || 0,
        error: d.error || ''
      })));
    });
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
