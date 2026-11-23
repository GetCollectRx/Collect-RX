/**
 * Builds the SPA shell HTML that Express serves.
 *
 * Express serves this shell and the API from the same host, so the browser must call
 * `/api` on the page's own origin. Pointing it at a different host (for example
 * collect-rx.fly.dev while the page is on www.collectrx.ca) makes the auth cookie
 * cross-site: it is SameSite=Lax, so the browser does not send it, every session
 * call returns 401 and the user is bounced back to the sign-in page.
 *
 * The API-origin meta is therefore injected only for a deliberate split deployment,
 * and only when SPA_INJECT_API_ORIGIN=true and PUBLIC_API_BASE_URL is set.
 */
function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function buildSpaIndexHtml(raw: string, env: NodeJS.ProcessEnv = process.env): string {
  const inject = (env.SPA_INJECT_API_ORIGIN || '').trim().toLowerCase() === 'true';
  const api = (env.PUBLIC_API_BASE_URL || '').trim().replace(/\/$/, '');
  if (!inject || !api) return raw;
  const meta = `<meta name="crx-public-api-origin" content="${escapeHtmlAttr(api)}" />`;
  return /name="crx-public-api-origin"/i.test(raw)
    ? raw.replace(/<meta\s+name="crx-public-api-origin"[^>]*>/i, meta)
    : raw.replace('</head>', `${meta}\n</head>`);
}
