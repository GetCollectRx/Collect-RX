// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Analytics Routes
//
// GET /api/analytics/insurance — time saved, dollars recovered,
//                                resolution rates, call volume over time
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  getTimeSaved,
  getDollarsRecovered,
  getResolutionRateByCarrier,
  getCallVolumeOverTime,
} from '../services/insurance-analytics';
import { authenticate } from '../server/middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../server/middleware/requirePracticeSession';
import { apiErrorMessageForResponse } from '../server/apiErrorMessage.js';

const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);

// ---------------------------------------------------------------------------
// GET /api/analytics/insurance
// Aggregate metrics for the practice dashboard.
//
// Query params:
//   practiceId — optional; must match session when sent (metrics always scoped to session)
//   from       — ISO date (default: 30 days ago)
//   to         — ISO date (default: now)
//   bucket     — "day" | "week" (for call volume chart, default "day")
// ---------------------------------------------------------------------------
router.get('/insurance', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const bucket = (req.query.bucket as 'day' | 'week') ?? 'day';

    const to   = req.query.to   ? new Date(req.query.to as string)   : new Date();
    const from = req.query.from
      ? new Date(req.query.from as string)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const dateRange = { from, to };

    const [timeSaved, dollarsRecovered, resolutionByCarrier, callVolume] = await Promise.all([
      getTimeSaved(prisma, practiceId, dateRange),
      getDollarsRecovered(prisma, practiceId, dateRange),
      getResolutionRateByCarrier(prisma, practiceId),
      getCallVolumeOverTime(prisma, practiceId, dateRange, bucket),
    ]);

    return res.json({
      success: true,
      data: {
        timeSaved,
        dollarsRecovered,
        resolutionByCarrier,
        callVolume,
        window: { from: from.toISOString(), to: to.toISOString() },
      },
    });
  } catch (err) {
    console.error('[GET /analytics/insurance]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

function weekStartUtc(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay();
  const diff = (day + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - diff);
  return x.toISOString().slice(0, 10);
}

router.get('/collection-rate', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const whereBase = { practiceId, paymentStatus: { not: 'written_off' as const } };
    const [totalCount, paidCount, paidAgg, paidDays] = await Promise.all([
      prisma.patientBalance.count({ where: whereBase }),
      prisma.patientBalance.count({ where: { ...whereBase, paymentStatus: 'paid' } }),
      prisma.patientBalance.aggregate({
        where: { practiceId, paymentStatus: 'paid' },
        _sum: { amountPaid: true },
      }),
      prisma.patientBalance.findMany({
        where: { practiceId, paymentStatus: 'paid' },
        select: { daysSinceAdjudication: true },
        take: 500,
      }),
    ]);
    const totalCollected = Number(paidAgg._sum.amountPaid ?? 0);
    const avgDaysToPayment =
      paidDays.length > 0
        ? Math.round(
            paidDays.reduce((s, r) => s + r.daysSinceAdjudication, 0) / paidDays.length,
          )
        : 0;
    const collectionRate =
      totalCount > 0 ? Math.round((paidCount / totalCount) * 1000) / 10 : 0;
    return res.json({
      totalCount,
      paidCount,
      collectionRate,
      avgDaysToPayment,
      totalCollected,
    });
  } catch (err) {
    console.error('[GET /analytics/collection-rate]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.get('/stage-funnel', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const stages = ['outstanding', 'partial', 'paid', 'written_off'] as const;
    const rows = await prisma.patientBalance.groupBy({
      by: ['paymentStatus'],
      where: { practiceId },
      _count: true,
    });
    const byStatus = Object.fromEntries(rows.map((r) => [r.paymentStatus, r._count]));
    let prev = 0;
    const funnel = stages.map((stage) => {
      const count = byStatus[stage] ?? 0;
      const dropOff = prev > 0 ? Math.max(0, prev - count) : 0;
      prev = Math.max(prev, count);
      return { stage, count, dropOff };
    });
    return res.json({ funnel });
  } catch (err) {
    console.error('[GET /analytics/stage-funnel]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.get('/priority-balances', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const rows = await prisma.patientBalance.findMany({
      where: { practiceId, paymentStatus: { in: ['outstanding', 'partial'] } },
      orderBy: [{ daysSinceAdjudication: 'desc' }, { patientOwes: 'desc' }],
      take: 20,
      select: {
        id: true,
        patientFirstName: true,
        patientLastName: true,
        patientOwes: true,
        daysSinceAdjudication: true,
        reminderStatus: true,
        paymentStatus: true,
      },
    });
    const priorityBalances = rows.map((b) => ({
      id: b.id,
      patient: {
        displayName: `${b.patientFirstName} ${b.patientLastName}`.trim(),
      },
      daysOutstanding: b.daysSinceAdjudication,
      amount: b.patientOwes,
      currentStage: b.reminderStatus !== 'none' ? b.reminderStatus : b.paymentStatus,
    }));
    return res.json({ priorityBalances });
  } catch (err) {
    console.error('[GET /analytics/priority-balances]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.get('/message-effectiveness', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    async function rateFor(label: string, extra: Prisma.PatientBalanceWhereInput) {
      const total = await prisma.patientBalance.count({ where: { practiceId, ...extra } });
      if (total === 0) return null;
      const paid = await prisma.patientBalance.count({
        where: { practiceId, paymentStatus: 'paid', ...extra },
      });
      const paymentRate = Math.round((paid / total) * 1000) / 10;
      return { messageType: label, paymentRate };
    }
    const effectiveness = (
      await Promise.all([
        rateFor('Email reminder', { lastReminderEmailAt: { not: null } }),
        rateFor('SMS reminder', { lastReminderSmsAt: { not: null } }),
        rateFor('After 2nd reminder', { reminderStatus: { in: ['reminder_2', 'reminder_3'] } }),
      ])
    ).filter(Boolean) as { messageType: string; paymentRate: number }[];
    return res.json({ effectiveness });
  } catch (err) {
    console.error('[GET /analytics/message-effectiveness]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.get('/payment-trends', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const since = new Date(Date.now() - 12 * 7 * 24 * 60 * 60 * 1000);
    const paid = await prisma.patientBalance.findMany({
      where: { practiceId, paymentStatus: 'paid', updatedAt: { gte: since } },
      select: { updatedAt: true, amountPaid: true },
    });
    const byWeek = new Map<string, number>();
    for (const p of paid) {
      const w = weekStartUtc(p.updatedAt);
      byWeek.set(w, (byWeek.get(w) ?? 0) + Number(p.amountPaid ?? 0));
    }
    const trends = [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, totalAmount]) => ({ week, totalAmount }));
    return res.json({ trends });
  } catch (err) {
    console.error('[GET /analytics/payment-trends]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.get('/carrier-performance', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const rows = await prisma.patientBalance.groupBy({
      by: ['carrierCode', 'paymentStatus'],
      where: { practiceId, carrierCode: { not: null } },
      _count: true,
    });
    const byCarrier = new Map<string, { total: number; resolved: number }>();
    for (const r of rows) {
      const code = r.carrierCode ?? 'unknown';
      const cur = byCarrier.get(code) ?? { total: 0, resolved: 0 };
      cur.total += r._count;
      if (r.paymentStatus === 'paid') cur.resolved += r._count;
      byCarrier.set(code, cur);
    }
    const performance = [...byCarrier.entries()]
      .filter(([, v]) => v.total > 0)
      .map(([carrier, v]) => ({
        carrier,
        total: v.total,
        resolved: v.resolved,
        rate: Math.round((v.resolved / v.total) * 1000) / 10,
      }))
      .sort((a, b) => b.total - a.total);
    return res.json({ performance });
  } catch (err) {
    console.error('[GET /analytics/carrier-performance]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

router.get('/phase5-kpis', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const days = Math.min(365, parseInt(String(req.query.days ?? '30'), 10) || 30);
    const since = new Date(Date.now() - days * 86_400_000);
    const { getPhase5CallKpis } = await import('../server/services/phase5CallKpis.js');
    const data = await getPhase5CallKpis(prisma, practiceId, since);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /analytics/phase5-kpis]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/practice-performance/export', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [workItems, closeRuns, patientPaid, claims] = await Promise.all([
      prisma.workItem.aggregate({
        where: { practiceId, status: 'open' },
        _sum: { dollarsAtRisk: true },
        _count: true,
      }),
      prisma.arCloseRun.findMany({
        where: { practiceId, closeDate: { gte: since90 } },
        orderBy: { closeDate: 'asc' },
      }),
      prisma.patientBalance.aggregate({
        where: { practiceId, paymentStatus: 'paid' },
        _sum: { amountPaid: true, amountBilled: true },
      }),
      prisma.insuranceClaim.count({ where: { practiceId, status: { not: 'RESOLVED' } } }),
    ]);
    const billed = Number(patientPaid._sum.amountBilled ?? 0);
    const collected = Number(patientPaid._sum.amountPaid ?? 0);
    const grossCollectionRate = billed > 0 ? Math.round((collected / billed) * 1000) / 10 : 0;
    const lines: string[] = [
      'section,metric,value',
      `summary,open_ar_total,${Number(workItems._sum.dollarsAtRisk ?? 0)}`,
      `summary,open_work_items,${workItems._count}`,
      `summary,open_insurance_claims,${claims}`,
      `summary,gross_collection_rate_pct,${grossCollectionRate}`,
    ];
    for (const r of closeRuns) {
      lines.push(
        [
          'daily_close',
          r.closeDate.toISOString().slice(0, 10),
          Number(r.queueOpenTotal),
          Number(r.paymentsReceived),
          r.variancePct,
          r.validationPassed,
        ].join(','),
      );
    }
    const body = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="collectrx-practice-performance.csv"');
    return res.send(body);
  } catch (err) {
    console.error('[GET /analytics/practice-performance/export]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/practice-performance', async (req: Request, res: Response) => {
  try {
    const qPractice = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qPractice)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const [workItems, claims, closeRuns, patientPaid] = await Promise.all([
      prisma.workItem.aggregate({
        where: { practiceId, status: 'open' },
        _sum: { dollarsAtRisk: true },
        _count: true,
      }),
      prisma.insuranceClaim.findMany({
        where: { practiceId },
        select: { status: true, outstandingAmount: true, billedAmount: true, daysOutstanding: true, updatedAt: true },
      }),
      prisma.arCloseRun.findMany({
        where: { practiceId, closeDate: { gte: since90 } },
        orderBy: { closeDate: 'asc' },
        take: 90,
      }),
      prisma.patientBalance.aggregate({
        where: { practiceId, paymentStatus: 'paid' },
        _sum: { amountPaid: true, amountBilled: true },
      }),
    ]);

    const openInsurance = claims.filter((c) => c.status !== 'RESOLVED');
    const daysInAr =
      openInsurance.length > 0
        ? Math.round(
            openInsurance.reduce((s, c) => s + c.daysOutstanding, 0) / openInsurance.length,
          )
        : 0;

    const billed = Number(patientPaid._sum.amountBilled ?? 0);
    const collected = Number(patientPaid._sum.amountPaid ?? 0);
    const grossCollectionRate = billed > 0 ? Math.round((collected / billed) * 1000) / 10 : 0;

    const resolvedClaims = claims.filter((c) => c.status === 'RESOLVED');
    const insuranceRecovered = resolvedClaims.reduce(
      (s, c) => s + Math.max(0, Number(c.billedAmount) - Number(c.outstandingAmount)),
      0,
    );
    const insuranceBilled = claims.reduce((s, c) => s + Number(c.billedAmount), 0);
    const netCollectionRate =
      insuranceBilled > 0 ? Math.round((insuranceRecovered / insuranceBilled) * 1000) / 10 : 0;

    const agingTrend = closeRuns.map((r) => ({
      date: r.closeDate.toISOString().slice(0, 10),
      queueOpenTotal: Number(r.queueOpenTotal),
      variancePct: r.variancePct,
    }));

    const { getDenialAnalytics } = await import('../services/insurance-denial-analytics.js');
    const denials = await getDenialAnalytics(prisma, practiceId);

    return res.json({
      success: true,
      data: {
        openArTotal: Number(workItems._sum.dollarsAtRisk ?? 0),
        openWorkItemCount: workItems._count,
        daysInAr,
        grossCollectionRate,
        netCollectionRate,
        agingTrend,
        topDenialReasons: denials.topDenialReasons.slice(0, 5),
        denialByCarrier: denials.byCarrier.slice(0, 5),
      },
    });
  } catch (err) {
    console.error('[GET /analytics/practice-performance]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
