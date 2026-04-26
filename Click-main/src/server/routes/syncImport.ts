/**
 * Sync Import Routes — receives data pushed by the AbelDent desktop sync service.
 *
 * POST /api/patients/balances  — upsert patient balances (deduplicates by
 *   abeldentPatientId + procedureCode + treatmentDate)
 *
 * POST /api/claims/import  — upsert insurance claims (deduplicates by
 *   abeldentClaimId)
 *
 * Both endpoints use upsert semantics: new records are created, existing
 * records are updated only when the balance/amount has changed (skipped
 * otherwise to avoid spurious updatedAt churn).
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { logAudit } from '../middleware/auditLog.js';

// Cast to any until `prisma generate` is run after schema migration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

interface RawBalance {
  abeldent_patient_id    : string;
  patient_first_name     : string;
  patient_last_name      : string;
  patient_email?         : string;
  patient_phone?         : string;
  procedure_code?        : string;
  procedure_description? : string;
  treatment_date?        : string;
  adjudication_date?     : string;
  amount_billed?         : number | string;
  insurance_paid?        : number | string;
  patient_owes?          : number | string;
  days_since_adjudication?: number | string;
}

interface RawClaim {
  id                   : string;
  patient_first_name   : string;
  patient_last_name    : string;
  carrier_name?        : string;
  policy_number?       : string;
  procedure_code?      : string;
  procedure_description?: string;
  treatment_date?      : string;
  submission_date?     : string;
  amount_billed?       : number | string;
  amount_outstanding?  : number | string;
  days_outstanding?    : number | string;
}

function toFloat(v: unknown): number {
  const n = parseFloat(String(v ?? 0));
  return isFinite(n) ? n : 0;
}

function toInt(v: unknown): number {
  const n = parseInt(String(v ?? 0), 10);
  return isFinite(n) ? n : 0;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

export function createSyncImportRouter(prisma: PrismaClient): Router {
  const db = prisma as AnyPrisma;
  const router = Router();

  // ── POST /api/patients/balances ───────────────────────────────────────────
  router.post('/balances', async (req: Request, res: Response) => {
    const rows: RawBalance[] = req.body;
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected JSON array of balance records' });
    }

    let imported = 0, updated = 0, skipped = 0, errors = 0;

    for (const row of rows) {
      try {
        const abeldentId    = String(row.abeldent_patient_id || '').slice(0, 50);
        const procedureCode = String(row.procedure_code || '').slice(0, 20);
        const treatmentDate = toDate(row.treatment_date);
        const newPatientOwes = toFloat(row.patient_owes);

        if (!abeldentId) { errors++; continue; }

        // Dedup key: patient + procedure + date
        const existing = await db.patientBalance.findFirst({
          where: { abeldentPatientId: abeldentId, procedureCode, treatmentDate },
        });

        if (!existing) {
          await db.patientBalance.create({
            data: {
              abeldentPatientId    : abeldentId,
              patientFirstName     : String(row.patient_first_name || '').slice(0, 100),
              patientLastName      : String(row.patient_last_name  || '').slice(0, 100),
              patientEmail         : row.patient_email   ? String(row.patient_email).slice(0, 200)   : null,
              patientPhone         : row.patient_phone   ? String(row.patient_phone).slice(0, 30)    : null,
              procedureCode,
              procedureDescription : row.procedure_description ? String(row.procedure_description).slice(0, 300) : null,
              treatmentDate,
              adjudicationDate     : toDate(row.adjudication_date),
              amountBilled         : toFloat(row.amount_billed),
              insurancePaid        : toFloat(row.insurance_paid),
              patientOwes          : newPatientOwes,
              daysSinceAdjudication: toInt(row.days_since_adjudication),
            },
          });
          imported++;
        } else {
          // Only update if the outstanding balance has changed by more than 1 cent
          if (Math.abs(existing.patientOwes - newPatientOwes) > 0.01) {
            await db.patientBalance.update({
              where: { id: existing.id },
              data : {
                patientOwes          : newPatientOwes,
                insurancePaid        : toFloat(row.insurance_paid),
                daysSinceAdjudication: toInt(row.days_since_adjudication),
              },
            });
            updated++;
          } else {
            skipped++;
          }
        }
      } catch (err) {
        console.error('[syncImport] Balance row error:', err);
        errors++;
      }
    }

    await logAudit(prisma, {
      action    : 'SYNC_IMPORT_BALANCES',
      resource  : 'PatientBalance',
      metadata  : JSON.stringify({ imported, updated, skipped, errors, total: rows.length }),
    });

    return res.json({ imported, updated, skipped, errors, total: rows.length });
  });

  // ── POST /api/claims/import ───────────────────────────────────────────────
  router.post('/import', async (req: Request, res: Response) => {
    const rows: RawClaim[] = req.body;
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: 'Expected JSON array of claim records' });
    }

    let imported = 0, updated = 0, skipped = 0, errors = 0;

    for (const row of rows) {
      try {
        const abeldentClaimId = String(row.id || '').slice(0, 50);
        if (!abeldentClaimId) { errors++; continue; }

        const newOutstanding = toFloat(row.amount_outstanding);

        // Try to find a PatientBalance that matches this claim
        // (AbelDent claims map onto PatientBalance records)
        const existing = await db.patientBalance.findFirst({
          where: { abeldentPatientId: abeldentClaimId },
        });

        if (!existing) {
          await db.patientBalance.create({
            data: {
              abeldentPatientId    : abeldentClaimId,
              patientFirstName     : String(row.patient_first_name || '').slice(0, 100),
              patientLastName      : String(row.patient_last_name  || '').slice(0, 100),
              carrierCode          : row.carrier_name ? String(row.carrier_name).slice(0, 50) : null,
              procedureCode        : String(row.procedure_code || '').slice(0, 20),
              procedureDescription : row.procedure_description ? String(row.procedure_description).slice(0, 300) : null,
              treatmentDate        : toDate(row.treatment_date),
              amountBilled         : toFloat(row.amount_billed),
              patientOwes          : newOutstanding,
              daysSinceAdjudication: toInt(row.days_outstanding),
            },
          });
          imported++;
        } else {
          if (Math.abs(existing.patientOwes - newOutstanding) > 0.01) {
            await db.patientBalance.update({
              where: { id: existing.id },
              data : {
                patientOwes          : newOutstanding,
                daysSinceAdjudication: toInt(row.days_outstanding),
              },
            });
            updated++;
          } else {
            skipped++;
          }
        }
      } catch (err) {
        console.error('[syncImport] Claim row error:', err);
        errors++;
      }
    }

    await logAudit(prisma, {
      action  : 'SYNC_IMPORT_CLAIMS',
      resource: 'PatientBalance',
      metadata: JSON.stringify({ imported, updated, skipped, errors, total: rows.length }),
    });

    return res.json({ imported, updated, skipped, errors, total: rows.length });
  });

  return router;
}
