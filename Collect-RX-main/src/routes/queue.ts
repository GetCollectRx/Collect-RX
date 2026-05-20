// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Call queue API (priority scores for dispatch ordering).
// ─────────────────────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { buildPriorityQueue } from '../server/services/priorityEngine';
import { authenticate } from '../server/middleware/authenticate';
import {
  practiceIdFromSession,
  queryPracticeConflictsSession,
  requirePracticeContext,
} from '../server/middleware/requirePracticeSession';
import { apiErrorMessageForResponse } from '../server/apiErrorMessage.js';
import { redactPriorityScoreRow } from '../server/accessControl/redaction.js';

const DEFAULT_CARRIER_ORDER = [
  'sun_life',
  'canada_life',
  'manulife',
  'green_shield',
  'rbc_insurance',
  'telus_adjudicare',
] as const;

function parseCarrierOrderJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed as string[];
    }
  } catch {
    /* ignore */
  }
  return [...DEFAULT_CARRIER_ORDER];
}

const router = Router();
router.use(authenticate);
router.use(requirePracticeContext);

// GET /api/queue/carrier-order?practiceId=… — persisted drag order for CarrierPriorityPanel
router.get('/carrier-order', async (req: Request, res: Response) => {
  try {
    const qP = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
    if (queryPracticeConflictsSession(req, qP || undefined)) {
      return res.status(403).json({ error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);
    const row = await prisma.carrierOrder.findUnique({ where: { practiceId } });
    const order = row ? parseCarrierOrderJson(row.order) : [...DEFAULT_CARRIER_ORDER];
    return res.json({ order });
  } catch (err) {
    console.error('[GET /queue/carrier-order]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

// POST /api/queue/carrier-order — body: { order: string[] }
router.post('/carrier-order', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const body = req.body as { order?: unknown };
    if (!Array.isArray(body.order) || !body.order.every((x) => typeof x === 'string')) {
      return res.status(400).json({ error: 'Invalid order' });
    }
    const orderJson = JSON.stringify(body.order);
    await prisma.carrierOrder.upsert({
      where: { practiceId },
      create: { practiceId, order: orderJson },
      update: { order: orderJson },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /queue/carrier-order]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

/** Electron legacy: set preferred carrier for a calendar day (`QueuePriority` row). */
function parseQueuePriorityDate(raw: unknown): Date {
  const fallback = () => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
  };
  if (typeof raw !== 'string' || !raw.trim()) return fallback();
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    return new Date(Date.UTC(y, mo - 1, day, 12, 0, 0));
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? fallback() : dt;
}

// POST /api/queue/priority — body: { carrier?: string, date?: string (YYYY-MM-DD) }
router.post('/priority', async (req: Request, res: Response) => {
  try {
    const practiceId = practiceIdFromSession(req);
    const body = req.body as { carrier?: unknown; date?: unknown };
    const carrierRaw = body.carrier;
    const carrier =
      typeof carrierRaw === 'string' && carrierRaw.trim() ? carrierRaw.trim() : null;
    const priorityDate = parseQueuePriorityDate(body.date);
    await prisma.queuePriority.upsert({
      where: {
        practiceId_priorityDate: { practiceId, priorityDate },
      },
      create: { practiceId, carrier, priorityDate },
      update: { carrier },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[POST /queue/priority]', err);
    return res.status(500).json({ error: apiErrorMessageForResponse(err) });
  }
});

// GET /api/queue/priority-scores?practiceId=... (must match session when provided)
router.get('/priority-scores', async (req: Request, res: Response) => {
  try {
    const qP = typeof req.query.practiceId === 'string' ? req.query.practiceId.trim() : '';
    if (queryPracticeConflictsSession(req, qP || undefined)) {
      return res.status(403).json({ success: false, error: 'practiceId does not match session' });
    }
    const practiceId = practiceIdFromSession(req);

    const ranked = await buildPriorityQueue(prisma, practiceId);
    const data = ranked.map((row) => redactPriorityScoreRow(row as Record<string, unknown>, req.auth));
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[GET /queue/priority-scores]', err);
    return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
  }
});

export default router;
