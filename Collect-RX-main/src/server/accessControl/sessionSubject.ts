/**
 * Per-request confirmation that the signed session still describes a real,
 * currently-authorized subject.
 *
 * A JWT is valid for 8h (90d for accountants) and carries `practiceId` inside
 * the signature, so nothing in the token itself changes when staff deactivate
 * a user or move them to another location. Without this check, revocation in
 * the UI does not take effect until the token expires — for an accountant that
 * is up to 90 days of continued PHI access after access was withdrawn.
 *
 * Cached briefly: this runs on every authenticated request, and the lookup is
 * a primary-key read. The TTL bounds how long a revocation can lag on a
 * machine that did not serve the revoking request (each Fly machine holds its
 * own cache), so it is deliberately short rather than merely convenient.
 */
import { prisma } from '../../lib/prisma.js';
import { runWithRlsBypass } from '../db/rlsContext.js';
import {
  isCrossPracticeReader,
  isPlatformUserSession,
  type AuthJwtPayload,
  type UserAuthPayload,
} from './types.js';

export interface SessionSubjectResult {
  ok: boolean;
  /** HTTP status to return when `ok` is false. */
  status?: number;
  error?: string;
}

const OK: SessionSubjectResult = { ok: true };

function ttlMs(): number {
  const raw = Number(process.env.SESSION_SUBJECT_CACHE_MS ?? 10_000);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10_000;
}

interface CacheEntry {
  expiresAt: number;
  result: SessionSubjectResult;
}

const cache = new Map<string, CacheEntry>();

/** Drops a subject's cached verdict so a revocation takes effect immediately on this process. */
export function invalidateSessionSubject(userId: string): void {
  for (const key of [...cache.keys()]) {
    if (key === userId || key.startsWith(`${userId}:`)) cache.delete(key);
  }
}

export function clearSessionSubjectCache(): void {
  cache.clear();
}

function cacheKey(payload: AuthJwtPayload): string {
  const userId = 'userId' in payload ? payload.userId : 'unknown';
  const practiceId = 'practiceId' in payload ? (payload.practiceId ?? '') : '';
  const kind = isPlatformUserSession(payload) ? 'platform' : 'user';
  // practiceId is part of the key so a token claiming a different practice is
  // evaluated on its own merits rather than inheriting a valid token's verdict.
  return `${userId}:${kind}:${practiceId}`;
}

async function evaluate(payload: AuthJwtPayload): Promise<SessionSubjectResult> {
  // Bootstrap platform-dev login: authenticated by shared credential, no row.
  if (payload.role === 'platform_dev' && !isPlatformUserSession(payload)) return OK;

  const userId = 'userId' in payload ? payload.userId : undefined;
  if (!userId) return { ok: false, status: 401, error: 'Invalid session' };

  // Platform staff sessions resolve against platform_users, not practice users.
  if (isPlatformUserSession(payload)) {
    const platformUser = await runWithRlsBypass(() =>
      prisma.platformUser.findUnique({
        where: { id: userId },
        select: { active: true },
      }),
    );
    if (!platformUser?.active) {
      return { ok: false, status: 401, error: 'Account is no longer active' };
    }
    return OK;
  }

  const user = await runWithRlsBypass(() =>
    prisma.user.findUnique({
      where: { id: userId },
      select: { isActive: true, practiceId: true, tokenExpiresAt: true },
    }),
  );

  if (!user || !user.isActive) {
    return { ok: false, status: 401, error: 'Account is no longer active' };
  }

  if (user.tokenExpiresAt && user.tokenExpiresAt < new Date()) {
    return {
      ok: false,
      status: 401,
      error: 'Account access has expired. Contact your Office Manager to renew.',
    };
  }

  // A cross-practice reader legitimately operates outside a single practice —
  // its scope comes from a request hint, which RLS still constrains. Everyone
  // else must present the practice the user actually belongs to.
  if (!isCrossPracticeReader(payload)) {
    const tokenPracticeId = (payload as UserAuthPayload).practiceId;
    if (!tokenPracticeId || tokenPracticeId !== user.practiceId) {
      return { ok: false, status: 401, error: 'Session no longer valid for this practice' };
    }
  }

  return OK;
}

export async function validateSessionSubject(payload: AuthJwtPayload): Promise<SessionSubjectResult> {
  const key = cacheKey(payload);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.result;

  const result = await evaluate(payload);

  const ttl = ttlMs();
  if (ttl > 0) {
    // Negative verdicts are cached too — a revoked token being replayed in a
    // loop must not turn into one DB read per request.
    cache.set(key, { expiresAt: now + ttl, result });
    if (cache.size > 10_000) {
      for (const [k, v] of cache) {
        if (v.expiresAt <= now) cache.delete(k);
      }
    }
  }

  return result;
}
