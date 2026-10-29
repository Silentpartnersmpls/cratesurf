// Loopback-only control endpoint for the kiosk page.
//
// Chromium has no address bar in kiosk mode and the MPC's hardware BACK button
// belongs to the MPC app, which is stopped while browsing. This is the way out:
// the home page's EXIT button navigates here and the browse stack tears itself
// down and hands the panel back to the MPC.
//
// Bound to 127.0.0.1 so nothing on the LAN can hit it.
const http = require('http');
const { execFile } = require('child_process');

const PORT = 8799;
const DOWN = '/data/browser/bin/browse-down.sh';

http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/exit') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('leaving browse mode\n');
    // Answer first, then tear down: the teardown kills the browser that asked.
    setTimeout(() => execFile('/bin/sh', [DOWN], (err, out, errout) => {
      if (err) console.error('browse-down failed', err.message, errout);
      else console.log(out.trim());
    }), 250);
    return;
  }
  if (req.url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ mode: 'browse', pid: process.pid }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`exit server on 127.0.0.1:${PORT}`));
