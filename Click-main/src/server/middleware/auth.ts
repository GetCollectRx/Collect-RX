import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: string;
  practiceId: string;
  email: string;
  role: 'admin' | 'manager' | 'staff' | 'readonly';
  iat?: number;
  exp?: number;
}

// Extend Express Request to carry the decoded JWT
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET || 'changeme-in-production-use-env';
export const JWT_EXPIRES_IN = '8h';

// ── Token utilities ────────────────────────────────────────────────────────────

export function signToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

// ── Middleware: require a valid JWT ───────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.slice(7);
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Middleware: restrict to one or more roles ─────────────────────────────────

export function requireRole(...roles: JwtPayload['role'][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Requires role: ${roles.join(' | ')}. Your role: ${req.user.role}`,
      });
    }
    next();
  };
}

// ── Middleware: enforce practiceId scoping ────────────────────────────────────
// Ensures a request can only access data belonging to the authenticated practice.

export function requirePracticeScope(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const practiceIdParam =
    (req.params.practiceId as string) ||
    (req.query.practiceId as string) ||
    (req.body?.practiceId as string);

  // Admins can access any practice; everyone else is scoped
  if (req.user.role !== 'admin' && practiceIdParam && practiceIdParam !== req.user.practiceId) {
    return res.status(403).json({ error: 'Access denied: cross-practice request not allowed' });
  }

  next();
}
