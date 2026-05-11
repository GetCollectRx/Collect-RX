import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { db } from '../db';
import { authenticate } from '../middleware/authenticate';
import { AUTH_COOKIE, authCookieOptions } from '../cookies';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  try {
    const { practiceId, password } = req.body as { practiceId?: string; password?: string };
    if (!practiceId || !password) {
      return res.status(400).json({ error: 'practiceId and password are required' });
    }
    const practice = db.practices.get(practiceId);
    if (!practice || !practice.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!bcrypt.compareSync(password, practice.passwordHash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { practiceId: practice.id, role: 'practice_admin', userId: 'user_001' },
      config.jwtSecret,
      { expiresIn: '8h' }
    );
    res.cookie(AUTH_COOKIE, token, authCookieOptions());
    res.json({ token, practiceId: practice.id, practiceName: practice.name });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

authRouter.post('/admin-login', (req, res) => {
  try {
    const { secret } = req.body as { secret?: string };
    const allowInsecure =
      process.env.ALLOW_INSECURE_ADMIN_DEV === 'true' &&
      (config.nodeEnv === 'development' || config.nodeEnv === 'test');
    if (!allowInsecure) {
      if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
        return res.status(401).json({ error: 'Invalid admin credentials' });
      }
    }
    const token = jwt.sign(
      { practiceId: 'platform', role: 'platform_admin', userId: 'admin_001' },
      config.jwtSecret,
      { expiresIn: '2h' }
    );
    res.cookie(AUTH_COOKIE, token, authCookieOptions());
    res.json({ token, role: 'platform_admin' });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.get('/me', authenticate, (req, res) => {
  if (req.role === 'platform_admin') {
    return res.json({ role: 'platform_admin' });
  }
  const p = db.practices.get(req.practiceId!);
  if (!p) {
    return res.status(401).json({ error: 'Not found' });
  }
  const { passwordHash: _h, ...safe } = p;
  res.json({ practice: safe });
});
