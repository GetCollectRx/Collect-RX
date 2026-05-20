/**
 * CollectRx — Patient Balances Data Layer
 *
 * All reads/writes for patient_balances table.
 * PHI stays in PostgreSQL — this module never ships patient data to external services.
 */

import { randomBytes, randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';

interface BalanceRow {
  patient_first_name?: string;
  patient_last_name?: string;
  patient_owes?: number | string;
  amount_billed?: number | string;
  insurance_paid?: number | string;
  treatment_date?: string;
  adjudication_date?: string;
  procedure_code?: string;
  procedure_description?: string;
  abeldent_patient_id?: string;
  patient_email?: string;
  patient_phone?: string;
  days_since_adjudication?: number | string;
}

interface UpsertResults {
  imported: number;
  updated: number;
  skipped: number;
  errors: Array<{ patient: string; error: string }>;
}

// Upsert from AbelDent sync
export async function upsertBalances(rows: BalanceRow[], practiceId?: string): Promise<UpsertResults> {
  const results: UpsertResults = { imported: 0, updated: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const fileRowLine = i + 2; // row 1 = header
    const rowLabel = (detail: string) =>
      `Row ${fileRowLine}` + (detail ? ` — ${detail}` : '');

    try {
      const allEmpty = Object.values(row).every(
        (v) => v === undefined || String(v).trim() === ''
      );
      if (allEmpty) {
        continue;
      }

      const firstName = String(row.patient_first_name || '').trim();
      const lastName = String(row.patient_last_name || '').trim();
      const patientOwes = parseFloat(String(row.patient_owes || ''));

      if (!firstName || !lastName) {
        results.errors.push({
          patient: rowLabel(''),
          error: 'patient_first_name and patient_last_name are required (non-empty)',
        });
        continue;
      }

      if (isNaN(patientOwes) || patientOwes <= 0) {
        results.errors.push({
          patient: rowLabel(`${firstName} ${lastName}`.trim()),
          error: 'patient_owes must be a number greater than 0',
        });
        continue;
      }

      const amountBilled = parseFloat(String(row.amount_billed || 0)) || 0;
      const insurancePaid = parseFloat(String(row.insurance_paid || 0)) || 0;
      const treatmentDate = row.treatment_date ? new Date(row.treatment_date) : null;
      const adjudication = row.adjudication_date ? new Date(row.adjudication_date) : null;
      const procedureCode = row.procedure_code || null;
      const abeldentId = row.abeldent_patient_id || null;

      let daysSince = parseInt(String(row.days_since_adjudication || 0), 10);
      if (isNaN(daysSince) && adjudication) {
        daysSince = Math.floor((Date.now() - adjudication.getTime()) / 86_400_000);
      }
      daysSince = Math.max(daysSince || 0, 0);

      // Check for existing record
      let existing = null;
      if (abeldentId && treatmentDate && procedureCode) {
        existing = await prisma.patientBalance.findFirst({
          where: {
            abeldentPatientId: abeldentId,
            treatmentDate,
            procedureCode,
            practiceId: practiceId || null,
          },
        });
      }

      // Reuse patient's existing token
      let patientToken = existing?.patientToken;
      if (!patientToken && abeldentId) {
        const tokenRow = await prisma.patientBalance.findFirst({
          where: { abeldentPatientId: abeldentId },
          select: { patientToken: true },
        });
        patientToken = tokenRow?.patientToken || randomUUID();
      }
      if (!patientToken) patientToken = randomUUID();

      if (existing) {
        // Never overwrite settled balances
        if (existing.paymentStatus === 'paid' || existing.paymentStatus === 'written_off') {
          results.skipped++;
          continue;
        }

        await prisma.patientBalance.update({
          where: { id: existing.id },
          data: {
            insurancePaid,
            patientOwes,
            daysSinceAdjudication: daysSince,
            patientEmail: row.patient_email || existing.patientEmail,
            patientPhone: row.patient_phone || existing.patientPhone,
            updatedAt: new Date(),
          },
        });
        results.updated++;
      } else {
        await prisma.patientBalance.create({
          data: {
            patientToken,
            abeldentPatientId: abeldentId,
            patientFirstName: firstName,
            patientLastName: lastName,
            patientEmail: row.patient_email || null,
            patientPhone: row.patient_phone || null,
            procedureCode,
            procedureDescription: row.procedure_description || null,
            treatmentDate,
            adjudicationDate: adjudication,
            amountBilled,
            insurancePaid,
            patientOwes,
            daysSinceAdjudication: daysSince,
            practiceId: practiceId || null,
          },
        });
        results.imported++;
      }
    } catch (err) {
      const fn = String(row.patient_first_name || '').trim();
      const ln = String(row.patient_last_name || '').trim();
      const who = [fn, ln].filter(Boolean).join(' ').trim() || String(row.abeldent_patient_id || '').trim() || 'unknown';
      console.error('Balance upsert error', { row: fileRowLine, who, error: (err as Error).message });
      results.errors.push({ patient: `Row ${fileRowLine} — ${who}`, error: (err as Error).message });
    }
  }

  return results;
}

// List balances for dashboard
interface ListOptions {
  practiceId?: string;
  paymentStatus?: string;
  reminderStatus?: string;
  limit?: number;
  offset?: number;
}

export async function listBalances(options: ListOptions = {}) {
  const { practiceId, paymentStatus, reminderStatus, limit = 100, offset = 0 } = options;

  return prisma.patientBalance.findMany({
    where: {
      ...(practiceId && { practiceId }),
      ...(paymentStatus && { paymentStatus }),
      ...(reminderStatus && { reminderStatus }),
    },
    orderBy: [
      { daysSinceAdjudication: 'desc' },
      { patientOwes: 'desc' },
    ],
    take: limit,
    skip: offset,
  });
}

// Single balance with Stripe account info
export async function getBalance(id: string) {
  const balance = await prisma.patientBalance.findUnique({
    where: { id },
  });

  if (!balance) return null;

  // Get Stripe account if practice has one
  let stripeAccountId = null;
  if (balance.practiceId) {
    const stripeAccount = await prisma.stripeConnectAccount.findUnique({
      where: { practiceId: balance.practiceId },
    });
    if (stripeAccount?.chargesEnabled) {
      stripeAccountId = stripeAccount.stripeAccountId;
    }
  }

  return { ...balance, stripeAccountId };
}

// Update reminder status
interface ReminderSentOptions {
  emailSent?: boolean;
  smsSent?: boolean;
  nextStatus?: string;
}

export async function recordReminderSent(id: string, options: ReminderSentOptions) {
  const { emailSent, smsSent, nextStatus } = options;

  await prisma.patientBalance.update({
    where: { id },
    data: {
      ...(nextStatus && { reminderStatus: nextStatus }),
      ...(emailSent && { lastReminderEmailAt: new Date() }),
      ...(smsSent && { lastReminderSmsAt: new Date() }),
      updatedAt: new Date(),
    },
  });
}

// Attach payment link — P3-22: issue a new public pay token + expiry when the Stripe link is (re)created.
export async function setPaymentLink(id: string, url: string, linkId: string) {
  const ttlMs = (Number(process.env.PUBLIC_PAY_TOKEN_TTL_DAYS) || 7) * 86_400_000;
  const publicPayToken = randomBytes(16).toString('hex');
  const publicPayTokenExpiresAt = new Date(Date.now() + ttlMs);
  await prisma.patientBalance.update({
    where: { id },
    data: {
      stripePaymentLink: url,
      stripePaymentLinkId: linkId,
      publicPayToken,
      publicPayTokenExpiresAt,
      updatedAt: new Date(),
    },
  });
}

// Record payment
export async function recordPayment(id: string, amountPaid: number, paymentIntentId: string) {
  const balance = await prisma.patientBalance.findUnique({ where: { id } });
  if (!balance) return;

  const newAmountPaid = Number(balance.amountPaid || 0) + amountPaid;
  const newStatus = newAmountPaid >= Number(balance.patientOwes) ? 'paid' : 'partial';

  await prisma.patientBalance.update({
    where: { id },
    data: {
      amountPaid: newAmountPaid,
      paymentStatus: newStatus,
      stripePaymentIntentId: paymentIntentId,
      updatedAt: new Date(),
    },
  });
}

// Write-off
export async function writeOffBalance(id: string) {
  await prisma.patientBalance.update({
    where: { id },
    data: {
      paymentStatus: 'written_off',
      updatedAt: new Date(),
    },
  });
}

// Get reminder candidates
export async function getReminderCandidates() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  return prisma.patientBalance.findMany({
    where: {
      paymentStatus: { in: ['outstanding', 'partial'] },
      AND: [
        {
          OR: [
            { reminderStatus: 'none', daysSinceAdjudication: { gte: 7 } },
            { reminderStatus: 'reminder_1', daysSinceAdjudication: { gte: 21 } },
            { reminderStatus: 'reminder_2', daysSinceAdjudication: { gte: 45 } },
          ],
        },
        {
          OR: [
            { lastReminderEmailAt: null },
            { lastReminderEmailAt: { lt: sevenDaysAgo } },
          ],
        },
      ],
    },
    orderBy: [
      { daysSinceAdjudication: 'desc' },
      { patientOwes: 'desc' },
    ],
  });
}
