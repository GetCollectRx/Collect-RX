// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Prisma Client Singleton
//
// Single shared PrismaClient instance for the Express server.
// In development, prevents connection pool exhaustion from hot-reloads.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';

declare global {
  // Allow global `var` declaration for singleton pattern in dev
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

export default prisma;
