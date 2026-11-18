/**
 * Structured auth events for production diagnosis.
 *
 * Until now a failed sign-in or a rejected session left no trace in the logs, so a
 * "signs in then bounces to login" report could not be investigated from production.
 * These events carry the outcome and reason only. They never carry the email address,
 * password, token, or URL query string (which can hold patient or claim identifiers):
 * the email is reduced to a short one-way fingerprint so repeated attempts can be
 * correlated without storing the address.
 */
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { logger } from './logger.js';

export function emailFingerprint(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 12);
}

function pathOnly(req: Request): string {
  const raw = `${req.baseUrl ?? ''}${req.path ?? ''}`;
  return raw.split('?')[0] || '/';
}

export type LoginOutcome =
  | 'success'
  | 'no_such_active_user'
  | 'wrong_password'
  | 'accountant_access_expired'
  | 'sso_required';

export function logLoginEvent(outcome: LoginOutcome, email: string): void {
  const meta = { outcome, emailFp: emailFingerprint(email) };
  if (outcome === 'success') logger.info('[auth] login', meta);
  else logger.warn('[auth] login rejected', meta);
}

export type SessionRejectReason =
  | 'no_token'
  | 'invalid_token'
  | 'token_without_practice'
  | 'user_missing_or_inactive'
  | 'practice_mismatch'
  | 'accountant_expired'
  | 'session_lookup_failed';

export function logSessionRejected(req: Request, reason: SessionRejectReason, userId?: string): void {
  logger.warn('[auth] session rejected', {
    reason,
    path: pathOnly(req),
    method: req.method,
    userIdPrefix: userId ? userId.slice(0, 8) : undefined,
  });
}
