import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import {
  setAuthCookie,
  setPlatformDevAuthCookie,
  clearAuthCookie,
} from '../authToken';
import { authenticate } from '../middleware/authenticate';
import { authLimiter } from '../middleware/rateLimiter';
import { getSubscriptionGateState } from '../stripe/billing';
import {
  formatZodError,
  loginBodySchema,
  platformDevLoginBodySchema,
} from '../validation/zodSchemas.js';
import { practiceIdFromRequestHints } from '../accessControl/practiceContext.js';
import { isPlatformDev } from '../accessControl/types.js';

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

export function createAuthRouter(prisma: PrismaClient): Router {
  const r = Router();

  r.post('/login', authLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = loginBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: formatZodError(parsed.error) });
      }
      const { practiceId, password } = parsed.data;
      const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
      if (!practice) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const ok = await bcrypt.compare(password, practice.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      setAuthCookie(res, practice.id);
      const subscription = await getSubscriptionGateState(prisma, practice.id);
      res.json({
        role: 'practice' as const,
        phiAccess: true,
        practice: { id: practice.id, name: practice.name, timezone: practice.timezone },
        subscription,
      });
    } catch (e) {
      console.error('Login error:', e);
      res.status(500).json({ error: 'Login failed' });
    }
  });

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
      res.json({
        role: 'platform_dev' as const,
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
      });
    } catch (e) {
      console.error('Platform dev login error:', e);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  r.post('/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

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
          phiAccess: false,
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

      const id = auth.practiceId;
      const practice = await prisma.practice.findUnique({
        where: { id },
        select: { id: true, name: true, timezone: true },
      });
      if (!practice) {
        return res.status(401).json({ error: 'Session invalid' });
      }
      const subscription = await getSubscriptionGateState(prisma, id);
      res.json({
        role: 'practice',
        phiAccess: true,
        practice,
        subscription,
      });
    } catch (e) {
      console.error('me error:', e);
      res.status(500).json({ error: 'Failed' });
    }
  });

  return r;
}
