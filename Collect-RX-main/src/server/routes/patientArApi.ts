/**
 * P3-11 — Patient AR (AbelDent-style patient_balances) — practice-scoped
 */

import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  listBalances,
  writeOffBalance,
  upsertBalances,
} from '../patients/balances';
import { appendAuditLog } from '../audit/auditLog.js';
import { patientContactDisabledMessage } from '../insuranceOnlyPolicy.js';

import { useOwnerPracticeApiAuthOnly } from '../middleware/ownerPracticeApi.js';
import { practiceIdFromSession } from '../middleware/requirePracticeSession.js';

function practiceId(req: Request): string {
  return practiceIdFromSession(req);
}

export function createPatientArApiRouter(prisma: PrismaClient): Router {
  const r = Router();
  useOwnerPracticeApiAuthOnly(r);

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

  /** AbelDent / service sync — JSON array or `{ records: [] }` (same shape as admin CSV pipeline). */
  r.post('/patients/balances', async (req: Request, res: Response) => {
    const pid = practiceId(req);
    try {
      const raw = req.body as unknown;
      const rows = Array.isArray(raw) ? raw : (raw as { records?: unknown })?.records;
      if (!Array.isArray(rows)) {
        return res.status(400).json({
          error: 'Expected a JSON array of rows or { records: array }',
        });
      }
      const result = await upsertBalances(rows as never, pid);
      void appendAuditLog(prisma, {
        practiceId: pid,
        action: 'patient_ar.bulk_upsert',
        subjectType: 'PatientBalance',
        subjectId: 'bulk',
        details: { imported: result.imported, updated: result.updated, skipped: result.skipped },
        req,
      });
      return res.json({ success: true, ...result });
    } catch (e) {
      console.error('POST /patients/balances error', e);
      return res.status(500).json({ error: 'Failed to import balances' });
    }
  });

  r.post('/patients/balances/:id/send-reminder', async (_req: Request, res: Response) => {
    return res.status(403).json({ error: patientContactDisabledMessage() });
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
