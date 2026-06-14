// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Rate Limiter Middleware
//
// Four tiers:
//   authLimiter     —   5 req / 15 min per IP  (login — brute-force prevention)
//   strictLimiter   —  10 req / 1 min  per IP  (expensive writes)
//   standardLimiter — 120 req / 1 min per IP (anonymous), 600/min per signed-in user
//   webhookLimiter  — 300 req / 1 min  per IP  (Vapi can fire bursts)
//
// When REDIS_URL is set, all limiters use a Redis-backed store so counts are shared
// across multiple API processes (Railway horizontal scaling).
//
// All tiers return JSON 429 with Retry-After so clients can back off cleanly.
// ─────────────────────────────────────────────────────────────────────────────

import IORedis from 'ioredis';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import rateLimit, { ipKeyGenerator, type Options, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { COOKIE_NAME, verifyAuthToken } from '../authToken';

let rateLimitRedis: IORedis | null = null;
let loggedRedisStore = false;

function getOptionalRateLimitRedis(): IORedis | null {
  const url = (process.env.REDIS_URL || '').trim();
  if (!url) return null;
  if (!rateLimitRedis) {
    rateLimitRedis = new IORedis(url, { maxRetriesPerRequest: null });
  }
  return rateLimitRedis;
}

// Shared JSON 429 handler
function makeHandler(message: string) {
  return (_req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: message,
      retryAfter: res.getHeader('Retry-After'),
    });
  };
}

/** Per signed-in user when a valid session cookie is present; otherwise per client IP. */
function sessionOrIpKey(req: Request): string {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token === 'string' && token.length > 0) {
    try {
      const payload = verifyAuthToken(token);
      const userId =
        'userId' in payload && typeof payload.userId === 'string'
          ? payload.userId
          : payload.role;
      return `sess:${userId}`;
    } catch {
      /* fall through to IP */
    }
  }
  return ipKeyGenerator(req.ip ?? 'unknown');
}

function makeLimiter(opts: Partial<Options>): RateLimitRequestHandler {
  const redis = getOptionalRateLimitRedis();
  const storeOpts: Partial<Options> = redis
    ? {
        store: new RedisStore({
          sendCommand: (command: string, ...args: string[]) =>
            redis.call(command, ...args) as Promise<RedisReply>,
          prefix: 'collectrx:rl:',
        }),
      }
    : {};

  if (redis && !loggedRedisStore) {
    loggedRedisStore = true;
    console.log('[rate-limit] Redis store enabled (REDIS_URL). Limits shared across replicas.');
  }

  return rateLimit({
    standardHeaders: true,   // Return RateLimit-* headers (RFC 6585)
    legacyHeaders:   false,  // Suppress deprecated X-RateLimit-*
    keyGenerator: sessionOrIpKey,
    ...storeOpts,
    ...opts,
  });
}

/**
 * authLimiter — 5 attempts per 15 minutes per IP.
 * Applied to POST /api/auth/login to prevent credential brute-forcing.
 * Intentionally strict: legitimate users won't hit this in normal use.
 */
export const authLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 5,
  handler: makeHandler(
    'Too many login attempts. Please wait 15 minutes before trying again.',
  ),
});

/**
 * strictLimiter — 10 requests per minute per IP.
 * Applied to expensive or mutation-heavy endpoints (queue triggers, imports).
 */
export const strictLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 1000,
  max: 10,
  handler: makeHandler(
    'Too many requests. Please slow down and try again shortly.',
  ),
});

/**
 * standardLimiter — baseline for /api/*.
 * Anonymous traffic: 120 req/min per IP.
 * Signed-in app sessions: 600 req/min per user (avoids shared-NAT / proxy IP collisions).
 */
export const standardLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 1000,
  max: (req) => (sessionOrIpKey(req).startsWith('sess:') ? 600 : 120),
  handler: makeHandler(
    'Too many requests. Please slow down and try again shortly.',
  ),
});

/**
 * webhookLimiter — 300 requests per minute per IP.
 * Applied to Vapi webhook routes which legitimately fire in batches.
 */
export const webhookLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 1000,
  max: 300,
  handler: makeHandler(
    'Too many webhook requests. Please slow down and try again shortly.',
  ),
});

/**
 * publicLimiter — unauthenticated patient pay + email unsubscribe.
 * Tighter than standardLimiter to slow token / UUID enumeration.
 */
export const publicLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 1000,
  max: 60,
  handler: makeHandler(
    'Too many requests. Please slow down and try again shortly.',
  ),
});

/**
 * healthLimiter — cheap endpoints still need a ceiling (metrics + DB ping abuse).
 * Applied to /health and /api/health/* only.
 */
export const healthLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 1000,
  max: 120,
  handler: makeHandler(
    'Too many health or metrics requests. Please slow down and try again shortly.',
  ),
});

/**
 * telemetryEventsLimiter — product analytics SDK batches (5 s per tab).
 * Applied only to POST /api/telemetry/events before the global /api limiter.
 */
export const telemetryEventsLimiter: RateLimitRequestHandler = makeLimiter({
  windowMs: 60 * 1000,
  max: 1000,
  handler: makeHandler('Telemetry rate limit exceeded. Please slow down.'),
});
