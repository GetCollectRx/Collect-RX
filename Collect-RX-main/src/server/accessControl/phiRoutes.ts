import type { Request } from 'express';
import { isPlatformDev, isUserSession, type AuthJwtPayload, type UserAuthPayload } from './types.js'

/** Paths (pathname only) that must never be served to `platform_dev` sessions. */
const PHI_PATH_PREFIXES = [
  '/api/benefits',
  '/api/eligibility',
  '/api/cdcp',
  '/api/canadian',
  '/api/vapi/phi',
] as const;

/**
 * Paths blocked for roles without PHI access (accountant, group_admin).
 */
const NO_PHI_ROLES = new Set<string>(['accountant', 'group_admin']);

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
  if (!auth) return null;

  // platform_dev: full PHI block
  if (isPlatformDev(auth)) {
    if (!isPhiApiRoute(req)) return null;
    return 'This endpoint is not available for platform developer sessions (PHI boundary).';
  }

  // Practice-layer roles with no PHI access (accountant, group_admin)
  if (isUserSession(auth)) {
    const user = auth as UserAuthPayload;
    if (NO_PHI_ROLES.has(user.role) && isPhiApiRoute(req)) {
      return `Role '${user.role}' does not have access to patient PHI endpoints.`;
    }
  }

  return null;
}
