/**
 * The self-test's containment is only as good as its egress guard, so the guard
 * is tested on its own: a child process with the guard preloaded must reach
 * loopback, must be refused everywhere else, and must log what it was refused.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const guard = path.resolve(here, '../self-test/egressGuard.cjs');

const childScript = `
const http = require('node:http');
const net = require('node:net');
const server = http.createServer((_q, r) => r.end('ok')).listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const local = await fetch('http://127.0.0.1:' + port).then((r) => r.text());
  const external = await fetch('https://example.com/').then(() => 'reached', (e) => 'blocked');
  const sock = await new Promise((resolve) => {
    const s = net.connect(80, '203.0.113.9');
    s.on('error', (e) => resolve('blocked ' + e.code));
    s.on('connect', () => resolve('reached'));
  });
  const named = await new Promise((resolve) => require('node:dns').lookup('collectrx-selftest.invalid.example', (e) => resolve(e ? 'blocked' : 'reached')));
  console.log(JSON.stringify({ local, external, sock, named }));
  server.close();
});
`;

describe('self-test egress guard', () => {
  it('lets loopback through, refuses every other destination, and logs each refusal', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'egress-guard-'));
    const log = path.join(dir, 'egress.log');
    try {
      const run = spawnSync(process.execPath, ['--require', guard, '-e', childScript], {
        env: { PATH: process.env.PATH ?? '', SELFTEST_EGRESS_LOG: log },
        encoding: 'utf8',
        timeout: 20_000,
      });
      expect(run.status, run.stderr).toBe(0);
      const result = JSON.parse(run.stdout.trim().split('\n').pop() ?? '{}') as Record<string, string>;
      expect(result.local).toBe('ok');
      expect(result.external).toBe('blocked');
      expect(result.sock).toMatch(/^blocked/u);
      expect(result.named).toBe('blocked');

      expect(existsSync(log)).toBe(true);
      const entries = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { kind: string; target: string });
      const targets = entries.map((e) => e.target);
      expect(targets).toContain('example.com');
      expect(targets).toContain('203.0.113.9');
      expect(targets).toContain('collectrx-selftest.invalid.example');
      expect(targets.every((t) => t !== '127.0.0.1' && t !== 'localhost')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
