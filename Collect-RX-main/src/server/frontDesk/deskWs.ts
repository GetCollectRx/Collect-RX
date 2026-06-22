import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws';
import { verifyAuthToken, COOKIE_NAME } from '../authToken.js';
import { getUserRole, authPracticeId } from '../accessControl/types.js';
import type { WsEvent } from '../../types/ws.js';

type Client = { ws: WebSocket; practiceId: string };

const clients = new Set<Client>();

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function attachDeskWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/desk' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const token =
      parseCookie(req.headers.cookie, COOKIE_NAME) ??
      (typeof req.headers['sec-websocket-protocol'] === 'string'
        ? req.headers['sec-websocket-protocol']
        : null);

    if (!token) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    let practiceId: string;
    try {
      const auth = verifyAuthToken(token);
      const role = getUserRole(auth);
      if (role !== 'front_desk') {
        ws.close(4403, 'Forbidden');
        return;
      }
      if (!authPracticeId(auth)) {
        ws.close(4401, 'Unauthorized');
        return;
      }
      practiceId = authPracticeId(auth)!;
    } catch {
      ws.close(4401, 'Unauthorized');
      return;
    }

    const client: Client = { ws, practiceId };
    clients.add(client);

    ws.on('close', () => {
      clients.delete(client);
    });

    ws.send(JSON.stringify({ type: 'connected', data: { practiceId } }));
  });

  return wss;
}

export function broadcastDesk(practiceId: string, event: WsEvent): void {
  const payload = JSON.stringify(event);
  for (const c of clients) {
    if (c.practiceId !== practiceId) continue;
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(payload);
    }
  }
}
