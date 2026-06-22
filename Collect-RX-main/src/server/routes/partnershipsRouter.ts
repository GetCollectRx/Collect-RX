import { Router, type Request, type Response } from 'express';
import type { PrismaClient, ProspectStage } from '@prisma/client';
import { authenticate } from '../middleware/authenticate.js';
import { requirePlatformAdmin } from '../middleware/requireUserRole.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { harvestProspects } from '../marketing/prospectHarvester.js';
import { initiateProspectSalesCall } from '../marketing/vapiSalesCall.js';
import { advanceProspectStage, runMarketingSequenceTick } from '../marketing/sequenceEngine.js';
import { handleProspectClosedWon } from '../marketing/practiceHandoff.js';
import { syncProspectStageToHubspot } from '../marketing/hubspotSync.js';
import { checkProspectDncl } from '../marketing/dnclCheck.js';
import {
  createCampaign,
  harvestForCampaign,
  listCampaigns,
} from '../marketing/campaignService.js';
import { sendHotLeadAlert } from '../marketing/hotLeadAlerts.js';
import { logProspectActivity } from '../marketing/prospectActivity.js';
import { previewColdEmail, type PostDemoOutcome } from '../marketing/emailTemplates.js'
import {
  CAPABILITY_CATALOG,
  formatCapabilityCatalogForReview,
} from '../marketing/outreachVoice.js';
import { PROSPECT_STAGES } from '../../types/partnerships.js';
import {
  loadScoreWeights,
} from '../marketing/prospectScoring.js';
import {
  runMarketingLearningCycle,
} from '../marketing/marketingLearningJob.js';
import { startTrialOnboarding, runTrialOnboardingTick } from '../marketing/trialOnboarding.js';
import { sendSuggestedReply } from '../marketing/replyIntelligence.js';
import { sendPostDemoFollowUp } from '../marketing/postDemoFollowUp.js';

export function createPartnershipsRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(authenticate);
  router.use(requirePlatformAdmin);

  router.get('/stats', async (_req: Request, res: Response) => {
    const counts = await prisma.prospect.groupBy({
      by: ['stage'],
      _count: { _all: true },
    });
    const byStage = Object.fromEntries(counts.map((c) => [c.stage, c._count._all]));
    const total = counts.reduce((n, c) => n + c._count._all, 0);
    return res.json({ success: true, data: { total, byStage } });
  });

  router.get('/pipeline', async (_req: Request, res: Response) => {
    const pipeline = await Promise.all(
      PROSPECT_STAGES.map(async (stage) => {
        const [count, prospects] = await Promise.all([
          prisma.prospect.count({ where: { stage } }),
          prisma.prospect.findMany({
            where: { stage },
            orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
            take: 10,
            select: {
              id: true,
              practiceName: true,
              city: true,
              province: true,
              score: true,
              stage: true,
              email: true,
              phone: true,
              updatedAt: true,
            },
          }),
        ]);
        return {
          stage,
          count,
          prospects: prospects.map((p) => ({
            id: p.id,
            practiceName: p.practiceName,
            city: p.city,
            province: p.province,
            score: p.score,
            stage: p.stage,
            email: p.email,
            phone: p.phone,
            updatedAt: p.updatedAt.toISOString(),
          })),
        };
      }),
    );
    return res.json({ success: true, data: { pipeline } });
  });

  router.get('/learning/score-config', async (_req: Request, res: Response) => {
    const weights = await loadScoreWeights(prisma);
    const config = await prisma.marketingScoreConfig.findUnique({ where: { id: 'default' } });
    const lastRun = await prisma.marketingLearningRun.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return res.json({
      success: true,
      data: {
        weights,
        stats: config?.stats ?? null,
        lastRun: lastRun
          ? {
              id: lastRun.id,
              wins: lastRun.wins,
              losses: lastRun.losses,
              prospectsRescored: lastRun.prospectsRescored,
              createdAt: lastRun.createdAt.toISOString(),
            }
          : null,
      },
    });
  });

  router.post('/learning/run', async (_req: Request, res: Response) => {
    try {
      const result = await runMarketingLearningCycle(prisma);
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.get('/prospects', async (req: Request, res: Response) => {
    const stage = req.query.stage as ProspectStage | undefined;
    const where = stage && PROSPECT_STAGES.includes(stage) ? { stage } : {};
    const rows = await prisma.prospect.findMany({
      where,
      orderBy: [{ score: 'desc' }, { updatedAt: 'desc' }],
      take: 200,
    });
    return res.json({
      success: true,
      data: rows.map((p) => ({
        id: p.id,
        practiceName: p.practiceName,
        contactName: p.contactName,
        email: p.email,
        phone: p.phone,
        city: p.city,
        score: p.score,
        stage: p.stage,
        source: p.source,
        lastEngagedAt: p.lastEngagedAt?.toISOString() ?? null,
        lastEmailSentAt: p.lastEmailSentAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });

  router.get('/prospects/:id', async (req: Request, res: Response) => {
    const prospect = await prisma.prospect.findUnique({
      where: { id: req.params.id },
      include: {
        activities: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!prospect) return res.status(404).json({ success: false, error: 'Not found' });
    return res.json({ success: true, data: prospect });
  });

  router.post('/prospects', async (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const practiceName = String(body.practiceName || '').trim();
    if (!practiceName) {
      return res.status(400).json({ success: false, error: 'practiceName required' });
    }
    const prospect = await prisma.prospect.create({
      data: {
        practiceName,
        contactName: typeof body.contactName === 'string' ? body.contactName.trim() : null,
        email: typeof body.email === 'string' ? body.email.trim() : null,
        phone: typeof body.phone === 'string' ? body.phone.trim() : null,
        city: typeof body.city === 'string' ? body.city.trim() : null,
        province: typeof body.province === 'string' ? body.province.trim() : null,
        website: typeof body.website === 'string' ? body.website.trim() : null,
        pmsHint: typeof body.pmsHint === 'string' ? body.pmsHint.trim() : null,
        score: typeof body.score === 'number' ? body.score : 50,
        source: 'manual',
      },
    });
    await logProspectActivity(prisma, prospect.id, 'created', 'Manually added prospect');
    return res.status(201).json({ success: true, data: prospect });
  });

  /**
   * Bulk import prospects from the RCDSO scraper or any CSV-to-JSON pipeline.
   * Body: { prospects: ProspectInput[] }
   * Skips rows where (practiceName + city) already exists.
   * Returns { created, skipped, errors }.
   */
  router.post('/prospects/bulk-import', async (req: Request, res: Response) => {
    const body = req.body as { prospects?: unknown[] };
    if (!Array.isArray(body.prospects) || body.prospects.length === 0) {
      return res.status(400).json({ success: false, error: 'prospects array required' });
    }
    if (body.prospects.length > 500) {
      return res.status(400).json({ success: false, error: 'Max 500 prospects per batch' });
    }

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of body.prospects) {
      const r = row as Record<string, unknown>;
      const practiceName = String(r.practiceName || '').trim();
      const city = typeof r.city === 'string' ? r.city.trim() : null;

      if (!practiceName) { errors.push('Missing practiceName'); continue; }

      try {
        const existing = await prisma.prospect.findFirst({
          where: { practiceName, city: city ?? undefined },
          select: { id: true },
        });
        if (existing) { skipped++; continue; }

        await prisma.prospect.create({
          data: {
            practiceName,
            contactName: typeof r.contactName === 'string' ? r.contactName.trim() : null,
            email: typeof r.email === 'string' && r.email.trim() ? r.email.trim() : null,
            phone: typeof r.phone === 'string' ? r.phone.trim() : null,
            city,
            province: typeof r.province === 'string' ? r.province.trim() : 'ON',
            website: typeof r.website === 'string' ? r.website.trim() : null,
            pmsHint: typeof r.pmsHint === 'string' ? r.pmsHint.trim() : null,
            score: typeof r.score === 'number' ? r.score : 50,
            source: 'rcdso' as unknown as import('@prisma/client').ProspectSource,
          },
        });
        created++;
      } catch (err) {
        errors.push(`${practiceName}: ${(err as Error).message}`);
      }
    }

    return res.json({ success: true, data: { created, skipped, errors: errors.slice(0, 20) } });
  });

  router.patch('/prospects/:id', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const data: Record<string, unknown> = {};
      if (typeof body.contactName === 'string') data.contactName = body.contactName.trim();
      if (typeof body.email === 'string') data.email = body.email.trim();
      if (typeof body.phone === 'string') data.phone = body.phone.trim();
      if (typeof body.pmsHint === 'string') data.pmsHint = body.pmsHint.trim();
      if (typeof body.score === 'number') data.score = body.score;

      let prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
      if (!prospect) return res.status(404).json({ success: false, error: 'Not found' });

      if (typeof body.stage === 'string' && PROSPECT_STAGES.includes(body.stage as ProspectStage)) {
        prospect = await advanceProspectStage(prisma, prospect.id, body.stage as ProspectStage);
        await logProspectActivity(prisma, prospect.id, 'stage_change', `Stage → ${body.stage}`);

        if (body.stage === 'closed_won') {
          await handleProspectClosedWon(prisma, prospect.id);
        } else {
          if (body.stage === 'demo_booked') {
            await sendHotLeadAlert(prospect, 'demo_booked');
          }
          void syncProspectStageToHubspot(
            prisma,
            prospect.id,
            body.stage as ProspectStage,
          ).catch((err) => {
            console.warn('[hubspot] stage sync failed', (err as Error).message);
          });
        }
      }

      if (Object.keys(data).length > 0) {
        prospect = await prisma.prospect.update({
          where: { id: req.params.id },
          data,
        });
      }

      return res.json({ success: true, data: prospect });
    } catch (err) {
      return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.post('/prospects/harvest', async (req: Request, res: Response) => {
    const body = req.body as {
      query?: string;
      city?: string;
      province?: string;
      limit?: number;
      campaignId?: string;
    };
    const query = body.query?.trim();
    if (!query) {
      return res.status(400).json({ success: false, error: 'query required (e.g. dental practice)' });
    }
    if (body.campaignId) {
      try {
        const result = await harvestForCampaign(prisma, body.campaignId, {
          query,
          city: body.city,
          province: body.province,
          limit: body.limit,
        });
        return res.json({ success: true, data: result });
      } catch (err) {
        return res.status(422).json({ success: false, error: apiErrorMessageForResponse(err) });
      }
    }
    const result = await harvestProspects(prisma, {
      query,
      city: body.city,
      province: body.province,
      limit: body.limit,
    });
    return res.json({ success: true, data: result });
  });

  router.get('/campaigns', async (_req: Request, res: Response) => {
    const campaigns = await listCampaigns(prisma);
    return res.json({ success: true, data: { campaigns } });
  });

  router.post('/campaigns', async (req: Request, res: Response) => {
    try {
      const body = req.body as Record<string, unknown>;
      const campaign = await createCampaign(prisma, {
        name: String(body.name || ''),
        targetProvinces: Array.isArray(body.targetProvinces)
          ? (body.targetProvinces as string[])
          : undefined,
        harvestQuery: typeof body.harvestQuery === 'string' ? body.harvestQuery : undefined,
        maxProspects: typeof body.maxProspects === 'number' ? body.maxProspects : undefined,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
      });
      return res.status(201).json({ success: true, data: campaign });
    } catch (err) {
      return res.status(422).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.post('/campaigns/:id/harvest', async (req: Request, res: Response) => {
    try {
      const body = req.body as { query?: string; city?: string; province?: string; limit?: number };
      const result = await harvestForCampaign(prisma, req.params.id!, {
        query: body.query,
        city: body.city,
        province: body.province,
        limit: body.limit,
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(422).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.post('/prospects/:id/dncl-check', async (req: Request, res: Response) => {
    try {
      const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
      if (!prospect) return res.status(404).json({ success: false, error: 'Not found' });
      const result = await checkProspectDncl(prisma, prospect);
      const updated = await prisma.prospect.findUnique({ where: { id: prospect.id } });
      return res.json({ success: true, data: { ...result, prospect: updated } });
    } catch (err) {
      return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.post('/prospects/:id/create-practice', async (req: Request, res: Response) => {
    try {
      const { createPracticeFromProspect } = await import('../marketing/practiceHandoff.js');
      const result = await createPracticeFromProspect(prisma, req.params.id!);
      const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
      return res.json({ success: true, data: { ...result, prospect } });
    } catch (err) {
      return res.status(422).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.post('/prospects/:id/call', async (req: Request, res: Response) => {
    try {
      const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
      if (!prospect) return res.status(404).json({ success: false, error: 'Not found' });
      const result = await initiateProspectSalesCall(prisma, prospect);
      await logProspectActivity(prisma, prospect.id, 'sales_call_started', `Vapi ${result.vapiCallId}`);
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(422).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.get('/prospects/:id/email-preview', async (req: Request, res: Response) => {
    const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
    if (!prospect) return res.status(404).json({ success: false, error: 'Not found' });
    const stepRaw = Number(req.query.step);
    const step = Number.isFinite(stepRaw) && stepRaw >= 1 ? Math.min(4, Math.floor(stepRaw)) : prospect.sequenceStep + 1;
    const preview = previewColdEmail(prospect, step);
    if (!preview) return res.status(400).json({ success: false, error: 'Invalid step' });
    return res.json({ success: true, data: preview });
  });

  router.post('/prospects/:id/pause-sequence', async (req: Request, res: Response) => {
    const body = req.body as { days?: number };
    const days = typeof body.days === 'number' && body.days > 0 ? Math.min(90, body.days) : 14;
    const pauseUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const prospect = await prisma.prospect.update({
      where: { id: req.params.id },
      data: { sequencePausedUntil: pauseUntil },
    });
    await logProspectActivity(prisma, prospect.id, 'sequence_paused', `Paused ${days} days`);
    return res.json({ success: true, data: prospect });
  });

  router.post('/prospects/:id/resume-sequence', async (req: Request, res: Response) => {
    const prospect = await prisma.prospect.update({
      where: { id: req.params.id },
      data: { sequencePausedUntil: null },
    });
    await logProspectActivity(prisma, prospect.id, 'sequence_resumed', 'Cadence resumed');
    return res.json({ success: true, data: prospect });
  });

  router.post('/prospects/:id/opt-out', async (req: Request, res: Response) => {
    const prospect = await prisma.prospect.update({
      where: { id: req.params.id },
      data: {
        optOutAt: new Date(),
        stage: 'opted_out',
        sequenceCompleted: true,
      },
    });
    await logProspectActivity(prisma, prospect.id, 'opted_out', 'Manually opted out');
    return res.json({ success: true, data: prospect });
  });

  router.post('/prospects/:id/send-suggested-reply', async (req: Request, res: Response) => {
    try {
      const result = await sendSuggestedReply(prisma, req.params.id!);
      const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
      return res.json({ success: true, data: { ...result, prospect } });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('No suggested') ? 400 : 422;
      return res.status(status).json({ success: false, error: msg });
    }
  });

  router.post('/prospects/:id/post-demo-follow-up', async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        outcome?: PostDemoOutcome;
        concern?: string;
        concernResponse?: string;
        agreementSendDay?: string;
        send?: boolean;
      };
      const outcome = body.outcome;
      if (!outcome || !['interested', 'thinking', 'not_fit'].includes(outcome)) {
        return res.status(400).json({ success: false, error: 'outcome required (interested | thinking | not_fit)' });
      }
      const result = await sendPostDemoFollowUp(prisma, req.params.id!, {
        outcome,
        concern: body.concern,
        concernResponse: body.concernResponse,
        agreementSendDay: body.agreementSendDay,
        send: body.send,
      });
      return res.json({ success: true, data: result });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('already sent') ? 409 : 422;
      return res.status(status).json({ success: false, error: msg });
    }
  });

  router.post('/sequence/tick', async (_req: Request, res: Response) => {
    const result = await runMarketingSequenceTick(prisma);
    return res.json({ success: true, data: result });
  });

  /** Capability catalog + voice rules — for reviewing outreach messaging */
  router.get('/outreach-voice', (_req: Request, res: Response) => {
    return res.json({
      success: true,
      data: {
        catalog: CAPABILITY_CATALOG,
        markdown: formatCapabilityCatalogForReview(),
      },
    });
  });

  /**
   * Start trial onboarding for a prospect.
   * Sends the pre-kickoff email (step 0) immediately and begins the 60-day sequence.
   * Call this after the trial agreement is signed.
   */
  router.post('/prospects/:id/start-trial', async (req: Request, res: Response) => {
    try {
      await startTrialOnboarding(prisma, req.params.id!);
      const prospect = await prisma.prospect.findUnique({ where: { id: req.params.id } });
      return res.json({ success: true, data: prospect });
    } catch (err) {
      const msg = (err as Error).message;
      const status = msg.includes('already started') ? 409 : 422;
      return res.status(status).json({ success: false, error: msg });
    }
  });

  /**
   * Advance any due trial onboarding emails across all active trials.
   * Called by the daily cron job; can also be triggered manually for testing.
   */
  router.post('/trial/tick', async (_req: Request, res: Response) => {
    try {
      const sent = await runTrialOnboardingTick(prisma);
      return res.json({ success: true, data: { sent } });
    } catch (err) {
      return res.status(500).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  return router;
}
