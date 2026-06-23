/**
 * Startup health scan — runs when the API server boots (and via scripts for Electron).
 */
import type { PrismaClient } from '@prisma/client';
import { getAlertDefinition } from './alertCatalog.js';

export interface StartupCheckResult {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  skipped?: boolean;
}

export function startupScanEnabled(): boolean {
  const off = ['0', 'false', 'no'].includes(
    (process.env.STARTUP_HEALTH_SCAN_ENABLED || '').trim().toLowerCase(),
  );
  if (off) return false;
  const force = ['1', 'true', 'yes'].includes(
    (process.env.STARTUP_HEALTH_SCAN_ENABLED || '').trim().toLowerCase(),
  );
  if (force) return true;
  return process.env.NODE_ENV === 'production';
}

/** In-process checks (no HTTP). */
export async function runInternalStartupChecks(prisma: PrismaClient): Promise<StartupCheckResult[]> {
  const results: StartupCheckResult[] = [];

  const nodeEnv = process.env.NODE_ENV || 'development';
  const jwt = Boolean((process.env.JWT_SECRET || '').trim());
  results.push({
    id: 'env',
    label: 'JWT_SECRET configured',
    ok: nodeEnv !== 'production' || jwt,
    detail: jwt ? 'set' : 'missing in production',
  });

  if (nodeEnv === 'production') {
    const vapi = Boolean((process.env.VAPI_WEBHOOK_SECRET || '').trim());
    results.push({
      id: 'env',
      label: 'VAPI_WEBHOOK_SECRET configured',
      ok: vapi,
      detail: vapi ? 'set' : 'required in production',
    });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    results.push({
      id: 'database_readiness',
      label: 'Database connection',
      ok: true,
      detail: 'SELECT 1 ok',
    });
  } catch (err) {
    results.push({
      id: 'database_readiness',
      label: 'Database connection',
      ok: false,
      detail: (err as Error).message,
    });
  }

  const requiredTables = [
    'insurance_claims',
    'call_attempts',
    'emr_sync_outbox',
  ] as const;
  try {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const have = new Set(rows.map((r) => r.tablename));
    const missing = requiredTables.filter((t) => !have.has(t));
    results.push({
      id: 'database',
      label: 'Critical database tables',
      ok: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(', ')}` : 'present',
    });
  } catch (err) {
    results.push({
      id: 'database',
      label: 'Critical database tables',
      ok: false,
      detail: (err as Error).message,
    });
  }

  return results;
}

/** HTTP smoke against this instance (call after listen). */
export async function runHttpStartupSmoke(apiOrigin: string): Promise<StartupCheckResult[]> {
  const origin = apiOrigin.replace(/\/$/, '');
  const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 12_000);
  const checks: Array<{
    id: string;
    label: string;
    path: string;
    pass: (r: { ok: boolean; status: number; body: Record<string, unknown> }) => boolean;
  }> = [
    {
      id: 'liveness',
      label: 'API liveness',
      path: '/api/health',
      pass: ({ ok, body }) => ok && body?.status === 'ok',
    },
    {
      id: 'readiness',
      label: 'API readiness (DB)',
      path: '/api/health/ready',
      pass: ({ ok, body }) => ok && body?.status === 'ready',
    },
    {
      id: 'auth-guard',
      label: 'Auth guard on claims API',
      path: '/api/insurance/claims',
      pass: ({ status }) => status === 401,
    },
  ];

  const results: StartupCheckResult[] = [];
  for (const c of checks) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(`${origin}${c.path}`, { signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        body = { raw: text.slice(0, 120) };
      }
      const pass = c.pass({ ok: res.ok, status: res.status, body });
      results.push({
        id: c.id,
        label: c.label,
        ok: pass,
        detail: pass ? `${c.path} → ${res.status}` : `${c.path} → ${res.status}`,
      });
    } catch (err) {
      results.push({
        id: c.id,
        label: c.label,
        ok: false,
        detail: (err as Error).message,
      });
    }
  }
  return results;
}

export function failedStartupChecks(results: StartupCheckResult[]): StartupCheckResult[] {
  return results.filter((r) => !r.ok && !r.skipped);
}

export function formatStartupDigest(
  failures: StartupCheckResult[],
  context: { host: string; source: string },
): { subject: string; text: string; html: string } {
  const lines: string[] = [
    'CollectRx startup health scan found issues.',
    '',
    `Host: ${context.host}`,
    `Source: ${context.source}`,
    `Time: ${new Date().toISOString()}`,
    '',
  ];

  const htmlParts: string[] = [
    `<p>CollectRx <strong>startup scan</strong> found <strong>${failures.length}</strong> issue(s).</p>`,
    `<p><small>Host: ${context.host} · Source: ${context.source}</small></p>`,
  ];

  failures.forEach((f, i) => {
    const def = getAlertDefinition(f.id);
    lines.push(`${i + 1}. [${def.severity.toUpperCase()}] ${f.label}`);
    lines.push(`   Detail: ${f.detail ?? 'failed'}`);
    lines.push('   Impact:');
    def.impact.forEach((imp) => lines.push(`     • ${imp}`));
    lines.push('   Fix:');
    def.suggestedFixes.forEach((fix, j) => lines.push(`     ${j + 1}. ${fix}`));
    lines.push('');

    htmlParts.push(
      `<h3>${i + 1}. ${def.title}</h3>`,
      `<p><strong>Detail:</strong> ${f.detail ?? 'failed'}</p>`,
      `<p><strong>Impact</strong></p><ul>${def.impact.map((x) => `<li>${x}</li>`).join('')}</ul>`,
      `<p><strong>Fix</strong></p><ol>${def.suggestedFixes.map((x) => `<li>${x}</li>`).join('')}</ol>`,
    );
  });

  return {
    subject: `CollectRx startup: ${failures.length} issue(s) on ${context.host}`,
    text: lines.join('\n').slice(0, 12000),
    html: `<!DOCTYPE html><html><body style="font-family:sans-serif">${htmlParts.join('')}</body></html>`,
  };
}
