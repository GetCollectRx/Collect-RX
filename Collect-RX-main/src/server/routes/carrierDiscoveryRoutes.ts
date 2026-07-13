import { Router, type Request, type Response } from 'express';
import type { CarrierId } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePlatformAdmin } from '../middleware/requireUserRole.js';
import { authUserId } from '../accessControl/types.js';
import { CARRIER_CONFIGS } from '../../carriers/adapter.js';
import {
  createNavigationProposal,
  deriveNavigationStepsFromTranscript,
  ensureMonthlyDiscoveryRoster,
  isCarrierDiscoveryEnabled,
  requestCarrierRediscovery,
  reviewNavigationProposal,
} from '../discovery/carrierDiscoveryService.js';

const router = Router();
router.use(authenticate);
router.use(requirePlatformAdmin);

function carrierFrom(value: string): CarrierId | null {
  return Object.prototype.hasOwnProperty.call(CARRIER_CONFIGS, value) ? value as CarrierId : null;
}

function hasDiscoveryEnabled(res: Response): boolean {
  if (isCarrierDiscoveryEnabled()) return true;
  res.status(409).json({
    success: false,
    error: 'Carrier discovery is disabled. Set COLLECTRX_CARRIER_DISCOVERY_ENABLED=1 for an explicit operator run.',
  });
  return false;
}

router.get('/roster', async (_req: Request, res: Response) => {
  try {
    const runs = await prisma.carrierDiscoveryRun.findMany({
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: { proposals: { select: { id: true, status: true, createdAt: true } } },
    });
    res.json({ success: true, enabled: isCarrierDiscoveryEnabled(), data: runs });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unable to load discovery roster' });
  }
});

router.post('/roster/monthly', async (_req: Request, res: Response) => {
  if (!hasDiscoveryEnabled(res)) return;
  try {
    const created = await ensureMonthlyDiscoveryRoster(prisma);
    res.status(201).json({ success: true, created });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unable to create roster' });
  }
});

router.post('/runs', async (req: Request, res: Response) => {
  if (!hasDiscoveryEnabled(res)) return;
  const body = req.body as { carrierId?: string; issueDetail?: string };
  const carrierId = body.carrierId ? carrierFrom(body.carrierId) : null;
  if (!carrierId) {
    res.status(400).json({ success: false, error: 'A supported carrierId is required' });
    return;
  }
  try {
    const id = await requestCarrierRediscovery(
      prisma,
      carrierId,
      'MANUAL',
      body.issueDetail,
      authUserId(req.auth ?? req.practiceAuth) ?? undefined,
    );
    res.status(201).json({ success: true, data: { id } });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unable to request discovery' });
  }
});

router.post('/runs/:id/ready', async (req: Request, res: Response) => {
  if (!hasDiscoveryEnabled(res)) return;
  try {
    const updated = await prisma.carrierDiscoveryRun.updateMany({
      where: { id: req.params.id, status: 'PENDING' },
      data: { status: 'READY_FOR_OPERATOR' },
    });
    if (updated.count !== 1) {
      res.status(404).json({ success: false, error: 'Pending discovery run not found' });
      return;
    }
    // This transition is intentionally informational: no scheduler or call dispatcher consumes it.
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unable to update discovery run' });
  }
});

router.get('/snapshots/:carrierId', async (req: Request, res: Response) => {
  const carrierId = carrierFrom(req.params.carrierId);
  if (!carrierId) {
    res.status(400).json({ success: false, error: 'Unsupported carrierId' });
    return;
  }
  const snapshots = await prisma.carrierNavigationSnapshot.findMany({
    where: { carrierId },
    orderBy: { version: 'desc' },
    take: 50,
  });
  res.json({ success: true, data: snapshots });
});

router.get('/proposals', async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : 'PROPOSED';
  if (!['PROPOSED', 'APPROVED', 'REJECTED'].includes(status)) {
    res.status(400).json({ success: false, error: 'Invalid proposal status' });
    return;
  }
  const proposals = await prisma.carrierNavigationProposal.findMany({
    where: { status: status as 'PROPOSED' | 'APPROVED' | 'REJECTED' },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ success: true, data: proposals });
});

router.post('/proposals', async (req: Request, res: Response) => {
  if (!hasDiscoveryEnabled(res)) return;
  const body = req.body as {
    carrierId?: string;
    discoveryRunId?: string;
    steps?: unknown;
    transcript?: string;
    summary?: string;
    evidence?: string;
    confidence?: number;
  };
  const carrierId = body.carrierId ? carrierFrom(body.carrierId) : null;
  const suppliedSteps =
    Array.isArray(body.steps) && body.steps.every((step) => typeof step === 'string')
      ? body.steps
      : typeof body.transcript === 'string'
        ? deriveNavigationStepsFromTranscript(body.transcript)
        : null;
  if (!carrierId || !suppliedSteps || typeof body.summary !== 'string') {
    res.status(400).json({ success: false, error: 'carrierId, summary, and string steps or a transcript are required' });
    return;
  }
  try {
    const proposal = await createNavigationProposal(prisma, {
      carrierId,
      discoveryRunId: body.discoveryRunId,
      steps: suppliedSteps,
      summary: body.summary,
      evidence: body.evidence ?? body.transcript,
      confidence: body.confidence,
    });
    res.status(201).json({ success: true, data: proposal });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Unable to create proposal' });
  }
});

router.post('/proposals/:id/review', async (req: Request, res: Response) => {
  if (!hasDiscoveryEnabled(res)) return;
  const body = req.body as { action?: string; notes?: string };
  if (body.action !== 'approve' && body.action !== 'reject') {
    res.status(400).json({ success: false, error: 'action must be approve or reject' });
    return;
  }
  const reviewerId = authUserId(req.auth ?? req.practiceAuth);
  if (!reviewerId) {
    res.status(403).json({ success: false, error: 'Authenticated reviewer required' });
    return;
  }
  try {
    const reviewed = await reviewNavigationProposal(prisma, req.params.id, body.action, reviewerId, body.notes);
    if (!reviewed) {
      res.status(404).json({ success: false, error: 'Proposed navigation change not found' });
      return;
    }
    res.json({ success: true, status: body.action === 'approve' ? 'APPROVED' : 'REJECTED' });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unable to review proposal' });
  }
});

export function createCarrierDiscoveryRouter(): Router {
  return router;
}

