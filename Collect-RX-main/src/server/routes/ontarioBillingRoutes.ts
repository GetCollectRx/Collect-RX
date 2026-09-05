// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Ontario CDCP/Accerta split-billing quoting
// POST /api/ontario-billing/split
//
// Front-desk-facing (not owner-only): this powers the Pre-Visit Blueprint
// checkout tool, which front desk staff use directly — see
// requireFrontDeskOnly usage elsewhere for the roles this pattern serves.
// Stateless: this is a quick "what would the numbers be" quote, not tied to
// a stored patient/claim record, mirroring how front desk uses it at
// checkout before treatment.
// ─────────────────────────────────────────────────────────────────────────────

import { Router, type Request, type Response } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePracticeContext } from '../middleware/requirePracticeSession.js';
import { calculateOntarioSplitBilling, type SplitBillingResult } from '../services/billing/billingCalculator.js';
import type { CdcpCoPayTier } from '../services/billing/ontarioCdcpConfig.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { logger } from '../observability/logger.js';

const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);

interface SplitBillingRequestBody {
  odaFeeAmount?: unknown;
  cdcpFeeAmount?: unknown;
  coPayTier?: unknown;
  isProvincialSecondary?: unknown;
}

const VALID_CO_PAY_TIERS: readonly number[] = [0, 40, 60];

router.post('/split', (req: Request, res: Response) => {
  const body = req.body as SplitBillingRequestBody;

  const odaFeeAmount = Number(body.odaFeeAmount);
  const cdcpFeeAmount = Number(body.cdcpFeeAmount);
  const coPayTier = Number(body.coPayTier);
  const isProvincialSecondary = Boolean(body.isProvincialSecondary);

  if (!Number.isFinite(odaFeeAmount) || odaFeeAmount < 0) {
    return res.status(400).json({ success: false, error: 'odaFeeAmount must be a non-negative number' });
  }
  if (!Number.isFinite(cdcpFeeAmount) || cdcpFeeAmount < 0) {
    return res.status(400).json({ success: false, error: 'cdcpFeeAmount must be a non-negative number' });
  }
  if (!VALID_CO_PAY_TIERS.includes(coPayTier)) {
    return res.status(400).json({ success: false, error: 'coPayTier must be 0, 40, or 60' });
  }

  try {
    const result: SplitBillingResult = calculateOntarioSplitBilling({
      odaFeeAmount,
      cdcpFeeAmount,
      coPayTier: coPayTier as CdcpCoPayTier,
      isProvincialSecondary,
    });
    return res.json({ success: true, result });
  } catch (err) {
    logger.error('[ontario-billing] split calculation failed', { error: err });
    return res.status(400).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
