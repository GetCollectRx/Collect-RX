import rateLimit from 'express-rate-limit';

// ── General API rate limiter ──────────────────────────────────────────────────
// 300 requests per 15 minutes per IP — generous for internal desktop app

export const apiLimiter = rateLimit({
  windowMs        : 15 * 60 * 1000, // 15 minutes
  max             : 300,
  standardHeaders : true,
  legacyHeaders   : false,
  message         : { error: 'Too many requests, please try again later.' },
  skip            : (req) => req.path === '/api/health', // never rate-limit health check
});

// ── Strict limiter for auth endpoints ────────────────────────────────────────
// 10 login attempts per 15 minutes per IP — mitigates brute force

export const authLimiter = rateLimit({
  windowMs        : 15 * 60 * 1000,
  max             : 10,
  standardHeaders : true,
  legacyHeaders   : false,
  message         : { error: 'Too many login attempts. Please wait 15 minutes.' },
});

// ── Strict limiter for estimate endpoints ────────────────────────────────────
// 60 per minute — enough for interactive use, not enough for scraping

export const estimateLimiter = rateLimit({
  windowMs        : 60 * 1000,
  max             : 60,
  standardHeaders : true,
  legacyHeaders   : false,
  message         : { error: 'Estimate rate limit exceeded. Slow down.' },
});
