import { Router, type Request, type Response } from 'express';
import type { CarrierId, ClaimPriority } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../middleware/requirePracticeSession.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { CARRIER_CONFIGS } from '../../carriers/adapter.js';
import {
  mapActiveCall,
  mapQueueEntry,
  mapTranscriptLine,
} from '../frontDesk/deskMappers.js';
import {
  isPracticeQueuePaused,
  setPracticeQueuePaused,
} from '../frontDesk/queueEngine.js';
import { clearCarrierBlock } from '../frontDesk/carrierBlockService.js';
import { endVapiCall, transferVapiCall } from '../../vapi/client.js';
import { refreshDeskQueueBroadcast } from '../frontDesk/deskQueueBroadcast.js';
import { broadcastDesk } from '../frontDesk/deskWs.js';
import type { ActiveAgent } from '../../types/frontDesk.js';
import { requireFrontDeskOnly, blockAuditorWrites } from '../middleware/requireUserRole.js';
import { assertPlatformAdminClaimGrant } from '../middleware/grantChecks.js';
import { listEscalations, resolveEscalation } from '../services/escalationService.js';
import { isAuditor, getUserRole } from '../accessControl/types.js';
import type { EscalationResolution } from '../../types/practiceSettings.js';

const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);

router.use(async (req, res, next) => {
  if (isAuditor(req.auth ?? req.practiceAuth)) {
    res.status(403).json({ success: false, error: 'Auditors cannot access call operations' });
    return;
  }
  const practiceId = req.params.practiceId;
  if (typeof practiceId === 'string' && !(await assertPlatformAdminClaimGrant(req, res, practiceId))) {
    return;
  }
  next();
});

function assertPracticeParam(req: Request, res: Response): string | null {
  const pid = req.params.practiceId;
  if (queryPracticeConflictsSession(req, pid)) {
    res.status(403).json({ success: false, error: 'practiceId does not match session' });
    return null;
  }
  return practiceIdFromSession(req);
}

router.get('/:practiceId/active', async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;

    const attempt = await prisma.callAttempt.findFirst({
      where: { completedAt: null, claim: { practiceId } },
      orderBy: { initiatedAt: 'desc' },
      include: {
        claim: {
          select: {
            id: true,
            practiceId: true,
            carrierId: true,
            claimNumber: true,
            outstandingAmount: true,
          },
        },
      },
    });

    if (!attempt) {
      return res.json({ success: true, data: { call: null, transcript: [] } });
    }

    const queue = await prisma.callQueue.findUnique({ where: { claimId: attempt.claimId } });
    const lines = await prisma.callTranscriptLine.findMany({
      where: { practiceId, vapiCallId: attempt.vapiCallId },
      orderBy: { recordedAt: 'asc' },
    });

    return res.json({
      success: true,
      data: {
        call: mapActiveCall(attempt, attempt.claim, queue?.attempts ?? 1),
        transcript: lines.map((l) => mapTranscriptLine(l, attempt.id)),
      },
    });
  } catch (err) {
    console.error('[desk/active]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/:practiceId/queue', async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;

    const rows = await prisma.callQueue.findMany({
      where: { practiceId, status: { in: ['PENDING', 'BLOCKED'] } },
      orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }],
      include: {
        claim: {
          select: { claimNumber: true, carrierId: true, outstandingAmount: true },
        },
      },
    });

    const paused = await isPracticeQueuePaused(prisma, practiceId);

    return res.json({
      success: true,
      data: { queue: rows.map(mapQueueEntry), paused },
    });
  } catch (err) {
    console.error('[desk/queue]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/:practiceId/history', async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 25));
    const skip = (page - 1) * limit;
    const { carrier, outcome, from, to } = req.query as Record<string, string>;

    const where: Record<string, unknown> = {
      completedAt: { not: null },
      claim: { practiceId, ...(carrier ? { carrierId: carrier as CarrierId } : {}) },
      ...(outcome ? { outcome } : {}),
      ...(from || to
        ? {
            initiatedAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.callAttempt.findMany({
        where,
        skip,
        take: limit,
        orderBy: { initiatedAt: 'desc' },
        include: {
          claim: {
            select: {
              claimNumber: true,
              carrierId: true,
              outstandingAmount: true,
            },
          },
        },
      }),
      prisma.callAttempt.count({ where }),
    ]);

    return res.json({
      success: true,
      data: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error('[desk/history]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/:practiceId/queue/pause', blockAuditorWrites, async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    await setPracticeQueuePaused(prisma, practiceId, true);
    return res.json({ success: true, paused: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/:practiceId/queue/resume', async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    await setPracticeQueuePaused(prisma, practiceId, false);
    return res.json({ success: true, paused: false });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/:practiceId/queue/:id/priority', async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    const priority = Number((req.body as { priority?: number }).priority);
    if (!Number.isFinite(priority)) {
      return res.status(400).json({ success: false, error: 'priority must be a number' });
    }
    const rank =
      priority <= 25 ? 'URGENT' : priority <= 75 ? 'HIGH' : priority <= 100 ? 'NORMAL' : 'LOW';
    const row = await prisma.callQueue.updateMany({
      where: { id: req.params.id, practiceId },
      data: { priority: rank as ClaimPriority },
    });
    if (row.count === 0) {
      return res.status(404).json({ success: false, error: 'Queue entry not found' });
    }
    await refreshDeskQueueBroadcast(prisma, practiceId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.delete('/:practiceId/queue/:id', async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    await prisma.callQueue.deleteMany({ where: { id: req.params.id, practiceId } });
    await refreshDeskQueueBroadcast(prisma, practiceId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/:practiceId/active/pause-agent', requireFrontDeskOnly, async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    const staffId = (req.body as { staffId?: string }).staffId ?? 'front_desk';
    const attempt = await prisma.callAttempt.findFirst({
      where: { completedAt: null, claim: { practiceId } },
    });
    if (!attempt) return res.status(404).json({ success: false, error: 'No active call' });

    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: {
        pausedByStaffAt: new Date(),
        pausedByStaffId: staffId,
        liveState: 'paused_by_staff',
      },
    });

    broadcastDesk(practiceId, {
      type: 'call.state_changed',
      data: {
        callId: attempt.id,
        state: 'paused_by_staff',
        activeAgent: (attempt.activeAgent as ActiveAgent | null) ?? null,
      },
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/:practiceId/active/end-call', requireFrontDeskOnly, async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    const attempt = await prisma.callAttempt.findFirst({
      where: { completedAt: null, claim: { practiceId } },
    });
    if (!attempt) return res.status(404).json({ success: false, error: 'No active call' });

    await endVapiCall(attempt.vapiCallId);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/:practiceId/active/takeover', requireFrontDeskOnly, async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    const { phoneNumber, staffId } = req.body as { phoneNumber?: string; staffId?: string };
    if (!phoneNumber?.trim()) {
      return res.status(400).json({ success: false, error: 'phoneNumber is required' });
    }
    const attempt = await prisma.callAttempt.findFirst({
      where: { completedAt: null, claim: { practiceId } },
    });
    if (!attempt) return res.status(404).json({ success: false, error: 'No active call' });

    await transferVapiCall(attempt.vapiCallId, phoneNumber.trim());
    await prisma.callAttempt.update({
      where: { id: attempt.id },
      data: {
        takenOverByStaffAt: new Date(),
        takenOverByStaffId: staffId ?? 'front_desk',
        liveState: 'resolving',
      },
    });

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/:practiceId/carriers', async (req: Request, res: Response) => {
  req.params = { ...req.params };
  const practiceId = assertPracticeParam(req, res);
  if (!practiceId) return;
  try {
    const active = await prisma.callAttempt.findFirst({
      where: { completedAt: null, claim: { practiceId } },
      include: { claim: { select: { carrierId: true } } },
    });
    const blocks = await prisma.carrierBlockEvent.findMany({
      where: { practiceId, resumedAt: null },
    });
    const blockMap = new Map(blocks.map((b) => [b.carrierId, b]));
    const data = (Object.keys(CARRIER_CONFIGS) as CarrierId[]).map((carrierId) => {
      const block = blockMap.get(carrierId);
      const onCall = active?.claim.carrierId === carrierId;
      return {
        carrierId,
        displayName: CARRIER_CONFIGS[carrierId].displayName,
        status: block ? 'blocked' : onCall ? 'on_call' : 'open',
        block: block
          ? { id: block.id, blockedAt: block.blockedAt.toISOString(), reason: block.notes }
          : null,
      };
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/:practiceId/queue/held', async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    const rows = await prisma.callQueue.findMany({
      where: { practiceId, status: 'BLOCKED' },
      orderBy: [{ priority: 'desc' }, { scheduledFor: 'asc' }],
      include: {
        claim: { select: { claimNumber: true, carrierId: true, outstandingAmount: true } },
      },
    });
    return res.json({ success: true, data: rows.map(mapQueueEntry) });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/:practiceId/escalations', async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    const status = req.query.status as 'open' | 'resolved' | undefined;
    const limit = Math.min(100, parseInt(req.query.limit as string, 10) || 50);
    const data = await listEscalations(prisma, practiceId, status, limit);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.put('/:practiceId/escalations/:id', blockAuditorWrites, async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    const role = getUserRole(req.auth ?? req.practiceAuth);
    if (!role || !['front_desk', 'practice_owner', 'billing_ops_manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Cannot resolve escalations with this role' });
    }
  const { resolution, notes } = req.body as { resolution?: EscalationResolution; notes?: string };
    if (!resolution) {
      return res.status(400).json({ success: false, error: 'resolution required' });
    }
    const staffId = req.auth?.userId ?? 'staff';
    const data = await resolveEscalation(prisma, practiceId, req.params.id, {
      resolution,
      notes,
      staffId,
    });
    if (!data) return res.status(404).json({ success: false, error: 'Escalation not found' });
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.get('/:practiceId/carriers/status', async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;

    const active = await prisma.callAttempt.findFirst({
      where: { completedAt: null, claim: { practiceId } },
      include: { claim: { select: { carrierId: true } } },
    });

    const blocks = await prisma.carrierBlockEvent.findMany({
      where: { practiceId, resumedAt: null },
    });
    const blockMap = new Map(blocks.map((b) => [b.carrierId, b]));

    const data = (Object.keys(CARRIER_CONFIGS) as CarrierId[]).map((carrierId) => {
      const block = blockMap.get(carrierId);
      const onCall = active?.claim.carrierId === carrierId;
      return {
        carrierId,
        displayName: CARRIER_CONFIGS[carrierId].displayName,
        status: block ? 'blocked' : onCall ? 'on_call' : 'open',
        block: block
          ? {
              id: block.id,
              blockedAt: block.blockedAt.toISOString(),
              reason: block.notes,
            }
          : null,
      };
    });

    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

router.post('/:practiceId/carriers/:carrierId/unblock', requireFrontDeskOnly, async (req: Request, res: Response) => {
  try {
    const practiceId = assertPracticeParam(req, res);
    if (!practiceId) return;
    const carrierId = req.params.carrierId as CarrierId;
    const staffId = (req.body as { staffId?: string }).staffId ?? 'front_desk';
    const ok = await clearCarrierBlock(prisma, practiceId, carrierId, staffId);
    if (!ok) {
      return res.status(404).json({ success: false, error: 'No active block for carrier' });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export function createFrontDeskRouter(): Router {
  return router;
}
