/* eslint-disable @typescript-eslint/no-namespace -- standard Express `Request` augmentation */
import type { Request, Response, NextFunction } from 'express';
import { findActiveAgentByToken } from '../services/desktopConnectorService.js';
import { runWithRlsBypass, runWithRlsContext } from '../db/rlsContext.js';

declare global {
  namespace Express {
    interface Request {
      connectorAuth?: { practiceId: string; agentId: string };
    }
  }
}

/** Bearer token auth for practice desktop agents (opaque connector token). */
export async function authenticateConnector(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ success: false, error: 'Connector authentication required' });
      return;
    }
    // Token lookup must bypass RLS: there is no practice context yet (the token
    // is how we learn which practice this is), and the agents table is tenant-
    // scoped, so an unscoped read returns null and rejects every valid token.
    const agent = await runWithRlsBypass(() => findActiveAgentByToken(token));
    if (!agent) {
      res.status(401).json({ success: false, error: 'Invalid or revoked connector token' });
      return;
    }
    req.connectorAuth = { practiceId: agent.practiceId, agentId: agent.id };
    // Establish the tenant RLS scope for the rest of the request, mirroring the
    // session auth middleware — otherwise the import/heartbeat handlers read and
    // write zero rows under enforced RLS.
    runWithRlsContext({ practiceId: agent.practiceId }, () => next());
  } catch (err) {
    console.error('[authenticateConnector]', err);
    res.status(500).json({ success: false, error: 'Connector authentication failed' });
  }
}
