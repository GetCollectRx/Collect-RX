import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Request/job-scoped PostgreSQL RLS session variables (via set_config). */
export interface RlsContext {
  /** Tenant scope — maps to app.practice_id for RLS policies. */
  practiceId?: string;
  /** Platform jobs (rules tick, learning cycle) that legitimately cross tenants. */
  bypass?: boolean;
}

const storage = new AsyncLocalStorage<RlsContext>();

export function getRlsContext(): RlsContext | undefined {
  return storage.getStore();
}

export function runWithRlsContext<T>(ctx: RlsContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export async function runWithRlsBypass<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ bypass: true }, fn);
}

export async function runWithPracticeRls<T>(practiceId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ practiceId }, fn);
}

/**
 * Wraps a middleware whose internals don't propagate AsyncLocalStorage
 * (observed with multer's multipart stream parsing — verified via debug
 * trace that `getRlsContext()` is present immediately before `upload.single()`
 * and gone immediately after). Captures the RLS context before the wrapped
 * middleware runs and re-establishes it for everything downstream, so
 * routes that parse `multipart/form-data` don't silently lose tenant scope
 * and fail RLS `WITH CHECK` on their first write.
 */
export function preserveRlsAcrossMiddleware(middleware: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = getRlsContext();
    middleware(req, res, (err?: unknown) => {
      if (ctx) {
        runWithRlsContext(ctx, () => next(err as Parameters<NextFunction>[0]));
      } else {
        next(err as Parameters<NextFunction>[0]);
      }
    });
  };
}
