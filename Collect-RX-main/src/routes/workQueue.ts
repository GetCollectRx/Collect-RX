import { Router, Request, Response } from 'express';
import type { CarrierId, WorkItemSource } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { authenticate } from '../server/middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
} from '../server/middleware/requirePracticeSession';
import {
  listWorkItems,
  syncWorkItemsForPractice,
  type WorkQueueFilters,
} from '../server/services/workQueueService.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req: Request, res: Response) => {
  try {
    const qP = req.query.practiceId as string | undefined;
    if (queryPracticeConflictsSession(req, qP)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, parseInt(String(req.query.limit ?? '50'), 10) || 50);

    const filters: WorkQueueFilters = {
      itemType: req.query.itemType as string | undefined,
      carrierId: req.query.carrier as CarrierId | undefined,
      aging: req.query.aging as WorkQueueFilters['aging'],
      assignedRep: req.query.assignedRep as string | undefined,
      status: (req.query.status as string) || 'open',
    };

    const result = await listWorkItems(prisma, practiceId, filters, page, limit);
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[GET /work-queue]', err);
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.get('/by-source/:sourceType/:sourceId', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const sourceType = req.params.sourceType as WorkItemSource;
    const item = await prisma.workItem.findFirst({
      where: {
        practiceId,
        sourceType,
        sourceId: req.params.sourceId,
        status: 'open',
      },
    });
    return res.json({ success: true, data: item });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.post('/sync', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const result = await syncWorkItemsForPractice(prisma, practiceId);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const body = req.body as {
      assignedRep?: string | null;
      followUpAt?: string | null;
      notes?: string | null;
      status?: string;
    };

    const existing = await prisma.workItem.findFirst({
      where: { id: req.params.id, practiceId },
    });
    if (!existing) return res.status(404).json({ success: false, error: 'Work item not found' });

    const updated = await prisma.workItem.update({
      where: { id: existing.id },
      data: {
        assignedRep: body.assignedRep !== undefined ? body.assignedRep : undefined,
        notes: body.notes !== undefined ? body.notes : undefined,
        status: body.status ?? undefined,
        followUpAt:
          body.followUpAt === null
            ? null
            : body.followUpAt
              ? new Date(body.followUpAt)
              : undefined,
      },
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, error: (err as Error).message });
  }
});

export default router;
