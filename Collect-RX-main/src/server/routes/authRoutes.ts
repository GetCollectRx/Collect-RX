import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import {
  getUserRole,
  isCrossPracticeReader,
  isPlatformDev,
  isUserSession,
  practiceRoleToBrief,
  ROLE_LEVEL,
  authPracticeId,
  type UserAuthPayload,
} from '../accessControl/types.js';
import type { UserRole } from '../../types/userRole.js';
import {
  setUserAuthCookie,
  setPlatformDevAuthCookie,
  setBriefAuthCookie,
  clearAuthCookie,
} from '../authToken';
import { authenticate } from '../middleware/authenticate';
import { authorizeRole } from '../middleware/authorizeRole';
import { authLimiter } from '../middleware/rateLimiter';
import { getSubscriptionGateState } from '../stripe/billing';
import {
  formatZodError,
  loginBodySchema,
  platformDevLoginBodySchema,
  createUserBodySchema,
  updateUserBodySchema,
  changePasswordBodySchema,
  registerBodySchema,
  inviteBodySchema,
  acceptInviteBodySchema,
} from '../validation/zodSchemas.js';
import { practiceIdFromRequestHints } from '../accessControl/practiceContext.js';
import { sendPasswordResetEmail } from '../email/passwordReset.js';
import { sendInviteEmail } from '../email/inviteEmail.js';
import { runSessionHealthCheck } from '../observability/sessionHealthCheck.js';

const BCRYPT_ROUNDS = 12;

async function buildSessionHealth(prisma: PrismaClient) {
  const health = await runSessionHealthCheck(prisma);
  if (!health.ok) {
    console.warn('[sessionHealth] Login health check failed:', health.checks.filter((c) => !c.ok && !c.skipped));
  }
  return health;
}

// ─── Platform dev password ────────────────────────────────────────────────────

function platformDevPasswordConfigured(): string | null {
  const plain = process.env.PLATFORM_DEV_PASSWORD?.trim();
  if (plain) return plain;
  const hash = process.env.PLATFORM_DEV_PASSWORD_HASH?.trim();
  if (hash) return `__hash__:${hash}`;
  return null;
}

async function verifyPlatformDevPassword(password: string): Promise<boolean> {
  const configured = platformDevPasswordConfigured();
  if (!configured) return false;
  if (configured.startsWith('__hash__:')) {
    const hash = configured.slice('__hash__:'.length);
    return bcrypt.compare(password, hash);
  }
  const a = Buffer.from(password, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─── Role-based helpers ───────────────────────────────────────────────────────

/**
 * Returns true when the actor can manage the target role.
 * Rules (from RBAC spec):
 *  - platform_dev: can manage anyone
 *  - practice_owner: can manage all roles below owner (not another owner)
 *  - office_manager: can manage billing_coordinator, front_desk, associate_dentist, accountant
 */
function canManageRole(
  actorAuth: UserAuthPayload,
  targetRole: string,
): boolean {
  const actorLevel = ROLE_LEVEL[actorAuth.role as keyof typeof ROLE_LEVEL] ?? 0;
  const targetLevel = ROLE_LEVEL[targetRole as keyof typeof ROLE_LEVEL] ?? 0;
  return actorLevel > targetLevel;
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createAuthRouter(prisma: PrismaClient): Router {
  const r = Router();

  // ── Login ────────────────────────────────────────────────────────────────────

  /** POST /api/auth/login — email + password */
  r.post('/login', authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: formatZodError(parsed.error) });
      }
      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Accountant token expiry check
      if (user.role === 'accountant' && user.tokenExpiresAt && user.tokenExpiresAt < new Date()) {
        return res.status(401).json({ error: 'Account access has expired. Contact your Office Manager to renew.' });
      }

      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      setUserAuthCookie(res, {
        userId: user.id,
        practiceId: user.practiceId,
        role: user.role as UserAuthPayload['role'],
        ...(user.providerId ? { providerId: user.providerId } : {}),
      });

      const practice = await prisma.practice.findUnique({
        where: { id: user.practiceId },
        select: { id: true, name: true, timezone: true },
      });
      const subscription = await getSubscriptionGateState(prisma, user.practiceId);
      const health = await buildSessionHealth(prisma);

      return res.json({
        role: user.role,
        userRole: practiceRoleToBrief(user.role),
        deskRole: user.role === 'front_desk' ? 'front_desk' : 'owner',
        phiAccess: ['practice_owner', 'office_manager', 'billing_coordinator', 'associate_dentist', 'front_desk'].includes(user.role),
        practice,
        subscription,
        user: { id: user.id, displayName: user.displayName, email: user.email, role: user.role },
        health,
      });
    } catch (e) {
      console.error('Login error:', e);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  /** POST /api/auth/login/platform-dev */
  r.post('/login/platform-dev', authLimiter, async (req: Request, res: Response) => {
    try {
      if (!platformDevPasswordConfigured()) {
        return res.status(503).json({
          error: 'Platform developer login is not configured (set PLATFORM_DEV_PASSWORD)',
        });
      }
      const parsed = platformDevLoginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: formatZodError(parsed.error) });
      }
      const ok = await verifyPlatformDevPassword(parsed.data.password);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      setPlatformDevAuthCookie(res);
      const practices = await prisma.practice.findMany({
        select: { id: true, name: true, timezone: true },
        orderBy: { name: 'asc' },
      });
      const health = await buildSessionHealth(prisma);
      return res.json({
        role: 'platform_dev' as const,
        userRole: 'platform_admin' as const,
        phiAccess: false,
        practices,
        subscription: {
          enforce: false,
          active: true,
          status: null,
          currentPeriodEnd: null,
          priceConfigured: false,
          skipped: true,
        },
        health,
      });
    } catch (e) {
      console.error('Platform dev login error:', e);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  /** POST /api/auth/login/platform-user — auditor / billing ops (PlatformUser table) */
  r.post('/login/platform-user', authLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email?.trim() || !password) {
        return res.status(400).json({ error: 'email and password required' });
      }
      const user = await prisma.platformUser.findUnique({
        where: { email: email.trim().toLowerCase() },
      });
      if (!user?.active) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

      const userRole = user.userRole as UserRole;
      setBriefAuthCookie(res, {
        userRole,
        userId: user.id,
        practiceId: user.practiceId,
        phiAccess: userRole === 'auditor',
      });

      let practice = null;
      if (user.practiceId) {
        practice = await prisma.practice.findUnique({
          where: { id: user.practiceId },
          select: { id: true, name: true, timezone: true },
        });
      }
      const sessionAuth = {
        role: userRole === 'auditor' ? 'accountant' as const : 'group_admin' as const,
        userRole,
        userId: user.id,
        practiceId: user.practiceId ?? '',
        phiAccess: userRole === 'auditor',
      };
      const practices = isCrossPracticeReader(sessionAuth)
        ? await prisma.practice.findMany({
            select: { id: true, name: true, timezone: true },
            orderBy: { name: 'asc' },
          })
        : practice
          ? [practice]
          : [];

      return res.json({
        userRole,
        role: userRole === 'auditor' ? 'accountant' : userRole === 'billing_ops_manager' ? 'group_admin' : 'platform_dev',
        phiAccess: userRole === 'auditor',
        practice: practice ?? practices[0] ?? null,
        practices,
        subscription: {
          enforce: false, active: true, status: null, currentPeriodEnd: null, priceConfigured: false, skipped: true,
        },
        health: await buildSessionHealth(prisma),
      });
    } catch (e) {
      console.error('Platform user login error:', e);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  /** POST /api/auth/logout */
  r.post('/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  /** GET /api/auth/session-health — runtime health check for restored sessions */
  r.get('/session-health', authenticate, async (_req, res) => {
    try {
      const health = await buildSessionHealth(prisma);
      return res.json(health);
    } catch (e) {
      console.error('session-health error:', e);
      return res.status(500).json({ error: 'Health check failed' });
    }
  });

  /** GET /api/auth/me */
  r.get('/me', authenticate, async (req, res) => {
    try {
      const auth = req.auth!;

      if (isPlatformDev(auth)) {
        const practices = await prisma.practice.findMany({
          select: { id: true, name: true, timezone: true },
          orderBy: { name: 'asc' },
        });
        const ctx = practiceIdFromRequestHints(req);
        const practice = ctx
          ? await prisma.practice.findUnique({
              where: { id: ctx },
              select: { id: true, name: true, timezone: true },
            })
          : null;
        return res.json({
          role: 'platform_dev',
          userRole: 'platform_admin',
          phiAccess: false,
          practices,
          practice,
          subscription: {
            enforce: false, active: true, status: null,
            currentPeriodEnd: null, priceConfigured: false, skipped: true,
          },
        });
      }

      const platformUser = await prisma.platformUser.findUnique({
        where: { id: auth.userId },
      });
      if (platformUser?.active) {
        const userRole = platformUser.userRole as UserRole;
        const practices = isCrossPracticeReader(auth)
          ? await prisma.practice.findMany({
              select: { id: true, name: true, timezone: true },
              orderBy: { name: 'asc' },
            })
          : platformUser.practiceId
            ? await prisma.practice.findMany({
                where: { id: platformUser.practiceId },
                select: { id: true, name: true, timezone: true },
              })
            : [];
        const ctx = practiceIdFromRequestHints(req) ?? platformUser.practiceId ?? practices[0]?.id;
        const practice = ctx
          ? await prisma.practice.findUnique({
              where: { id: ctx },
              select: { id: true, name: true, timezone: true },
            })
          : null;
        const legacyRole =
          userRole === 'auditor'
            ? ('accountant' as const)
            : userRole === 'billing_ops_manager' || userRole === 'platform_admin'
              ? ('group_admin' as const)
              : ('practice_owner' as const);
        return res.json({
          role: legacyRole,
          userRole,
          phiAccess: userRole === 'auditor',
          practices,
          practice,
          subscription: {
            enforce: false,
            active: true,
            status: null,
            currentPeriodEnd: null,
            priceConfigured: false,
            skipped: true,
          },
        });
      }

      const user = auth as UserAuthPayload;
      const [dbUser, practice] = await Promise.all([
        prisma.user.findUnique({
          where: { id: user.userId },
          select: { id: true, email: true, displayName: true, role: true, isActive: true },
        }),
        prisma.practice.findUnique({
          where: { id: user.practiceId },
          select: { id: true, name: true, timezone: true },
        }),
      ]);
      if (!dbUser || !dbUser.isActive || !practice) {
        return res.status(401).json({ error: 'Session invalid' });
      }
      const subscription = await getSubscriptionGateState(prisma, user.practiceId);
      return res.json({
        role: user.role,
        userRole: getUserRole(auth) ?? practiceRoleToBrief(user.role),
        deskRole: user.role === 'front_desk' ? 'front_desk' : 'owner',
        phiAccess: auth.phiAccess,
        practice,
        subscription,
        user: { id: dbUser.id, displayName: dbUser.displayName, email: dbUser.email, role: dbUser.role },
      });
    } catch (e) {
      console.error('me error:', e);
      return res.status(500).json({ error: 'Failed' });
    }
  });

  // ── User management ──────────────────────────────────────────────────────────
  // All routes below require at minimum office_manager.

  /** GET /api/auth/users — list users for the current practice */
  r.get('/users', authenticate, authorizeRole('office_manager'), async (req, res) => {
    try {
      const auth = req.auth as UserAuthPayload;
      const practiceId = isPlatformDev(req.auth!)
        ? (practiceIdFromRequestHints(req) ?? '')
        : (authPracticeId(req.auth!) ?? auth.practiceId);

      const users = await prisma.user.findMany({
        where: { practiceId },
        select: {
          id: true, email: true, displayName: true, role: true,
          isActive: true, providerId: true, tokenExpiresAt: true,
          createdAt: true, updatedAt: true,
        },
        orderBy: { displayName: 'asc' },
      });
      return res.json({ users });
    } catch (e) {
      console.error('list users error:', e);
      return res.status(500).json({ error: 'Failed to list users' });
    }
  });

  /** POST /api/auth/users — create a user in the current practice */
  r.post('/users', authenticate, authorizeRole('office_manager'), async (req, res) => {
    try {
      const auth = req.auth!;
      const actorAuth = isUserSession(auth) ? (auth as UserAuthPayload) : null;
      const practiceId = actorAuth
        ? actorAuth.practiceId
        : (practiceIdFromRequestHints(req) ?? '');

      const parsed = createUserBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: formatZodError(parsed.error) });
      }
      const { email, password, displayName, role, providerId } = parsed.data;

      // Validate role assignment authority
      if (actorAuth && !isPlatformDev(auth) && !canManageRole(actorAuth, role)) {
        return res.status(403).json({ error: `Your role cannot create accounts with role '${role}'` });
      }

      if (role === 'associate_dentist' && !providerId) {
        return res.status(400).json({ error: 'providerId is required for associate_dentist role' });
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ error: 'A user with this email already exists' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const tokenExpiresAt = role === 'accountant'
        ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        : null;

      const user = await prisma.user.create({
        data: {
          practiceId,
          email,
          passwordHash,
          displayName,
          role: role as import('@prisma/client').PracticeRole,
          providerId: providerId ?? null,
          tokenExpiresAt,
        },
        select: {
          id: true, email: true, displayName: true, role: true,
          isActive: true, providerId: true, tokenExpiresAt: true, createdAt: true,
        },
      });

      return res.status(201).json({ user });
    } catch (e) {
      console.error('create user error:', e);
      return res.status(500).json({ error: 'Failed to create user' });
    }
  });

  /** PATCH /api/auth/users/:userId — update a user */
  r.patch('/users/:userId', authenticate, authorizeRole('office_manager'), async (req, res) => {
    try {
      const auth = req.auth!;
      const actorAuth = isUserSession(auth) ? (auth as UserAuthPayload) : null;
      const practiceId = actorAuth
        ? actorAuth.practiceId
        : (practiceIdFromRequestHints(req) ?? '');

      const target = await prisma.user.findFirst({
        where: { id: req.params.userId, practiceId },
      });
      if (!target) return res.status(404).json({ error: 'User not found' });

      // Check authority to manage target
      if (actorAuth && !isPlatformDev(auth) && !canManageRole(actorAuth, target.role)) {
        return res.status(403).json({ error: 'Insufficient permissions to modify this user' });
      }

      const parsed = updateUserBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: formatZodError(parsed.error) });
      }
      const { displayName, role, isActive, providerId, tokenExpiresAt } = parsed.data;

      // If changing role, verify the actor can assign the new role too
      if (role && actorAuth && !isPlatformDev(auth) && !canManageRole(actorAuth, role)) {
        return res.status(403).json({ error: `Your role cannot assign role '${role}'` });
      }

      const updated = await prisma.user.update({
        where: { id: req.params.userId },
        data: {
          ...(displayName !== undefined ? { displayName } : {}),
          ...(role !== undefined ? { role: role as import('@prisma/client').PracticeRole } : {}),
          ...(isActive !== undefined ? { isActive } : {}),
          ...(providerId !== undefined ? { providerId } : {}),
          ...(tokenExpiresAt !== undefined ? { tokenExpiresAt: new Date(tokenExpiresAt) } : {}),
        },
        select: {
          id: true, email: true, displayName: true, role: true,
          isActive: true, providerId: true, tokenExpiresAt: true, updatedAt: true,
        },
      });

      return res.json({ user: updated });
    } catch (e) {
      console.error('update user error:', e);
      return res.status(500).json({ error: 'Failed to update user' });
    }
  });

  /** DELETE /api/auth/users/:userId — deactivate a user (soft delete) */
  r.delete('/users/:userId', authenticate, authorizeRole('office_manager'), async (req, res) => {
    try {
      const auth = req.auth!;
      const actorAuth = isUserSession(auth) ? (auth as UserAuthPayload) : null;
      const practiceId = actorAuth
        ? actorAuth.practiceId
        : (practiceIdFromRequestHints(req) ?? '');

      const target = await prisma.user.findFirst({
        where: { id: req.params.userId, practiceId },
      });
      if (!target) return res.status(404).json({ error: 'User not found' });

      if (actorAuth && !isPlatformDev(auth) && !canManageRole(actorAuth, target.role)) {
        return res.status(403).json({ error: 'Insufficient permissions to deactivate this user' });
      }

      // Prevent self-deactivation
      if (actorAuth && target.id === actorAuth.userId) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
      }

      await prisma.user.update({ where: { id: target.id }, data: { isActive: false } });
      return res.json({ ok: true });
    } catch (e) {
      console.error('deactivate user error:', e);
      return res.status(500).json({ error: 'Failed to deactivate user' });
    }
  });

  /** POST /api/auth/users/:userId/change-password — user changes their own password */
  r.post('/users/:userId/change-password', authenticate, async (req, res) => {
    try {
      const auth = req.auth!;
      if (!isUserSession(auth)) {
        return res.status(403).json({ error: 'Not available for platform dev sessions' });
      }
      const actor = auth as UserAuthPayload;

      // Users can only change their own password (managers can reset via PATCH)
      if (actor.userId !== req.params.userId) {
        return res.status(403).json({ error: 'You can only change your own password' });
      }

      const parsed = changePasswordBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: formatZodError(parsed.error) });
      }
      const { currentPassword, newPassword } = parsed.data;

      const user = await prisma.user.findUnique({ where: { id: actor.userId } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await prisma.user.update({ where: { id: actor.userId }, data: { passwordHash } });

      return res.json({ ok: true });
    } catch (e) {
      console.error('change password error:', e);
      return res.status(500).json({ error: 'Failed to change password' });
    }
  });

  // ── Practice Owner promotion ──────────────────────────────────────────────────
  // Only platform_dev (Khalid) can promote a user to practice_owner.

  /** POST /api/auth/users/:userId/promote-owner */
  r.post('/users/:userId/promote-owner', authenticate, authorizeRole('platform_dev'), async (req, res) => {
    try {
      const practiceId = practiceIdFromRequestHints(req);
      if (!practiceId) {
        return res.status(400).json({ error: 'practiceId is required' });
      }
      const target = await prisma.user.findFirst({
        where: { id: req.params.userId, practiceId },
      });
      if (!target) return res.status(404).json({ error: 'User not found' });

      const updated = await prisma.user.update({
        where: { id: target.id },
        data: { role: 'practice_owner' },
        select: { id: true, displayName: true, role: true },
      });
      return res.json({ user: updated });
    } catch (e) {
      console.error('promote owner error:', e);
      return res.status(500).json({ error: 'Failed to promote user' });
    }
  });

  // ── Password reset ────────────────────────────────────────────────────────────

  /**
   * POST /api/auth/reset-password/request
   * Body: { email }
   * Issues a reset token. In production, the token would be emailed; for now it is
   * returned in the response so the admin can relay it to the user.
   * Always returns 200 to avoid email enumeration.
   */
  r.post('/reset-password/request', authLimiter, async (req: Request, res: Response) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (!email) return res.status(400).json({ error: 'email is required' });

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) {
        // Return 200 regardless to prevent email enumeration
        return res.json({ ok: true, message: 'If that email exists, a reset token has been issued.' });
      }

      // Invalidate any existing unused tokens for this user
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const { randomBytes } = await import('node:crypto');
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });

      // Send email (fire-and-forget; errors are logged but never expose to caller)
      void sendPasswordResetEmail(user.email, user.displayName, token).catch((e: unknown) => {
        console.error('[password-reset] email send failed', e);
      });

      console.log(`[password-reset] token issued for ${email}`);

      return res.json({ ok: true, message: 'If that email exists, a reset token has been issued.' });
    } catch (e) {
      console.error('reset-password request error:', e);
      return res.status(500).json({ error: 'Failed to process request' });
    }
  });

  /**
   * GET /api/auth/reset-password/token/:userId
   * Platform-dev only — retrieves the current active reset token for a user.
   * Used by admin to relay the token to the user until email delivery is wired up.
   */
  r.get('/reset-password/token/:userId', authenticate, authorizeRole('platform_dev'), async (req, res) => {
    try {
      const record = await prisma.passwordResetToken.findFirst({
        where: { userId: req.params.userId, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (!record) return res.status(404).json({ error: 'No active reset token found' });
      return res.json({ token: record.token, expiresAt: record.expiresAt });
    } catch (e) {
      console.error('get reset token error:', e);
      return res.status(500).json({ error: 'Failed' });
    }
  });

  /**
   * POST /api/auth/reset-password/confirm
   * Body: { token, newPassword }
   * Consumes the token and sets the new password.
   */
  r.post('/reset-password/confirm', authLimiter, async (req: Request, res: Response) => {
    try {
      const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
      const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
      if (!token || !newPassword) {
        return res.status(400).json({ error: 'token and newPassword are required' });
      }
      if (newPassword.length < 8) {
        return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
      }

      const record = await prisma.passwordResetToken.findUnique({ where: { token } });
      if (!record || record.usedAt || record.expiresAt < new Date()) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await prisma.$transaction([
        prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
        prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      ]);

      return res.json({ ok: true });
    } catch (e) {
      console.error('reset-password confirm error:', e);
      return res.status(500).json({ error: 'Failed to reset password' });
    }
  });

  // ── Self-service registration ─────────────────────────────────────────────

  /** POST /api/auth/register — create a new practice + owner account (public) */
  r.post('/register', authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = registerBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });
      const { practiceName, displayName, email, password } = parsed.data;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const { practice, user } = await prisma.$transaction(async (tx) => {
        const practice = await tx.practice.create({
          data: {
            name: practiceName,
            passwordHash,
            timezone: 'America/Toronto',
          },
        });
        const user = await tx.user.create({
          data: {
            practiceId: practice.id,
            email,
            passwordHash,
            displayName,
            role: 'practice_owner',
          },
          select: { id: true, email: true, displayName: true, role: true },
        });
        return { practice, user };
      });

      const sessionAuth = {
        userId: user.id,
        practiceId: practice.id,
        role: 'practice_owner' as const,
        email: user.email,
        displayName: user.displayName,
      };
      setUserAuthCookie(res, sessionAuth);
      return res.status(201).json({
        user,
        practiceId: practice.id,
        role: 'practice_owner',
        userRole: 'owner',
      });
    } catch (e) {
      console.error('register error:', e);
      return res.status(500).json({ error: 'Registration failed' });
    }
  });

  // ── Staff invites ─────────────────────────────────────────────────────────

  /** POST /api/auth/invite — send an invite email to a staff member (practice_owner/office_manager) */
  r.post('/invite', authenticate, authorizeRole('office_manager'), async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const actorAuth = isUserSession(auth) ? (auth as UserAuthPayload) : null;
      const practiceId = actorAuth?.practiceId ?? practiceIdFromRequestHints(req) ?? '';

      const parsed = inviteBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });
      const { email, role } = parsed.data;

      if (actorAuth && !isPlatformDev(auth) && !canManageRole(actorAuth, role)) {
        return res.status(403).json({ error: `Your role cannot invite someone with role '${role}'` });
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ error: 'A user with this email already exists' });

      const practice = await prisma.practice.findUnique({ where: { id: practiceId }, select: { name: true } });
      if (!practice) return res.status(404).json({ error: 'Practice not found' });

      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const invite = await prisma.inviteToken.create({
        data: { practiceId, email, role: role as import('@prisma/client').PracticeRole, expiresAt },
        select: { token: true },
      });

      await sendInviteEmail({ toEmail: email, practiceName: practice.name, role, token: invite.token });
      return res.json({ invited: true });
    } catch (e) {
      console.error('invite error:', e);
      return res.status(500).json({ error: 'Failed to send invite' });
    }
  });

  /** GET /api/auth/invite/:token — validate token and return role info (public) */
  r.get('/invite/:token', async (req: Request, res: Response) => {
    try {
      const invite = await prisma.inviteToken.findUnique({
        where: { token: req.params.token },
        include: { practice: { select: { name: true } } },
      });
      if (!invite) return res.status(404).json({ error: 'Invite not found or already used' });
      if (invite.usedAt) return res.status(410).json({ error: 'This invite has already been used' });
      if (invite.expiresAt < new Date()) return res.status(410).json({ error: 'This invite has expired' });
      return res.json({ email: invite.email, role: invite.role, practiceName: invite.practice.name });
    } catch (e) {
      console.error('invite lookup error:', e);
      return res.status(500).json({ error: 'Failed to look up invite' });
    }
  });

  /** POST /api/auth/accept-invite — create staff account from invite token (public) */
  r.post('/accept-invite', authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = acceptInviteBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });
      const { token, displayName, password } = parsed.data;

      const invite = await prisma.inviteToken.findUnique({ where: { token } });
      if (!invite) return res.status(404).json({ error: 'Invite not found' });
      if (invite.usedAt) return res.status(410).json({ error: 'This invite has already been used' });
      if (invite.expiresAt < new Date()) return res.status(410).json({ error: 'This invite has expired' });

      const existing = await prisma.user.findUnique({ where: { email: invite.email } });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

      const [user] = await prisma.$transaction([
        prisma.user.create({
          data: {
            practiceId: invite.practiceId,
            email: invite.email,
            passwordHash,
            displayName,
            role: invite.role,
          },
          select: { id: true, email: true, displayName: true, role: true },
        }),
        prisma.inviteToken.update({ where: { token }, data: { usedAt: new Date() } }),
      ]);

      const sessionAuth = {
        userId: user.id,
        practiceId: invite.practiceId,
        role: user.role as 'practice_owner',
        email: user.email,
        displayName: user.displayName,
      };
      setUserAuthCookie(res, sessionAuth);
      return res.status(201).json({ user, role: user.role });
    } catch (e) {
      console.error('accept-invite error:', e);
      return res.status(500).json({ error: 'Failed to create account' });
    }
  });

  return r;
}
