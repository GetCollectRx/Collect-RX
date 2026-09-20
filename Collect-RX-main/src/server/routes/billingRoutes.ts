import { Router, type Request, type Response } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requirePracticeContext, practiceIdFromSession } from '../middleware/requirePracticeSession';
import { authenticate } from '../middleware/authenticate';
import { requirePracticeOwner } from '../middleware/requirePracticeOwner.js';
import { requirePlanUsageAccess } from '../middleware/requirePlanUsageAccess.js';
import { createBillingCheckoutSession, createBillingPortalSession, getSubscriptionGateState } from '../stripe/billing';
import { apiClientErrorMessage } from '../apiErrorMessage.js';
import { confirmOverage, getPlanSummary } from '../plans/planBridge.js';
import { getPracticeSettings, updatePracticeSettings } from '../services/practiceSettingsService.js';
import type { PracticeSettings } from '../../types/practiceSettings.js';
import { logger } from '../observability/logger.js';

export function createBillingRouter(prisma: PrismaClient): Router {
  const r = Router();
  const planUsageAccess = requirePlanUsageAccess(prisma);

  r.post('/checkout', authenticate, requirePracticeContext, requirePracticeOwner, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const requestedPlanId = typeof req.body?.planId === 'string' ? req.body.planId.trim() : undefined;
      const { url } = await createBillingCheckoutSession(practiceId, prisma, requestedPlanId);
      res.json({ url });
    } catch (e) {
      logger.error('[billing/checkout]', { error: e });
      res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  });

  r.get('/usage', authenticate, requirePracticeContext, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const subscription = await getSubscriptionGateState(prisma, practiceId);
      res.json({ subscription });
    } catch (e) {
      logger.error('[billing/usage]', { error: e });
      res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  });

  r.post('/portal', authenticate, requirePracticeContext, requirePracticeOwner, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const { url } = await createBillingPortalSession(practiceId, prisma);
      res.json({ url });
    } catch (e) {
      logger.error('[billing/portal]', { error: e });
      res.status(400).json({ error: apiClientErrorMessage(e) });
    }
  });

  /** Plan tier, cycle usage, alerts — for /billing page and dashboard banners. */
  r.get('/plan', authenticate, requirePracticeContext, planUsageAccess, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const practice = await prisma.practice.findUnique({
        where: { id: practiceId },
        select: { subscriptionCurrentPeriodEnd: true, subscriptionStatus: true, name: true },
      });
      const subscription = await getSubscriptionGateState(prisma, practiceId);
      const plan = await getPlanSummary(practiceId, practice?.subscriptionCurrentPeriodEnd);
      const settings = await getPracticeSettings(prisma, practiceId);
      res.json({
        success: true,
        plan,
        subscription,
        practiceName: practice?.name ?? null,
        visibility: {
          usageVisibleToOfficeManager: settings.usageVisibleToOfficeManager,
          usageVisibleToBillingCoordinator: settings.usageVisibleToBillingCoordinator,
          usageAlertEmailsEnabled: settings.usageAlertEmailsEnabled,
        },
      });
    } catch (e) {
      logger.error('[billing/plan]', { error: e });
      res.status(500).json({ success: false, error: apiClientErrorMessage(e) });
    }
  });

  /** Practice confirms overage charges from the Usage tab — resumes paused calling. */
  r.post('/usage/confirm-overage', authenticate, requirePracticeContext, planUsageAccess, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const result = await confirmOverage(practiceId);
      if (result.status === 'expired') {
        return res.status(409).json({
          success: false,
          status: 'expired',
          error:
            'The overage confirmation window has expired. Upgrade your plan or wait for the next billing cycle to resume calling.',
        });
      }
      res.json({ success: true, ...result });
    } catch (e) {
      logger.error('[billing/usage/confirm-overage]', { error: e });
      res.status(400).json({ success: false, error: apiClientErrorMessage(e) });
    }
  });

  /** Owner-only: toggle which staff roles can view plan usage + email alerts. */
  r.patch('/plan/visibility', authenticate, requirePracticeContext, requirePracticeOwner, async (req: Request, res: Response) => {
    try {
      const practiceId = practiceIdFromSession(req);
      const body = req.body as Partial<
        Pick<
          PracticeSettings,
          'usageVisibleToOfficeManager' | 'usageVisibleToBillingCoordinator' | 'usageAlertEmailsEnabled'
        >
      >;
      const patch: Partial<PracticeSettings> = {};
      if (typeof body.usageVisibleToOfficeManager === 'boolean') {
        patch.usageVisibleToOfficeManager = body.usageVisibleToOfficeManager;
      }
      if (typeof body.usageVisibleToBillingCoordinator === 'boolean') {
        patch.usageVisibleToBillingCoordinator = body.usageVisibleToBillingCoordinator;
      }
      if (typeof body.usageAlertEmailsEnabled === 'boolean') {
        patch.usageAlertEmailsEnabled = body.usageAlertEmailsEnabled;
      }
      const settings = await updatePracticeSettings(prisma, practiceId, patch);
      res.json({
        success: true,
        visibility: {
          usageVisibleToOfficeManager: settings.usageVisibleToOfficeManager,
          usageVisibleToBillingCoordinator: settings.usageVisibleToBillingCoordinator,
          usageAlertEmailsEnabled: settings.usageAlertEmailsEnabled,
        },
      });
    } catch (e) {
      logger.error('[billing/plan/visibility]', { error: e });
      res.status(400).json({ success: false, error: apiClientErrorMessage(e) });
    }
  });

  return r;
}
