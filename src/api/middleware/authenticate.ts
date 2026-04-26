import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { requestContext } from '../context';
import { AUTH_COOKIE } from '../cookies';
import type { JWTPayload, UserRole } from '../../types';

declare global {
  namespace Express {
    interface Request {
      practiceId?: string;
      userId?: string;
      role?: UserRole;
      patient?: import('../../types').Patient;
    }
  }
}

function getBearerToken(req: Request): string | undefined {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  const c = req.cookies?.[AUTH_COOKIE] as string | undefined;
  return c;
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Use session cookie or Bearer token.' });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as JWTPayload;
    req.practiceId = payload.practiceId;
    req.userId = payload.userId;
    req.role = payload.role;
    requestContext.run(
      { practiceId: payload.practiceId, userId: payload.userId, role: payload.role },
      next
    );
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.role !== 'platform_admin') {
    return res.status(403).json({ error: 'Platform admin access required.' });
  }
  next();
}
