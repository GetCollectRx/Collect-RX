/**
 * Static IDOR guard audit — authenticated routers must use session practice id,
 * not trust body/query practiceId alone.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../src');

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      collectTsFiles(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Route modules that mount `authenticate` (practice-scoped APIs). */
const AUTH_ROUTE_FILES = [
  'routes/insurance.ts',
  'routes/calls.ts',
  'routes/carriers.ts',
  'routes/analytics.ts',
  'routes/eligibility.ts',
  'routes/queue.ts',
  'routes/workQueue.ts',
  'server/routes/dashboardRoutes.ts',
  'server/routes/adminRoutes.ts',
  'server/routes/pmsSyncRoutes.ts',
  'server/routes/benefitsApi.ts',
  'server/routes/billingRoutes.ts',
  'server/routes/cdcp.ts',
  'server/routes/canadianExpansionApi.ts',
];

describe('IDOR practice scope audit', () => {
  it('authenticated route files import session practice helpers', () => {
    for (const rel of AUTH_ROUTE_FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(
        src.includes('authenticate') || src.includes('useOwnerPracticeApi'),
        rel,
      ).toBe(true);
      expect(
        src.includes('practiceIdFromSession') ||
          src.includes('practiceId(req)') ||
          src.includes('req.practiceAuth'),
        rel,
      ).toBe(true);
    }
  });

  it('no authenticated route file uses only req.body.practiceId for DB where (grep heuristic)', () => {
    const badPattern = /where:\s*\{\s*practiceId:\s*req\.body/;
    for (const rel of AUTH_ROUTE_FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src, rel).not.toMatch(badPattern);
    }
  });

  it('public and webhook entrypoints are not in the authenticated-only list', () => {
    const publicPaths = [
      'server/routes/sendgridInboundRouter.ts',
      'webhooks/vapi.ts',
    ];
    for (const rel of publicPaths) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src.includes('router.use(authenticate)')).toBe(false);
    }
  });
});
