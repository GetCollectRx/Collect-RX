/**
 * Claims Validator Webhook Handler
 * POST /api/webhooks/claims/validate
 *
 * Async validation webhook — runs OFF-CALL after Claims_Agent completes
 * Validates extracted facts, checks for PHI leaks, safety violations, and carrier block risk
 * On failure: creates escalation + notifies practice
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { handleClaimsValidatorWebhook } from '../server/vapi/claimsValidatorWebhook.js';

const router = Router();

/**
 * POST /api/webhooks/claims/validate
 * Async validator webhook — receives transcript + extracted_facts after call ends
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    await handleClaimsValidatorWebhook(req, res, prisma);
  } catch (err) {
    console.error('[claims-validator-webhook] Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
