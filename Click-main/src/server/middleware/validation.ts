/**
 * Input validation middleware using Zod.
 * Wraps common request validation patterns for Express routes.
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

// ── Generic validate middleware factory ───────────────────────────────────────

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.issues.map(e => ({
        field  : e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', errors });
    }
    req.body = result.data; // replace with coerced/cleaned data
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errors = result.error.issues.map(e => ({
        field  : e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ error: 'Validation failed', errors });
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}

// ── Shared reusable schemas ───────────────────────────────────────────────────

export const practiceIdQuery = z.object({
  practiceId: z.string().uuid('practiceId must be a valid UUID'),
});

export const uuidParam = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

export const paginationQuery = z.object({
  page    : z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ── XSS sanitization ─────────────────────────────────────────────────────────
// Strip HTML tags from string values recursively in a plain object.

function stripTags(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/<[^>]*>/g, '')                   // strip HTML tags
      .replace(/javascript:/gi, '')              // strip JS URIs
      .replace(/on\w+\s*=/gi, '')                // strip event handlers
      .trim();
  }
  if (Array.isArray(value)) return value.map(stripTags);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stripTags(v)])
    );
  }
  return value;
}

export function sanitizeBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === 'object') {
    req.body = stripTags(req.body);
  }
  next();
}

// ── SQL injection guard (defence in depth — Prisma already parameterises) ────
// Rejects requests that contain obvious raw SQL injection patterns.

const SQL_INJECTION_PATTERN = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|EXEC|UNION|--)\b)/i;

export function guardSqlInjection(req: Request, res: Response, next: NextFunction) {
  const body = JSON.stringify(req.body || {});
  const query = JSON.stringify(req.query || {});

  if (SQL_INJECTION_PATTERN.test(body) || SQL_INJECTION_PATTERN.test(query)) {
    return res.status(400).json({ error: 'Invalid input detected' });
  }
  next();
}
