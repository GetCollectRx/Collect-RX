/**
 * Platform-admin-only dashboard for the BullMQ dead-letter records written
 * by workerEntry.ts's 'failed' handler (see jobs/deadLetterQueue.ts). This
 * is fleet-wide operational data, not practice data — gated the same way as
 * platformPersonaAdminApi.ts, not the practice-scoped adminRoutes.ts.
 */
import { Router, type Request, type Response } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { requirePlatformAdmin } from '../middleware/requireUserRole.js';
import { authUserId } from '../accessControl/types.js';
import { apiErrorMessageForResponse, apiClientErrorMessage } from '../apiErrorMessage.js';
import { retryDeadLetter } from '../jobs/deadLetterQueue.js';
import { getArQueue } from '../jobs/arQueue.js';
import { prisma } from '../../lib/prisma.js';

const MAX_PAGE_SIZE = 100;

export function createDlqAdminRouter(): Router {
  const router = Router();
  router.use(authenticate);
  router.use(requirePlatformAdmin);

  router.get('/', async (req: Request, res: Response) => {
    const take = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || 50));
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    try {
      const rows = await prisma.workerDeadLetter.findMany({
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { createdAt: 'desc' },
      });
      res.json({
        success: true,
        deadLetters: rows,
        nextCursor: rows.length === take ? rows[rows.length - 1].id : null,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.post('/:id/retry', async (req: Request, res: Response) => {
    const { id } = req.params;
    const retriedBy = authUserId(req.auth ?? req.practiceAuth) ?? 'unknown';

    try {
      const result = await retryDeadLetter(prisma, getArQueue, id, retriedBy);

      if ('notFound' in result) {
        res.status(404).json({ success: false, error: 'Dead letter record not found' });
        return;
      }
      if ('alreadyRetried' in result) {
        res.status(409).json({ success: false, error: 'This dead letter record has already been retried' });
        return;
      }
      res.json({ success: true, newBullJobId: result.newBullJobId ?? null });
    } catch (err) {
      res.status(500).json({ success: false, error: apiClientErrorMessage(err) });
    }
  });

  return router;
}
