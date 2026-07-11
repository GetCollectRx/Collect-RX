// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Prisma Client Singleton (+ optional RLS extension)
//
// Single shared PrismaClient instance for the Express server.
// In development, prevents connection pool exhaustion from hot-reloads.
//
// When RLS policies are deployed, the extended client wraps tenant-scoped
// queries in a transaction that sets app.practice_id / app.rls_bypass.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';
import { extendPrismaWithRls } from './prismaRls.js';

declare global {
  var __prisma: PrismaClient | undefined;
  var __prismaBase: PrismaClient | undefined;
}

const rlsEnabled = process.env.COLLECTRX_RLS_ENABLED !== '0';

const basePrisma: PrismaClient =
  global.__prismaBase ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  global.__prismaBase = basePrisma;
}

export const prisma: PrismaClient = rlsEnabled
  ? ((global.__prisma as PrismaClient | undefined) ??
    (extendPrismaWithRls(basePrisma) as unknown as PrismaClient))
  : basePrisma;

if (process.env.NODE_ENV !== 'production' && rlsEnabled) {
  global.__prisma = prisma;
}

/** Raw client without RLS extension — migrations, one-off admin scripts. */
export const prismaBase = basePrisma;

export default prisma;
