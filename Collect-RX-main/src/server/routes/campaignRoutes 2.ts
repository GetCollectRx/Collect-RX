import type { Express, Request, Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/authenticate.js';

function requirePlatformAdmin(req: Request, res: Response, next: () => void): void {
  const auth = req.auth;
  const role = auth && 'role' in auth ? (auth as { role: string }).role : null;

  if (role !== 'platform_admin' && role !== 'platform_dev') {
    res.status(403).json({ error: 'Campaign operations require platform_admin role.' });
    return;
  }
  next();
}

export function registerCampaignRoutes(app: Express, prisma: PrismaClient): void {
  // POST /api/campaigns - Create a new campaign
  app.post('/api/campaigns', authenticate, requirePlatformAdmin, async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, notes, targetProvinces, maxProspects } = req.body as {
        name?: string;
        notes?: string;
        targetProvinces?: string[];
        maxProspects?: number;
      };

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Campaign name is required' });
        return;
      }

      const campaign = await prisma.marketingCampaign.create({
        data: {
          name: name.trim(),
          notes: notes?.trim() || undefined,
          active: true,
          targetProvinces: targetProvinces ? JSON.stringify(targetProvinces) : undefined,
          maxProspects: maxProspects ?? undefined,
        },
      });

      const prospectCount = await prisma.prospect.count({
        where: { campaignId: campaign.id },
      });

      console.warn(`[campaignRoutes] Created campaign: ${campaign.id} (${campaign.name})`);

      res.status(201).json({
        id: campaign.id,
        name: campaign.name,
        active: campaign.active,
        notes: campaign.notes,
        prospectCount,
        createdAt: campaign.createdAt.toISOString(),
      });
    } catch (err) {
      console.error('[campaignRoutes] POST /api/campaigns failed:', (err as Error).message);
      res.status(500).json({ error: 'Failed to create campaign' });
    }
  });

  // GET /api/campaigns - List all campaigns with summary stats
  app.get('/api/campaigns', authenticate, requirePlatformAdmin, async (_req: Request, res: Response): Promise<void> => {
    try {
      const campaigns = await prisma.marketingCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { prospects: true } },
        },
      });

      const campaignStats = await Promise.all(
        campaigns.map(async (campaign) => {
          const prospectStats = await prisma.prospect.aggregate({
            where: { campaignId: campaign.id },
            _count: { id: true },
            _sum: { emailOpenCount: true, emailClickCount: true },
          });

          const replied = await prisma.prospect.count({
            where: { campaignId: campaign.id, emailRepliedAt: { not: null } },
          });

          const converted = await prisma.prospect.count({
            where: { campaignId: campaign.id, closedWonAt: { not: null } },
          });

          return {
            id: campaign.id,
            name: campaign.name,
            active: campaign.active,
            totalProspects: campaign._count.prospects,
            emailsSent: prospectStats._count.id,
            emailsOpened: prospectStats._sum.emailOpenCount || 0,
            emailsClicked: prospectStats._sum.emailClickCount || 0,
            repliedCount: replied,
            convertedCount: converted,
            conversionRate:
              prospectStats._count.id > 0
                ? ((converted / prospectStats._count.id) * 100).toFixed(2)
                : '0.00',
            createdAt: campaign.createdAt.toISOString(),
            updatedAt: campaign.updatedAt.toISOString(),
          };
        }),
      );

      res.json(campaignStats);
    } catch (err) {
      console.error('[campaignRoutes] GET /api/campaigns failed:', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  });

  // GET /api/campaigns/:id/stats - Get detailed statistics for a campaign
  app.get('/api/campaigns/:id/stats', authenticate, requirePlatformAdmin, async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const campaign = await prisma.marketingCampaign.findUnique({
        where: { id },
        include: { _count: { select: { prospects: true } } },
      });

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }

      const prospectStats = await prisma.prospect.aggregate({
        where: { campaignId: id },
        _count: { id: true },
        _sum: { emailOpenCount: true, emailClickCount: true },
      });

      const replied = await prisma.prospect.count({
        where: { campaignId: id, emailRepliedAt: { not: null } },
      });

      const converted = await prisma.prospect.count({
        where: { campaignId: id, closedWonAt: { not: null } },
      });

      const bounced = await prisma.prospect.count({
        where: { campaignId: id, emailBounceReason: { not: null } },
      });

      const eventCounts = await prisma.emailCampaignEvent.groupBy({
        by: ['eventType'],
        where: { prospect: { campaignId: id } },
        _count: { id: true },
      });

      const eventsByType = Object.fromEntries(
        eventCounts.map((group) => [group.eventType, group._count.id]),
      );

      console.warn(`[campaignRoutes] Retrieved stats for campaign: ${id}`);

      res.json({
        campaignId: campaign.id,
        campaignName: campaign.name,
        active: campaign.active,
        stats: {
          totalProspects: campaign._count.prospects,
          emailsSent: prospectStats._count.id,
          emailsOpened: prospectStats._sum.emailOpenCount || 0,
          emailsClicked: prospectStats._sum.emailClickCount || 0,
          repliedCount: replied,
          convertedCount: converted,
          bouncedCount: bounced,
          conversionRate:
            prospectStats._count.id > 0
              ? ((converted / prospectStats._count.id) * 100).toFixed(2)
              : '0.00',
          eventsByType: eventsByType,
        },
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      });
    } catch (err) {
      console.error('[campaignRoutes] GET /api/campaigns/:id/stats failed:', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch campaign stats' });
    }
  });

  // POST /api/campaigns/:id/send-batch - Queue prospects for email sending
  app.post(
    '/api/campaigns/:id/send-batch',
    authenticate,
    requirePlatformAdmin,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { id } = req.params;
        const { prospectIds, emailSubject, force } = req.body as {
          prospectIds?: string[];
          emailSubject?: string;
          force?: boolean;
        };

        const campaign = await prisma.marketingCampaign.findUnique({
          where: { id },
        });

        if (!campaign) {
          res.status(404).json({ error: 'Campaign not found' });
          return;
        }

        if (!campaign.active && !force) {
          res.status(400).json({ error: 'Campaign is inactive. Use force=true to override.' });
          return;
        }

        const prospectsToSend = prospectIds && Array.isArray(prospectIds) && prospectIds.length > 0
          ? await prisma.prospect.findMany({
            where: {
              id: { in: prospectIds },
              campaignId: id,
            },
          })
          : await prisma.prospect.findMany({
            where: {
              campaignId: id,
              email: { not: null },
              optOutAt: null,
              emailBounceReason: null,
              sequenceCompleted: false,
            },
          });

        if (prospectsToSend.length === 0) {
          res.status(400).json({ error: 'No prospects found to send emails to' });
          return;
        }

        const batchSize = 100;
        let processedCount = 0;

        for (let i = 0; i < prospectsToSend.length; i += batchSize) {
          const batch = prospectsToSend.slice(i, i + batchSize);

          await Promise.all(
            batch.map(async (prospect) => {
              const nextSequenceStep = prospect.emailSequenceStep + 1;

              await prisma.prospect.update({
                where: { id: prospect.id },
                data: {
                  emailSequenceStep: nextSequenceStep,
                  lastEmailSentAt: new Date(),
                },
              });

              await prisma.emailCampaignEvent.create({
                data: {
                  prospectId: prospect.id,
                  eventType: 'sent',
                  eventTimestamp: new Date(),
                  emailSubject: emailSubject || undefined,
                },
              });

              processedCount += 1;
            }),
          );
        }

        console.warn(
          `[campaignRoutes] Queued ${processedCount} prospects for sending in campaign: ${id}`,
        );

        res.json({
          campaignId: id,
          batchSize: processedCount,
          message: `Queued ${processedCount} prospects for email sending`,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[campaignRoutes] POST /api/campaigns/:id/send-batch failed:', (err as Error).message);
        res.status(500).json({ error: 'Failed to queue batch for sending' });
      }
    },
  );

  // GET /api/campaigns/:id/prospects - Get all prospects in campaign with optional filtering
  app.get('/api/campaigns/:id/prospects', authenticate, requirePlatformAdmin, async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { sort, limit } = req.query;

      const campaign = await prisma.marketingCampaign.findUnique({
        where: { id },
      });

      if (!campaign) {
        res.status(404).json({ error: 'Campaign not found' });
        return;
      }

      let queryLimit = 1000;
      if (limit && typeof limit === 'string') {
        queryLimit = Math.min(parseInt(limit, 10), 1000);
      }

      const prospects = await prisma.prospect.findMany({
        where: { campaignId: id },
        take: queryLimit,
        orderBy:
          sort === 'engagement'
            ? [{ emailOpenCount: 'desc' }, { emailClickCount: 'desc' }]
            : [{ createdAt: 'desc' }],
      });

      console.warn(`[campaignRoutes] Retrieved ${prospects.length} prospects for campaign: ${id}`);

      res.json(prospects);
    } catch (err) {
      console.error('[campaignRoutes] GET /api/campaigns/:id/prospects failed:', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch prospects' });
    }
  });

  // GET /api/campaigns/:id/emails-sent-today - Get count of emails sent today
  app.get('/api/campaigns/:id/emails-sent-today', authenticate, requirePlatformAdmin, async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const count = await prisma.emailCampaignEvent.count({
        where: {
          prospect: { campaignId: id },
          eventType: 'sent',
          eventTimestamp: {
            gte: today,
            lt: tomorrow,
          },
        },
      });

      console.warn(`[campaignRoutes] Emails sent today in campaign ${id}: ${count}`);

      res.json({ count });
    } catch (err) {
      console.error('[campaignRoutes] GET /api/campaigns/:id/emails-sent-today failed:', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch emails sent today' });
    }
  });

  // GET /api/campaigns/prospects/:id/history - Get email event history for a prospect
  app.get('/api/campaigns/prospects/:id/history', authenticate, requirePlatformAdmin, async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const prospect = await prisma.prospect.findUnique({
        where: { id },
      });

      if (!prospect) {
        res.status(404).json({ error: 'Prospect not found' });
        return;
      }

      const history = await prisma.emailCampaignEvent.findMany({
        where: { prospectId: id },
        orderBy: { eventTimestamp: 'desc' },
        take: 100,
      });

      console.warn(`[campaignRoutes] Retrieved history for prospect: ${id} (${history.length} events)`);

      res.json(history);
    } catch (err) {
      console.error('[campaignRoutes] GET /api/campaigns/prospects/:id/history failed:', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch prospect history' });
    }
  });
}
