/**
 * Prisma client accessor — re-exported as getPrisma() so agentRunsRouter
 * and other server modules can import without coupling to the lib path.
 */
import { prisma } from '../lib/prisma.js';
import type { PrismaClient } from '@prisma/client';

export function getPrisma(): PrismaClient {
  return prisma;
}
