/**
 * Static IDOR guard audit — authenticated routers must use session practice id,
 * not trust body/query practiceId alone.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// import.meta.dirname requires Node 20.11+/21.2+, above this repo's declared
// package.json engines minimum of 20.10.0 — fileURLToPath is portable back
// to Node 10 and avoids the mismatch. See scripts/sync-vapi-squad.ts for the
// same fix and the crash this avoids.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../src');

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
  'server/routes/frontDeskApi.ts',
  'server/routes/practiceReportsApi.ts',
  'server/routes/preVisitRoutes.ts',
  'server/routes/pmsApiRoutes.ts',
  'server/routes/connectorAdminRoutes.ts',
  'server/routes/productTelemetry.ts',
];

/**
 * Platform-level routers that intentionally read/aggregate across ALL practices
 * for a role-gated platform persona (platform_admin, platform_dev, group_admin,
 * auditor) — session `practiceId` scoping does not apply here by design, so they
 * are audited separately: authenticated, and gated by a role check.
 */
const PLATFORM_ROLE_GATED_ROUTE_FILES = [
  'server/routes/platformPersonaAdminApi.ts',
  'server/routes/groupAdminRoutes.ts',
  'server/routes/complianceRoutes.ts',
  'server/routes/partnershipsRouter.ts',
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
    for (const rel of [...AUTH_ROUTE_FILES, ...PLATFORM_ROLE_GATED_ROUTE_FILES]) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src, rel).not.toMatch(badPattern);
    }
  });

  it('platform-level routers are authenticated and role-gated (not merely session practiceId scoped)', () => {
    const roleGatePattern =
      /requirePlatformAdmin|authorizeRole\(|role\s*!==|getUserRole\(|isPlatformAdmin\(|isAuditor\(|hasMinRole\(/;
    for (const rel of PLATFORM_ROLE_GATED_ROUTE_FILES) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(
        src.includes('router.use(authenticate)') ||
          src.includes('r.use(authenticate)') ||
          /authenticate\s*,/.test(src),
        rel,
      ).toBe(true);
      expect(roleGatePattern.test(src), rel).toBe(true);
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
