import type { Request, Response, NextFunction } from 'express';
import { logLine, redactString } from './logger.js';
import { recordHttpRequest } from './metrics.js';

function useJsonRequestLog(): boolean {
  if (process.env.LOG_JSON === '0') {
    return false;
  }
  if (process.env.LOG_JSON === '1') {
    return true;
  }
  return process.env.NODE_ENV === 'production';
}

/**
 * Request timing + P6-01 request log; updates P6-03 in-process metrics.
 * Skip noisy paths to avoid self-noise in uptime checks.
 */
export function requestMetricsAndAccessLog() {
  const skip = /^\/api\/(health$|health\/ready$)/;
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      recordHttpRequest(ms, res.statusCode);
      if (skip.test(req.path)) {
        return;
      }
      if (useJsonRequestLog()) {
        logLine('info', 'http', {
          method: req.method,
          path: redactString((req.path || '') + (req.query && Object.keys(req.query).length ? '?' : '')),
          status: res.statusCode,
          ms,
        });
      }
    });
    next();
  };
}
