import type { Express, Request, Response } from 'express';
import type { PrismaClient, ProspectStage } from '@prisma/client';
import { authenticate } from '../middleware/authenticate.js';
import { runEmailCampaignScheduler } from '../marketing/emailCampaignScheduler.js';
import { enrichCampaignEmails } from '../marketing/emailEnrichment.js';
import { analyzeAndUpdateProspectFromReply, bulkAnalyzeReplies } from '../marketing/replyDetection.js';

function requirePlatformAdmin(req: Request, res: Response, next: () => void) {
  const auth = req.auth;
  const role = auth && 'role' in auth ? (auth as { role: string }).role : null;

  if (role !== 'platform_admin' && role !== 'platform_dev') {
    return res.status(403).json({ error: 'Email campaigns require platform_admin role.' });
  }
  next();
}

export function registerEmailCampaignRoutes(app: Express, prisma: PrismaClient) {
  // GET /api/admin/email-campaigns
  app.get('/api/admin/email-campaigns', authenticate, requirePlatformAdmin, async (_req: Request, res: Response) => {
    try {
      const campaigns = await prisma.marketingCampaign.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { prospects: true } },
        },
      });

      const campaignStats = await Promise.all(
        campaigns.map(async (campaign) => {
          const prospectCounts = await prisma.prospect.groupBy({
            by: ['stage'],
            where: { campaignId: campaign.id },
            _count: { id: true },
          });

          const statsByStage = Object.fromEntries(
            prospectCounts.map((group) => [group.stage, group._count.id]),
          );

          const emailStats = await prisma.prospect.aggregate({
            where: { campaignId: campaign.id },
            _count: {
              id: true,
              emailOpenCount: true,
            },
            _sum: { emailOpenCount: true },
          });

          return {
            id: campaign.id,
            name: campaign.name,
            active: campaign.active,
            totalProspects: campaign._count.prospects,
            statsByStage,
            emailsOpenedCount: emailStats._sum.emailOpenCount || 0,
            prospectCount: emailStats._count.id,
            createdAt: campaign.createdAt.toISOString(),
          };
        }),
      );

      res.json(campaignStats);
    } catch (err) {
      console.error('[emailCampaignRoutes] get campaigns failed', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
  });

  // GET /api/admin/email-campaigns/:campaignId/prospects
  app.get(
    '/api/admin/email-campaigns/:campaignId/prospects',
    authenticate,
    requirePlatformAdmin,
    async (req: Request, res: Response) => {
      try {
        const { campaignId } = req.params;
        const { stage, emailStatus } = req.query;

        const where: Record<string, unknown> = { campaignId };

        if (stage && typeof stage === 'string') {
          where.stage = stage;
        }

        if (emailStatus === 'opened') {
          where.emailOpenCount = { gt: 0 };
        }

        const prospects = await prisma.prospect.findMany({
          where,
          select: {
            id: true,
            practiceName: true,
            contactName: true,
            email: true,
            city: true,
            stage: true,
            score: true,
            lastEmailSentAt: true,
            emailOpenCount: true,
            emailClickCount: true,
            closedWonAt: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        res.json(prospects);
      } catch (err) {
        console.error('[emailCampaignRoutes] get prospects failed', (err as Error).message);
        res.status(500).json({ error: 'Failed to fetch prospects' });
      }
    },
  );

  // POST /api/admin/email-campaigns/import-csv
  app.post('/api/admin/email-campaigns/import-csv', authenticate, requirePlatformAdmin, async (request: Request, res: Response) => {
    try {
      const { campaignName, prospects } = request.body as {
        campaignName: string;
        prospects: Array<{
          practiceName: string;
          contactName?: string;
          email: string;
          city?: string;
          province?: string;
        }>;
      };

      if (!campaignName || !Array.isArray(prospects) || prospects.length === 0) {
        return res.status(400).json({ error: 'campaignName and prospects array required' });
      }

      // Create campaign
      const campaign = await prisma.marketingCampaign.create({
        data: {
          name: campaignName,
          active: true,
          notes: `Imported ${prospects.length} prospects`,
        },
      });

      // Batch create prospects
      const createdProspects = await Promise.all(
        prospects.map((p) =>
          prisma.prospect.create({
            data: {
              practiceName: p.practiceName,
              contactName: p.contactName,
              email: p.email,
              city: p.city,
              province: p.province,
              campaignId: campaign.id,
              source: 'manual',
              stage: 'new',
            },
          }),
        ),
      );

      res.json({
        campaignId: campaign.id,
        campaignName: campaign.name,
        importedCount: createdProspects.length,
      });
    } catch (err) {
      console.error('[emailCampaignRoutes] import csv failed', (err as Error).message);
      res.status(500).json({ error: 'Failed to import prospects' });
    }
  });

  // POST /api/admin/email-campaigns/send-batch
  app.post(
    '/api/admin/email-campaigns/:campaignId/send-batch',
    authenticate,
    requirePlatformAdmin,
    async (_req: Request, res: Response) => {
      try {
        const result = await runEmailCampaignScheduler(prisma);
        res.json(result);
      } catch (err) {
        console.error('[emailCampaignRoutes] send batch failed', (err as Error).message);
        res.status(500).json({ error: 'Failed to send email batch' });
      }
    },
  );

  // GET /api/admin/email-campaigns/stats/summary
  app.get('/api/admin/email-campaigns/stats/summary', authenticate, requirePlatformAdmin, async (_req: Request, res: Response) => {
    try {
      const stats = await prisma.prospect.aggregate({
        _count: { id: true },
        _sum: { emailOpenCount: true, emailClickCount: true },
      });

      const replied = await prisma.prospect.count({
        where: { emailRepliedAt: { not: null } },
      });

      const closedWon = await prisma.prospect.count({
        where: { closedWonAt: { not: null } },
      });

      res.json({
        totalProspects: stats._count.id,
        totalEmailsOpened: stats._sum.emailOpenCount || 0,
        totalEmailsClicked: stats._sum.emailClickCount || 0,
        repliedCount: replied,
        convertedCount: closedWon,
        conversionRate: stats._count.id > 0 ? ((closedWon / stats._count.id) * 100).toFixed(2) : '0',
      });
    } catch (err) {
      console.error('[emailCampaignRoutes] get stats failed', (err as Error).message);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // POST /api/admin/email-campaigns/:prospectId/mark-replied
  app.post(
    '/api/admin/email-campaigns/:prospectId/mark-replied',
    authenticate,
    requirePlatformAdmin,
    async (req: Request, res: Response) => {
      try {
        const { prospectId } = req.params;
        const { replyBody, stage } = req.body as { replyBody?: string; stage?: string };

        const updated = await prisma.prospect.update({
          where: { id: prospectId },
          data: {
            stage: (stage as ProspectStage) || ('engaged' as ProspectStage),
            metadata: {
              replied: true,
              repliedAt: new Date().toISOString(),
              ...(replyBody && { replyBody }),
            },
          },
        });

        res.json(updated);
      } catch (err) {
        console.error('[emailCampaignRoutes] mark replied failed', (err as Error).message);
        res.status(500).json({ error: 'Failed to update prospect' });
      }
    },
  );

  // POST /api/admin/email-campaigns/:prospectId/mark-converted
  app.post(
    '/api/admin/email-campaigns/:prospectId/mark-converted',
    authenticate,
    requirePlatformAdmin,
    async (req: Request, res: Response) => {
      try {
        const { prospectId } = req.params;

        const updated = await prisma.prospect.update({
          where: { id: prospectId },
          data: {
            closedWonAt: new Date(),
            stage: 'closed_won',
          },
        });

        res.json(updated);
      } catch (err) {
        console.error('[emailCampaignRoutes] mark converted failed', (err as Error).message);
        res.status(500).json({ error: 'Failed to update prospect' });
      }
    },
  );

  // POST /api/admin/email-campaigns/:campaignId/enrich-emails
  app.post(
    '/api/admin/email-campaigns/:campaignId/enrich-emails',
    authenticate,
    requirePlatformAdmin,
    async (req: Request, res: Response) => {
      try {
        const { campaignId } = req.params;
        const result = await enrichCampaignEmails(campaignId, prisma);
        res.json({
          message: `Email enrichment complete`,
          total: result.total,
          enriched: result.enriched,
          failed: result.failed,
          enrichmentRate: result.total > 0 ? `${Math.round((result.enriched / result.total) * 100)}%` : '0%',
        });
      } catch (err) {
        console.error('[emailCampaignRoutes] enrich emails failed', (err as Error).message);
        res.status(500).json({ error: 'Email enrichment failed' });
      }
    },
  );

  // POST /api/admin/email-campaigns/:prospectId/analyze-reply
  app.post(
    '/api/admin/email-campaigns/:prospectId/analyze-reply',
    authenticate,
    requirePlatformAdmin,
    async (req: Request, res: Response) => {
      try {
        const { prospectId } = req.params;
        const { replyText } = req.body as { replyText: string };

        const prospect = await prisma.prospect.findUnique({
          where: { id: prospectId },
          select: { practiceName: true },
        });

        if (!prospect) {
          return res.status(404).json({ error: 'Prospect not found' });
        }

        const analysis = await analyzeAndUpdateProspectFromReply(
          prospectId,
          replyText,
          prospect.practiceName,
          prisma,
        );

        res.json(analysis);
      } catch (err) {
        console.error('[emailCampaignRoutes] analyze reply failed', (err as Error).message);
        res.status(500).json({ error: 'Reply analysis failed' });
      }
    },
  );

  // GET /api/admin/email-campaigns/:campaignId/reply-analysis
  app.get(
    '/api/admin/email-campaigns/:campaignId/reply-analysis',
    authenticate,
    requirePlatformAdmin,
    async (req: Request, res: Response) => {
      try {
        const { campaignId } = req.params;
        const stats = await bulkAnalyzeReplies(campaignId, prisma);
        res.json(stats);
      } catch (err) {
        console.error('[emailCampaignRoutes] get reply analysis failed', (err as Error).message);
        res.status(500).json({ error: 'Failed to fetch reply analysis' });
      }
    },
  );
}
