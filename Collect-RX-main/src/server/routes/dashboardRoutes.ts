import { Router, type Request, type Response } from 'express';
import { Prisma, type ClaimStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../middleware/requirePracticeSession';
import { CARRIER_CONFIGS } from '../../carriers/adapter';
import { syncWorkItemsForPractice } from '../services/workQueueService.js';
import { computeRecoveryMetrics } from '../recovery/recoveryMetrics.js';
import { computeCarrierStats } from '../services/platformReports.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { useOwnerPracticeApi } from '../middleware/ownerPracticeApi.js';
import { getPracticePmsContext } from '../pms/practicePmsContext.js';
import { normalizePmsVendorId, vendorDisplayName } from '../pms/pmsRegistry.js';
import { logger } from '../observability/logger.js';

const router = Router();
useOwnerPracticeApi(router);

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
        logger.warn('[GET /dashboard/stats] work queue bootstrap failed', { error: syncErr });
      }
    }

    const workAgg = await prisma.workItem.aggregate({
      where: { practiceId, status: 'open' },
      _sum: { dollarsAtRisk: true },
      _count: true,
    });

    const [lastImport, pms] = await Promise.all([
      prisma.pmsImportRun.findFirst({
        where: { practiceId },
        orderBy: { startedAt: 'desc' },
        select: {
          startedAt: true,
          status: true,
          pmsSource: true,
          validationPassed: true,
          recordsImported: true,
          recordsTotal: true,
          recordsFailed: true,
        },
      }),
      getPracticePmsContext(prisma, practiceId),
    ]);

    const claims = await prisma.insuranceClaim.findMany({
      where: { practiceId, deletedAt: null, status: { in: OPEN_STATUSES } },
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
        deletedAt: null,
        status: 'RESOLVED',
        updatedAt: { gte: startOfUtcDay },
      },
    });

    const revenueToday = 0;
    let revenueThisWeek = 0;

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

    let decliningCarriers: { code: string; name: string; successRate: number }[] = [];
    try {
      const { stats } = await computeCarrierStats(prisma, practiceId, '30d');
      decliningCarriers = stats
        .filter((c) => c.trend === 'declining' && c.totalClaims >= 3)
        .map((c) => ({ code: c.carrierId, name: c.carrierName, successRate: c.successRate }));
    } catch (carrierStatsErr) {
      logger.warn('[GET /dashboard/stats] carrier trend check failed', { error: carrierStatsErr });
    }

    const unifiedOpenAR = Number(workAgg._sum.dollarsAtRisk ?? 0);

    let recoveryMetrics = null;
    try {
      recoveryMetrics = await computeRecoveryMetrics(prisma, practiceId);
      revenueThisWeek = recoveryMetrics?.dollarsRecoveredSyncVerifiedLast30Days ?? 0;
    } catch (recoveryErr) {
      logger.warn('[GET /dashboard/stats] recovery metrics failed', { error: recoveryErr });
    }

    return res.json({
      totalOpenAR: useUnifiedAr ? unifiedOpenAR : totalOpenAR,
      aging,
      stageCounts,
      openBalanceCount: claims.length,
      openWorkItemCount: workAgg._count,
      insuranceOpenAR: totalOpenAR,
      unifiedAr: useUnifiedAr,
      recoveryMetrics,
      pms,
      lastPmsImport: lastImport
        ? {
            at: lastImport.startedAt.toISOString(),
            status: lastImport.status,
            source: lastImport.pmsSource,
            sourceDisplayName: vendorDisplayName(
              normalizePmsVendorId(lastImport.pmsSource) ?? 'other',
            ),
            validationPassed: lastImport.validationPassed,
            recordsImported: lastImport.recordsImported,
            recordsTotal: lastImport.recordsTotal,
            recordsFailed: lastImport.recordsFailed,
          }
        : null,
      claimsResolvedToday,
      revenueToday,
      revenueThisWeek,
      telephony: { callsPlacedToday, activeCalls: [] as unknown[] },
      operationalAlerts: {
        blockedCarriers,
        decliningCarriers,
      },
    });
  } catch (err) {
    logger.error('[GET /dashboard/stats]', { error: err });
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
    logger.error('[GET /dashboard/ar-close]', { error: err });
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
    logger.error('[POST /dashboard/ar-close/run]', { error: err });
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

/** Server-driven onboarding checklist for practice setup wizard. */
router.get('/setup-status', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const [practice, lastImport, claimCount, callCount, pms] = await Promise.all([
      prisma.practice.findUnique({
        where: { id: practiceId },
        select: { name: true, billingPhone: true, npi: true, settings: true },
      }),
      prisma.pmsImportRun.findFirst({
        where: { practiceId, status: 'success', recordsImported: { gt: 0 } },
        orderBy: { startedAt: 'desc' },
        select: { id: true, recordsImported: true },
      }),
      prisma.insuranceClaim.count({ where: { practiceId, deletedAt: null } }),
      prisma.callAttempt.count({ where: { claim: { practiceId } } }),
      getPracticePmsContext(prisma, practiceId),
    ]);

    const pmsVendorSet = Boolean(pms.vendorId && pms.vendorId !== 'other');
    const identitySet = Boolean(practice?.name && practice?.billingPhone && practice?.npi);
    const vapiReady = Boolean(process.env.VAPI_API_KEY?.trim());

    const steps = [
      {
        id: 'csv_import',
        title: 'Import outstanding claims',
        detail: 'Upload a CSV export so CollectRx knows which claims to follow up.',
        done: Boolean(lastImport),
        href: '/import',
      },
      {
        id: 'pms_vendor',
        title: 'Confirm PMS vendor',
        detail: 'Set your practice management system for consistent column mapping.',
        done: pmsVendorSet || Boolean(lastImport),
        href: '/settings',
      },
      {
        id: 'claims_verified',
        title: 'Verify claims in queue',
        detail: 'Open Claims and confirm outstanding balances look correct.',
        done: claimCount > 0,
        href: '/insurance?tab=queue',
      },
      {
        id: 'practice_identity',
        title: 'Practice identity for carrier calls',
        detail: 'Name, callback number, and NPI are spoken on every carrier call.',
        done: identitySet,
        href: '/settings',
      },
      {
        id: 'integrations',
        title: 'Voice agent configured',
        detail: 'Vapi must be connected before CollectRx can dial carriers.',
        done: vapiReady,
        href: '/admin/integrations',
      },
      {
        id: 'first_call',
        title: 'First carrier call placed',
        detail: 'Optional — confirms the full loop is working end-to-end.',
        done: callCount > 0,
        href: '/console',
      },
    ];

    const complete = steps.filter((s) => s.done).length;
    const readyForCalls = Boolean(lastImport && claimCount > 0 && identitySet && vapiReady);

    return res.json({
      success: true,
      data: {
        steps,
        complete,
        total: steps.length,
        readyForCalls,
        claimCount,
        lastImportAt: lastImport ? undefined : null,
      },
    });
  } catch (err) {
    logger.error('[GET /dashboard/setup-status]', { error: err });
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
