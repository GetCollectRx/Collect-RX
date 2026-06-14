import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { useOwnerPracticeApiAuthOnly } from '../middleware/ownerPracticeApi.js';
import { patientContactDisabledMessage } from '../insuranceOnlyPolicy.js';

/** Legacy patient Balance + outreach routes — disabled (insurance-only product). */
export function createBalancesOutreachRouter(_prisma: PrismaClient): Router {
  const r = Router();
  useOwnerPracticeApiAuthOnly(r);

  const disabled = (_req: Request, res: Response) =>
    res.status(410).json({ error: patientContactDisabledMessage() });

  r.get('/balances', disabled);
  r.get('/balances/:id', disabled);
  r.get('/outreach', disabled);
  r.post('/outreach/:id/respond', disabled);
  r.post('/pay/:balanceId', disabled);

  return r;
}
