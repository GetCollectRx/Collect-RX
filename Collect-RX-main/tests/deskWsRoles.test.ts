/**
 * Who may open the desk socket. Front desk users always may. Anyone else only when the practice has designated
 * them, so the rep-on-the-line alert follows the person the practice chose and not a job title.
 */
import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { WebSocket } from 'ws';
const { getSettings } = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock('../src/server/services/practiceSettingsService.js', () => ({ getPracticeSettings: getSettings }));
vi.mock('../src/server/db/rlsContext.js', () => ({ runWithRlsBypass: <T>(fn: () => T) => fn() }));

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
  it('always admits front desk, and refuses everyone else who is not designated', async () => {
    getSettings.mockResolvedValue({ designatedIndividualUserId: null });
    const { server, port } = await start();
    try {
      expect(await outcome(port, 'front_desk')).toEqual({ firstMessage: 'connected', closeCode: null });
      for (const role of ['practice_owner', 'office_manager', 'billing_coordinator', 'accountant', 'group_admin'] as const) {
        expect(await outcome(port, role)).toEqual({ firstMessage: null, closeCode: 4403 });
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('admits the person the practice designated, whatever their role', async () => {
    getSettings.mockResolvedValue({ designatedIndividualUserId: 'u-1' });
    const { server, port } = await start();
    try {
      expect(await outcome(port, 'office_manager')).toEqual({ firstMessage: 'connected', closeCode: null });
      expect(await outcome(port, 'practice_owner')).toEqual({ firstMessage: 'connected', closeCode: null });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('refuses someone who is not the designated person', async () => {
    getSettings.mockResolvedValue({ designatedIndividualUserId: 'someone-else' });
    const { server, port } = await start();
    try {
      expect(await outcome(port, 'office_manager')).toEqual({ firstMessage: null, closeCode: 4403 });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
