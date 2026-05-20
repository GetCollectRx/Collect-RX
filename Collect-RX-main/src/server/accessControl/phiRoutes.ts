import type { Request } from 'express';
import { isPlatformDev } from './types.js';
import type { AuthJwtPayload } from './types.js';

/** Paths (pathname only) that must never be served to `platform_dev` sessions. */
const PHI_PATH_PREFIXES = [
  '/api/patients',
  '/api/benefits',
  '/api/balances',
  '/api/eligibility',
  '/api/cdcp',
  '/api/canadian',
  '/api/vapi/phi',
] as const;

/** Analytics sub-routes allowed without PHI (insurance aggregates only). */
const ANALYTICS_ALLOWED = new Set(['/api/analytics/insurance']);

function requestPathname(req: Request): string {
  const raw = req.originalUrl || req.url || '';
  const q = raw.indexOf('?');
  return q >= 0 ? raw.slice(0, q) : raw;
}

export function isPhiApiRoute(req: Request): boolean {
  const path = requestPathname(req);
  if (ANALYTICS_ALLOWED.has(path)) return false;
  if (path.startsWith('/api/analytics')) return true;
  return PHI_PATH_PREFIXES.some((p) => path.startsWith(p));
}

export function assertPhiRouteAllowed(auth: AuthJwtPayload | undefined, req: Request): string | null {
  if (!isPlatformDev(auth)) return null;
  if (!isPhiApiRoute(req)) return null;
  return 'This endpoint is not available for platform developer sessions (PHI boundary).';
}
