import { Router, type Request, type Response } from 'express';
import { Prisma, type ClaimStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../middleware/requirePracticeSession';
import { redactDashboardRecentPayment } from '../accessControl/redaction.js';
import { CARRIER_CONFIGS } from '../../carriers/adapter';
import { syncWorkItemsForPractice } from '../services/workQueueService.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';

const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);

const OPEN_STATUSES: ClaimStatus[] = [
  'PENDING',
  'IN_QUEUE',
  'CALLING',
  'APPROVED_PENDING_PAYMENT',
  'ESCALATED',
  'ON_HOLD',
  'BLOCKED',
];

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
    if (queryPracticeConflictsSession(req, q || undefined)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);

    const existingWorkItems = await prisma.workItem.count({ where: { practiceId } });
    if (existingWorkItems === 0) {
      try {
        await syncWorkItemsForPractice(prisma, practiceId);
      } catch (syncErr) {
        console.warn('[GET /dashboard/stats] work queue bootstrap failed:', (syncErr as Error).message);
      }
    }

    const workAgg = await prisma.workItem.aggregate({
      where: { practiceId, status: 'open' },
      _sum: { dollarsAtRisk: true },
      _count: true,
    });

    const lastImport = await prisma.pmsImportRun.findFirst({
      where: { practiceId },
      orderBy: { startedAt: 'desc' },
      select: {
        startedAt: true,
        status: true,
        pmsSource: true,
        validationPassed: true,
      },
    });

    const claims = await prisma.insuranceClaim.findMany({
      where: { practiceId, status: { in: OPEN_STATUSES } },
      select: {
        outstandingAmount: true,
        daysOutstanding: true,
        status: true,
      },
    });

    const openWorkItems = await prisma.workItem.findMany({
      where: { practiceId, status: 'open' },
      select: { dollarsAtRisk: true, daysOutstanding: true, itemType: true },
    });

    let totalOpenAR = 0;
    const aging = { '0-30': 0, '31-60': 0, '>60': 0 };
    const stageCounts: Record<string, number> = {};
    for (const s of OPEN_STATUSES) stageCounts[s] = 0;

    for (const c of claims) {
      const amt = Number(c.outstandingAmount);
      totalOpenAR += amt;
      const st = String(c.status);
      stageCounts[st] = (stageCounts[st] ?? 0) + 1;
    }

    const useUnifiedAr = workAgg._count > 0;
    if (useUnifiedAr) {
      aging['0-30'] = 0;
      aging['31-60'] = 0;
      aging['>60'] = 0;
      for (const w of openWorkItems) {
        const amt = Number(w.dollarsAtRisk);
        const d = w.daysOutstanding;
        if (d <= 30) aging['0-30'] += amt;
        else if (d <= 60) aging['31-60'] += amt;
        else aging['>60'] += amt;
      }
    } else {
      for (const c of claims) {
        const amt = Number(c.outstandingAmount);
        const d = c.daysOutstanding;
        if (d <= 30) aging['0-30'] += amt;
        else if (d <= 60) aging['31-60'] += amt;
        else aging['>60'] += amt;
      }
    }

    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);

    const claimsResolvedToday = await prisma.insuranceClaim.count({
      where: {
        practiceId,
        status: 'RESOLVED',
        updatedAt: { gte: startOfUtcDay },
      },
    });

    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const payments = await prisma.paymentEvent.findMany({
      where: { balance: { practiceId }, paidAt: { gte: weekAgo } },
      include: { balance: { include: { patient: true } } },
      orderBy: { paidAt: 'desc' },
      take: 12,
    });

    let revenueToday = 0;
    let revenueThisWeek = 0;
    const todayMs = startOfUtcDay.getTime();
    for (const p of payments) {
      const cents = p.amountCents / 100;
      revenueThisWeek += cents;
      if (p.paidAt.getTime() >= todayMs) revenueToday += cents;
    }

    const callsPlacedToday = await prisma.callAttempt.count({
      where: {
        initiatedAt: { gte: startOfUtcDay },
        claim: { practiceId },
      },
    });

    const activeBlocks = await prisma.carrierBlockEvent.findMany({
      where: { practiceId, resumedAt: null },
      select: { carrierId: true },
    });
    const blockedCarriers = activeBlocks.map((b) => ({
      code: b.carrierId,
      name: CARRIER_CONFIGS[b.carrierId]?.displayName ?? b.carrierId,
    }));

    const stripeAcct = await prisma.stripeConnectAccount.findUnique({ where: { practiceId } });
    const patientPaymentsReady = Boolean(
      stripeAcct?.chargesEnabled && process.env.STRIPE_SECRET_KEY?.trim(),
    );

    const recentPayments = payments.slice(0, 8).map((p) =>
      redactDashboardRecentPayment(
        {
          id: p.id,
          amount: p.amountCents / 100,
          paidAt: p.paidAt.toISOString(),
          patientLabel: p.balance.patient?.displayName?.trim() || 'Patient',
        },
        req.auth,
      ),
    );

    const unifiedOpenAR = Number(workAgg._sum.dollarsAtRisk ?? 0);

    return res.json({
      totalOpenAR: useUnifiedAr ? unifiedOpenAR : totalOpenAR,
      aging,
      stageCounts,
      openBalanceCount: claims.length,
      openWorkItemCount: workAgg._count,
      insuranceOpenAR: totalOpenAR,
      unifiedAr: useUnifiedAr,
      lastPmsImport: lastImport
        ? {
            at: lastImport.startedAt.toISOString(),
            status: lastImport.status,
            source: lastImport.pmsSource,
            validationPassed: lastImport.validationPassed,
          }
        : null,
      claimsResolvedToday,
      revenueToday,
      revenueThisWeek,
      telephony: { callsPlacedToday, activeCalls: [] as unknown[] },
      recentPayments,
      operationalAlerts: {
        blockedCarriers,
        patientPaymentsReady,
      },
    });
  } catch (err) {
    console.error('[GET /dashboard/stats]', err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021') {
      return res.status(503).json({
        error:
          'Database schema is missing CollectRx tables. On this machine run: npx prisma migrate deploy (from Collect-RX-main with DATABASE_URL set).',
      });
    }
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.get('/ar-close', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
    if (queryPracticeConflictsSession(req, q || undefined)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const limit = Math.min(60, parseInt(String(req.query.limit ?? '30'), 10) || 30);
    const runs = await prisma.arCloseRun.findMany({
      where: { practiceId },
      orderBy: { closeDate: 'desc' },
      take: limit,
    });
    return res.json({
      success: true,
      data: runs.map((r) => ({
        closeDate: r.closeDate.toISOString().slice(0, 10),
        queueOpenTotal: Number(r.queueOpenTotal),
        paymentsReceived: Number(r.paymentsReceived),
        variancePct: r.variancePct,
        validationPassed: r.validationPassed,
      })),
    });
  } catch (err) {
    console.error('[GET /dashboard/ar-close]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.post('/ar-close/run', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const { runDailyArCloseForPractice } = await import('../jobs/dailyArClose.js');
    const result = await runDailyArCloseForPractice(prisma, practiceId);
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error('[POST /dashboard/ar-close/run]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

export default router;
