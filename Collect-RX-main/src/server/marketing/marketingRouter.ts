/**
 * Marketing API Routes
 *
 * Endpoints for the Partnerships pipeline:
 *   GET    /api/marketing/prospects          — list with filters
 *   POST   /api/marketing/prospects          — create manually
 *   GET    /api/marketing/prospects/:id      — single prospect + events
 *   PATCH  /api/marketing/prospects/:id      — update stage/notes/score
 *   DELETE /api/marketing/prospects/:id      — soft-delete (set stage=closed_lost)
 *   GET    /api/marketing/pipeline           — kanban counts + prospect cards per stage
 *   POST   /api/marketing/prospects/:id/sequence/start  — start email cadence
 *   POST   /api/marketing/prospects/:id/sequence/stop   — stop active sequence
 *   POST   /api/marketing/prospects/:id/call            — initiate voice qualification call
 *   POST   /api/marketing/voice-outcome                 — Vapi tool-call callback (unauthenticated)
 *   POST   /api/marketing/harvest                       — trigger Google Places harvest
 *   GET    /api/marketing/stats                         — pipeline summary stats
 *
 *   GET  /api/public/prospect-unsubscribe    — one-click email opt-out (unauthenticated)
 */

import { Router, type Request, type Response } from 'express';
import type { PrismaClient, Prisma } from '@prisma/client';
import { authenticate } from '../middleware/authenticate.js';
import { startEmailCadence } from './sequenceEngine.js';
import { initiateQualificationCall } from './salesQualifierAgent.js';
import { harvestProspects } from './prospectHarvester.js';
import { verifyProspectUnsubscribeRequest } from './unsubscribeUrl.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_STAGES = [
  'new', 'contacted', 'engaged', 'qualified',
  'demo_scheduled', 'proposal_sent', 'closed_won', 'closed_lost', 'not_interested',
] as const;

type ProspectStageValue = (typeof ALLOWED_STAGES)[number];

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function optStr(v: unknown): string | null {
  const s = str(v);
  return s || null;
}

/** Require platform_dev or group_admin role. Falls back to practice_owner for single-tenant pilots. */
async function requireMarketingAccess(req: Request, res: Response): Promise<boolean> {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  const role = req.auth.role as string | undefined;
  const allowedRoles = ['platform_dev', 'group_admin', 'practice_owner', 'office_manager'];
  if (!role || !allowedRoles.includes(role)) {
    res.status(403).json({ error: 'Access denied' });
    return false;
  }
  return true;
}

export function createMarketingRouter(prisma: PrismaClient): Router {
  const r = Router();

  // ── List prospects ───────────────────────────────────────────────────────
  r.get('/prospects', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const { stage, search, limit = '50', offset = '0' } = req.query as Record<string, string>;
    const take = Math.min(parseInt(limit) || 50, 200);
    const skip = parseInt(offset) || 0;

    const where: Record<string, unknown> = {};
    if (stage && ALLOWED_STAGES.includes(stage as ProspectStageValue)) {
      where['stage'] = stage;
    }
    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [prospects, total] = await Promise.all([
      prisma.prospectPractice.findMany({
        where,
        orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
        take,
        skip,
        include: {
          sequences: { where: { status: 'active' }, take: 1 },
          _count: { select: { events: true } },
        },
      }),
      prisma.prospectPractice.count({ where }),
    ]);

    res.json({ prospects, total, limit: take, offset: skip });
  });

  // ── Pipeline (kanban view) ───────────────────────────────────────────────
  r.get('/pipeline', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const stages = await prisma.prospectPractice.groupBy({
      by: ['stage'],
      _count: { id: true },
    });

    const recentPerStage = await Promise.all(
      ALLOWED_STAGES.map((stage) =>
        prisma.prospectPractice.findMany({
          where: { stage },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: { id: true, name: true, city: true, province: true, score: true, updatedAt: true, stage: true, email: true, phone: true },
        })
      )
    );

    const pipeline = ALLOWED_STAGES.map((stage, idx) => ({
      stage,
      count: stages.find((s: { stage: string; _count: { id: number } }) => s.stage === stage)?._count.id ?? 0,
      prospects: recentPerStage[idx],
    }));

    res.json({ pipeline });
  });

  // ── Stats ────────────────────────────────────────────────────────────────
  r.get('/stats', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const [stageCounts, recent, emailsSent, demoBooked] = await Promise.all([
      prisma.prospectPractice.groupBy({ by: ['stage'], _count: { id: true } }),
      prisma.prospectPractice.findMany({
        where: { stage: { notIn: ['closed_won', 'closed_lost', 'not_interested'] } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, name: true, stage: true, score: true, updatedAt: true },
      }),
      prisma.prospectEvent.count({ where: { type: 'email_sent' } }),
      prisma.prospectEvent.count({ where: { type: 'demo_booked' } }),
    ]);

    const byStage = Object.fromEntries(stageCounts.map((s: { stage: string; _count: { id: number } }) => [s.stage, s._count.id]));
    const total = Object.values(byStage).reduce((a: number, b: number) => a + b, 0);
    const active = total - ((byStage['closed_won'] ?? 0) + (byStage['closed_lost'] ?? 0) + (byStage['not_interested'] ?? 0));

    res.json({ total, active, byStage, emailsSent, demoBooked, recentActivity: recent });
  });

  // ── Create prospect ──────────────────────────────────────────────────────
  r.post('/prospects', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = str(body.name);
    if (!name || name.length > 200) {
      return res.status(400).json({ error: 'Practice name is required (max 200 chars)' });
    }

    const email = optStr(body.email);
    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const now = new Date();
    const prospect = await prisma.prospectPractice.create({
      data: {
        name,
        city: optStr(body.city),
        province: optStr(body.province),
        postalCode: optStr(body.postalCode),
        phone: optStr(body.phone),
        email,
        website: optStr(body.website),
        pmsGuess: optStr(body.pmsGuess),
        notes: optStr(body.notes),
        source: 'manual',
        stage: 'new',
        score: typeof body.score === 'number' ? Math.min(100, Math.max(0, body.score)) : 50,
        updatedAt: now,
      },
    });

    await prisma.prospectEvent.create({
      data: {
        prospectId: prospect.id,
        type: 'stage_changed',
        metadata: { action: 'created', source: 'manual' },
        occurredAt: now,
      },
    });

    res.status(201).json({ prospect });
  });

  // ── Get single prospect ──────────────────────────────────────────────────
  r.get('/prospects/:id', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const prospect = await prisma.prospectPractice.findUnique({
      where: { id: req.params.id },
      include: {
        sequences: { orderBy: { startedAt: 'desc' } },
        events: { orderBy: { occurredAt: 'desc' }, take: 50 },
      },
    });
    if (!prospect) return res.status(404).json({ error: 'Not found' });
    res.json({ prospect });
  });

  // ── Update prospect ──────────────────────────────────────────────────────
  r.patch('/prospects/:id', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const existing = await prisma.prospectPractice.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const newStage = str(body.stage) as ProspectStageValue | '';
    if (newStage && !ALLOWED_STAGES.includes(newStage)) {
      return res.status(400).json({ error: `Invalid stage: ${newStage}` });
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (body.name !== undefined) updates['name'] = str(body.name) || existing.name;
    if (body.city !== undefined) updates['city'] = optStr(body.city);
    if (body.province !== undefined) updates['province'] = optStr(body.province);
    if (body.postalCode !== undefined) updates['postalCode'] = optStr(body.postalCode);
    if (body.phone !== undefined) updates['phone'] = optStr(body.phone);
    if (body.email !== undefined) {
      const e = optStr(body.email);
      if (e && !EMAIL_RE.test(e)) return res.status(400).json({ error: 'Invalid email' });
      updates['email'] = e;
    }
    if (body.website !== undefined) updates['website'] = optStr(body.website);
    if (body.notes !== undefined) updates['notes'] = optStr(body.notes);
    if (body.pmsGuess !== undefined) updates['pmsGuess'] = optStr(body.pmsGuess);
    if (typeof body.score === 'number') updates['score'] = Math.min(100, Math.max(0, body.score));
    if (newStage) updates['stage'] = newStage;

    const prospect = await prisma.prospectPractice.update({
      where: { id: req.params.id },
      data: updates,
    });

    if (newStage && newStage !== existing.stage) {
      await prisma.prospectEvent.create({
        data: {
          prospectId: prospect.id,
          type: 'stage_changed',
          metadata: { fromStage: existing.stage, toStage: newStage },
          occurredAt: now,
        },
      });
    }
    if (body.notes !== undefined && body.notes !== existing.notes) {
      await prisma.prospectEvent.create({
        data: {
          prospectId: prospect.id,
          type: 'note_added',
          metadata: { note: str(body.notes).slice(0, 500) },
          occurredAt: now,
        },
      });
    }

    res.json({ prospect });
  });

  // ── Start email cadence ──────────────────────────────────────────────────
  r.post('/prospects/:id/sequence/start', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const prospect = await prisma.prospectPractice.findUnique({ where: { id: req.params.id } });
    if (!prospect) return res.status(404).json({ error: 'Not found' });
    if (prospect.optedOutAt) return res.status(409).json({ error: 'Prospect has opted out of email' });
    if (!prospect.email) return res.status(400).json({ error: 'Prospect has no email address' });

    const { sequenceId, alreadyActive } = await startEmailCadence(prisma, req.params.id, true);
    res.json({ sequenceId, alreadyActive });
  });

  // ── Stop active sequence ─────────────────────────────────────────────────
  r.post('/prospects/:id/sequence/stop', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const now = new Date();
    const updated = await prisma.prospectSequence.updateMany({
      where: { prospectId: req.params.id, status: 'active' },
      data: { status: 'stopped', completedAt: now, updatedAt: now },
    });

    res.json({ stopped: updated.count });
  });

  // ── Initiate voice call ──────────────────────────────────────────────────
  r.post('/prospects/:id/call', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const prospect = await prisma.prospectPractice.findUnique({ where: { id: req.params.id } });
    if (!prospect) return res.status(404).json({ error: 'Not found' });
    if (!prospect.phone) return res.status(400).json({ error: 'Prospect has no phone number' });

    // Enforce call window: Mon–Fri 8am–5pm Eastern
    const now = new Date();
    const etHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/Toronto' })).getHours();
    const etDay = new Date(now.toLocaleString('en-US', { timeZone: 'America/Toronto' })).getDay();
    if (etDay === 0 || etDay === 6 || etHour < 8 || etHour >= 17) {
      return res.status(400).json({ error: 'Calls are only allowed Mon–Fri 8am–5pm Eastern time' });
    }

    let callId: string;
    try {
      callId = await initiateQualificationCall({
        prospectId: prospect.id,
        practiceName: prospect.name,
        city: prospect.city,
        phone: prospect.phone,
        pmsGuess: prospect.pmsGuess,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.status(502).json({ error: `Failed to initiate call: ${msg}` });
    }

    await prisma.prospectEvent.create({
      data: {
        prospectId: prospect.id,
        type: 'call_attempted',
        metadata: { vapiCallId: callId },
        occurredAt: now,
      },
    });

    res.json({ callId });
  });

  // ── Vapi voice-outcome tool callback (unauthenticated — validated by shared secret) ──
  r.post('/voice-outcome', async (req: Request, res: Response) => {
    const secret = process.env.VAPI_WEBHOOK_SECRET;
    if (secret) {
      const provided =
        req.get('x-vapi-secret') || req.get('X-Vapi-Secret') ||
        (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (provided !== secret) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const meta = (body.metadata ?? {}) as Record<string, string>;
    const prospectId = meta['prospect_id'] || str(body.prospectId);
    const toolCall = (body.toolCallList as Array<{ function?: { arguments?: { outcome?: string; notes?: string; practiceSize?: string; pmsUsed?: string } } }> | undefined)?.[0];
    const args = toolCall?.function?.arguments ?? (body as Record<string, unknown>);
    const outcome = str(args?.['outcome'] as unknown);
    const notes = optStr(args?.['notes'] as unknown);
    const practiceSize = optStr(args?.['practiceSize'] as unknown);
    const pmsUsed = optStr(args?.['pmsUsed'] as unknown);

    if (!prospectId) {
      return res.status(400).json({ error: 'Missing prospect_id in metadata' });
    }

    const now = new Date();
    const stageMap: Record<string, ProspectStageValue> = {
      qualified: 'qualified',
      demo_booked: 'demo_scheduled',
      not_interested: 'not_interested',
      wants_info: 'engaged',
    };
    const newStage = stageMap[outcome];

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.prospectEvent.create({
        data: {
          prospectId,
          type: 'call_outcome',
          metadata: { outcome, notes, practiceSize, pmsUsed },
          occurredAt: now,
        },
      });
      if (newStage) {
        await tx.prospectPractice.update({
          where: { id: prospectId },
          data: {
            stage: newStage,
            ...(pmsUsed ? { pmsGuess: pmsUsed } : {}),
            ...(practiceSize ? { practiceSize: practiceSize as 'solo' | 'small_group' | 'large_group' } : {}),
            updatedAt: now,
          },
        });
      }
    });

    res.json({ received: true });
  });

  // ── Harvest prospects ────────────────────────────────────────────────────
  r.post('/harvest', authenticate, async (req: Request, res: Response) => {
    if (!(await requireMarketingAccess(req, res))) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const city = str(body.city);
    if (!city) return res.status(400).json({ error: 'city is required' });

    try {
      const result = await harvestProspects(prisma, {
        city,
        province: optStr(body.province) ?? undefined,
        query: optStr(body.query) ?? undefined,
        maxResults: typeof body.maxResults === 'number' ? body.maxResults : 20,
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return r;
}

/**
 * Public (unauthenticated) prospect unsubscribe endpoint.
 * Registered at /api/public/prospect-unsubscribe.
 */
export function createProspectUnsubscribeRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.get('/prospect-unsubscribe', async (req: Request, res: Response) => {
    const prospectId = str(req.query['p'] as unknown);
    const sig = str(req.query['s'] as unknown);

    if (!prospectId || !verifyProspectUnsubscribeRequest(prospectId, sig)) {
      return res.status(400).send('<p>Invalid or expired unsubscribe link.</p>');
    }

    await prisma.prospectPractice.updateMany({
      where: { id: prospectId, optedOutAt: null },
      data: { optedOutAt: new Date(), updatedAt: new Date() },
    });

    await prisma.prospectEvent.create({
      data: {
        prospectId,
        type: 'unsubscribed',
        metadata: { via: 'email_link' },
        occurredAt: new Date(),
      },
    });

    res.send(`
      <!DOCTYPE html>
      <html><head><meta charset="UTF-8"/><title>Unsubscribed</title></head>
      <body style="font-family:sans-serif;max-width:400px;margin:60px auto;text-align:center">
        <h2>You've been unsubscribed</h2>
        <p>We won't send any more marketing emails to this address.</p>
      </body></html>
    `);
  });

  return r;
}
