import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { runWithCorrelationId } from '../observability/correlationContext.js';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Every request gets a correlation ID — reused from the incoming header if
 * the caller (or an upstream proxy) already set one, otherwise generated
 * fresh. Echoed back on the response so a client can correlate its own
 * logs, and stashed in AsyncLocalStorage so every logger.*() call made
 * while handling this request picks it up automatically without threading
 * it through every function signature.
 */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(CORRELATION_ID_HEADER);
  const correlationId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader(CORRELATION_ID_HEADER, correlationId);
  runWithCorrelationId(correlationId, next);
}
