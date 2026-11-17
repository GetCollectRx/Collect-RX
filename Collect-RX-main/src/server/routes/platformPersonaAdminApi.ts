import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePlatformAdmin } from '../middleware/requireUserRole.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { getPracticeSettings, updatePracticeSettings } from '../services/practiceSettingsService.js';
import { computeQueueStats } from '../services/platformReports.js';
import { computePlatformRecoveryMetrics } from '../recovery/recoveryMetrics.js';
import type { UserRole } from '../../types/userRole.js';
import { authPracticeId, authUserId, getUserRole, isPlatformAdmin } from '../accessControl/types.js';
import { TIERS } from '../../billing/tiers.js';
import { appendAuditLog } from '../audit/auditLog.js';
import { z } from 'zod';
import { CarrierId } from '@prisma/client';
import { runWithRlsBypass } from '../db/rlsContext.js';
import { logger } from '../observability/logger.js';
import { CSV_AR_FEATURES, setCsvArFeaturePaused } from '../featureFlags/csvArFeatures.js';
import {
  PAUSE_REASON_MAX_LENGTH,
  listActiveDispatchPauses,
  setDispatchPause,
  type PauseTarget,
} from '../pauseControls/dispatchPause.js';

const pauseBodySchema = z
  .object({
    paused: z.boolean(),
    reason: z.string().trim().max(PAUSE_REASON_MAX_LENGTH).optional(),
  })
  .refine((b) => !b.paused || (b.reason !== undefined && b.reason.length > 0), {
    message: 'reason is required when pausing',
    path: ['reason'],
  });

const carrierPauseBodySchema = pauseBodySchema.and(z.object({ practiceId: z.string().uuid().optional() }));
const featureFlagBodySchema = z.object({
  paused: z.boolean(),
  reason: z.string().trim().max(PAUSE_REASON_MAX_LENGTH).optional(),
});
const CSV_AR_FEATURE_VALUES: readonly string[] = Object.values(CSV_AR_FEATURES);

export function createPlatformPersonaAdminRouter(): Router {
  const router = Router();
  router.use(authenticate);
  // This router shares the /api/admin mount with the practice-owner admin
  // router. A hard 403 here would swallow every /api/admin/* request from
  // practice owners before their router (mounted after this one) is reached —
  // locking practices out of their own settings. Non-platform users skip this
  // router entirely and fall through to the practice admin router.
  router.use((req: Request, _res: Response, next: NextFunction) => {
    if (!isPlatformAdmin(req.auth ?? req.practiceAuth)) return next('router');
    next();
  });
  router.use(requirePlatformAdmin);

  // ── Staged rollout flags (platform-wide kill switch) ──────────────────────
  router.get('/feature-flags', async (_req, res) => {
    const rows = await runWithRlsBypass(() =>
      prisma.featureFlag.findMany({
        where: { practiceId: null, feature: { in: [...CSV_AR_FEATURE_VALUES] } },
        select: { feature: true, paused: true, pauseReason: true, pausedAt: true },
      }),
    );
    const byFeature = new Map(rows.map((r) => [r.feature, r]));
    const data = CSV_AR_FEATURE_VALUES.map((feature) => {
      const row = byFeature.get(feature);
      return {
        feature,
        paused: row?.paused ?? false,
        pauseReason: row?.pauseReason ?? null,
        pausedAt: row?.pausedAt?.toISOString() ?? null,
      };
    });
    return res.json({ success: true, data });
  });

  router.patch('/feature-flags/:feature', async (req, res) => {
    const feature = req.params.feature;
    if (!CSV_AR_FEATURE_VALUES.includes(feature)) {
      return res.status(404).json({ success: false, error: 'Unknown feature flag' });
    }
    const parsed = featureFlagBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'paused (boolean) is required' });
    }
    const { paused, reason } = parsed.data;
    await runWithRlsBypass(() =>
      setCsvArFeaturePaused(
        prisma,
        null,
        feature as (typeof CSV_AR_FEATURES)[keyof typeof CSV_AR_FEATURES],
        paused,
        reason,
      ),
    );
    logger.warn('[platformAdmin] feature flag changed', { feature, paused, actorId: authUserId(req.auth) });
    return res.json({ success: true, data: { feature, paused } });
  });

  // ── Calling pause controls (R6 / G3) ──────────────────────────────────────
  router.get('/pauses', async (_req, res) => {
    const pauses = await listActiveDispatchPauses(prisma);
    return res.json({ success: true, data: { pauses, carriers: Object.values(CarrierId) } });
  });

  async function applyPause(
    req: Request,
    res: Response,
    target: PauseTarget,
    paused: boolean,
    reason: string | null,
  ) {
    await setDispatchPause(prisma, target, paused, reason);
    const actorId = authUserId(req.auth) ?? null;
    // Operator-visible record without patient data. System and carrier-wide
    // pauses have no tenant, so they log only; practice-scoped ones also land
    // in that practice's tamper-evident audit chain.
    logger.warn('[platformAdmin] calling pause changed', {
      scope: target.scope,
      practiceId: target.practiceId,
      carrierId: target.carrierId ?? null,
      paused,
      actorId,
    });
    if (target.practiceId) {
      void appendAuditLog(prisma, {
        practiceId: target.practiceId,
        action: paused ? 'platform_admin.calling_paused' : 'platform_admin.calling_resumed',
        subjectType: 'Practice',
        subjectId: target.practiceId,
        details: { scope: target.scope, carrierId: target.carrierId ?? null, reason },
        req,
      });
    }
    return res.json({ success: true, data: { scope: target.scope, paused } });
  }

  router.put('/pauses/system', async (req, res) => {
    const parsed = pauseBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
    return applyPause(req, res, { scope: 'system', practiceId: null }, parsed.data.paused, parsed.data.reason ?? null);
  });

  router.put('/pauses/practices/:practiceId', async (req, res) => {
    const practiceId = z.string().uuid().safeParse(req.params.practiceId);
    if (!practiceId.success) return res.status(400).json({ success: false, error: 'Invalid practice id' });
    const parsed = pauseBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
    const practice = await prisma.practice.findUnique({ where: { id: practiceId.data }, select: { id: true } });
    if (!practice) return res.status(404).json({ success: false, error: 'Practice not found' });
    return applyPause(req, res, { scope: 'practice', practiceId: practiceId.data }, parsed.data.paused, parsed.data.reason ?? null);
  });

  router.put('/pauses/carriers/:carrierId', async (req, res) => {
    const carrierId = z.nativeEnum(CarrierId).safeParse(req.params.carrierId);
    if (!carrierId.success) return res.status(400).json({ success: false, error: 'Unknown carrier' });
    const parsed = carrierPauseBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' });
    const practiceId = parsed.data.practiceId ?? null;
    if (practiceId) {
      const practice = await prisma.practice.findUnique({ where: { id: practiceId }, select: { id: true } });
      if (!practice) return res.status(404).json({ success: false, error: 'Practice not found' });
    }
    return applyPause(
      req,
      res,
      { scope: 'carrier', practiceId, carrierId: carrierId.data },
      parsed.data.paused,
      parsed.data.reason ?? null,
    );
  });

  router.get('/practices', async (req, res) => {
    const rows = await prisma.practice.findMany({
      select: {
        id: true,
        name: true,
        settings: true,
        billingTier: true,
        subscriptionStatus: true,
        callsPaused: true,
        callsPausedReason: true,
      },
      orderBy: { name: 'asc' },
    });
    for (const p of rows) {
      void appendAuditLog(prisma, {
        practiceId: p.id,
        action: 'platform_admin.practice.read',
        subjectType: 'Practice',
        subjectId: p.id,
        details: { via: 'practices_list' },
        req,
      });
    }
    const data = await Promise.all(
      rows.map(async (p) => {
        const settings = await getPracticeSettings(prisma, p.id);
        const openEsc = await prisma.callEscalation.count({
          where: { practiceId: p.id, status: 'open' },
        });
        const lastCall = await prisma.callAttempt.findFirst({
          where: { claim: { practiceId: p.id } },
          orderBy: { initiatedAt: 'desc' },
          select: { initiatedAt: true },
        });
        const tier = TIERS[p.billingTier];
        const now = new Date();
        const usage = await prisma.usagePeriod.findFirst({
          where: { practiceId: p.id, periodStart: { lte: now }, periodEnd: { gte: now } },
          orderBy: { periodStart: 'desc' },
          select: { minutesConsumed: true },
        });
        const minutesConsumed = usage?.minutesConsumed ?? 0;
        return {
          id: p.id,
          name: p.name,
          voiceAgentEnabled: settings.voiceAgentEnabled,
          openEscalations: openEsc,
          lastCallAt: lastCall?.initiatedAt?.toISOString() ?? null,
          billingTier: p.billingTier,
          tierName: tier.name,
          subscriptionStatus: p.subscriptionStatus ?? null,
          callsPaused: p.callsPaused,
          callsPausedReason: p.callsPausedReason,
          minutesConsumed,
          minutesIncluded: tier.includedMinutes,
          minutesRemaining: Math.max(0, tier.includedMinutes - minutesConsumed),
        };
      }),
    );
    return res.json({ success: true, data });
  });

  router.get('/practices/:practiceId', async (req, res) => {
    const practice = await prisma.practice.findUnique({
      where: { id: req.params.practiceId },
      select: { id: true, name: true, timezone: true, settings: true },
    });
    if (!practice) return res.status(404).json({ success: false, error: 'Not found' });
    const queueStats = await computeQueueStats(prisma, practice.id);
    const settings = await getPracticeSettings(prisma, practice.id);
    void appendAuditLog(prisma, {
      practiceId: practice.id,
      action: 'platform_admin.practice.read',
      subjectType: 'Practice',
      subjectId: practice.id,
      req,
    });
    return res.json({ success: true, data: { practice, settings, queueStats } });
  });

  router.put('/practices/:practiceId/settings', async (req, res) => {
    try {
      const settings = await updatePracticeSettings(prisma, req.params.practiceId, req.body);
      return res.json({ success: true, data: settings });
    } catch (err) {
      return res.status(422).json({ success: false, error: apiErrorMessageForResponse(err) });
    }
  });

  router.get('/practices/:practiceId/grants', async (req, res) => {
    const grants = await prisma.platformAdminPracticeGrant.findMany({
      where: { practiceId: req.params.practiceId },
    });
    void appendAuditLog(prisma, {
      practiceId: req.params.practiceId,
      action: 'platform_admin.practice_grants.read',
      subjectType: 'Practice',
      subjectId: req.params.practiceId,
      req,
    });
    return res.json({ success: true, data: grants });
  });

  router.post('/practices/:practiceId/grants', async (req, res) => {
    const { adminId, grantedByOwnerId } = req.body as {
      adminId?: string;
      grantedByOwnerId?: string;
    };
    if (!adminId?.trim() || !grantedByOwnerId?.trim()) {
      return res.status(400).json({ success: false, error: 'adminId and grantedByOwnerId required' });
    }
    const grant = await prisma.platformAdminPracticeGrant.create({
      data: {
        adminUserId: adminId.trim(),
        practiceId: req.params.practiceId,
        grantedByOwnerId: grantedByOwnerId.trim(),
      },
    });
    return res.json({ success: true, data: grant });
  });

  router.delete('/practices/:practiceId/grants/:grantId', async (req, res) => {
    await prisma.platformAdminPracticeGrant.deleteMany({
      where: { id: req.params.grantId, practiceId: req.params.practiceId },
    });
    return res.json({ success: true });
  });

  router.get('/queue/stats', async (req, res) => {
    const practices = await prisma.practice.findMany({ select: { id: true, name: true } });
    for (const p of practices) {
      void appendAuditLog(prisma, {
        practiceId: p.id,
        action: 'platform_admin.practice.read',
        subjectType: 'Practice',
        subjectId: p.id,
        details: { via: 'queue_stats' },
        req,
      });
    }
    const platformRecovery = await computePlatformRecoveryMetrics(prisma);
    const stats = await Promise.all(
      practices.map(async (p) => {
        const [queue, blockingGatesOpen, awaitingSyncVerification] = await Promise.all([
          computeQueueStats(prisma, p.id),
          prisma.claimRecoveryAction.count({
            where: { practiceId: p.id, status: 'BLOCKING', clearedAt: null },
          }),
          prisma.insuranceClaim.count({
            where: {
              practiceId: p.id,
              recoveryRoute: 'WAIT_SYNC',
              outstandingAmount: { gt: 0 },
            },
          }),
        ]);
        return {
          practice: p,
          ...queue,
          blockingGatesOpen,
          awaitingSyncVerification,
        };
      }),
    );
    return res.json({ success: true, data: stats, platformRecovery });
  });

  // These break-glass endpoints record an auditable request only — they do not
  // build or dispatch the AR call queue themselves (dispatch runs on its own
  // schedule via runDeskQueueTick in src/server/frontDesk/queueEngine.ts, gated
  // by CARRIER_BLOCK, plan limits, and the call window) and they do not notify
  // practice owners. The response copy must never claim otherwise — see
  // OUTSTANDING-FIXES-PRODUCT-READY.md for the audit finding.
  router.post('/queue/build', async (req, res) => {
    const reason = (req.body as { reason?: string }).reason?.trim();
    if (!reason) return res.status(400).json({ success: false, error: 'reason is required' });
    const auth = req.auth!;
    const adminUserId = authUserId(auth) ?? 'platform-admin';
    await prisma.breakGlassAuditLog.create({
      data: { adminUserId, action: 'build_queue', reason },
    });
    return res.json({
      success: true,
      message:
        'Break-glass request recorded in the audit log. This does not build or dispatch the AR queue — ' +
        'dispatch runs automatically on its own schedule — and no notification is sent to practice owners.',
    });
  });

  router.post('/queue/run', async (req, res) => {
    const reason = (req.body as { reason?: string }).reason?.trim();
    if (!reason) return res.status(400).json({ success: false, error: 'reason is required' });
    const auth = req.auth!;
    const adminUserId = authUserId(auth) ?? 'platform-admin';
    await prisma.breakGlassAuditLog.create({
      data: { adminUserId, action: 'run_queue', reason },
    });
    return res.json({
      success: true,
      message:
        'Break-glass request recorded in the audit log. This does not run or dispatch the AR queue — ' +
        'dispatch runs automatically on its own schedule — and no notification is sent to practice owners.',
    });
  });

  router.get('/users', async (_req, res) => {
    const users = await prisma.platformUser.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        userRole: true,
        practiceId: true,
        active: true,
        createdAt: true,
      },
    });
    return res.json({ success: true, data: users });
  });

  router.post('/users', async (req, res) => {
    const { email, password, userRole, practiceId } = req.body as {
      email?: string;
      password?: string;
      userRole?: UserRole;
      practiceId?: string;
    };
    if (!email?.trim() || !password || !userRole) {
      return res.status(400).json({ success: false, error: 'email, password, and userRole required' });
    }
    const hash = await bcrypt.hash(password, 12);
    const user = await prisma.platformUser.create({
      data: {
        id: randomUUID(),
        email: email.trim().toLowerCase(),
        passwordHash: hash,
        userRole,
        practiceId: practiceId ?? null,
      },
    });
    return res.json({
      success: true,
      data: { id: user.id, email: user.email, userRole: user.userRole, practiceId: user.practiceId },
    });
  });

  router.delete('/users/:id', async (req, res) => {
    await prisma.platformUser.update({
      where: { id: req.params.id },
      data: { active: false },
    });
    return res.json({ success: true });
  });

  return router;
}

/** Owner-initiated grant for platform admin claim access */
export function createOwnerGrantRouter(): Router {
  const router = Router();
  router.use(authenticate);

  router.post('/:practiceId/grants', async (req: Request, res: Response) => {
    const auth = req.auth!;
    const ownerId = authUserId(auth);
  if (getUserRole(auth) !== 'practice_owner' || authPracticeId(auth) !== req.params.practiceId) {
      return res.status(403).json({ success: false, error: 'Practice owner only' });
    }
    const { adminId } = req.body as { adminId?: string };
    if (!adminId?.trim()) {
      return res.status(400).json({ success: false, error: 'adminId required' });
    }
    const grant = await prisma.platformAdminPracticeGrant.create({
      data: {
        adminUserId: adminId.trim(),
        practiceId: req.params.practiceId,
        grantedByOwnerId: ownerId ?? 'owner',
      },
    });
    return res.json({ success: true, data: grant });
  });

  return router;
}
