import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { requirePlatformAdmin } from '../middleware/requireUserRole.js';
import { apiErrorMessageForResponse } from '../apiErrorMessage.js';
import { getPracticeSettings, updatePracticeSettings } from '../services/practiceSettingsService.js';
import { computeQueueStats } from '../services/platformReports.js';
import type { UserRole } from '../../types/userRole.js';
import { authPracticeId, authUserId, getUserRole } from '../accessControl/types.js';

export function createPlatformPersonaAdminRouter(): Router {
  const router = Router();
  router.use(authenticate);
  router.use(requirePlatformAdmin);

  router.get('/practices', async (_req, res) => {
    const rows = await prisma.practice.findMany({
      select: { id: true, name: true, settings: true },
      orderBy: { name: 'asc' },
    });
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
        return {
          id: p.id,
          name: p.name,
          voiceAgentEnabled: settings.voiceAgentEnabled,
          openEscalations: openEsc,
          lastCallAt: lastCall?.initiatedAt?.toISOString() ?? null,
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

  router.get('/queue/stats', async (_req, res) => {
    const practices = await prisma.practice.findMany({ select: { id: true, name: true } });
    const stats = await Promise.all(
      practices.map(async (p) => ({
        practice: p,
        ...(await computeQueueStats(prisma, p.id)),
      })),
    );
    return res.json({ success: true, data: stats });
  });

  router.post('/queue/build', async (req, res) => {
    const reason = (req.body as { reason?: string }).reason?.trim();
    if (!reason) return res.status(400).json({ success: false, error: 'reason is required' });
    const auth = req.auth!;
    const adminUserId = authUserId(auth) ?? 'platform-admin';
    await prisma.breakGlassAuditLog.create({
      data: { adminUserId, action: 'build_queue', reason },
    });
    return res.json({ success: true, message: 'Queue build logged. Practice owners will be notified.' });
  });

  router.post('/queue/run', async (req, res) => {
    const reason = (req.body as { reason?: string }).reason?.trim();
    if (!reason) return res.status(400).json({ success: false, error: 'reason is required' });
    const auth = req.auth!;
    const adminUserId = authUserId(auth) ?? 'platform-admin';
    await prisma.breakGlassAuditLog.create({
      data: { adminUserId, action: 'run_queue', reason },
    });
    return res.json({ success: true, message: 'Queue run logged. Practice owners will be notified.' });
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
