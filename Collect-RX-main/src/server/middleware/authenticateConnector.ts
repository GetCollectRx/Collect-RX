import type { Request, Response, NextFunction } from 'express';
import { findActiveAgentByToken } from '../services/desktopConnectorService.js';

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
    const agent = await findActiveAgentByToken(token);
    if (!agent) {
      res.status(401).json({ success: false, error: 'Invalid or revoked connector token' });
      return;
    }
    req.connectorAuth = { practiceId: agent.practiceId, agentId: agent.id };
    next();
  } catch (err) {
    console.error('[authenticateConnector]', err);
    res.status(500).json({ success: false, error: 'Connector authentication failed' });
  }
}
