/**
 * Stand-in for api.vapi.ai during the self-test. Accepts every call the app
 * makes, records it, and never contacts anything. Admin routes (prefixed with
 * double underscore) let the test read what was "dialled".
 */
import http from 'node:http';

const port = Number(process.env.FAKE_VAPI_PORT ?? 3199);
const dials = [];
const other = [];
let counter = 0;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : null);
      } catch {
        resolve(text);
      }
    });
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/__dials') return send(200, { dials, other });
    if (url.pathname === '/__reset') {
      dials.length = 0;
      other.length = 0;
      return send(200, { ok: true });
    }
    if (url.pathname === '/__health') return send(200, { ok: true });
    const body = await readBody(req);
    if (req.method === 'POST' && url.pathname === '/call') {
      counter += 1;
      const id = `fake-call-${String(counter).padStart(4, '0')}`;
      dials.push({ at: new Date().toISOString(), id, body, authorization: req.headers.authorization ?? null });
      return send(201, { id, status: 'queued', createdAt: new Date().toISOString() });
    }
    other.push({ at: new Date().toISOString(), method: req.method, path: url.pathname, body });
    if (req.method === 'GET' && /^\/call\/[^/]+$/u.test(url.pathname)) {
      return send(200, { id: url.pathname.split('/')[2], status: 'ended', endedReason: 'customer-ended-call', startedAt: new Date().toISOString(), endedAt: new Date().toISOString() });
    }
    return send(200, {});
  })
  .listen(port, '127.0.0.1', () => console.warn(`[fake-vapi] listening on ${port}`));
