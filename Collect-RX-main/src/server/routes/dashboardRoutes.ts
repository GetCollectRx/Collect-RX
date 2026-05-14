import { Router, type Request, type Response } from 'express';
import type { ClaimStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../middleware/requirePracticeSession';
import { CARRIER_CONFIGS } from '../../carriers/adapter';

const router = Router();
router.use(authenticate);

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

    const claims = await prisma.insuranceClaim.findMany({
      where: { practiceId, status: { in: OPEN_STATUSES } },
      select: {
        outstandingAmount: true,
        daysOutstanding: true,
        status: true,
      },
    });

    let totalOpenAR = 0;
    const aging = { '0-30': 0, '31-60': 0, '>60': 0 };
    const stageCounts: Record<string, number> = {};
    for (const s of OPEN_STATUSES) stageCounts[s] = 0;

    for (const c of claims) {
      const amt = Number(c.outstandingAmount);
      totalOpenAR += amt;
      const d = c.daysOutstanding;
      if (d <= 30) aging['0-30'] += amt;
      else if (d <= 60) aging['31-60'] += amt;
      else aging['>60'] += amt;
      const st = String(c.status);
      stageCounts[st] = (stageCounts[st] ?? 0) + 1;
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

    const recentPayments = payments.slice(0, 8).map((p) => ({
      id: p.id,
      amount: p.amountCents / 100,
      paidAt: p.paidAt.toISOString(),
      patientLabel: p.balance.patient.displayName,
    }));

    return res.json({
      totalOpenAR,
      aging,
      stageCounts,
      openBalanceCount: claims.length,
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
    return res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
