import { Router, type Request, type Response } from 'express';
import { publicLimiter } from '../middleware/rateLimiter';
import { patientContactDisabledMessage } from '../insuranceOnlyPolicy.js';

/**
 * Legacy public patient pay + email unsubscribe routes — disabled.
 */
export function createPublicPatientPayRouter(_prisma: unknown): Router {
  const r = Router();
  r.use(publicLimiter);

  const disabled = (_req: Request, res: Response) =>
    res.status(410).json({ error: patientContactDisabledMessage() });

  r.get('/public/email-unsubscribe', disabled);
  r.get('/public/pay/:publicToken', disabled);

  return r;
}
