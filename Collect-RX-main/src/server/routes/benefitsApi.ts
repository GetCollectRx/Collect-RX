/**
 * P3-10 — Pre-treatment benefits + estimate (practice-scoped by patient token)
 */

import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { useOwnerPracticeApiAuthOnly } from '../middleware/ownerPracticeApi.js';
import { practiceIdFromSession } from '../middleware/requirePracticeSession.js';
import {
  getCurrentBenefits,
  getCoverage,
  getPlanYear,
  getPendingClaimsTotal,
} from '../benefits/schema';
import { calculateEstimate } from '../benefits/calculator';
import { logger } from '../observability/logger.js';

function practiceId(req: Request): string {
  return practiceIdFromSession(req);
}

export function createBenefitsApiRouter(_prisma: PrismaClient): Router {
  const r = Router();
  useOwnerPracticeApiAuthOnly(r);

  r.get('/benefits/:patientToken', async (req: Request, res: Response) => {
    try {
      practiceId(req);
      const patientToken = req.params.patientToken;
      const carrierCode = String((req.query.carrier_code as string) || '').trim();
      if (!carrierCode) {
        return res.status(400).json({ error: 'carrier_code query param is required' });
      }
      const planYear = await getPlanYear(patientToken, carrierCode);
      if (!planYear) {
        return res.json({ benefits: null, coverage: [], error: 'no_plan_year' });
      }
      const b = await getCurrentBenefits(patientToken, carrierCode);
      if (!b) {
        return res.json({ benefits: null, coverage: [], error: 'no_benefits' });
      }
      const { paid, pending } = await getPendingClaimsTotal(
        patientToken,
        carrierCode,
        planYear.planYearStart,
        planYear.planYearEnd
      );
      const cov = await getCoverage(patientToken, carrierCode);
      return res.json({
        benefits: {
          annual_max: b.annualMax,
          annual_max_used: b.annualMaxUsed,
          pending_claims: pending,
          plan_year_end: planYear.planYearEnd.toISOString().split('T')[0],
          stale_flag: b.staleFlag,
          deductible: b.deductible,
          deductible_met: b.deductibleMet,
        },
        coverage: cov.map((c) => ({
          cdt_category: c.cdtCategory,
          coverage_pct: c.coveragePct,
          waiting_period_months: c.waitingPeriodMonths,
          waiting_period_start: c.waitingPeriodStart?.toISOString().split('T')[0] ?? null,
          frequency_limit_months: c.frequencyLimitMonths,
          last_service_date: c.lastServiceDate?.toISOString().split('T')[0] ?? null,
        })),
        _meta: { paidFromClaims: paid },
      });
    } catch (e) {
      logger.error('GET /benefits error', { error: e });
      return res.status(500).json({ error: 'Failed to load benefits' });
    }
  });

  r.post('/benefits/estimate', async (req: Request, res: Response) => {
    try {
      practiceId(req);
      const body = req.body as {
        patient_token?: string;
        carrier_code?: string;
        procedures?: Array<{ cdtCode: string; fee: number; description?: string }>;
      };
      const patientToken = String(body.patient_token || '').trim();
      const carrierCode = String(body.carrier_code || '').trim();
      if (!patientToken || !carrierCode) {
        return res.status(400).json({ error: 'patient_token and carrier_code are required' });
      }
      const procs = Array.isArray(body.procedures) ? body.procedures : [];
      if (procs.length === 0) {
        return res.status(400).json({ error: 'procedures array is required' });
      }
      const result = await calculateEstimate(patientToken, carrierCode, procs);
      if (result.lines.length === 0) {
        return res.status(200).json({
          totalFees: 0,
          insurancePays: 0,
          patientOwes: 0,
          procedures: [],
          deductibleApplied: 0,
          exceedsAnnualMax: false,
          overageAmount: 0,
          warnings: result.warnings,
        });
      }
      const tot = result.totals;
      const deductibleApplied = result.lines.reduce(
        (s, l) => s + parseFloat(l.deductibleApplied),
        0
      );
      const maxed = result.lines.some(
        (l) => l.maxCapApplied && parseFloat(l.maxCapApplied) > 0
      );
      const overageAmount = result.lines.reduce(
        (s, l) => s + (l.maxCapApplied ? parseFloat(l.maxCapApplied) : 0),
        0
      );
      return res.json({
        totalFees: parseFloat(tot.totalFee),
        insurancePays: parseFloat(tot.totalInsurance),
        patientOwes: parseFloat(tot.totalPatient),
        procedures: result.lines.map((l) => ({
          code: l.cdtCode,
          category: l.category,
          fee: parseFloat(l.fee),
          coveragePct: parseFloat(l.coveragePct),
          insurancePays: parseFloat(l.insuranceCovers),
          patientOwes: parseFloat(l.patientOwes),
        })),
        deductibleApplied,
        exceedsAnnualMax: maxed,
        overageAmount,
        warnings: result.warnings,
      });
    } catch (e) {
      logger.error('POST /benefits/estimate error', { error: e });
      return res.status(500).json({ error: 'Failed to calculate estimate' });
    }
  });

  return r;
}
