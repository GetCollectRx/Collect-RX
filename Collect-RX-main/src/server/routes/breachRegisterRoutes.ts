import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authUserId } from '../accessControl/types.js';
import { authenticate } from '../middleware/authenticate.js';
import { practiceIdFromSession, requirePracticeContext } from '../middleware/requirePracticeSession.js';
import { requireUserRoles } from '../middleware/requireUserRole.js';
import {
  BreachRegisterError,
  annualBreachCounts,
  buildBreachPacket,
  createBreachEntry,
  listBreachEntries,
  updateBreachEntry,
} from '../compliance/breachRegister.js';

const ERROR_STATUS: Record<BreachRegisterError['code'], number> = {
  MISSING_FIELD: 400,
  INVALID_FIELD: 400,
  FREE_TEXT_IDENTIFIER: 422,
  NOT_FOUND: 404,
};

function sendError(res: Response, error: unknown): void {
  if (error instanceof BreachRegisterError) {
    res.status(ERROR_STATUS[error.code]).json({
      success: false,
      error: error.message,
      code: error.code,
      field: error.field,
      reasonCode: error.reasonCode,
    });
    return;
  }
  res.status(500).json({ success: false, error: 'Breach register request failed' });
}

/**
 * Breach register API. Practice owner only: the register is the practice's
 * record of its own incidents, and the packet contains patient tokens.
 */
export function createBreachRegisterRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(authenticate);
  router.use(requirePracticeContext);
  router.use(requireUserRoles('practice_owner'));

  router.get('/', async (req: Request, res: Response) => {
    try {
      const entries = await listBreachEntries(prisma, practiceIdFromSession(req));
      res.json({ success: true, data: entries });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/annual-counts', async (req: Request, res: Response) => {
    try {
      const year = Number(req.query.year);
      const counts = await annualBreachCounts(prisma, practiceIdFromSession(req), year);
      res.json({ success: true, data: counts });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/', async (req: Request, res: Response) => {
    try {
      const created = await createBreachEntry(prisma, {
        practiceId: practiceIdFromSession(req),
        body: req.body,
        userId: authUserId(req.auth ?? req.practiceAuth) ?? undefined,
        req,
      });
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch('/:id', async (req: Request, res: Response) => {
    try {
      await updateBreachEntry(prisma, {
        practiceId: practiceIdFromSession(req),
        id: String(req.params.id),
        patch: req.body,
        userId: authUserId(req.auth ?? req.practiceAuth) ?? undefined,
        req,
      });
      res.json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get('/:id/packet', async (req: Request, res: Response) => {
    try {
      const packet = await buildBreachPacket(prisma, {
        practiceId: practiceIdFromSession(req),
        id: String(req.params.id),
        userId: authUserId(req.auth ?? req.practiceAuth) ?? undefined,
        req,
      });
      res.json({ success: true, data: packet });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
