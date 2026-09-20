/**
 * P0.1 completion — the parts of runGracefulShutdownSequence() that need
 * controlled/failing dependencies to exercise: the force-exit-on-timeout
 * path, close-in-dependency-order guarantee, and correlation-ID tracing.
 * deskWs.js and queueEngine.js are mocked here (unlike
 * gracefulShutdownSequence.test.ts, which deliberately uses the real ones)
 * so their timing/failure can be controlled precisely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';

describe('runGracefulShutdownSequence — timeout, ordering, tracing', () => {
  const calls: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    calls.length = 0;
    vi.doMock('../src/server/frontDesk/deskWs.js', () => ({
      attachDeskWebSocket: vi.fn(),
      broadcastDesk: vi.fn(),
      closeAllDeskConnections: vi.fn(() => {
        calls.push('closeAllDeskConnections');
      }),
    }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function importIndexWithQueueEngineMock(drainImpl: () => Promise<void>) {
    vi.doMock('../src/server/frontDesk/queueEngine.js', () => ({
      startDeskQueueEngine: vi.fn(),
      drainDeskQueueEngine: vi.fn(async () => {
        calls.push('drainDeskQueueEngine:start');
        await drainImpl();
        calls.push('drainDeskQueueEngine:end');
      }),
    }));
    return import('../src/server/index.js');
  }

  it('returns timedOut: true and does not throw if the sequence hangs past totalTimeoutMs', async () => {
    const mod = await importIndexWithQueueEngineMock(
      () => new Promise(() => {
        /* never resolves — simulates a hung desk queue drain */
      }),
    );
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const start = Date.now();
    const result = await mod.runGracefulShutdownSequence(server, {
      jobTimeoutMs: 50,
      totalTimeoutMs: 80,
      correlationId: 'test-timeout',
      signal: 'SIGTERM',
    });
    const elapsed = Date.now() - start;

    expect(result.timedOut).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(1000);
    expect(mod.exitCodeForShutdownResult(result)).toBe(1);
  });

  it('returns timedOut: false and exit code 0 when everything closes within the timeout', async () => {
    const mod = await importIndexWithQueueEngineMock(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    vi.spyOn(mod.prisma, '$disconnect').mockResolvedValue(undefined);

    const result = await mod.runGracefulShutdownSequence(server, {
      jobTimeoutMs: 5_000,
      totalTimeoutMs: 5_000,
      correlationId: 'test-happy',
      signal: 'SIGTERM',
    });

    expect(result.timedOut).toBe(false);
    expect(mod.exitCodeForShutdownResult(result)).toBe(0);
  });

  it('closes in dependency order: WS clients, then desk queue drain, then HTTP server, then Prisma', async () => {
    const mod = await importIndexWithQueueEngineMock(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));

    const originalClose = server.close.bind(server);
    vi.spyOn(server, 'close').mockImplementation((cb?: (err?: Error) => void) => {
      calls.push('server.close:start');
      return originalClose((err?: Error) => {
        calls.push('server.close:end');
        cb?.(err);
      });
    });
    vi.spyOn(mod.prisma, '$disconnect').mockImplementation(async () => {
      calls.push('prisma.$disconnect');
    });

    await mod.runGracefulShutdownSequence(server, {
      jobTimeoutMs: 5_000,
      totalTimeoutMs: 5_000,
      correlationId: 'test-order',
      signal: 'SIGTERM',
    });

    const order = calls.filter((c) =>
      ['closeAllDeskConnections', 'drainDeskQueueEngine:end', 'server.close:end', 'prisma.$disconnect'].includes(c),
    );
    expect(order).toEqual([
      'closeAllDeskConnections',
      'drainDeskQueueEngine:end',
      'server.close:end',
      'prisma.$disconnect',
    ]);
  });

  it('tags every shutdown log line with the same correlation ID', async () => {
    const mod = await importIndexWithQueueEngineMock(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    vi.spyOn(mod.prisma, '$disconnect').mockResolvedValue(undefined);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await mod.runGracefulShutdownSequence(server, {
        jobTimeoutMs: 5_000,
        totalTimeoutMs: 5_000,
        correlationId: 'trace-me-123',
        signal: 'SIGTERM',
      });

      // logger.info() emits one JSON string per line (see observability/logger.ts) —
      // parse each console.log call's single string argument rather than
      // checking (msg, meta) as separate positional arguments.
      const shutdownLogLines = logSpy.mock.calls
        .map((args) => args[0])
        .filter((arg): arg is string => typeof arg === 'string')
        .map((line) => JSON.parse(line) as { msg: string; correlationId?: string })
        .filter((parsed) => parsed.msg.includes('[server]') && /shutdown/i.test(parsed.msg));

      expect(shutdownLogLines.length).toBeGreaterThanOrEqual(2); // start + complete
      for (const parsed of shutdownLogLines) {
        expect(parsed.correlationId).toBe('trace-me-123');
      }
    } finally {
      logSpy.mockRestore();
    }
  });
});
