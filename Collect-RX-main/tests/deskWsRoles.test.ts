/**
 * Who may open the desk socket. The rep-on-the-line alert reaches the roles that can mark themselves available.
 */
import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
import { attachDeskWebSocket } from '../src/server/frontDesk/deskWs.js';
import { COOKIE_NAME, signUserToken } from '../src/server/authToken.js';

async function start(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer();
  attachDeskWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  return { server, port: typeof address === 'object' && address ? address.port : 0 };
}

function outcome(port: number, role: 'front_desk' | 'practice_owner' | 'office_manager' | 'billing_coordinator' | 'accountant' | 'group_admin'): Promise<{ firstMessage: string | null; closeCode: number | null }> {
  const token = signUserToken({ userId: 'u-1', practiceId: 'p-1', role });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/desk`, { headers: { Cookie: `${COOKIE_NAME}=${token}` } });
  return new Promise((resolve) => {
    let firstMessage: string | null = null;
    ws.on('message', (data: Buffer) => {
      firstMessage = (JSON.parse(data.toString()) as { type: string }).type;
      ws.close();
    });
    ws.on('close', (code: number) => resolve({ firstMessage, closeCode: firstMessage ? null : code }));
    ws.on('error', () => resolve({ firstMessage, closeCode: -1 }));
  });
}

describe('desk socket roles', () => {
  it('admits the roles that can take a live rep and refuses accountants and group admins', async () => {
    const { server, port } = await start();
    try {
      // The token carries a brief role: office manager, billing coordinator and associate dentist all collapse to practice_owner.
      for (const role of ['front_desk', 'practice_owner', 'office_manager', 'billing_coordinator'] as const) {
        expect(await outcome(port, role)).toEqual({ firstMessage: 'connected', closeCode: null });
      }
      for (const role of ['accountant', 'group_admin'] as const) {
        expect(await outcome(port, role)).toEqual({ firstMessage: null, closeCode: 4403 });
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
