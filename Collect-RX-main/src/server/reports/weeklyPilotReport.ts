// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Weekly Pilot Report
//
// Assembles per-practice weekly metrics (calls placed, claims resolved,
// revenue recovered, staff time saved) and emails them to the practice
// owner via SendGrid.
//
// Gated behind WEEKLY_PILOT_REPORT_ENABLED — no practice is live yet, so
// the cron is inert until the flag is set in the host environment.
// ─────────────────────────────────────────────────────────────────────────────

import type { PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger.js';

export interface WeeklyPracticeMetrics {
  practiceId: string;
  practiceName: string;
  windowDays: number;
  periodStart: Date;
  periodEnd: Date;
  callsPlaced: number;
  claimsResolved: number;
  revenueRecovered: number;
  callMinutes: number;
}

export interface WeeklyReportEmail {
  subject: string;
  html: string;
  text: string;
}

export async function buildWeeklyPracticeMetrics(
  prisma: PrismaClient,
  practiceId: string,
  now = new Date(),
): Promise<WeeklyPracticeMetrics> {
  const windowDays = 7;
  const periodEnd = now;
  const periodStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const practice = await prisma.practice.findUnique({
    where: { id: practiceId },
    select: { id: true, name: true },
  });
  if (!practice) {
    throw new Error(`Practice ${practiceId} not found`);
  }

  const attempts = await prisma.callAttempt.findMany({
    where: {
      initiatedAt: { gte: periodStart, lte: periodEnd },
      claim: { practiceId },
    },
    select: {
      outcome: true,
      durationSeconds: true,
      claim: { select: { billedAmount: true } },
    },
  });

  const resolved = attempts.filter((a) => a.outcome === 'RESOLVED');
  const revenueRecovered = resolved.reduce(
    (sum, a) => sum + Number(a.claim?.billedAmount ?? 0),
    0,
  );
  const callSeconds = attempts.reduce((sum, a) => sum + (a.durationSeconds ?? 0), 0);

  return {
    practiceId: practice.id,
    practiceName: practice.name,
    windowDays,
    periodStart,
    periodEnd,
    callsPlaced: attempts.length,
    claimsResolved: resolved.length,
    revenueRecovered,
    callMinutes: Math.round(callSeconds / 60),
  };
}

function formatCad(amount: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount);
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', year: 'numeric' });
}

export function renderWeeklyReportEmail(metrics: WeeklyPracticeMetrics): WeeklyReportEmail {
  const period = `${formatDate(metrics.periodStart)} – ${formatDate(metrics.periodEnd)}`;
  const subject = `CollectRx weekly report — ${metrics.practiceName} (${period})`;

  const rows: Array<[string, string]> = [
    ['Carrier calls placed', String(metrics.callsPlaced)],
    ['Claims resolved', String(metrics.claimsResolved)],
    ['Revenue recovered', formatCad(metrics.revenueRecovered)],
    ['Staff phone time saved', `${metrics.callMinutes} minutes`],
  ];

  const html = `
    <h2>Your CollectRx week in review</h2>
    <p>${metrics.practiceName} &middot; ${period}</p>
    <table style="border-collapse:collapse;font-size:15px">
      ${rows
        .map(
          ([label, value]) =>
            `<tr><td style="padding:6px 16px 6px 0;color:#555">${label}</td>` +
            `<td style="padding:6px 0;font-weight:bold">${value}</td></tr>`,
        )
        .join('\n      ')}
    </table>
    <p style="font-size:13px;color:#666">Questions about this report? Reply to this email and our team will follow up.</p>
  `;

  const text = [
    `Your CollectRx week in review`,
    `${metrics.practiceName} — ${period}`,
    '',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'Questions about this report? Reply to this email and our team will follow up.',
  ].join('\n');

  return { subject, html, text };
}

async function getSendGrid(): Promise<import('@sendgrid/mail').MailService | null> {
  if (!process.env.SENDGRID_API_KEY) return null;
  const sg = (await import('@sendgrid/mail')).default;
  sg.setApiKey(process.env.SENDGRID_API_KEY);
  return sg;
}

export function weeklyPilotReportEnabled(): boolean {
  return ['1', 'true', 'yes'].includes(
    String(process.env.WEEKLY_PILOT_REPORT_ENABLED ?? '').toLowerCase(),
  );
}

async function findPracticeOwnerEmail(prisma: PrismaClient, practiceId: string): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { practiceId, role: 'practice_owner', isActive: true },
    select: { email: true },
    orderBy: { createdAt: 'asc' },
  });
  return owner?.email ?? null;
}

export interface WeeklyReportRunResult {
  sent: number;
  skippedNoOwner: number;
  failed: number;
}

/**
 * Send the weekly report to every practice's owner. Practices without an
 * active practice_owner user are skipped (nowhere to send). Send failures
 * are logged per practice and never abort the run for the others.
 */
export async function sendWeeklyPilotReports(
  prisma: PrismaClient,
  now = new Date(),
): Promise<WeeklyReportRunResult> {
  const result: WeeklyReportRunResult = { sent: 0, skippedNoOwner: 0, failed: 0 };

  const sg = await getSendGrid();
  if (!sg) {
    logger.warn('[weeklyPilotReport] SENDGRID_API_KEY unset — skipping weekly report run', {});
    return result;
  }

  const from = process.env.SENDGRID_FROM_EMAIL;
  if (!from) {
    logger.warn('[weeklyPilotReport] SENDGRID_FROM_EMAIL unset — skipping weekly report run', {});
    return result;
  }

  const practices = await prisma.practice.findMany({ select: { id: true } });

  for (const practice of practices) {
    try {
      const ownerEmail = await findPracticeOwnerEmail(prisma, practice.id);
      if (!ownerEmail) {
        result.skippedNoOwner++;
        continue;
      }

      const metrics = await buildWeeklyPracticeMetrics(prisma, practice.id, now);
      const email = renderWeeklyReportEmail(metrics);

      await sg.send({
        to: ownerEmail,
        from: { email: from, name: process.env.SENDGRID_FROM_NAME ?? 'CollectRx' },
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      result.sent++;
    } catch (err) {
      result.failed++;
      logger.error('[weeklyPilotReport] send failed', { practiceId: practice.id, error: err });
    }
  }

  return result;
}
