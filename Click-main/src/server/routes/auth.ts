import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPrisma = any;
import { PrismaClient } from '@prisma/client';
import { signToken, requireAuth } from '../middleware/auth.js';
import { logAudit } from '../middleware/auditLog.js';

const loginSchema = z.object({
  email   : z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const registerSchema = z.object({
  email     : z.string().email(),
  password  : z.string().min(8),
  practiceId: z.string().uuid(),
  role      : z.enum(['admin', 'manager', 'staff', 'readonly']).default('staff'),
});

export function createAuthRouter(prisma: PrismaClient): Router {
  // Cast to any until `prisma generate` is run after schema migration
  const db = prisma as AnyPrisma;
  const router = Router();

  // ── POST /api/auth/login ───────────────────────────────────────────────────
  router.post('/login', async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { email, password } = parsed.data;

    try {
      const user = await db.user.findUnique({ where: { email } });

      // Constant-time comparison even on miss (prevent user enumeration)
      const dummyHash = '$2a$12$dummyhashforenumerationprotection00000000000000000000000';
      const hash = user?.passwordHash ?? dummyHash;
      const valid = await bcrypt.compare(password, hash);

      if (!user || !user.isActive || !valid) {
        await logAudit(prisma, {
          userId    : user?.id,
          practiceId: user?.practiceId,
          action    : 'LOGIN_FAILED',
          resource  : 'User',
          resourceId: user?.id,
          ipAddress : req.ip,
          userAgent : req.headers['user-agent'],
          metadata  : JSON.stringify({ email }),
        });
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = signToken({
        userId    : user.id,
        practiceId: user.practiceId,
        email     : user.email,
        role      : user.role as 'admin' | 'manager' | 'staff' | 'readonly',
      });

      // Update last login timestamp
      await db.user.update({
        where: { id: user.id },
        data : { lastLoginAt: new Date() },
      });

      await logAudit(prisma, {
        userId    : user.id,
        practiceId: user.practiceId,
        action    : 'LOGIN_SUCCESS',
        resource  : 'User',
        resourceId: user.id,
        ipAddress : req.ip,
        userAgent : req.headers['user-agent'],
      });

      return res.json({
        token,
        user: {
          id        : user.id,
          email     : user.email,
          role      : user.role,
          practiceId: user.practiceId,
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /api/auth/logout ─────────────────────────────────────────────────
  // JWTs are stateless; logout is client-side token discard.
  // We log it server-side for HIPAA audit trail.
  router.post('/logout', requireAuth, async (req: Request, res: Response) => {
    await logAudit(prisma, {
      userId    : req.user!.userId,
      practiceId: req.user!.practiceId,
      action    : 'LOGOUT',
      resource  : 'User',
      resourceId: req.user!.userId,
      ipAddress : req.ip,
      userAgent : req.headers['user-agent'],
    });
    return res.json({ ok: true });
  });

  // ── POST /api/auth/register ───────────────────────────────────────────────
  // Admin-only: create a new user for a practice
  router.post('/register', requireAuth, async (req: Request, res: Response) => {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can register new users' });
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { email, password, practiceId, role } = parsed.data;

    try {
      const existing = await db.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const user = await db.user.create({
        data: { email, passwordHash, practiceId, role },
      });

      await logAudit(prisma, {
        userId    : req.user!.userId,
        practiceId: req.user!.practiceId,
        action    : 'CREATE_USER',
        resource  : 'User',
        resourceId: user.id,
        ipAddress : req.ip,
        userAgent : req.headers['user-agent'],
        metadata  : JSON.stringify({ email, role, practiceId }),
      });

      return res.status(201).json({
        id        : user.id,
        email     : user.email,
        role      : user.role,
        practiceId: user.practiceId,
      });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /api/auth/me ──────────────────────────────────────────────────────
  router.get('/me', requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await db.user.findUnique({
        where : { id: req.user!.userId },
        select: { id: true, email: true, role: true, practiceId: true, lastLoginAt: true },
      });
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(user);
    } catch (err) {
      console.error('Me error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /api/auth/change-password ───────────────────────────────────────
  router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword    : z.string().min(8, 'New password must be at least 8 characters'),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    try {
      const user = await db.user.findUnique({ where: { id: req.user!.userId } });
      if (!user) return res.status(404).json({ error: 'User not found' });

      const valid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
      await db.user.update({ where: { id: user.id }, data: { passwordHash } });

      await logAudit(prisma, {
        userId    : user.id,
        practiceId: user.practiceId,
        action    : 'CHANGE_PASSWORD',
        resource  : 'User',
        resourceId: user.id,
        ipAddress : req.ip,
        userAgent : req.headers['user-agent'],
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error('Change password error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
