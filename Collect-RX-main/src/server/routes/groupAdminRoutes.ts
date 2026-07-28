import { Router, type Request, type Response, type NextFunction } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/authenticate';
import { runWithPracticeRls } from '../db/rlsContext.js';
import { createOrgBillingCheckoutSession, createOrgBillingPortalSession } from '../stripe/billing.js';
import { apiClientErrorMessage } from '../apiErrorMessage.js';
import {
  callerAdminOrganizationId,
  callerBillingViewerOrganizationId,
  callerHasOrganizationMembership,
  callerIsBillingViewer,
} from '../accessControl/organizationContext.js';
import { hasMinRole, type UserAuthPayload } from '../accessControl/types.js';
import { runPmsImportPipeline } from '../pms/pmsImportPipeline.js';
import { normalizePmsVendorId } from '../pms/pmsRegistry.js';
import {
  groupPmsImportBodySchema,
  addOrgPracticeBodySchema,
  updateOrgMemberBodySchema,
  formatZodError,
} from '../validation/zodSchemas.js';
import { unusedLegacyPasswordHash, createOrgPractice } from '../organizations/practiceProvisioning.js';

/**
 * Group/DSO Admin API — PHI-free aggregate views across all practices.
 * Accessible to group_admin/platform_dev (full access) and, for the two
 * billing routes only, an accountant-role org_billing_viewer controller —
 * see FR-8 in specs/phase-4-enterprise-it-compliance.md. Every route below
 * that must stay org_admin-only enforces that explicitly itself rather than
 * relying on this coarse entry gate.
 */
export function createGroupAdminRouter(prisma: PrismaClient): Router {
  const r = Router();
  r.use(authenticate);
  r.use(async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (!auth) { res.status(401).json({ error: 'Authentication required' }); return; }
    if (hasMinRole(auth, 'group_admin')) { next(); return; }
    const userId = (auth as UserAuthPayload).userId;
    if (userId && (await callerHasOrganizationMembership(prisma, userId))) { next(); return; }
    res.status(403).json({ error: 'Insufficient permissions for this action' });
  });

  /**
   * GET /api/group/practices-summary
   * Returns per-practice stats without any patient PHI.
   */
  r.get('/practices-summary', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const { CSV_AR_FEATURES } = await import('../featureFlags/csvArFeatures.js');
      const dsoConsoleFlag = await prisma.featureFlag.findFirst({
        where: { feature: CSV_AR_FEATURES.DSO_CONSOLE, practiceId: null },
      });
      if (dsoConsoleFlag?.paused) return res.status(403).json({ error: 'DSO console is currently paused' });
      // FR-8: org_billing_viewer is billing-only — explicit 403, not an empty-but-200 fall-through.
      if (await callerIsBillingViewer(prisma, userId)) {
        return res.status(403).json({ error: 'Billing-only access cannot view practice data' });
      }
      const memberships = await prisma.organizationMember.findMany({
        where: { userId },
        select: { organizationId: true },
      });
      if (memberships.length === 0) return res.json({ practices: [] });
      const practices = await prisma.practice.findMany({
        where: { organizationMemberships: { some: { organizationId: { in: memberships.map((m) => m.organizationId) } } } },
        select: { id: true, name: true, timezone: true, subscriptionStatus: true },
        orderBy: { name: 'asc' },
      });

      const summaries = await Promise.all(
        practices.map(async (p) => {
          // insurance_claims is RLS-protected on practice_id; the caller's session
          // RLS context is scoped to their own home practice, so every sibling
          // practice in the org needs its own narrow RLS scope for this query.
          const [
            totalClaims,
            resolvedClaims,
            activeUsers,
          ] = await runWithPracticeRls(p.id, () => Promise.all([
            prisma.insuranceClaim.count({ where: { practiceId: p.id } }),
            prisma.insuranceClaim.count({ where: { practiceId: p.id, status: { in: ['RESOLVED', 'APPROVED_PENDING_PAYMENT'] } } }),
            prisma.user.count({ where: { practiceId: p.id, isActive: true } }),
          ]));

          return {
            id: p.id,
            name: p.name,
            timezone: p.timezone,
            subscriptionStatus: p.subscriptionStatus,
            totalClaims,
            resolvedClaims,
            resolutionRate: totalClaims > 0 ? Math.round((resolvedClaims / totalClaims) * 100) : 0,
            outstandingAR: 0, // Patient AR removed — CollectRx is insurance-only
            activeUsers,
          };
        }),
      );

      return res.json({ practices: summaries });
    } catch (e) {
      console.error('group practices-summary error:', e);
      return res.status(500).json({ error: 'Failed to load group summary' });
    }
  });

  /**
   * GET /api/group/carrier-lessons/proposed
   * Platform/org review queue for carrier intelligence proposals.
   */
  r.get('/carrier-lessons/proposed', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const { CSV_AR_FEATURES } = await import('../featureFlags/csvArFeatures.js');
      const carrierIntelFlag = await prisma.featureFlag.findFirst({
        where: { feature: CSV_AR_FEATURES.CARRIER_INTELLIGENCE, practiceId: null },
      });
      if (carrierIntelFlag?.paused) return res.status(403).json({ error: 'Carrier intelligence is currently paused' });
      const { listProposedCarrierLessons } = await import('../learning/practiceCarrierFeed.js');
      const carrierId = typeof req.query.carrierId === 'string' ? req.query.carrierId : undefined;
      const data = await listProposedCarrierLessons(prisma, carrierId as import('@prisma/client').CarrierId | undefined);
      return res.json({ lessons: data });
    } catch (e) {
      console.error('group carrier-lessons error:', e);
      return res.status(500).json({ error: 'Failed to load proposed lessons' });
    }
  });

  r.post('/carrier-lessons/:id/review', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const action = req.body?.action === 'reject' ? 'reject' : 'approve';
      const { reviewLesson } = await import('../learning/carrierLessons.js');
      const ok = await reviewLesson(prisma, req.params.id, action, userId);
      if (!ok) return res.status(404).json({ error: 'Lesson not found or already reviewed' });
      return res.json({ success: true });
    } catch {
      return res.status(500).json({ error: 'Review failed' });
    }
  });

  /**
   * GET /api/group/billing
   * Consolidated subscription + pooled-usage view for the DSO's org_admin —
   * "charge the parent company" per the enterprise billing decision.
   */
  r.get('/billing', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      // org_billing_viewer may read billing status too (FR-8) — org_admin-only
      // actions (checkout, cogs-pooling, everything else below) stay on
      // callerAdminOrganizationId, which explicitly excludes org_billing_viewer.
      const organizationId = await callerBillingViewerOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization billing access required' });

      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          stripeCustomerId: true,
          subscriptionStatus: true,
          billingTier: true,
          cogsPoolingEnabled: true,
          callsPaused: true,
          callsPausedReason: true,
          subscriptionCurrentPeriodEnd: true,
        },
      });
      if (!org) return res.status(404).json({ error: 'Organization not found' });

      const memberPracticeIds = (
        await prisma.organizationPractice.findMany({ where: { organizationId }, select: { practiceId: true } })
      ).map((p) => p.practiceId);

      const usagePeriods = await Promise.all(
        memberPracticeIds.map((practiceId) =>
          runWithPracticeRls(practiceId, () =>
            prisma.usagePeriod.findFirst({
              where: { practiceId, periodStart: { lte: new Date() }, periodEnd: { gte: new Date() } },
              orderBy: { periodStart: 'desc' },
              select: { minutesConsumed: true, callsCompleted: true },
            }),
          ),
        ),
      );
      const pooledMinutesConsumed = usagePeriods.reduce((sum, p) => sum + (p?.minutesConsumed ?? 0), 0);
      const pooledCallsCompleted = usagePeriods.reduce((sum, p) => sum + (p?.callsCompleted ?? 0), 0);

      return res.json({
        organization: {
          id: org.id,
          name: org.name,
          billed: Boolean(org.stripeCustomerId),
          subscriptionStatus: org.subscriptionStatus,
          billingTier: org.billingTier,
          cogsPoolingEnabled: org.cogsPoolingEnabled,
          callsPaused: org.callsPaused,
          callsPausedReason: org.callsPausedReason,
          subscriptionCurrentPeriodEnd: org.subscriptionCurrentPeriodEnd,
        },
        pooledUsage: {
          practiceCount: memberPracticeIds.length,
          minutesConsumed: pooledMinutesConsumed,
          callsCompleted: pooledCallsCompleted,
        },
      });
    } catch (e) {
      console.error('group billing status error:', e);
      return res.status(500).json({ error: 'Failed to load organization billing' });
    }
  });

  r.post('/billing/checkout', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const organizationId = await callerAdminOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization admin access required' });
      const requestedPlanId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : undefined;
      const { url } = await createOrgBillingCheckoutSession(organizationId, prisma, requestedPlanId);
      return res.json({ url });
    } catch (e) {
      console.error('group billing checkout error:', e);
      return res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  });

  /**
   * PATCH /api/group/billing/cogs-pooling
   * Org admin opt-out of usage pooling in favor of hard per-practice caps.
   * Takes effect immediately — evaluateCallGate/recordCallUsage in
   * usagePeriodService.ts read this flag live on every dispatch, so there is
   * no separate "pending" state to reconcile at cycle boundary.
   */
  r.patch('/billing/cogs-pooling', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const organizationId = await callerAdminOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization admin access required' });
      if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      const org = await prisma.organization.update({
        where: { id: organizationId },
        data: { cogsPoolingEnabled: req.body.enabled },
        select: { cogsPoolingEnabled: true },
      });
      return res.json({ cogsPoolingEnabled: org.cogsPoolingEnabled });
    } catch (e) {
      console.error('group cogs-pooling update error:', e);
      return res.status(500).json({ error: 'Failed to update pooling setting' });
    }
  });

  /**
   * PATCH /api/group/sso/enforce
   * Phase 4 FR-5: org_admin can turn SSO enforcement on/off once
   * platform_dev has configured the IdP connection — but cannot configure
   * the connection itself (that stays platform_dev-only, see Non-Goals).
   */
  r.patch('/sso/enforce', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const organizationId = await callerAdminOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization admin access required' });
      if (typeof req.body?.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      const existing = await prisma.organizationSsoConfig.findUnique({ where: { organizationId } });
      if (!existing) {
        return res.status(400).json({ error: 'No SSO connection is configured for your organization yet' });
      }
      const { setSsoEnforced } = await import('../sso/organizationSsoService.js');
      await setSsoEnforced(prisma, organizationId, req.body.enabled);
      return res.json({ ssoEnforced: req.body.enabled });
    } catch (e) {
      console.error('group sso enforce update error:', e);
      return res.status(500).json({ error: 'Failed to update SSO enforcement' });
    }
  });

  r.post('/billing/portal', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      // FR-8: org_billing_viewer may open the Stripe portal (view/manage invoices).
      const organizationId = await callerBillingViewerOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization billing access required' });
      const { url } = await createOrgBillingPortalSession(organizationId, prisma);
      return res.json({ url });
    } catch (e) {
      console.error('group billing portal error:', e);
      return res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  });

  r.get('/compliance/export', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const { CSV_AR_FEATURES } = await import('../featureFlags/csvArFeatures.js');
      const complianceFlag = await prisma.featureFlag.findFirst({
        where: { feature: CSV_AR_FEATURES.COMPLIANCE_WORKSPACE, practiceId: null },
      });
      if (complianceFlag?.paused) return res.status(403).json({ error: 'Compliance workspace is currently paused' });
      // FR-8: org_billing_viewer is billing-only — explicit 403, not an empty-but-200 fall-through.
      if (await callerIsBillingViewer(prisma, userId)) {
        return res.status(403).json({ error: 'Billing-only access cannot view compliance data' });
      }
      const memberships = await prisma.organizationMember.findMany({
        where: { userId },
        select: { organizationId: true },
      });
      if (memberships.length === 0) return res.json({ practices: [] });
      const practiceIds = (
        await prisma.organizationPractice.findMany({
          where: { organizationId: { in: memberships.map((m) => m.organizationId) } },
          select: { practiceId: true },
        })
      ).map((p) => p.practiceId);

      const summaries = await Promise.all(
        practiceIds.map(async (practiceId) => {
          const [phiAccessCount, openGates, openUnderpayments] = await runWithPracticeRls(practiceId, () => Promise.all([
            prisma.phiAccessEvent.count({ where: { practiceId } }),
            prisma.claimRecoveryAction.count({
              where: { practiceId, status: { in: ['OPEN', 'BLOCKING'] }, clearedAt: null },
            }),
            prisma.underpaymentCase.count({ where: { practiceId, status: 'OPEN' } }),
          ]));
          return { practiceId, phiAccessCount, openGates, openUnderpayments };
        }),
      );
      return res.json({ practices: summaries });
    } catch {
      return res.status(500).json({ error: 'Compliance export failed' });
    }
  });

  /**
   * GET /api/group/compliance/export/v2?from=&to=
   * Auditor-facing bundle (Phase 4 FR-10-13): AuditLog, PhiAccessEvent,
   * member roster, CarrierBlockEvent — CSV per category, zipped. org_admin
   * only (this is additive to the v1 aggregate-counts export above, not a
   * replacement — v1 stays as the internal dashboard's data source).
   */
  r.get('/compliance/export/v2', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const organizationId = await callerAdminOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization admin access required' });

      const fromRaw = typeof req.query.from === 'string' ? req.query.from : undefined;
      const toRaw = typeof req.query.to === 'string' ? req.query.to : undefined;
      if (!fromRaw || !toRaw) {
        return res.status(400).json({ error: 'from and to query params are required (ISO date)' });
      }
      const from = new Date(fromRaw);
      const to = new Date(toRaw);
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        return res.status(400).json({ error: 'from and to must be valid dates' });
      }
      if (from > to) {
        return res.status(400).json({ error: 'from must be before to' });
      }

      const { buildOrgComplianceExportZip } = await import('../organizations/complianceExport.js');
      const { buffer, checksum } = await buildOrgComplianceExportZip(prisma, organizationId, from, to);

      await prisma.orgComplianceExport.create({
        data: { organizationId, exportedBy: userId, dateRangeFrom: from, dateRangeTo: to, checksum },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="collectrx-compliance-export-${fromRaw}-to-${toRaw}.zip"`,
      );
      res.setHeader('X-CollectRx-Export-Checksum', checksum);
      return res.send(buffer);
    } catch (e) {
      console.error('group compliance export v2 error:', e);
      return res.status(500).json({ error: 'Compliance export failed' });
    }
  });

  /**
   * POST /api/group/pms-import
   * Batch PMS import across the caller's org practices — replaces logging
   * into each practice's session and uploading N times. Every practiceId is
   * checked against the caller's org membership before it's touched, then
   * imported independently under its own narrow RLS scope (authorized
   * narrow RLS iteration — see docs/architecture/authorized-narrow-rls-iteration.md).
   */
  r.post('/pms-import', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });

      const parsed = groupPmsImportBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });
      const { imports } = parsed.data;

      // FR-8: org_billing_viewer is billing-only — explicitly excluded, not merely unlisted.
      const memberships = await prisma.organizationMember.findMany({
        where: { userId, role: { not: 'org_billing_viewer' } },
        select: { organizationId: true },
      });
      if (memberships.length === 0) return res.status(403).json({ error: 'Organization membership required' });
      const authorizedPracticeIds = new Set(
        (
          await prisma.organizationPractice.findMany({
            where: { organizationId: { in: memberships.map((m) => m.organizationId) } },
            select: { practiceId: true },
          })
        ).map((p) => p.practiceId),
      );

      const unauthorized = imports.filter((i) => !authorizedPracticeIds.has(i.practiceId));
      if (unauthorized.length > 0) {
        return res.status(403).json({
          error: 'One or more practices are not in your organization',
          practiceIds: unauthorized.map((i) => i.practiceId),
        });
      }

      const results = await Promise.all(
        imports.map(async (entry) => {
          const vendorId = normalizePmsVendorId(entry.pmsVendor);
          if (!vendorId) {
            return { practiceId: entry.practiceId, success: false, error: `Unknown PMS vendor "${entry.pmsVendor}"` };
          }
          try {
            const result = await runWithPracticeRls(entry.practiceId, () =>
              runPmsImportPipeline(prisma, {
                practiceId: entry.practiceId,
                pmsSource: vendorId,
                rows: entry.records,
                sourceRecordCount: entry.records.length,
                sourceBalanceTotal: entry.sourceBalanceTotal,
              }),
            );
            return {
              practiceId: entry.practiceId,
              success: true,
              runId: result.runId,
              imported: result.imported,
              skipped: result.skipped,
              failed: result.failed,
            };
          } catch (e) {
            console.error('group pms-import practice error:', entry.practiceId, e);
            return { practiceId: entry.practiceId, success: false, error: apiClientErrorMessage(e) };
          }
        }),
      );

      return res.json({ results });
    } catch (e) {
      console.error('group pms-import error:', e);
      return res.status(500).json({ error: 'Batch import failed' });
    }
  });

  /**
   * POST /api/group/practices
   * Add a location to the caller's existing organization — the self-serve
   * counterpart to POST /api/admin/organizations for a DSO that's already
   * onboarded and is opening a new location.
   */
  r.post('/practices', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const organizationId = await callerAdminOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization admin access required' });

      const parsed = addOrgPracticeBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });

      const passwordHash = await unusedLegacyPasswordHash();
      const practice = await prisma.$transaction((tx) => createOrgPractice(tx, organizationId, { ...parsed.data, passwordHash }));

      return res.status(201).json({ practice: { id: practice.id, name: practice.name, timezone: practice.timezone } });
    } catch (e) {
      console.error('group add-practice error:', e);
      return res.status(500).json({ error: 'Failed to add location' });
    }
  });

  /** Number of org_admin members in an organization — used to guard against locking the org out of admin access. */
  async function countOrgAdmins(organizationId: string): Promise<number> {
    return prisma.organizationMember.count({ where: { organizationId, role: 'org_admin' } });
  }

  /**
   * GET /api/group/members
   * List the caller's organization membership roster.
   */
  r.get('/members', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const organizationId = await callerAdminOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization admin access required' });

      const members = await prisma.organizationMember.findMany({
        where: { organizationId },
        select: {
          userId: true,
          role: true,
          createdAt: true,
          user: { select: { email: true, displayName: true, isActive: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      return res.json({
        members: members.map((m) => ({
          userId: m.userId,
          role: m.role,
          email: m.user.email,
          displayName: m.user.displayName,
          isActive: m.user.isActive,
          joinedAt: m.createdAt,
        })),
      });
    } catch (e) {
      console.error('group members list error:', e);
      return res.status(500).json({ error: 'Failed to load organization members' });
    }
  });

  /**
   * PATCH /api/group/members/:userId
   * Promote/demote a co-admin within the caller's organization. Blocks
   * self-service (a member cannot change their own role) and blocks
   * demoting the org's last remaining admin, which would lock the
   * organization out of admin access entirely.
   */
  r.patch('/members/:userId', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const organizationId = await callerAdminOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization admin access required' });

      const targetUserId = req.params.userId;
      if (targetUserId === userId) return res.status(400).json({ error: 'Cannot change your own membership role' });

      const parsed = updateOrgMemberBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });

      const membership = await prisma.organizationMember.findFirst({ where: { organizationId, userId: targetUserId } });
      if (!membership) return res.status(404).json({ error: 'Member not found in your organization' });

      if (membership.role === 'org_admin' && parsed.data.role === 'org_member' && (await countOrgAdmins(organizationId)) <= 1) {
        return res.status(400).json({ error: 'Organization must have at least one admin' });
      }

      await prisma.organizationMember.update({
        where: { id: membership.id },
        data: { role: parsed.data.role },
      });

      return res.json({ userId: targetUserId, role: parsed.data.role });
    } catch (e) {
      console.error('group member update error:', e);
      return res.status(500).json({ error: 'Failed to update member' });
    }
  });

  /**
   * DELETE /api/group/members/:userId
   * Remove a member from the caller's organization. Same self-service and
   * last-admin guards as the role update above. A removed group_admin's
   * PracticeRole is downgraded to practice_owner on their home practice so
   * they don't retain an org-tier role with no organization behind it.
   */
  r.delete('/members/:userId', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
      const organizationId = await callerAdminOrganizationId(prisma, userId);
      if (!organizationId) return res.status(403).json({ error: 'Organization admin access required' });

      const targetUserId = req.params.userId;
      if (targetUserId === userId) return res.status(400).json({ error: 'Cannot remove your own membership' });

      const membership = await prisma.organizationMember.findFirst({ where: { organizationId, userId: targetUserId } });
      if (!membership) return res.status(404).json({ error: 'Member not found in your organization' });

      if (membership.role === 'org_admin' && (await countOrgAdmins(organizationId)) <= 1) {
        return res.status(400).json({ error: 'Organization must have at least one admin' });
      }

      await prisma.$transaction([
        prisma.organizationMember.delete({ where: { id: membership.id } }),
        prisma.user.updateMany({ where: { id: targetUserId, role: 'group_admin' }, data: { role: 'practice_owner' } }),
      ]);

      return res.json({ removed: true });
    } catch (e) {
      console.error('group member remove error:', e);
      return res.status(500).json({ error: 'Failed to remove member' });
    }
  });

  return r;
}
