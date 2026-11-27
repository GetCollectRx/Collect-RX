import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws';
import { verifyAuthToken, COOKIE_NAME } from '../authToken.js';
import { getUserRole, authPracticeId, type AuthJwtPayload } from '../accessControl/types.js';
import { prisma } from '../../lib/prisma.js';
import { canConnectToDesk } from './deskAccess.js';
import type { WsEvent } from '../../types/ws.js';

type Client = { ws: WebSocket; practiceId: string };

const clients = new Set<Client>();
let acceptingConnections = true;

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

const WS_PATH = '/ws/desk';

export function attachDeskWebSocket(server: Server): WebSocketServer {
  // noServer + a manually path-scoped 'upgrade' listener, not the {server, path}
  // shortcut, ws's own handleUpgrade() calls abortHandshake(socket, 400) for any
  // request whose path doesn't match, on every upgrade the server gets, not just
  // ones aimed at this instance. That silently breaks any other WebSocketServer
  // sharing this same http.Server (see src/webhooks/holdParkAudioStream.ts).
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url !== WS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    if (!acceptingConnections) {
      ws.close(1001, 'Server shutting down');
      return;
    }

    // A malformed frame makes ws emit 'error' and close the socket itself. With
    // no listener, Node rethrows it as an uncaught exception, which takes the
    // whole API process down for every practice. Attached first, before the
    // token check and the awaited designated-user check, so no window is left.
    ws.on('error', (err: Error) => {
      console.warn('[deskWs] socket error, connection dropped:', err.message);
    });

    const token =
      parseCookie(req.headers.cookie, COOKIE_NAME) ??
      (typeof req.headers['sec-websocket-protocol'] === 'string'
        ? req.headers['sec-websocket-protocol']
        : null);

    if (!token) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    let auth: AuthJwtPayload;
    try {
      auth = verifyAuthToken(token);
    } catch {
      ws.close(4401, 'Unauthorized');
      return;
    }
    const practiceId = authPracticeId(auth);

    function admit(id: string) {
      // The designated-user check awaits the database, so shutdown may have
      // begun, or the client gone, since the connection was accepted.
      if (!acceptingConnections) {
        ws.close(1001, 'Server shutting down');
        return;
      }
      if (ws.readyState !== WebSocket.OPEN) return;
      const client: Client = { ws, practiceId: id };
      clients.add(client);

      ws.on('close', () => {
        clients.delete(client);
      });

      ws.send(JSON.stringify({ type: 'connected', data: { practiceId: id } }));
    }

    if (getUserRole(auth) === 'front_desk') {
      if (!practiceId) {
        ws.close(4401, 'Unauthorized');
        return;
      }
      admit(practiceId);
      return;
    }

    // Anyone else is admitted only when the practice has designated them to
    // receive the handoff alert.
    if (!practiceId) {
      ws.close(4403, 'Forbidden');
      return;
    }
    canConnectToDesk(prisma, auth).then(
      (allowed) => {
        if (allowed) admit(practiceId);
        else ws.close(4403, 'Forbidden');
      },
      () => ws.close(1011, 'Unavailable'),
    );
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

/**
 * Graceful-shutdown hook: stop accepting new /ws/desk connections and send
 * every currently-connected client a real 1001 "Going Away" close frame
 * instead of letting the process exit and abruptly reset their TCP
 * connections. Idempotent — safe to call once during shutdown.
 */
export function closeAllDeskConnections(): void {
  acceptingConnections = false;
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN || c.ws.readyState === WebSocket.CONNECTING) {
      c.ws.close(1001, 'Server shutting down');
    }
  }
  clients.clear();
}
