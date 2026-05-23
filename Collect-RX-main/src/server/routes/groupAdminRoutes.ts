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
  r.get('/practices-summary', async (_req: Request, res: Response) => {
    try {
      const practices = await prisma.practice.findMany({
        select: { id: true, name: true, timezone: true, subscriptionStatus: true },
        orderBy: { name: 'asc' },
      });

      const summaries = await Promise.all(
        practices.map(async (p) => {
          const [
            totalClaims,
            resolvedClaims,
            outstandingAR,
            activeUsers,
          ] = await Promise.all([
            prisma.insuranceClaim.count({ where: { practiceId: p.id } }),
            prisma.insuranceClaim.count({ where: { practiceId: p.id, status: { in: ['resolved', 'paid', 'closed'] } } }),
            prisma.patientBalance.aggregate({
              where: { practiceId: p.id, paymentStatus: { in: ['outstanding', 'partial'] } },
              _sum: { patientOwes: true },
            }),
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
            outstandingAR: outstandingAR._sum.patientOwes ?? 0,
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

  return r;
}
