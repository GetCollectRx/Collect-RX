'use strict';
/**
 * Containment for the self-test: preloaded into the app server with
 * NODE_OPTIONS=--require. Any connection to a non-loopback address is refused
 * and logged, so a bug (or a forgotten third-party key) cannot reach the real
 * Vapi, Twilio, SendGrid, Stripe or anything else. The log is read at the end
 * of the run and must be empty.
 *
 * Covers Node sockets (http, https, tls, fetch, pg drivers) and DNS lookups.
 * It does not cover Prisma's native query engine, which only talks to the
 * local database given in DATABASE_URL.
 */
const fs = require('node:fs');
const net = require('node:net');
const dns = require('node:dns');

const LOG = process.env.SELFTEST_EGRESS_LOG || '/tmp/selftest-egress.log';
const LOCAL = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1', '0.0.0.0']);

function record(kind, target) {
  try {
    fs.appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), kind, target })}\n`);
  } catch {
    // The guard must never be the thing that crashes the app.
  }
}

function hostFromConnectArgs(args) {
  // net.connect() passes the prototype an already-normalized array, [options, callback].
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === 'object') {
    if (first.path) return null;
    return String(first.host || 'localhost');
  }
  if (typeof first === 'string' && Number.isNaN(Number(first))) return null; // unix socket path
  const second = args[1];
  return typeof second === 'string' ? second : 'localhost';
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const host = hostFromConnectArgs(args);
  if (host !== null && !LOCAL.has(host)) {
    record('connect', host);
    const err = Object.assign(new Error(`self-test egress blocked: ${host}`), { code: 'ECONNREFUSED' });
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return originalConnect.apply(this, args);
};

const originalLookup = dns.lookup;
dns.lookup = function guardedLookup(hostname, ...rest) {
  if (typeof hostname === 'string' && !LOCAL.has(hostname)) {
    record('dns', hostname);
    const cb = rest[rest.length - 1];
    const err = Object.assign(new Error(`self-test egress blocked: ${hostname}`), { code: 'ENOTFOUND', hostname });
    if (typeof cb === 'function') return process.nextTick(() => cb(err));
  }
  return originalLookup.call(this, hostname, ...rest);
};

if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    try {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const host = new URL(raw).hostname.replace(/^\[|\]$/g, '');
      if (!LOCAL.has(host)) {
        record('fetch', host);
        return Promise.reject(Object.assign(new Error(`self-test egress blocked: ${host}`), { code: 'ECONNREFUSED' }));
      }
    } catch {
      // A malformed URL falls through to the real fetch, which reports it.
    }
    return originalFetch.call(this, input, init);
  };
}
