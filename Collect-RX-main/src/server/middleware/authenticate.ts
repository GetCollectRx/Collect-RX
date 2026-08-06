/* eslint-disable @typescript-eslint/no-namespace -- standard Express `Request` augmentation */
import type { Request, Response, NextFunction } from 'express';
import { COOKIE_NAME, verifyAuthToken } from '../authToken';
import { getUserRole, type AuthJwtPayload, type UserAuthPayload, type BriefAuthFields } from '../accessControl/types.js'
import { assertPhiRouteAllowed } from '../accessControl/phiRoutes.js';
import { practiceIdFromRequestHints } from '../accessControl/practiceContext.js';
import { runWithRlsContext } from '../db/rlsContext.js';
import { expandMirroredCollectRxOrigins, readAllowedOriginsRaw } from '../corsAllowedOrigins';
import { prisma } from '../../lib/prisma.js';

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

function continueWithRls(req: Request, next: NextFunction): void {
  const auth = req.auth;
  if (!auth) {
    next();
    return;
  }
  const hinted = practiceIdFromRequestHints(req);
  const sessionPracticeId =
    auth.role !== 'platform_dev' && 'practiceId' in auth
      ? (auth as UserAuthPayload).practiceId
      : undefined;
  const practiceId = sessionPracticeId ?? hinted;
  if (practiceId) {
    runWithRlsContext({ practiceId }, () => next());
    return;
  }
  runWithRlsContext({ bypass: true }, () => next());
}

/**
 * Accepts token from httpOnly cookie (preferred) or `Authorization: Bearer <jwt>`.
 * Also enforces accountant tokenExpiresAt against the DB on every request.
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
    const briefRole = getUserRole(payload);
    // Auditors are provisioned with practiceId: null and scoped instead via
    // AuditorGrant (see set-persona-test-passwords.mjs) — they were missing
    // here, so every real auditor session 401'd on the very first request
    // after login (GET /api/auth/me, which every page load triggers), even
    // though login itself succeeded. See OUTSTANDING-FIXES-PRODUCT-READY.md
    // P10-09.
    const crossPractice =
      briefRole === 'billing_ops_manager' ||
      briefRole === 'platform_admin' ||
      briefRole === 'auditor' ||
      payload.role === 'platform_dev';

    if (payload.role !== 'platform_dev' && !crossPractice && !(payload as UserAuthPayload).practiceId) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    req.auth = payload;
    if (payload.role !== 'platform_dev') {
      req.practiceAuth = payload as UserAuthPayload;
    }

    const phiBlock = assertPhiRouteAllowed(payload, req);
    if (phiBlock) {
      res.status(403).json({ error: phiBlock });
      return;
    }

    // Accountant token expiry — must be checked against DB since the JWT itself
    // has a 90-day TTL but the practice can revoke access before that via tokenExpiresAt.
    // Only for real practice-layer accountants: auditor (a PlatformUser, different
    // table entirely) also carries the legacy role: 'accountant' via
    // signBriefSessionToken's PracticeRoleMap, so without the platformUserSession
    // guard this looked up a PlatformUser's id in the practice `User` table, found
    // nothing, and 401'd every real auditor session on their first authenticated
    // request. See OUTSTANDING-FIXES-PRODUCT-READY.md P10-09.
    if (payload.role === 'accountant' && !(payload as BriefAuthFields).platformUserSession) {
      const userId = (payload as UserAuthPayload).userId;
      prisma.user.findUnique({ where: { id: userId }, select: { tokenExpiresAt: true, isActive: true } })
        .then((user) => {
          if (!user || !user.isActive) {
            res.status(401).json({ error: 'Account is no longer active' });
            return;
          }
          if (user.tokenExpiresAt && user.tokenExpiresAt < new Date()) {
            res.status(401).json({ error: 'Account access has expired. Contact your Office Manager to renew.' });
            return;
          }
          continueWithRls(req, next);
        })
        .catch(() => {
          // Fail CLOSED: if we cannot confirm the accountant's access is still valid
          // (active + not expired), deny rather than grant PHI access on a DB hiccup.
          res.status(503).json({ error: 'Unable to verify access right now. Please retry.' });
        });
      return;
    }

    continueWithRls(req, next);
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
