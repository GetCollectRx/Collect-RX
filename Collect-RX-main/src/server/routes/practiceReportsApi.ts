import { Router } from 'express';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../middleware/requirePracticeSession.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import {
  computeAgingReport,
  computeCarrierStats,
  computeQueueStats,
  computePortfolioSummary,
} from '../services/platformReports.js';
import {
  getPracticeSettings,
  updatePracticeSettings,
} from '../services/practiceSettingsService.js';
import { blockFrontDeskReports, blockAuditorWrites, requireBillingOps } from '../middleware/requireUserRole.js';
import { withGrantChecks } from '../middleware/grantChecks.js';
import { getUserRole, isPracticeOwner, isPlatformAdmin } from '../accessControl/types.js';
import { buildSimpleReportPdf } from '../lib/simpleReportPdf.js';

/** Escape untrusted text before interpolating into report HTML (prevents XSS via practice/patient names). */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function reportHtml(title: string, rows: string[][]): string {
  const safeTitle = escapeHtml(title);
  const head = rows[0]?.map((h) => `<th>${escapeHtml(h)}</th>`).join('') ?? '';
  const body = rows
    .slice(1)
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font-family:system-ui,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}
th,td{border:1px solid #ccc;padding:8px;text-align:left}th{background:#f4f4f4}</style></head>
<body><h1>${safeTitle}</h1><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

export function createPracticeReportsRouter(): Router {
  const router = Router();
  router.use(authenticate);
  router.use(requirePracticeContext);

  router.get(
    '/:practiceId/reports/aging',
    blockFrontDeskReports,
    withGrantChecks(async (req, res) => {
      try {
        if (queryPracticeConflictsSession(req, req.params.practiceId)) {
          res.status(403).json({ success: false, error: 'practiceId does not match session' });
          return;
        }
        const practiceId = practiceIdFromSession(req);
        const timeframe = (req.query.timeframe as '30d' | '90d' | 'all') || '30d';
        const data = await computeAgingReport(prisma, practiceId, timeframe);
        res.json({ success: true, data });
      } catch (err) {
        res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
      }
    }),
  );

  router.get(
    '/:practiceId/reports/carriers',
    blockFrontDeskReports,
    withGrantChecks(async (req, res) => {
      try {
        if (queryPracticeConflictsSession(req, req.params.practiceId)) {
          res.status(403).json({ success: false, error: 'practiceId does not match session' });
          return;
        }
        const practiceId = practiceIdFromSession(req);
        const timeframe = (req.query.timeframe as '30d' | '90d' | 'all') || '30d';
        const data = await computeCarrierStats(prisma, practiceId, timeframe);
        res.json({ success: true, data });
      } catch (err) {
        res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
      }
    }),
  );

  router.get(
    '/:practiceId/reports/queue',
    blockFrontDeskReports,
    withGrantChecks(async (req, res) => {
      try {
        if (queryPracticeConflictsSession(req, req.params.practiceId)) {
          res.status(403).json({ success: false, error: 'practiceId does not match session' });
          return;
        }
        const practiceId = practiceIdFromSession(req);
        const data = await computeQueueStats(prisma, practiceId);
        res.json({ success: true, data });
      } catch (err) {
        res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
      }
    }),
  );

  router.post(
    '/:practiceId/reports/export',
    blockFrontDeskReports,
    withGrantChecks(async (req, res) => {
      try {
        if (queryPracticeConflictsSession(req, req.params.practiceId)) {
          res.status(403).json({ success: false, error: 'practiceId does not match session' });
          return;
        }
        const practiceId = practiceIdFromSession(req);
        const body = req.body as { reportType?: string; format?: string };
        const reportType = body.reportType ?? 'aging';
        const format = (body.format ?? 'html').toLowerCase();
        const practice = await prisma.practice.findUnique({
          where: { id: practiceId },
          select: { name: true },
        });
        if (reportType === 'carriers') {
          const { stats } = await computeCarrierStats(prisma, practiceId, '30d');
          const rows = [
            ['Carrier', 'Success %', 'Claims', 'Avg duration (s)', 'Trend'],
            ...stats.map((s) => [
              s.carrierName,
              s.successRate.toFixed(1),
              String(s.totalClaims),
              String(s.avgCallDurationSeconds),
              s.trend,
            ]),
          ];
          const title = `${practice?.name ?? 'Practice'} — Carrier Stats`;
          if (format === 'pdf') {
            const pdf = buildSimpleReportPdf(title, rows);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="carrier-stats-${practiceId}.pdf"`);
            res.send(pdf);
            return;
          }
          const html = reportHtml(title, rows);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Content-Disposition', `attachment; filename="carrier-stats-${practiceId}.html"`);
          res.send(html);
          return;
        }
        const { buckets } = await computeAgingReport(prisma, practiceId, '30d');
        const rows = [
          ['Bucket', 'Amount (CAD cents)', 'Claims', '% of total'],
          ...buckets.map((b) => [
            b.label,
            String(b.totalAmount),
            String(b.claimCount),
            b.percentOfTotal.toFixed(1),
          ]),
        ];
        const title = `${practice?.name ?? 'Practice'} — Aging Report`;
        if (format === 'pdf') {
          const pdf = buildSimpleReportPdf(title, rows);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="aging-report-${practiceId}.pdf"`);
          res.send(pdf);
          return;
        }
        const html = reportHtml(title, rows);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="aging-report-${practiceId}.html"`);
        res.send(html);
      } catch (err) {
        res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
      }
    }),
  );

  router.get('/:practiceId/dashboard', blockFrontDeskReports, withGrantChecks(async (req, res) => {
    try {
      if (queryPracticeConflictsSession(req, req.params.practiceId)) {
        res.status(403).json({ success: false, error: 'practiceId does not match session' });
        return;
      }
      const practiceId = practiceIdFromSession(req);
      const [aging, queue, carriers, openEscalations, recentCalls] = await Promise.all([
        computeAgingReport(prisma, practiceId, '30d'),
        computeQueueStats(prisma, practiceId),
        computeCarrierStats(prisma, practiceId, '30d'),
        prisma.callEscalation.count({ where: { practiceId, status: 'open' } }),
        prisma.callAttempt.findMany({
          where: { completedAt: { not: null }, claim: { practiceId } },
          orderBy: { initiatedAt: 'desc' },
          take: 5,
          include: { claim: { select: { claimNumber: true, carrierId: true } } },
        }),
      ]);
      res.json({
        success: true,
        data: {
          aging: aging.buckets,
          queueStats: queue,
          carrierStats: carriers.stats,
          openEscalations,
          recentCalls: recentCalls.map((c) => ({
            id: c.id,
            claimRef: c.claim.claimNumber,
            carrierId: c.claim.carrierId,
            outcome: c.outcome,
            initiatedAt: c.initiatedAt.toISOString(),
            durationSeconds: c.durationSeconds,
          })),
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  }));

  router.get('/:practiceId/settings', blockFrontDeskReports, withGrantChecks(async (req, res) => {
    try {
      if (queryPracticeConflictsSession(req, req.params.practiceId)) {
        res.status(403).json({ success: false, error: 'practiceId does not match session' });
        return;
      }
      const practiceId = practiceIdFromSession(req);
      const auth = req.auth!;
      const role = getUserRole(auth);
      if (role !== 'practice_owner' && !isPlatformAdmin(auth)) {
        res.status(403).json({ success: false, error: 'Settings access denied' });
        return;
      }
      const settings = await getPracticeSettings(prisma, practiceId);
      const { getPracticePmsContext } = await import('../pms/practicePmsContext.js');
      const pms = await getPracticePmsContext(prisma, practiceId);
      const practice = await prisma.practice.findUnique({
        where: { id: practiceId },
        select: { id: true, name: true, timezone: true },
      });
      res.json({ success: true, data: { practice, settings, pms } });
    } catch (err) {
      res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  }));

  router.put('/:practiceId/settings', blockFrontDeskReports, blockAuditorWrites, withGrantChecks(async (req, res) => {
    try {
      if (queryPracticeConflictsSession(req, req.params.practiceId)) {
        res.status(403).json({ success: false, error: 'practiceId does not match session' });
        return;
      }
      const practiceId = practiceIdFromSession(req);
      const auth = req.auth!;
      if (!isPracticeOwner(auth) && !isPlatformAdmin(auth)) {
        res.status(403).json({ success: false, error: 'Only practice owner or platform admin may update settings' });
        return;
      }
      const settings = await updatePracticeSettings(prisma, practiceId, req.body);
      res.json({ success: true, data: settings });
    } catch (err) {
      const msg = apiErrorMessageForResponse(err);
      if (msg.includes('callWindow') || msg.includes('E.164') || msg.includes('minimumClaimAgeDays')) {
        res.status(422).json({ success: false, error: msg });
        return;
      }
      res.status(500).json({ success: false, error: msg });
    }
  }));

  return router;
}

export function createPortfolioRouter(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/portfolio', requireBillingOps, async (_req, res) => {
    try {
      const data = await computePortfolioSummary(prisma);
      res.json({ success: true, data });
    } catch (err) {
      res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });
  return router;
}
