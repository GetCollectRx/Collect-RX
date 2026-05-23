import jwt from 'jsonwebtoken';
import type { CookieOptions, Response } from 'express';
import type { AuthJwtPayload, PracticeAuthPayload } from './accessControl/types.js';

const COOKIE_NAME = 'crx_access';

/** @deprecated Use `PracticeAuthPayload` — kept for importers that referenced the old name. */
export type PracticeJwtPayload = PracticeAuthPayload;

function signingSecret(): string {
  if (process.env.NODE_ENV === 'production') {
    const s = process.env.JWT_SECRET;
    if (!s) {
      throw new Error('JWT_SECRET is required in production');
    }
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

function cookieOptions(): CookieOptions {
  if (crossSiteAuthCookie()) {
    return {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      path: '/',
      maxAge: 8 * 60 * 60 * 1000, // 8h
    };
  }
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000, // 8h
  };
}

export function signPracticeToken(practiceId: string): string {
  const payload: PracticeAuthPayload = { practiceId, role: 'practice', phiAccess: true };
  return jwt.sign(payload, signingSecret(), { expiresIn: '8h' });
}

export function signPlatformDevToken(): string {
  const payload: AuthJwtPayload = { role: 'platform_dev', phiAccess: false };
  return jwt.sign(payload, signingSecret(), { expiresIn: '8h' });
}

export function verifyAuthToken(token: string): AuthJwtPayload {
  const payload = jwt.verify(token, signingSecret()) as AuthJwtPayload;
  if (payload.role === 'practice') {
    if (!payload.practiceId) throw new jwt.JsonWebTokenError('missing practiceId');
    return { role: 'practice', practiceId: payload.practiceId, phiAccess: true };
  }
  if (payload.role === 'platform_dev') {
    return { role: 'platform_dev', phiAccess: false };
  }
  throw new jwt.JsonWebTokenError('invalid role');
}

/** @deprecated Use `verifyAuthToken` */
export function verifyPracticeToken(token: string): PracticeAuthPayload {
  const p = verifyAuthToken(token);
  if (p.role !== 'practice') {
    throw new jwt.JsonWebTokenError('not a practice token');
  }
  return p;
}

export function setAuthCookie(res: Response, practiceId: string): void {
  res.cookie(COOKIE_NAME, signPracticeToken(practiceId), cookieOptions());
}

export function setPlatformDevAuthCookie(res: Response): void {
  res.cookie(COOKIE_NAME, signPlatformDevToken(), cookieOptions());
}

export function clearAuthCookie(res: Response): void {
  if (crossSiteAuthCookie()) {
    res.clearCookie(COOKIE_NAME, { path: '/', sameSite: 'none', secure: true });
    return;
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export { COOKIE_NAME };
