/**
 * Base URL for links placed in emails (password reset, invites).
 *
 * Preference order:
 *   1. The host the user was on when they made the request (Origin, then Host),
 *      but only if it is on the allowlist below. This keeps the link on a
 *      hostname that actually resolves and that the user already trusts.
 *   2. APP_BASE_URL.
 *   3. https://www.collectrx.ca.
 *
 * The allowlist is what makes this safe: an attacker who forges a Host or
 * Origin header on a reset request cannot make the emailed link point at a
 * host they control, because any host outside the list is ignored.
 */

const DEFAULT_BASE_URL = 'https://www.collectrx.ca';
const BUILT_IN_HOSTS = ['www.collectrx.ca', 'collectrx.ca', 'collect-rx.fly.dev'];

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const u = new URL(value.includes('://') ? value : `https://${value}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

export function resolveAppBaseUrl(
  requestHint?: { origin?: string | null; host?: string | null },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = parseUrl(env.APP_BASE_URL?.trim());
  const allowed = new Set(BUILT_IN_HOSTS);
  if (configured) allowed.add(configured.host.toLowerCase());

  for (const candidate of [requestHint?.origin, requestHint?.host]) {
    const u = parseUrl(candidate?.trim() || undefined);
    if (!u) continue;
    const host = u.host.toLowerCase();
    // Never take a request-supplied host over plain http in production.
    if (!allowed.has(host)) continue;
    if (u.protocol !== 'https:' && env.NODE_ENV === 'production') continue;
    return `https://${host}`;
  }

  if (configured) return configured.origin;
  return DEFAULT_BASE_URL;
}

export interface RequestLike {
  get(name: string): string | undefined;
}

export function appBaseUrlFromRequest(req: RequestLike, env: NodeJS.ProcessEnv = process.env): string {
  return resolveAppBaseUrl({ origin: req.get('origin'), host: req.get('host') }, env);
}
