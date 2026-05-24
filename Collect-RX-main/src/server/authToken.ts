import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import type {
  AuthJwtPayload,
  PracticeRole,
  UserAuthPayload,
  PlatformDevAuthPayload,
} from './accessControl/types.js';
import { practiceRoleToBrief } from './accessControl/types.js';
import type { UserRole } from '../types/userRole.js';

export const COOKIE_NAME = 'crx_access';

/** @deprecated Use `UserAuthPayload` — kept for importers that referenced the old name. */
export type PracticeJwtPayload = UserAuthPayload;
/** @deprecated Use `UserAuthPayload` — kept for importers that referenced the old name. */
export type PracticeAuthPayload = UserAuthPayload;

function signingSecret(): string {
  if (process.env.NODE_ENV === 'production') {
    const s = process.env.JWT_SECRET;
    if (!s) throw new Error('JWT_SECRET is required in production');
    return s;
  }
  return process.env.JWT_SECRET || 'dev-collectrx-jwt-not-for-production';
}

/** Call once at process startup in production. */
export function assertJwtConfigAtStartup(): void {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is required in production');
    }
  }
}

function crossSiteAuthCookie(): boolean {
  const v = (process.env.AUTH_COOKIE_CROSS_SITE || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function cookieOptions(maxAgeMs = 8 * 60 * 60 * 1000): CookieOptions {
  if (crossSiteAuthCookie()) {
    return { httpOnly: true, sameSite: 'none', secure: true, path: '/', maxAge: maxAgeMs };
  }
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeMs,
  };
}

/** PHI access rules per practice role. */
function phiAccessForRole(role: PracticeRole): boolean {
  switch (role) {
    case 'practice_owner':
    case 'office_manager':
    case 'billing_coordinator':
    case 'associate_dentist':
    case 'front_desk':
      return true;
    case 'accountant':
    case 'group_admin':
      return false;
  }
}

/** TTL for each role. Accountants get a 90-day token; everyone else gets 8 hours. */
function tokenTtlForRole(role: PracticeRole): string {
  return role === 'accountant' ? '90d' : '8h';
}

// ─── Sign ────────────────────────────────────────────────────────────────────

export interface SignUserTokenOptions {
  userId: string;
  practiceId: string;
  role: PracticeRole;
  providerId?: string;
}

export function signUserToken({ userId, practiceId, role, providerId }: SignUserTokenOptions): string {
  const payload = {
    role,
    userId,
    practiceId,
    phiAccess: phiAccessForRole(role),
    userRole: practiceRoleToBrief(role),
    ...(providerId ? { providerId } : {}),
  };
  return jwt.sign(payload, signingSecret(), { expiresIn: tokenTtlForRole(role) as unknown as number });
}

export function signPlatformDevToken(): string {
  const payload = {
    role: 'platform_dev' as const,
    phiAccess: false as const,
    userRole: 'platform_admin' as const,
    userId: 'platform-dev',
    practiceId: null,
  };
  return jwt.sign(payload, signingSecret(), { expiresIn: '8h' });
}

/** @deprecated Use signUserToken — kept for any callers that referenced the old practice token. */
export function signPracticeToken(practiceId: string): string {
  // Issues a dummy owner token for backward compat during migration.
  return signUserToken({
    userId: `legacy-${practiceId}`,
    practiceId,
    role: 'practice_owner',
  });
}

// ─── Verify ──────────────────────────────────────────────────────────────────

export function verifyAuthToken(token: string): AuthJwtPayload {
  const payload = jwt.verify(token, signingSecret()) as AuthJwtPayload;

  if (payload.role === 'platform_dev') {
    return {
      role: 'platform_dev',
      phiAccess: false,
      userRole: 'platform_admin',
      userId: (payload as { userId?: string }).userId ?? 'platform-dev',
      practiceId: null,
    };
  }

  // All other roles are practice-layer user sessions.
  const user = payload as UserAuthPayload;
  if (!user.userId || !user.practiceId) {
    throw new jwt.JsonWebTokenError('missing userId or practiceId');
  }
  const knownRoles: PracticeRole[] = [
    'practice_owner', 'office_manager', 'billing_coordinator',
    'front_desk', 'associate_dentist', 'accountant', 'group_admin',
  ];
  if (!knownRoles.includes(user.role)) {
    throw new jwt.JsonWebTokenError(`unknown role: ${String(user.role)}`);
  }
  return {
    role: user.role,
    userId: user.userId,
    practiceId: user.practiceId,
    phiAccess: phiAccessForRole(user.role),
    userRole: practiceRoleToBrief(user.role),
    ...(user.providerId ? { providerId: user.providerId } : {}),
  };
}

/** @deprecated Use verifyAuthToken */
export function verifyPracticeToken(token: string): UserAuthPayload {
  const p = verifyAuthToken(token);
  if (p.role === 'platform_dev') throw new jwt.JsonWebTokenError('not a practice token');
  return p as UserAuthPayload;
}

// ─── Cookie helpers ──────────────────────────────────────────────────────────

export function setUserAuthCookie(res: Response, opts: SignUserTokenOptions): void {
  const maxAge = opts.role === 'accountant'
    ? 90 * 24 * 60 * 60 * 1000
    : 8 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, signUserToken(opts), cookieOptions(maxAge));
}

/** @deprecated Use setUserAuthCookie */
export function setAuthCookie(res: Response, practiceId: string): void {
  setUserAuthCookie(res, { userId: `legacy-${practiceId}`, practiceId, role: 'practice_owner' });
}

export function signBriefSessionToken(input: {
  userRole: UserRole;
  userId: string;
  practiceId: string | null;
  phiAccess: boolean;
}): string {
  const practiceRoleMap: Partial<Record<UserRole, PracticeRole | 'platform_dev'>> = {
    front_desk: 'front_desk',
    practice_owner: 'practice_owner',
    auditor: 'accountant',
    billing_ops_manager: 'group_admin',
    platform_admin: 'platform_dev',
  };
  const mapped = practiceRoleMap[input.userRole];
  const payload =
    mapped === 'platform_dev'
      ? {
          role: 'platform_dev' as const,
          phiAccess: false as const,
          userRole: input.userRole,
          userId: input.userId,
          practiceId: null,
        }
      : {
          role: mapped ?? 'practice_owner',
          userId: input.userId,
          practiceId: input.practiceId ?? '',
          phiAccess: input.phiAccess,
          userRole: input.userRole,
        };
  return jwt.sign(payload, signingSecret(), { expiresIn: '8h' });
}

export function setPlatformDevAuthCookie(res: Response): void {
  res.cookie(COOKIE_NAME, signPlatformDevToken(), cookieOptions());
}

export function setBriefAuthCookie(
  res: Response,
  input: { userRole: UserRole; userId: string; practiceId: string | null; phiAccess: boolean },
): void {
  res.cookie(COOKIE_NAME, signBriefSessionToken(input), cookieOptions());
}


export function clearAuthCookie(res: Response): void {
  if (crossSiteAuthCookie()) {
    res.clearCookie(COOKIE_NAME, { path: '/', sameSite: 'none', secure: true });
    return;
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
}
