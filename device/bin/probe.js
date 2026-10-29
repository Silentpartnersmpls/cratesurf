// What a link is, before anything is downloaded from it.
//
// A sample pack is often 300 MB and the only number on the page is whatever the
// site felt like printing, if anything. The browser cannot answer either: by the
// time chrome.downloads reports totalBytes the transfer is running, and on a 7"
// panel with a 16 GB card the question is worth a second's wait.
//
// So: one HEAD request. Servers that refuse HEAD (405, or a chunked reply with no
// length) get asked for a single byte instead, and Content-Range carries the
// total. The body is always cancelled - this asks a question, it does not fetch
// the file. Any failure is reported as a failure, never as a size of zero, so the
// bar can say "size unknown" rather than "0 B".
const PROBE_MS = 6000;

const unquote = (s) => String(s || '').trim().replace(/^"|"$/g, '');

// A failed probe is not the point of the card, so it has to fail in words. The
// first build passed Node's own error along and the panel read "could not reach
// the site: UND_ERR_SOCKET", which is a runtime's name for a problem the person
// holding the MPC cannot act on.
const WHY = {
  ENOTFOUND: 'the site name does not resolve',
  EAI_AGAIN: 'the name server did not answer',
  ECONNREFUSED: 'the site refused the connection',
  ECONNRESET: 'the connection was cut',
  EPIPE: 'the connection was cut',
  ETIMEDOUT: 'the site did not answer in time',
  EHOSTUNREACH: 'there is no route to that site from here',
  ENETUNREACH: 'there is no route to that site from here',
  UND_ERR_SOCKET: 'the connection was cut',
  UND_ERR_CONNECT_TIMEOUT: 'the site did not answer in time',
  CERT_HAS_EXPIRED: 'that site certificate has expired',
  ERR_TLS_CERT_ALTNAME_INVALID: 'the certificate does not belong to that site',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'the site uses a certificate this device does not trust',
  SELF_SIGNED_CERT_IN_CHAIN: 'the site uses a certificate this device does not trust',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the site certificate cannot be verified'
};

// undici buries the useful code one or two levels down (cause.cause), and the
// top-level message is always the useless "fetch failed".
const whyOf = (e) => {
  let c = e;
  for (let i = 0; i < 4 && c; i++) {
    if (c.code && WHY[c.code]) return WHY[c.code];
    c = c.cause;
  }
  return 'the connection failed';
};

const decoded = (s) => {
  try { return decodeURIComponent(s); } catch (_) { return s; }
};

// The name the browser will actually save it under, in Chromium's own order:
// Content-Disposition first (filename* before filename), then the path's last
// segment. A redirected URL is what gets read, because that is where the file is.
const nameOf = (res, url) => {
  const cd = res.headers.get('content-disposition') || '';
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/i.exec(cd);
  if (star) return decoded(unquote(star[1]));
  const plain = /filename\s*=\s*([^;]+)/i.exec(cd);
  if (plain) return unquote(plain[1]);
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (last) return decoded(last);
  } catch (_) {}
  return 'download';
};

async function probeLink(raw, timeoutMs = PROBE_MS) {
  let url;
  try { url = new URL(raw); } catch (_) { return { ok: false, error: 'that is not a link' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'only http and https links can be checked' };
  }

  const go = async (method, headers) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fetch(url, { method, headers, redirect: 'follow', signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  let res;
  try {
    res = await go('HEAD');
  } catch (e) {
    return {
      ok: false,
      error: e.name === 'AbortError'
        ? 'the site did not answer in time'
        : 'could not reach that site: ' + whyOf(e)
    };
  }

  const size = Number(res.headers.get('content-length')) || 0;
  const name = nameOf(res, res.url || url.href);

  if (!res.ok || !size) {
    try {
      const ranged = await go('GET', { Range: 'bytes=0-0' });
      const cr = /bytes\s+\d+-\d+\/(\d+)/i.exec(ranged.headers.get('content-range') || '');
      const total = cr ? Number(cr[1]) : Number(ranged.headers.get('content-length')) || 0;
      if (ranged.body) await ranged.body.cancel().catch(() => {});
      if (ranged.ok) {
        return {
          ok: true,
          name: nameOf(ranged, ranged.url || url.href),
          size: total || size,
          type: ranged.headers.get('content-type') || '',
          url: ranged.url || url.href
        };
      }
    } catch (_) { /* fall through to whatever the HEAD managed */ }
  }

  if (!res.ok) return { ok: false, error: `the site answered ${res.status}` };
  return { ok: true, name, size, type: res.headers.get('content-type') || '', url: res.url || url.href };
}

module.exports = { probeLink, nameOf };
