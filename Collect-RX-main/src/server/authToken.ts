import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { CookieOptions, Response } from 'express';
import { practiceRoleToBrief, type AuthJwtPayload, type PracticeRole, type UserAuthPayload, type BriefAuthFields } from './accessControl/types.js';
import type { UserRole } from '../types/userRole.js';

export const COOKIE_NAME = 'crx_access';
export const REFRESH_TOKEN_COOKIE_NAME = 'crx_refresh';

/** Pinned signing/verification algorithm — prevents alg-confusion and `alg:none` attacks. */
const JWT_ALGORITHM = 'HS256' as const;

/** Access token TTL: 15 minutes for all roles (short-lived, requires refresh for extended sessions) */
const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes in seconds

/** Refresh token TTL: 7 days (long-lived, rotated on each use) */
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

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

/** TTL for each role. All roles now use 15-minute access tokens with refresh token rotation. */
function tokenTtlForRole(_role: PracticeRole): number {
  return ACCESS_TOKEN_TTL;
}

// ─── Sign ────────────────────────────────────────────────────────────────────

export interface SignUserTokenOptions {
  userId: string;
  practiceId: string;
  role: PracticeRole;
  providerId?: string;
  jti?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export function signUserToken({ userId, practiceId, role, providerId, jti }: SignUserTokenOptions): string {
  const tokenJti = jti || crypto.randomBytes(16).toString('hex');
  const payload = {
    jti: tokenJti,
    role,
    userId,
    practiceId,
    phiAccess: phiAccessForRole(role),
    userRole: practiceRoleToBrief(role),
    ...(providerId ? { providerId } : {}),
  };
  return jwt.sign(payload, signingSecret(), {
    algorithm: JWT_ALGORITHM,
    expiresIn: tokenTtlForRole(role),
  });
}

/** Generate both access and refresh tokens for a user. */
export function generateTokenPair(opts: SignUserTokenOptions): TokenPair {
  const jti = crypto.randomBytes(16).toString('hex');
  const accessToken = signUserToken({ ...opts, jti });
  const refreshToken = jwt.sign(
    {
      jti,
      userId: opts.userId,
      practiceId: opts.practiceId,
      role: opts.role,
      type: 'refresh',
    },
    signingSecret(),
    {
      algorithm: JWT_ALGORITHM,
      expiresIn: REFRESH_TOKEN_TTL,
    }
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
  };
}

export function signPlatformDevToken(): string {
  const payload = {
    role: 'platform_dev' as const,
    phiAccess: false as const,
    userRole: 'platform_admin' as const,
    userId: 'platform-dev',
    practiceId: null,
  };
  return jwt.sign(payload, signingSecret(), { algorithm: JWT_ALGORITHM, expiresIn: '8h' });
}

// ─── Verify ──────────────────────────────────────────────────────────────────

export function verifyAuthToken(token: string): AuthJwtPayload {
  // Pin algorithms explicitly: never let a caller-supplied `alg` header (e.g. `none`
  // or an asymmetric algorithm) decide how the token is verified.
  const payload = jwt.verify(token, signingSecret(), { algorithms: [JWT_ALGORITHM] }) as AuthJwtPayload;

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
  const user = payload as UserAuthPayload & BriefAuthFields;
  const crossPractice =
    user.userRole === 'billing_ops_manager' || user.userRole === 'platform_admin';
  if (!user.userId || (!user.practiceId && !crossPractice)) {
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
    phiAccess: user.phiAccess ?? phiAccessForRole(user.role),
    userRole: user.userRole ?? practiceRoleToBrief(user.role),
    ...(user.providerId ? { providerId: user.providerId } : {}),
    ...(user.platformUserSession ? { platformUserSession: true } : {}),
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
  const practiceRoleMap: Partial<Record<UserRole, PracticeRole>> = {
    front_desk: 'front_desk',
    practice_owner: 'practice_owner',
    auditor: 'accountant',
    billing_ops_manager: 'group_admin',
    platform_admin: 'group_admin',
  };
  const mapped = practiceRoleMap[input.userRole] ?? 'practice_owner';
  const payload = {
    role: mapped,
    userId: input.userId,
    practiceId: input.practiceId ?? '',
    phiAccess: input.phiAccess,
    userRole: input.userRole,
    platformUserSession: true as const,
  };
  return jwt.sign(payload, signingSecret(), { algorithm: JWT_ALGORITHM, expiresIn: '8h' });
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
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/', sameSite: 'none', secure: true });
    return;
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, { path: '/' });
}

/** Check if a token JTI has been revoked (for logout/session invalidation). */
export async function isTokenRevoked(prisma: any, jti: string): Promise<boolean> {
  try {
    const revoked = await prisma.revokedToken.findUnique({ where: { jti } });
    return !!revoked;
  } catch {
    return false;
  }
}

/** Revoke a token by its JTI (called on logout). */
export async function revokeToken(prisma: any, jti: string): Promise<void> {
  try {
    await prisma.revokedToken.upsert({
      where: { jti },
      create: {
        jti,
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
      },
      update: {},
    });
  } catch (error) {
    // Log but don't throw — revocation failure should not break logout
    console.error('[authToken] Failed to revoke token:', error);
  }
}
