// ─────────────────────────────────────────────────────────────────────────────
// Strict TLS options for Node.js https.createServer (terminating TLS in-process).
//
// Typical Fly / reverse-proxy setups terminate TLS at the edge; leave
// TLS_KEY_PATH / TLS_CERT_PATH unset and keep listening on HTTP behind the proxy.
// Use this when you attach certs directly to Node (on-prem, sidecar, or custom VM).
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import type { ServerOptions } from 'node:https';

/** Forward-secrecy oriented suites for TLS 1.2 fallback paths (OpenSSL names). */
const STRICT_CIPHERS = [
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
].join(':');

/**
 * Build https.ServerOptions with min TLS 1.2, TLS 1.3 allowed, and a tight cipher list.
 * Reads PEM key + cert from disk synchronously at listen time.
 */
export function loadTlsCredentialsForNodeServer(keyPath: string, certPath: string): ServerOptions {
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.3',
    ciphers: STRICT_CIPHERS,
    honorCipherOrder: true,
  };
}
