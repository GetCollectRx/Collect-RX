'use strict';

/**
 * Serves the packaged React build locally and proxies /api + /ws to Fly.
 * Same-origin UI → proxy → collect-rx.fly.dev (Bearer auth from desktop client).
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const rel = decoded.replace(/^\/+/, '');
  const target = path.normalize(path.join(root, rel));
  if (!target.startsWith(path.normalize(root))) return null;
  return target;
}

function serveStatic(distDir, req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  let filePath = safeJoin(distDir, urlPath);
  if (!filePath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(data);
  });
}

function proxyHttp(distDir, apiOrigin, req, res) {
  const target = new URL(req.url, apiOrigin);
  const transport = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };
  delete headers.connection;

  const proxyReq = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end('Upstream API unavailable');
  });
  req.pipe(proxyReq);
}

function proxyWebSocket(apiOrigin, req, socket, head) {
  const target = new URL(req.url, apiOrigin);
  const transport = target.protocol === 'https:' ? https : http;
  const proxyReq = transport.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    method: req.method,
    path: `${target.pathname}${target.search}`,
    headers: { ...req.headers, host: target.host },
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    socket.write(
      `HTTP/1.1 ${proxyRes.statusCode || 101} ${proxyRes.statusMessage || 'Switching Protocols'}\r\n` +
        Object.entries(proxyRes.headers)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') +
        '\r\n\r\n',
    );
    if (proxyHead && proxyHead.length) proxySocket.write(proxyHead);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('error', () => socket.destroy());
  proxyReq.end();
}

/**
 * @param {{ distDir: string; apiOrigin: string; port?: number }} opts
 * @returns {Promise<{ port: number; close: () => Promise<void> }>}
 */
function startDesktopServer(opts) {
  const distDir = opts.distDir;
  const apiOrigin = opts.apiOrigin.replace(/\/$/, '');
  const preferred = opts.port || 17341;

  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    return Promise.reject(new Error(`Desktop UI bundle missing: ${distDir}/index.html`));
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const p = req.url || '/';
      if (p.startsWith('/api') || p.startsWith('/health')) {
        proxyHttp(distDir, apiOrigin, req, res);
        return;
      }
      serveStatic(distDir, req, res);
    });

    server.on('upgrade', (req, socket, head) => {
      const p = req.url || '';
      if (p.startsWith('/ws')) {
        proxyWebSocket(apiOrigin, req, socket, head);
        return;
      }
      socket.destroy();
    });

    server.on('error', reject);

    server.listen(preferred, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

module.exports = { startDesktopServer };
