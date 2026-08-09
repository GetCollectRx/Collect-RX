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
  type PracticeRole,
} from '../accessControl/types.js';
import type { UserRole } from '../../types/userRole.js';
import {
  setUserAuthCookie,
  setPlatformDevAuthCookie,
  setBriefAuthCookie,
  clearAuthCookie,
  signUserToken,
  signBriefSessionToken,
} from '../authToken';
import { authenticate } from '../middleware/authenticate';
import { authorizeRole } from '../middleware/authorizeRole';
import { authLimiter } from '../middleware/rateLimiter';
import { getSubscriptionGateState } from '../stripe/billing';
import { trialEndDate } from '../../billing/tiers.js';
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
  convertToOrganizationBodySchema,
} from '../validation/zodSchemas.js';
import { practiceIdFromRequestHints } from '../accessControl/practiceContext.js';
import { callerAdminOrganizationId } from '../accessControl/organizationContext.js';
import { createOrgPractice } from '../organizations/practiceProvisioning.js';
import { sendPasswordResetEmail } from '../email/passwordReset.js';
import { sendInviteEmail } from '../email/inviteEmail.js';
import { runSessionHealthCheck } from '../observability/sessionHealthCheck.js';

const BCRYPT_ROUNDS = 12;

type PracticeListRow = { id: string; name: string; timezone: string };

/**
 * Practices an auditor may see, per their `AuditorGrant` rows — a global
 * grant (`practiceId: null`) sees every practice, a scoped grant sees only
 * the practices it names. Mirrors `assertAuditorPracticeGrant` in
 * `middleware/grantChecks.ts`, which already enforces this same grant table
 * on per-practice data routes; this just extends it to the practices-list
 * surfaced by `/me` and login so an auditor with a real grant isn't shown an
 * empty list despite being authorized to read the data behind it.
 */
async function auditorPractices(prisma: PrismaClient, auditorUserId: string): Promise<PracticeListRow[]> {
  const grants = await prisma.auditorGrant.findMany({ where: { auditorUserId } });
  if (grants.length === 0) return [];
  if (grants.some((g) => g.practiceId === null)) {
    return prisma.practice.findMany({
      select: { id: true, name: true, timezone: true },
      orderBy: { name: 'asc' },
    });
  }
  const practiceIds = grants.map((g) => g.practiceId).filter((id): id is string => id !== null);
  if (practiceIds.length === 0) return [];
  return prisma.practice.findMany({
    where: { id: { in: practiceIds } },
    select: { id: true, name: true, timezone: true },
    orderBy: { name: 'asc' },
  });
}

async function buildSessionHealth(prisma: PrismaClient) {
  const health = await runSessionHealthCheck(prisma);
  if (!health.ok) {
    console.warn('[sessionHealth] Login health check failed:', health.checks.filter((c) => !c.ok && !c.skipped));
  }
  return health;
}

/**
 * A real customer group_admin's org practices, for the practice switcher —
 * PracticeContext.tsx already falls back to `data.practices` for any session
 * shape, so populating this array here is the only change the switcher needs.
 */
async function groupAdminOrgPractices(
  prisma: PrismaClient,
  userId: string,
): Promise<Array<{ id: string; name: string; timezone: string }>> {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId },
    select: { organizationId: true },
  });
  if (memberships.length === 0) return [];
  return prisma.practice.findMany({
    where: { organizationMemberships: { some: { organizationId: { in: memberships.map((m) => m.organizationId) } } } },
    select: { id: true, name: true, timezone: true },
    orderBy: { name: 'asc' },
  });
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

  function wantsDesktopSession(req: Request): boolean {
    return req.get('X-CRX-Desktop') === '1';
  }

  async function respondPracticeLogin(
    req: Request,
    res: Response,
    user: {
      id: string;
      practiceId: string;
      role: string;
      providerId: string | null;
      displayName: string;
      email: string;
    },
  ) {
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
    const practices = user.role === 'group_admin' ? await groupAdminOrgPractices(prisma, user.id) : undefined;

    return res.json({
      role: user.role,
      userRole: practiceRoleToBrief(user.role as PracticeRole | 'platform_dev'),
      deskRole: user.role === 'front_desk' ? 'front_desk' : 'owner',
      phiAccess: ['practice_owner', 'office_manager', 'billing_coordinator', 'associate_dentist', 'front_desk'].includes(user.role),
      practice,
      ...(practices ? { practices } : {}),
      subscription,
      user: { id: user.id, displayName: user.displayName, email: user.email, role: user.role },
      health,
      ...(wantsDesktopSession(req)
        ? {
            sessionToken: signUserToken({
              userId: user.id,
              practiceId: user.practiceId,
              role: user.role as UserAuthPayload['role'],
              ...(user.providerId ? { providerId: user.providerId } : {}),
            }),
          }
        : {}),
    });
  }

  async function respondPlatformUserLogin(
    req: Request,
    res: Response,
    user: {
      id: string;
      userRole: string;
      practiceId: string | null;
      passwordHash: string;
    },
  ) {
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
      : userRole === 'auditor'
        ? await auditorPractices(prisma, user.id)
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
        enforce: false, active: true, status: null, plan: null, usage: null, currentPeriodEnd: null, priceConfigured: false, skipped: true,
      },
      health: await buildSessionHealth(prisma),
      ...(wantsDesktopSession(req)
        ? {
            sessionToken: signBriefSessionToken({
              userRole,
              userId: user.id,
              practiceId: user.practiceId,
              phiAccess: userRole === 'auditor',
            }),
          }
        : {}),
    });
  }

  // ── Login ────────────────────────────────────────────────────────────────────

  /** POST /api/auth/dev/demo — one-click local demo sign-in (non-production only) */
  r.post('/dev/demo', async (req: Request, res: Response) => {
    try {
      if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not found' });
      }
      const email = (process.env.SEED_PRACTICE_EMAIL || 'demo@collectrx-test.local').trim().toLowerCase();
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.isActive) {
        return res.status(503).json({
          error: 'Demo practice is not set up. Run: npm run demo:seed',
        });
      }
      return respondPracticeLogin(req, res, user);
    } catch (e) {
      console.error('Dev demo login error:', e);
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  /** POST /api/auth/login — email + password (practice staff or platform roles) */
  r.post('/login', authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: formatZodError(parsed.error) });
      }
      const { email, password } = parsed.data;

      const practiceUser = await prisma.user.findUnique({ where: { email } });
      if (practiceUser?.isActive) {
        if (practiceUser.role === 'accountant' && practiceUser.tokenExpiresAt && practiceUser.tokenExpiresAt < new Date()) {
          return res.status(401).json({ error: 'Account access has expired. Contact your Office Manager to renew.' });
        }
        // Phase 4 FR-5: domain-based SSO enforcement, checked live at login
        // time (not stored per-user) — a config change takes effect immediately.
        const { findEnforcingSsoOrgForEmail } = await import('../sso/organizationSsoService.js');
        const ssoOrg = await findEnforcingSsoOrgForEmail(prisma, email);
        if (ssoOrg) {
          return res.status(403).json({
            error: 'Your organization requires single sign-on. Use your SSO login link instead of a password.',
            ssoLoginUrl: `/api/auth/sso/${ssoOrg.orgSlug}/login`,
          });
        }
        const ok = await bcrypt.compare(password, practiceUser.passwordHash);
        if (!ok) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        return respondPracticeLogin(req, res, practiceUser);
      }

      const platformUser = await prisma.platformUser.findUnique({ where: { email } });
      if (platformUser?.active) {
        const ok = await bcrypt.compare(password, platformUser.passwordHash);
        if (!ok) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        return respondPlatformUserLogin(req, res, platformUser);
      }

      return res.status(401).json({ error: 'Invalid credentials' });
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
          plan: null,
          usage: null,
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

  /** POST /api/auth/login/platform-user — legacy alias; main /login accepts platform emails too */
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
      return respondPlatformUserLogin(req, res, user);
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
            plan: null,
            usage: null,
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
          : userRole === 'auditor'
            ? await auditorPractices(prisma, platformUser.id)
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
        // Must match respondPlatformUserLogin's mapping below — this collapsed
        // platform_admin into 'group_admin' (billing_ops_manager's bucket)
        // instead of 'platform_dev', so authRoleToBriefPersona() on the client
        // silently demoted a platform_admin to billing_ops_manager on every
        // full page load (any deep link, refresh, or bookmark), locking them
        // out of every actual admin screen they'd just logged into — the
        // backend session/API auth is unaffected (it reads userRole from the
        // cookie, not this field), but the frontend nav breaks completely.
        // See OUTSTANDING-FIXES-PRODUCT-READY.md P10-09.
        const legacyRole =
          userRole === 'auditor'
            ? ('accountant' as const)
            : userRole === 'billing_ops_manager'
              ? ('group_admin' as const)
              : userRole === 'platform_admin'
                ? ('platform_dev' as const)
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
            plan: null,
            usage: null,
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
      const practices = dbUser.role === 'group_admin' ? await groupAdminOrgPractices(prisma, dbUser.id) : undefined;
      return res.json({
        role: user.role,
        userRole: getUserRole(auth) ?? practiceRoleToBrief(user.role),
        deskRole: user.role === 'front_desk' ? 'front_desk' : 'owner',
        phiAccess: auth.phiAccess,
        practice,
        ...(practices ? { practices } : {}),
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

  /**
   * POST /api/auth/register — create a new practice + owner account (public).
   * When `additionalPractices` is present, self-serve DSO signup: creates an
   * Organization plus every practice in one transaction, with the signing-up
   * user as group_admin/org_admin — the self-serve counterpart to the
   * platform_dev-only POST /api/admin/organizations tool.
   */
  r.post('/register', authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = registerBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });
      const { practiceName, displayName, email, password, organizationName, additionalPractices } = parsed.data;

      if (additionalPractices && additionalPractices.length > 0 && !organizationName) {
        return res.status(400).json({ error: 'organizationName is required when adding additional locations' });
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const isOrgSignup = Boolean(additionalPractices && additionalPractices.length > 0);

      const { practice, user, organizationId } = await prisma.$transaction(async (tx) => {
        const allPractices = [{ practiceName, timezone: undefined as string | undefined }, ...(additionalPractices ?? [])];

        // organizationName is guaranteed set here — the 400 check above already
        // rejected a non-empty additionalPractices with no organizationName.
        const organization = isOrgSignup
          ? await tx.organization.create({ data: { name: organizationName! } })
          : null;

        const createdPractices = [];
        for (const p of allPractices) {
          const created = organization
            ? await createOrgPractice(tx, organization.id, { practiceName: p.practiceName, timezone: p.timezone, passwordHash })
            : await tx.practice.create({
                data: {
                  name: p.practiceName,
                  passwordHash,
                  timezone: p.timezone ?? 'America/Toronto',
                  billingTier: 'trial',
                  trialEndsAt: trialEndDate(),
                },
              });
          createdPractices.push(created);
        }

        const practice = createdPractices[0];
        const user = await tx.user.create({
          data: {
            practiceId: practice.id,
            email,
            passwordHash,
            displayName,
            role: isOrgSignup ? 'group_admin' : 'practice_owner',
          },
          select: { id: true, email: true, displayName: true, role: true },
        });

        if (organization) {
          await tx.organizationMember.create({
            data: { organizationId: organization.id, userId: user.id, role: 'org_admin' },
          });
        }

        return { practice, user, organizationId: organization?.id };
      });

      const sessionAuth = {
        userId: user.id,
        practiceId: practice.id,
        role: user.role as 'practice_owner' | 'group_admin',
        email: user.email,
        displayName: user.displayName,
      };
      setUserAuthCookie(res, sessionAuth);
      return res.status(201).json({
        user,
        practiceId: practice.id,
        organizationId,
        role: user.role,
        userRole: isOrgSignup ? 'billing_ops_manager' : 'owner',
      });
    } catch (e) {
      console.error('register error:', e);
      return res.status(500).json({ error: 'Registration failed' });
    }
  });

  /**
   * POST /api/auth/convert-to-organization — self-serve upgrade for a
   * standalone practice_owner who wants to become a DSO owner, without
   * re-registering. Links their existing practice into a new Organization
   * and upgrades their PracticeRole to group_admin.
   */
  r.post('/convert-to-organization', authenticate, authorizeRole('practice_owner'), async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const actorAuth = isUserSession(auth) ? (auth as UserAuthPayload) : null;
      if (!actorAuth) return res.status(403).json({ error: 'Practice owner session required' });

      const existingMembership = await prisma.organizationMember.findFirst({ where: { userId: actorAuth.userId } });
      if (existingMembership) return res.status(400).json({ error: 'You are already part of an organization' });

      const parsed = convertToOrganizationBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });

      const organizationId = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({ data: { name: parsed.data.organizationName } });
        await tx.organizationPractice.create({
          data: { organizationId: organization.id, practiceId: actorAuth.practiceId },
        });
        await tx.organizationMember.create({
          data: { organizationId: organization.id, userId: actorAuth.userId, role: 'org_admin' },
        });
        await tx.user.update({ where: { id: actorAuth.userId }, data: { role: 'group_admin' } });
        return organization.id;
      });

      setUserAuthCookie(res, { userId: actorAuth.userId, practiceId: actorAuth.practiceId, role: 'group_admin' });

      return res.status(201).json({ organizationId, role: 'group_admin' });
    } catch (e) {
      console.error('convert-to-organization error:', e);
      return res.status(500).json({ error: 'Failed to create organization' });
    }
  });

  // ── Staff invites ─────────────────────────────────────────────────────────

  /** POST /api/auth/invite — send an invite email to a staff member (practice_owner/office_manager) */
  r.post('/invite', authenticate, authorizeRole('office_manager'), async (req: Request, res: Response) => {
    try {
      const auth = req.auth!;
      const actorAuth = isUserSession(auth) ? (auth as UserAuthPayload) : null;
      let practiceId = actorAuth?.practiceId ?? practiceIdFromRequestHints(req) ?? '';

      const parsed = inviteBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: formatZodError(parsed.error) });
      const { email, role, providerId, orgRole: requestedOrgRole } = parsed.data;

      if (role === 'associate_dentist' && !providerId) {
        return res.status(400).json({ error: 'providerId is required for associate_dentist role' });
      }
      if (requestedOrgRole === 'org_billing_viewer' && role !== 'accountant') {
        return res.status(400).json({ error: 'orgRole "org_billing_viewer" requires role "accountant"' });
      }

      // A co-admin invite (role === 'group_admin') is a same-level invite that
      // canManageRole's actorLevel > targetLevel rule would otherwise block —
      // it's allowed only for an existing org_admin inviting into their own
      // organization, checked separately from the normal role-hierarchy rule.
      // A billing-viewer invite (role === 'accountant' + orgRole === 'org_billing_viewer')
      // is the same shape — org_admin-only, org-scoped — for the DSO controller/CFO
      // persona (Phase 4 FR-9, specs/phase-4-enterprise-it-compliance.md).
      let organizationId: string | undefined;
      let orgRole: 'org_admin' | 'org_billing_viewer' | undefined;
      if (actorAuth && !isPlatformDev(auth)) {
        if (role === 'group_admin') {
          organizationId = (await callerAdminOrganizationId(prisma, actorAuth.userId)) ?? undefined;
          if (!organizationId) {
            return res.status(403).json({ error: 'Only an organization admin can invite a co-admin' });
          }
          orgRole = 'org_admin';
        } else if (requestedOrgRole === 'org_billing_viewer') {
          organizationId = (await callerAdminOrganizationId(prisma, actorAuth.userId)) ?? undefined;
          if (!organizationId) {
            return res.status(403).json({ error: 'Only an organization admin can invite a billing viewer' });
          }
          orgRole = 'org_billing_viewer';
        } else if (!canManageRole(actorAuth, role)) {
          return res.status(403).json({ error: `Your role cannot invite someone with role '${role}'` });
        }

        // A group_admin may target a specific sibling practice instead of their
        // own home practice — validated against their org membership, not just
        // trusted from the request body (authorized narrow RLS iteration).
        if (actorAuth.role === 'group_admin' && parsed.data.practiceId && parsed.data.practiceId !== actorAuth.practiceId) {
          const callerOrgId = await callerAdminOrganizationId(prisma, actorAuth.userId);
          const belongs = callerOrgId
            ? await prisma.organizationPractice.findFirst({ where: { organizationId: callerOrgId, practiceId: parsed.data.practiceId } })
            : null;
          if (!belongs) {
            return res.status(403).json({ error: 'That practice is not in your organization' });
          }
          practiceId = parsed.data.practiceId;
        }
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return res.status(409).json({ error: 'A user with this email already exists' });

      const practice = await prisma.practice.findUnique({ where: { id: practiceId }, select: { name: true } });
      if (!practice) return res.status(404).json({ error: 'Practice not found' });

      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const invite = await prisma.inviteToken.create({
        data: {
          practiceId,
          email,
          role: role as import('@prisma/client').PracticeRole,
          expiresAt,
          organizationId,
          orgRole,
          providerId: providerId ?? null,
        },
        select: { token: true },
      });

      // The invite token is already durably created at this point — an email
      // delivery failure (bad credentials, SendGrid outage) must not report
      // total failure, since the invite is still valid and usable via its link.
      try {
        await sendInviteEmail({ toEmail: email, practiceName: practice.name, role, token: invite.token });
        return res.json({ invited: true, emailSent: true });
      } catch (emailErr) {
        console.error('invite email send failed (token still created):', emailErr);
        return res.json({ invited: true, emailSent: false, token: invite.token });
      }
    } catch (e) {
      console.error('invite error:', e);
      return res.status(500).json({ error: 'Failed to create invite' });
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

      const user = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            practiceId: invite.practiceId,
            email: invite.email,
            passwordHash,
            displayName,
            role: invite.role,
            providerId: invite.providerId,
          },
          select: { id: true, email: true, displayName: true, role: true },
        });
        await tx.inviteToken.update({ where: { token }, data: { usedAt: new Date() } });
        if (invite.organizationId) {
          await tx.organizationMember.create({
            // Falls back to org_admin for invites predating the orgRole column.
            data: { organizationId: invite.organizationId, userId: user.id, role: invite.orgRole ?? 'org_admin' },
          });
        }
        return user;
      });

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
