import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/authenticate';
import { authorizeRole } from '../middleware/authorizeRole';

/**
 * Group/DSO Admin API — PHI-free aggregate views across all practices.
 * Accessible to group_admin and platform_dev only.
 */
export function createGroupAdminRouter(prisma: PrismaClient): Router {
  const r = Router();
  r.use(authenticate);
  r.use(authorizeRole('group_admin'));

  /**
   * GET /api/group/practices-summary
   * Returns per-practice stats without any patient PHI.
   */
  r.get('/practices-summary', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
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
          const [
            totalClaims,
            resolvedClaims,
            activeUsers,
          ] = await Promise.all([
            prisma.insuranceClaim.count({ where: { practiceId: p.id } }),
            prisma.insuranceClaim.count({ where: { practiceId: p.id, status: { in: ['RESOLVED', 'APPROVED_PENDING_PAYMENT'] } } }),
            prisma.user.count({ where: { practiceId: p.id, isActive: true } }),
          ]);

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

  r.get('/compliance/export', async (req: Request, res: Response) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) return res.status(403).json({ error: 'Organization membership required' });
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
          const [phiAccessCount, openGates, openUnderpayments] = await Promise.all([
            prisma.phiAccessEvent.count({ where: { practiceId } }),
            prisma.claimRecoveryAction.count({
              where: { practiceId, status: { in: ['OPEN', 'BLOCKING'] }, clearedAt: null },
            }),
            prisma.underpaymentCase.count({ where: { practiceId, status: 'OPEN' } }),
          ]);
          return { practiceId, phiAccessCount, openGates, openUnderpayments };
        }),
      );
      return res.json({ practices: summaries });
    } catch {
      return res.status(500).json({ error: 'Compliance export failed' });
    }
  });

  return r;
}
