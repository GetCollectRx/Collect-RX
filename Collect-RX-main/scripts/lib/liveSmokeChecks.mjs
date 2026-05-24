/**
 * HTTP smoke checks against a running CollectRx API.
 * @param {string} baseUrl
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<import('./breakageReport.mjs').CheckResult[]>}
 */
export async function runLiveSmokeChecks(baseUrl, opts = {}) {
  const origin = baseUrl.replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? Number(process.env.SMOKE_TIMEOUT_MS || 15_000);

  /** @type {import('./breakageReport.mjs').CheckResult[]} */
  const results = [];

  /** @param {string} path */
  async function fetchJson(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${origin}${path}`, { signal: controller.signal });
      const text = await res.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 200) };
      }
      return { ok: res.ok, status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  async function check(id, label, path, expect) {
    try {
      const { ok, status, body } = await fetchJson(path);
      const pass = expect({ ok, status, body });
      results.push({
        id,
        label,
        ok: pass,
        detail: pass ? `${path} → ${status}` : `${path} → ${status} ${JSON.stringify(body).slice(0, 120)}`,
        fix: pass ? undefined : `curl -sf "${origin}${path}"`,
      });
    } catch (e) {
      results.push({
        id,
        label,
        ok: false,
        detail: (e instanceof Error ? e.message : String(e)).slice(0, 160),
        fix: `Ensure API is running at ${origin}`,
      });
    }
  }

  await check('liveness', 'API liveness (/api/health)', '/api/health', ({ ok, body }) =>
    ok && body?.status === 'ok',
  );
  await check('readiness', 'Database readiness (/api/health/ready)', '/api/health/ready', ({ ok, body }) =>
    ok && body?.status === 'ready',
  );
  await check('metrics', 'Ops metrics (/api/health/metrics)', '/api/health/metrics', ({ ok, body }) =>
    ok && body?.success === true && body?.metrics != null,
  );
  await check(
    'auth-guard',
    'Practice APIs require auth (/api/insurance/claims)',
    '/api/insurance/claims',
    ({ status }) => status === 401,
  );
  await check('legacy-health', 'Legacy /health alias', '/health', ({ ok, body }) => ok && body?.status === 'ok');

  return results;
}
