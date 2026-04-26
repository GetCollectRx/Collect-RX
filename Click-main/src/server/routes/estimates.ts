/**
 * Phase 3: Estimate & Reconciliation API Routes
 * POST /api/estimates        — single procedure estimate
 * POST /api/estimates/multi  — multi-procedure estimate (appointment)
 * GET  /api/estimates/:token — get estimate history for a patient
 * POST /api/reconciliations  — reconcile EOB against estimate
 * GET  /api/reconciliations/:token — get reconciliation history
 */

import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { calculateEstimate, calculateMultiEstimate } from '../services/estimateCalculator.js';
import { reconcilePayment, reconcileBatch } from '../services/reconciliationEngine.js';
import { VALID_CARRIER_CODES } from '../services/carrierRules.js';

// Cast to any until `prisma generate` is run after schema migration
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;

export function createEstimateRouter(prisma: PrismaClient) {
  const db = prisma as AnyPrisma;
  const router = Router();

  // ── POST /api/estimates ─────────────────────────────────────────────────────
  // Single procedure estimate. Looks up patient benefits from DB if available.
  router.post('/', async (req, res) => {
    try {
      const {
        patientToken,
        practiceId,
        cdtCode,
        cdtDescription,
        procedureFee,
        carrierCode,
        // Optional overrides (if not passed, we look up from PatientBenefits)
        deductiblePaid,
        annualMaxUsed,
        patientDob,
        lastCleaningDate,
        lastExamDate,
        lastBitewingDate,
        lastFullSeriesDate,
        lastCrownDate,
        planStartDate,
        treatmentDate,
      } = req.body;

      // Validation
      if (!cdtCode || !/^D\d{4}$/.test(cdtCode)) {
        return res.status(400).json({ error: 'cdtCode must be in format D####' });
      }
      if (!carrierCode || !VALID_CARRIER_CODES.includes(carrierCode)) {
        return res.status(400).json({
          error: `carrierCode must be one of: ${VALID_CARRIER_CODES.join(', ')}`,
        });
      }
      if (typeof procedureFee !== 'number' || procedureFee <= 0) {
        return res.status(400).json({ error: 'procedureFee must be a positive number' });
      }

      // Fetch patient benefits from DB if patientToken provided and values not overridden
      let resolvedDeductiblePaid = deductiblePaid ?? 0;
      let resolvedAnnualMaxUsed = annualMaxUsed ?? 0;

      if (patientToken && (deductiblePaid === undefined || annualMaxUsed === undefined)) {
        const planYear = new Date().getFullYear().toString();
        const benefits = await prisma.patientBenefits.findFirst({
          where: { patientToken, carrierCode, planYear },
        });
        if (benefits) {
          resolvedDeductiblePaid = deductiblePaid ?? benefits.deductibleMet;
          resolvedAnnualMaxUsed = annualMaxUsed ?? benefits.annualMaxUsed;
        }
      }

      const estimate = calculateEstimate({
        cdtCode,
        cdtDescription: cdtDescription || cdtCode,
        procedureFee,
        carrierCode,
        deductiblePaid: resolvedDeductiblePaid,
        annualMaxUsed: resolvedAnnualMaxUsed,
        patientDob: patientDob ? new Date(patientDob) : undefined,
        lastCleaningDate: lastCleaningDate ? new Date(lastCleaningDate) : undefined,
        lastExamDate: lastExamDate ? new Date(lastExamDate) : undefined,
        lastBitewingDate: lastBitewingDate ? new Date(lastBitewingDate) : undefined,
        lastFullSeriesDate: lastFullSeriesDate ? new Date(lastFullSeriesDate) : undefined,
        lastCrownDate: lastCrownDate ? new Date(lastCrownDate) : undefined,
        planStartDate: planStartDate ? new Date(planStartDate) : undefined,
        treatmentDate: treatmentDate ? new Date(treatmentDate) : undefined,
      });

      // Persist estimate record if patientToken provided
      if (patientToken) {
        await db.estimateRecord.create({
          data: {
            patientToken,
            practiceId: practiceId ?? null,
            carrierCode,
            cdtCode,
            cdtDescription: estimate.cdtDescription,
            cdtCategory: estimate.cdtCategory,
            procedureFee,
            deductibleApplied: estimate.deductibleApplied,
            deductibleRemaining: estimate.deductibleRemaining,
            coveragePct: estimate.coveragePct,
            insurancePays: estimate.insurancePays,
            patientPays: estimate.patientPays,
            annualMaxRemaining: estimate.annualMaxRemaining,
            frequencyLimited: estimate.frequencyLimited,
            frequencyNote: estimate.frequencyNote ?? null,
            waitingPeriodActive: estimate.waitingPeriodActive,
            waitingPeriodNote: estimate.waitingPeriodNote ?? null,
            notes: estimate.breakdown.join('\n'),
          },
        });
      }

      res.json({ success: true, estimate });
    } catch (error: any) {
      console.error('Estimate error:', error);
      res.status(500).json({ error: error.message || 'Failed to calculate estimate' });
    }
  });

  // ── POST /api/estimates/multi ─────────────────────────────────────────────
  // Multi-procedure estimate for a full appointment.
  router.post('/multi', async (req, res) => {
    try {
      const {
        patientToken,
        practiceId: _practiceId,
        carrierCode,
        procedures,
        deductiblePaid,
        annualMaxUsed,
        patientDob,
        lastCleaningDate,
        lastExamDate,
        treatmentDate,
        planStartDate,
      } = req.body;

      if (!Array.isArray(procedures) || procedures.length === 0) {
        return res.status(400).json({ error: 'procedures must be a non-empty array' });
      }
      if (!carrierCode || !VALID_CARRIER_CODES.includes(carrierCode)) {
        return res.status(400).json({ error: `Invalid carrierCode` });
      }

      let resolvedDeductiblePaid = deductiblePaid ?? 0;
      let resolvedAnnualMaxUsed = annualMaxUsed ?? 0;

      if (patientToken && (deductiblePaid === undefined || annualMaxUsed === undefined)) {
        const planYear = new Date().getFullYear().toString();
        const benefits = await prisma.patientBenefits.findFirst({
          where: { patientToken, carrierCode, planYear },
        });
        if (benefits) {
          resolvedDeductiblePaid = deductiblePaid ?? benefits.deductibleMet;
          resolvedAnnualMaxUsed = annualMaxUsed ?? benefits.annualMaxUsed;
        }
      }

      const result = calculateMultiEstimate({
        procedures,
        carrierCode,
        deductiblePaid: resolvedDeductiblePaid,
        annualMaxUsed: resolvedAnnualMaxUsed,
        patientDob: patientDob ? new Date(patientDob) : undefined,
        lastCleaningDate: lastCleaningDate ? new Date(lastCleaningDate) : undefined,
        lastExamDate: lastExamDate ? new Date(lastExamDate) : undefined,
        planStartDate: planStartDate ? new Date(planStartDate) : undefined,
        treatmentDate: treatmentDate ? new Date(treatmentDate) : undefined,
      });

      res.json({ success: true, result });
    } catch (error: any) {
      console.error('Multi-estimate error:', error);
      res.status(500).json({ error: error.message || 'Failed to calculate multi-estimate' });
    }
  });

  // ── GET /api/estimates/:patientToken ──────────────────────────────────────
  router.get('/:patientToken', async (req, res) => {
    try {
      const { patientToken } = req.params;
      const records = await db.estimateRecord.findMany({
        where: { patientToken },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      res.json({ estimates: records });
    } catch (error) {
      console.error('Get estimates error:', error);
      res.status(500).json({ error: 'Failed to fetch estimates' });
    }
  });

  // ── GET /api/estimates/cdt/:code ──────────────────────────────────────────
  // Look up CDT code details
  router.get('/cdt/:code', async (req, res) => {
    try {
      const code = req.params.code.toUpperCase();
      const cdt = await db.cdtCode.findUnique({ where: { code } });
      if (!cdt) return res.status(404).json({ error: `CDT code ${code} not found` });
      res.json(cdt);
    } catch (error) {
      console.error('CDT lookup error:', error);
      res.status(500).json({ error: 'Failed to fetch CDT code' });
    }
  });

  // ── GET /api/estimates/cdt-search ─────────────────────────────────────────
  router.get('/cdt-search/query', async (req, res) => {
    try {
      const { q, category } = req.query as { q?: string; category?: string };
      const cdts = await db.cdtCode.findMany({
        where: {
          AND: [
            category ? { category } : {},
            q ? {
              OR: [
                { code: { contains: q } },
                { description: { contains: q } },
              ],
            } : {},
          ],
        },
        orderBy: { code: 'asc' },
        take: 50,
      });
      res.json({ codes: cdts });
    } catch (error) {
      console.error('CDT search error:', error);
      res.status(500).json({ error: 'Failed to search CDT codes' });
    }
  });

  return router;
}

export function createReconciliationRouter(prisma: PrismaClient) {
  const db = prisma as AnyPrisma;
  const router = Router();

  // ── POST /api/reconciliations ─────────────────────────────────────────────
  router.post('/', async (req, res) => {
    try {
      const {
        patientToken,
        carrierCode,
        cdtCode,
        estimatedInsurance,
        actualInsurance,
        denialReason,
        eobDate,
        notes,
        estimateId,
      } = req.body;

      if (!patientToken || !carrierCode || !cdtCode) {
        return res.status(400).json({ error: 'patientToken, carrierCode, and cdtCode are required' });
      }
      if (typeof actualInsurance !== 'number' || actualInsurance < 0) {
        return res.status(400).json({ error: 'actualInsurance must be a non-negative number' });
      }
      if (typeof estimatedInsurance !== 'number' || estimatedInsurance < 0) {
        return res.status(400).json({ error: 'estimatedInsurance must be a non-negative number' });
      }

      const result = reconcilePayment({
        patientToken,
        carrierCode,
        cdtCode,
        estimatedInsurance,
        actualInsurance,
        denialReason,
        eobDate: eobDate ? new Date(eobDate) : undefined,
        notes,
      });

      // Persist to DB
      const record = await db.reconciliationRecord.create({
        data: {
          estimateId: estimateId ?? null,
          patientToken,
          carrierCode,
          cdtCode,
          estimatedInsurance,
          actualInsurance,
          variance: result.variance,
          variancePct: result.variancePct,
          status: result.status,
          denialReason: result.denialReason ?? null,
          notes: result.explanation,
          eobDate: result.eobDate ?? null,
        },
      });

      res.json({ success: true, reconciliation: { ...result, id: record.id } });
    } catch (error: any) {
      console.error('Reconciliation error:', error);
      res.status(500).json({ error: error.message || 'Failed to reconcile payment' });
    }
  });

  // ── POST /api/reconciliations/batch ──────────────────────────────────────
  router.post('/batch', async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'items must be a non-empty array' });
      }

      const batchResult = reconcileBatch(items);

      // Persist all records
      await db.reconciliationRecord.createMany({
        data: batchResult.results.map(r => ({
          patientToken: r.patientToken,
          carrierCode: r.carrierCode,
          cdtCode: r.cdtCode,
          estimatedInsurance: r.estimatedInsurance,
          actualInsurance: r.actualInsurance,
          variance: r.variance,
          variancePct: r.variancePct,
          status: r.status,
          denialReason: r.denialReason ?? null,
          notes: r.explanation,
          eobDate: r.eobDate ?? null,
        })),
      });

      res.json({ success: true, ...batchResult });
    } catch (error: any) {
      console.error('Batch reconciliation error:', error);
      res.status(500).json({ error: error.message || 'Failed to reconcile batch' });
    }
  });

  // ── GET /api/reconciliations/:patientToken ────────────────────────────────
  router.get('/:patientToken', async (req, res) => {
    try {
      const { patientToken } = req.params;
      const { status } = req.query as { status?: string };

      const records = await db.reconciliationRecord.findMany({
        where: {
          patientToken,
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      res.json({ reconciliations: records });
    } catch (error) {
      console.error('Get reconciliations error:', error);
      res.status(500).json({ error: 'Failed to fetch reconciliations' });
    }
  });

  // ── GET /api/reconciliations — practice-level summary ────────────────────
  router.get('/', async (req, res) => {
    try {
      const { status, carrierCode, limit = '50' } = req.query as {
        status?: string;
        carrierCode?: string;
        limit?: string;
      };

      const records = await db.reconciliationRecord.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(carrierCode ? { carrierCode } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit, 10),
      });

      const actionRequired = records.filter((r: any) =>
        r.status === 'denied' || r.status === 'underpaid' || r.status === 'overpaid'
      );

      res.json({
        records,
        summary: {
          total: records.length,
          actionRequired: actionRequired.length,
          byStatus: {
            matched: records.filter((r: any) => r.status === 'matched').length,
            underpaid: records.filter((r: any) => r.status === 'underpaid').length,
            overpaid: records.filter((r: any) => r.status === 'overpaid').length,
            denied: records.filter((r: any) => r.status === 'denied').length,
          },
        },
      });
    } catch (error) {
      console.error('Get reconciliations summary error:', error);
      res.status(500).json({ error: 'Failed to fetch reconciliations' });
    }
  });

  return router;
}
