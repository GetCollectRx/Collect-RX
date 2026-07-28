/**
 * Daily claim status digest — sent to practice owners/managers summarizing queue, denials, and recoveries.
 */

import type { PrismaClient } from '@prisma/client';
import type { DenialCategoryRow } from '../../services/insurance-denial-analytics.js';

async function getSendGrid() {
  if (!process.env.SENDGRID_API_KEY) return null;
  const sg = (await import('@sendgrid/mail')).default;
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  return sg;
}

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL || 'https://app.collectrx.ca').replace(/\/$/, '');
}

export interface DigestData {
  practiceName: string;
  totalQueued: number;
  resolvedToday: number;
  deniedToday: number;
  pendingPayments: number;
  outstandingAmount: number;
  topDenialCategories: DenialCategoryRow[];
  carriers: Array<{ name: string; queuedCount: number; successRate: number }>;
}

export async function sendDailyDigestEmail(opts: {
  toEmail: string;
  displayName: string;
  data: DigestData;
}): Promise<void> {
  const sg = await getSendGrid();
  const dashboardUrl = `${appBaseUrl()}/dashboard`;
  const { data } = opts;

  const text = [
    `Hi ${opts.displayName},`,
    '',
    `Daily Claim Recovery Summary for ${data.practiceName}`,
    '',
    `Queue Status:`,
    `  • Total in queue: ${data.totalQueued} claims`,
    `  • Resolved today: ${data.resolvedToday}`,
    `  • Denied today: ${data.deniedToday}`,
    '',
    `Financials:`,
    `  • Outstanding: $${data.outstandingAmount.toFixed(2)}`,
    `  • Awaiting payment: ${data.pendingPayments} claims`,
    '',
    `Top Denial Reasons:`,
    ...data.topDenialCategories.slice(0, 5).map((d) => `  • ${d.category}: ${d.count} (${d.percentOfDenials}%)`),
    '',
    `Carrier Performance:`,
    ...data.carriers.map((c) => `  • ${c.name}: ${c.queuedCount} queued, ${c.successRate}% success rate`),
    '',
    `View full dashboard: ${dashboardUrl}`,
    '',
    '— CollectRx Automated Digest',
  ].join('\n');

  if (!sg) {
    console.log(
      `[daily-digest] SENDGRID_API_KEY not set — skipping email.\n  To: ${opts.toEmail}\n  Data: ${JSON.stringify(data)}`,
    );
    return;
  }

  const from = {
    email: process.env.SENDGRID_FROM_EMAIL || 'noreply@collectrx.ca',
    name: process.env.SENDGRID_FROM_NAME || 'CollectRx',
  };

  const carrierRows = data.carriers
    .map(
      (c) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:12px;text-align:left">${c.name}</td>
      <td style="padding:12px;text-align:center">${c.queuedCount}</td>
      <td style="padding:12px;text-align:center">${c.successRate}%</td>
    </tr>
  `,
    )
    .join('');

  const denialRows = data.topDenialCategories
    .slice(0, 5)
    .map(
      (d) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:12px;text-align:left">${d.category}</td>
      <td style="padding:12px;text-align:center">${d.count}</td>
      <td style="padding:12px;text-align:center">${d.percentOfDenials}%</td>
    </tr>
  `,
    )
    .join('');

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
      <div style="background:#f8f8f8;padding:16px;border-radius:8px;margin-bottom:24px">
        <p style="font-size:18px;font-weight:700;color:#111;margin:0">Daily Claim Recovery Summary</p>
        <p style="color:#666;font-size:14px;margin:8px 0 0 0">${data.practiceName}</p>
      </div>

      <div style="margin-bottom:24px">
        <p style="font-size:14px;font-weight:600;color:#111;margin-bottom:12px">Queue Status</p>
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:6px;padding:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div>
              <p style="color:#666;font-size:12px;margin:0">Total in Queue</p>
              <p style="font-size:24px;font-weight:700;color:#0f6e56;margin:8px 0 0 0">${data.totalQueued}</p>
            </div>
            <div>
              <p style="color:#666;font-size:12px;margin:0">Resolved Today</p>
              <p style="font-size:24px;font-weight:700;color:#0f6e56;margin:8px 0 0 0">${data.resolvedToday}</p>
            </div>
            <div>
              <p style="color:#666;font-size:12px;margin:0">Denied Today</p>
              <p style="font-size:24px;font-weight:700;color:#d32f2f;margin:8px 0 0 0">${data.deniedToday}</p>
            </div>
            <div>
              <p style="color:#666;font-size:12px;margin:0">Awaiting Payment</p>
              <p style="font-size:24px;font-weight:700;color:#f57c00;margin:8px 0 0 0">${data.pendingPayments}</p>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-bottom:24px">
        <p style="font-size:14px;font-weight:600;color:#111;margin-bottom:12px">Outstanding Amount</p>
        <div style="background:#fff;border:1px solid #e0e0e0;border-radius:6px;padding:16px">
          <p style="font-size:32px;font-weight:700;color:#0f6e56;margin:0">$${data.outstandingAmount.toFixed(2)}</p>
        </div>
      </div>

      <div style="margin-bottom:24px">
        <p style="font-size:14px;font-weight:600;color:#111;margin-bottom:12px">Top Denial Reasons</p>
        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:12px;text-align:left;font-weight:600;color:#111;border-right:1px solid #e0e0e0">Reason</th>
              <th style="padding:12px;text-align:center;font-weight:600;color:#111;border-right:1px solid #e0e0e0">Count</th>
              <th style="padding:12px;text-align:center;font-weight:600;color:#111">%</th>
            </tr>
          </thead>
          <tbody>
            ${denialRows}
          </tbody>
        </table>
      </div>

      <div style="margin-bottom:24px">
        <p style="font-size:14px;font-weight:600;color:#111;margin-bottom:12px">Carrier Performance</p>
        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e0e0e0;border-radius:6px;overflow:hidden">
          <thead>
            <tr style="background:#f5f5f5">
              <th style="padding:12px;text-align:left;font-weight:600;color:#111;border-right:1px solid #e0e0e0">Carrier</th>
              <th style="padding:12px;text-align:center;font-weight:600;color:#111;border-right:1px solid #e0e0e0">Queued</th>
              <th style="padding:12px;text-align:center;font-weight:600;color:#111">Success %</th>
            </tr>
          </thead>
          <tbody>
            ${carrierRows}
          </tbody>
        </table>
      </div>

      <a href="${dashboardUrl}"
         style="display:inline-block;padding:12px 24px;background:#0f6e56;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin:16px 0">
        View Full Dashboard
      </a>

      <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:16px">
        This is an automated daily digest from CollectRx. You can customize or disable these emails in your dashboard settings.
      </p>
    </div>
  `;

  await sg.send({
    to: opts.toEmail,
    from,
    subject: `Daily Claim Recovery Summary — ${data.practiceName}`,
    text,
    html,
  });
}

export async function computeDigestData(
  prisma: PrismaClient,
  practiceId: string,
): Promise<DigestData> {
  const { getDenialAnalytics } = await import('../../services/insurance-denial-analytics.js');
  const { getQueueSummary } = await import('../frontDesk/batchClaimStatusService.js');
  const { CARRIER_CONFIGS } = await import('../../carriers/adapter.js');

  const [denialAnalytics, queueSummary, allClaims] = await Promise.all([
    getDenialAnalytics(prisma, practiceId),
    getQueueSummary(prisma, practiceId),
    prisma.insuranceClaim.findMany({
      where: { practiceId },
      select: {
        carrierId: true,
        status: true,
        outstandingAmount: true,
        callAttempts: {
          select: { outcome: true, completedAt: true },
          orderBy: { completedAt: 'desc' },
          take: 1,
        },
      },
    }),
  ]);

  const practice = await prisma.practice.findUniqueOrThrow({
    where: { id: practiceId },
    select: { name: true },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const resolvedToday = allClaims.filter(
    (c) => c.status === 'RESOLVED' && c.callAttempts[0]?.completedAt && c.callAttempts[0].completedAt >= today,
  ).length;

  const deniedToday = allClaims.filter(
    (c) =>
      (c.status === 'DENIED' || c.status === 'ESCALATED') &&
      c.callAttempts[0]?.outcome === 'DENIED' &&
      c.callAttempts[0]?.completedAt &&
      c.callAttempts[0].completedAt >= today,
  ).length;

  const outstandingAmount = allClaims.reduce((sum, c) => sum + Number(c.outstandingAmount), 0);
  const pendingPayments = allClaims.filter((c) => c.status === 'APPROVED_PENDING_PAYMENT').length;

  const carrierStats = new Map<string, { queued: number; resolved: number }>();
  for (const claim of allClaims) {
    const carrierId = claim.carrierId;
    const carrierName = carrierId;

    if (!carrierStats.has(carrierName)) {
      carrierStats.set(carrierName, { queued: 0, resolved: 0 });
    }

    const stat = carrierStats.get(carrierName)!;
    if (queueSummary.byCarrier[carrierId]) {
      stat.queued = queueSummary.byCarrier[carrierId];
    }
    if (claim.status === 'RESOLVED') {
      stat.resolved += 1;
    }
  }

  const carriers = [...carrierStats.entries()].map(([name, stat]) => ({
    name,
    queuedCount: stat.queued,
    successRate: Math.round(((stat.resolved / (stat.queued || 1)) * 100 + Number.EPSILON) * 10) / 10,
  }));

  return {
    practiceName: practice.name,
    totalQueued: queueSummary.totalQueued,
    resolvedToday,
    deniedToday,
    pendingPayments,
    outstandingAmount,
    topDenialCategories: denialAnalytics.byCategory.slice(0, 5),
    carriers: carriers.sort((a, b) => b.queuedCount - a.queuedCount).slice(0, 10),
  };
}
