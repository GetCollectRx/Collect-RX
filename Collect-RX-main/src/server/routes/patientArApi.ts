/**
 * P3-11 — Patient AR (AbelDent-style patient_balances) — practice-scoped
 */

import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { listBalances, getBalance, writeOffBalance, recordReminderSent, setPaymentLink } from '../patients/balances';
import { sendEmailWithRetry, sendSMSWithRetry } from '../patients/messaging';
import { generatePaymentLink } from '../stripe/connect';
import { appendAuditLog } from '../audit/auditLog.js';

function practiceId(req: Request): string {
  return req.practiceAuth!.practiceId;
}

function nextReminderStatus(current: string): string {
  const map: Record<string, string> = { none: 'reminder_1', reminder_1: 'reminder_2', reminder_2: 'reminder_3' };
  return map[current] || 'reminder_3';
}

export function createPatientArApiRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/patients/balances', async (req: Request, res: Response) => {
    try {
      const pid = practiceId(req);
      const ps = (req.query.payment_status as string) || '';
      const rows = await listBalances({
        practiceId: pid,
        paymentStatus: ps || undefined,
        limit: 500,
      });
      return res.json({
        balances: rows.map((b) => ({
          id: b.id,
          patientFirstName: b.patientFirstName,
          patientLastName: b.patientLastName,
          procedureCode: b.procedureCode,
          procedureDescription: b.procedureDescription,
          treatmentDate: b.treatmentDate ? b.treatmentDate.toISOString().split('T')[0] : undefined,
          amountBilled: b.amountBilled,
          insurancePaid: b.insurancePaid,
          patientOwes: b.patientOwes,
          daysSinceAdjudication: b.daysSinceAdjudication,
          reminderStatus: b.reminderStatus,
          paymentStatus: b.paymentStatus,
          stripePaymentLink: b.stripePaymentLink,
        })),
      });
    } catch (e) {
      console.error('GET /patients/balances error', e);
      return res.status(500).json({ error: 'Failed to list balances' });
    }
  });

  r.post('/patients/balances/:id/send-reminder', async (req: Request, res: Response) => {
    const pid = practiceId(req);
    const id = req.params.id;
    try {
      const b = await getBalance(id);
      if (!b || b.practiceId !== pid) {
        return res.status(404).json({ error: 'Balance not found' });
      }
      if (b.paymentStatus === 'paid' || b.paymentStatus === 'written_off') {
        return res.status(400).json({ error: 'Balance is not actionable' });
      }
      let paymentUrl: string | null = b.stripePaymentLink ?? null;
      if (!paymentUrl && b.stripeAccountId) {
        const { url, id: linkId } = await generatePaymentLink(
          {
            id: b.id,
            patientOwes: b.patientOwes,
            practiceId: b.practiceId,
            patientToken: b.patientToken,
          },
          b.stripeAccountId
        );
        await setPaymentLink(b.id, url, linkId);
        paymentUrl = url;
      }
      const forMsg = {
        id: b.id,
        patientFirstName: b.patientFirstName,
        patientEmail: b.patientEmail,
        patientPhone: b.patientPhone,
        patientOwes: Number(b.patientOwes),
        treatmentDate: b.treatmentDate,
        reminderStatus: b.reminderStatus,
        smsOptOutAt: b.smsOptOutAt,
        emailOptOutAt: b.emailOptOutAt,
      };
      const nextStatus = nextReminderStatus(b.reminderStatus);
      const emailSent = await sendEmailWithRetry(forMsg, paymentUrl, 2);
      const smsSent = await sendSMSWithRetry(forMsg, paymentUrl, 2);
      if (emailSent || smsSent) {
        await recordReminderSent(b.id, { emailSent, smsSent, nextStatus });
      }
      void appendAuditLog(prisma, {
        practiceId: pid,
        action: 'patient_ar.send_reminder',
        subjectType: 'PatientBalance',
        subjectId: id,
        details: { emailSent, smsSent, nextStatus },
        req,
      });
      return res.json({ ok: true, emailSent, smsSent });
    } catch (e) {
      console.error('send-reminder error', e);
      return res.status(500).json({ error: 'Failed to send reminder' });
    }
  });

  r.post('/patients/balances/:id/write-off', async (req: Request, res: Response) => {
    const pid = practiceId(req);
    const id = req.params.id;
    try {
      const row = await prisma.patientBalance.findFirst({ where: { id, practiceId: pid } });
      if (!row) {
        return res.status(404).json({ error: 'Balance not found' });
      }
      await writeOffBalance(id);
      void appendAuditLog(prisma, {
        practiceId: pid,
        action: 'patient_ar.write_off',
        subjectType: 'PatientBalance',
        subjectId: id,
        req,
      });
      return res.json({ ok: true });
    } catch (e) {
      console.error('write-off error', e);
      return res.status(500).json({ error: 'Failed to write off' });
    }
  });

  return r;
}
