import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { setAuthCookie, clearAuthCookie, signPracticeToken } from '../authToken';
import { authenticate } from '../middleware/authenticate';
import { authLimiter } from '../middleware/rateLimiter';

export function createAuthRouter(prisma: PrismaClient): Router {
  const r = Router();

  // authLimiter: 5 attempts per 15 minutes per IP.
  // Prevents brute-force and credential-stuffing attacks against the login endpoint.
  r.post('/login', authLimiter, async (req: Request, res: Response) => {
    try {
      const { practiceId, password } = req.body as { practiceId?: string; password?: string };
      if (!practiceId || !password) {
        return res.status(400).json({ error: 'practiceId and password are required' });
      }
      const practice = await prisma.practice.findUnique({ where: { id: practiceId } });
      if (!practice) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const ok = await bcrypt.compare(password, practice.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      setAuthCookie(res, practice.id);
      res.json({
        token: signPracticeToken(practice.id),
        practice: { id: practice.id, name: practice.name, timezone: practice.timezone },
      });
    } catch (e) {
      console.error('Login error:', e);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  r.post('/logout', (_req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });

  r.get('/me', authenticate, async (req, res) => {
    try {
      const id = req.practiceAuth!.practiceId;
      const practice = await prisma.practice.findUnique({
        where: { id },
        select: { id: true, name: true, timezone: true },
      });
      if (!practice) {
        return res.status(401).json({ error: 'Session invalid' });
      }
      res.json({ practice });
    } catch (e) {
      console.error('me error:', e);
      res.status(500).json({ error: 'Failed' });
    }
  });

  return r;
}
