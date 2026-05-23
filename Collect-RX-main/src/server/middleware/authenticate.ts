/* eslint-disable @typescript-eslint/no-namespace -- standard Express `Request` augmentation */
import type { Request, Response, NextFunction } from 'express';
import { COOKIE_NAME, verifyAuthToken } from '../authToken';
import type { AuthJwtPayload, UserAuthPayload } from '../accessControl/types.js';
import { assertPhiRouteAllowed } from '../accessControl/phiRoutes.js';
import { expandMirroredCollectRxOrigins, readAllowedOriginsRaw } from '../corsAllowedOrigins';

declare global {
  namespace Express {
    interface Request {
      /** Set by `authenticate` after a valid JWT. */
      auth?: AuthJwtPayload;
      /** @deprecated Use `auth` — still set for practice sessions during migration. */
      practiceAuth?: UserAuthPayload;
    }
  }
}

/**
 * Accepts token from httpOnly cookie (preferred) or `Authorization: Bearer <jwt>`.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  try {
    const header = req.headers.authorization;
    const fromBearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const fromCookie = req.cookies?.[COOKIE_NAME] as string | undefined;
    const raw = fromBearer || fromCookie;
    if (!raw) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const payload = verifyAuthToken(raw);

    // Legacy guard: practice-layer tokens must carry practiceId
    if (payload.role !== 'platform_dev' && !(payload as UserAuthPayload).practiceId) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    req.auth = payload;
    // Keep practiceAuth in sync for routes still referencing it
    if (payload.role !== 'platform_dev') {
      req.practiceAuth = payload as UserAuthPayload;
    }

    const phiBlock = assertPhiRouteAllowed(payload, req);
    if (phiBlock) {
      res.status(403).json({ error: phiBlock });
      return;
    }

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function parseAllowedOrigins(): string[] {
  const fromEnv = readAllowedOriginsRaw()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return expandMirroredCollectRxOrigins(fromEnv);
  return [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
  ];
}

export { parseAllowedOrigins };
