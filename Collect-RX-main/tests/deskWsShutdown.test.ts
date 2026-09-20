/**
 * closeAllDeskConnections() must send every connected /ws/desk client a real
 * 1001 "Going Away" close frame (not an abrupt TCP reset) and refuse new
 * connections afterward. Kept in its own file — gracefulShutdown.test.ts
 * mocks deskWs.js wholesale for its queue-tick tests, and vi.doMock
 * registrations aren't cleared by vi.resetModules(), so they'd otherwise
 * shadow the real module here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('closeAllDeskConnections', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../src/server/authToken.js', () => ({
      COOKIE_NAME: 'crx_access',
      verifyAuthToken: () => ({ sub: 'user-1' }),
    }));
    vi.doMock('../src/server/accessControl/types.js', () => ({
      getUserRole: () => 'front_desk',
      authPracticeId: () => 'practice-1',
    }));
  });

  async function startRealDeskWsServer() {
    const http = await import('node:http');
    const mod = await import('../src/server/frontDesk/deskWs.js');
    const server = http.createServer();
    mod.attachDeskWebSocket(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return { server, mod, port };
  }

  it('sends a real 1001 close frame to every connected client', async () => {
    const { WebSocket } = await import('ws');
    const { server, mod, port } = await startRealDeskWsServer();

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/desk`, {
      headers: { Cookie: 'crx_access=fake-token-value' },
    });

    await new Promise<void>((resolve, reject) => {
      client.on('open', () => resolve());
      client.on('error', reject);
    });

    const closeEvent = new Promise<{ code: number; reason: string }>((resolve) => {
      client.on('close', (code: number, reasonBuf: Buffer) => {
        resolve({ code, reason: reasonBuf.toString() });
      });
    });

    mod.closeAllDeskConnections();

    const { code } = await closeEvent;
    expect(code).toBe(1001);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('refuses new connections after shutdown, closing them with 1001', async () => {
    const { WebSocket } = await import('ws');
    const { server, mod, port } = await startRealDeskWsServer();

    mod.closeAllDeskConnections();

    const client = new WebSocket(`ws://127.0.0.1:${port}/ws/desk`, {
      headers: { Cookie: 'crx_access=fake-token-value' },
    });

    const closeEvent = new Promise<number>((resolve, reject) => {
      client.on('close', (code: number) => resolve(code));
      client.on('error', reject);
    });

    expect(await closeEvent).toBe(1001);

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('is a safe no-op with zero connected clients', async () => {
    const mod = await import('../src/server/frontDesk/deskWs.js');
    expect(() => mod.closeAllDeskConnections()).not.toThrow();
  });
});
