import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { isUserSession, type UserAuthPayload } from '../accessControl/types.js';
import { logger } from '../observability/logger.js';

export function clientRequestMeta(req: Request | undefined) {
  if (!req) return { requestIp: null as string | null, userAgent: null as string | null };
  const xf = req.headers['x-forwarded-for'];
  const fromXf = typeof xf === 'string' ? xf.split(',')[0]!.trim() : '';
  return {
    requestIp: fromXf || req.ip || req.socket?.remoteAddress || null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
}

function userIdFromRequest(req: Request | undefined): string | undefined {
  const auth = req?.auth ?? req?.practiceAuth;
  return auth && isUserSession(auth) ? (auth as UserAuthPayload).userId : undefined;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export interface AuditIntegrityFields {
  id: string;
  createdAt: Date;
  practiceId: string;
  userId?: string | null;
  action: string;
  subjectType?: string | null;
  subjectId?: string | null;
  details?: unknown;
  requestIp?: string | null;
  userAgent?: string | null;
  previousHash?: string | null;
}

export function computeAuditIntegrityHash(fields: AuditIntegrityFields): string {
  const canonical = canonicalize({
    id: fields.id,
    createdAt: fields.createdAt.toISOString(),
    practiceId: fields.practiceId,
    userId: fields.userId ?? null,
    action: fields.action,
    subjectType: fields.subjectType ?? null,
    subjectId: fields.subjectId ?? null,
    details: fields.details ?? null,
    requestIp: fields.requestIp ?? null,
    userAgent: fields.userAgent ?? null,
    previousHash: fields.previousHash ?? null,
  });
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export interface AppendAuditInput {
  practiceId: string;
  action: string;
  subjectType?: string;
  subjectId?: string;
  details?: Record<string, unknown> | null;
  req?: Request;
  userId?: string;
  required?: boolean;
}

async function insertTenantChainedAudit(prisma: PrismaClient, input: AppendAuditInput): Promise<void> {
  const { requestIp, userAgent } = clientRequestMeta(input.req);
  const userId = input.userId ?? userIdFromRequest(input.req) ?? null;
  const id = randomUUID();
  const createdAt = new Date();
  const details = input.details ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.practiceId}, 0))`;
    const previous = await tx.auditLog.findFirst({
      where: { practiceId: input.practiceId, integrityHash: { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { integrityHash: true },
    });
    const previousHash = previous?.integrityHash ?? null;
    const integrityHash = computeAuditIntegrityHash({
      id, createdAt, practiceId: input.practiceId, userId, action: input.action,
      subjectType: input.subjectType, subjectId: input.subjectId, details,
      requestIp, userAgent, previousHash,
    });
    await tx.auditLog.create({
      data: {
        id, createdAt, practiceId: input.practiceId, userId: userId ?? undefined,
        action: input.action, subjectType: input.subjectType, subjectId: input.subjectId,
        details: (details ?? undefined) as Prisma.InputJsonValue | undefined,
        requestIp: requestIp ?? undefined, userAgent: userAgent ?? undefined,
        previousHash, integrityHash,
      },
    });
  });
}

export async function appendAuditLog(prisma: PrismaClient, input: AppendAuditInput): Promise<void> {
  try {
    await insertTenantChainedAudit(prisma, input);
  } catch (error) {
    logger.error('[audit] tenant-chain append failed', { action: input.action, error });
    if (input.required) throw error;
  }
}

export function appendRequiredAuditLog(
  prisma: PrismaClient,
  input: Omit<AppendAuditInput, 'required'>,
): Promise<void> {
  return appendAuditLog(prisma, { ...input, required: true });
}

export async function appendPhiAccessEvent(
  prisma: PrismaClient,
  input: {
    practiceId: string;
    operation: string;
    recordType: string;
    recordId: string;
    purpose?: string;
    correlationId?: string;
    actorId?: string;
    required?: boolean;
  },
): Promise<void> {
  const { required, ...data } = input;
  try {
    await prisma.phiAccessEvent.create({ data });
  } catch (error) {
    logger.error('[audit] PHI access event append failed', { operation: input.operation, error });
    if (required) throw error;
  }
}

export interface TenantAuditVerification {
  valid: boolean;
  checked: number;
  firstBrokenId?: string;
}

export async function verifyTenantAuditIntegrity(
  prisma: PrismaClient,
  practiceId: string,
): Promise<TenantAuditVerification> {
  const rows = await prisma.auditLog.findMany({
    where: { practiceId, integrityHash: { not: null } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  let priorRetainedHash: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (i > 0 && row.previousHash !== priorRetainedHash) {
      return { valid: false, checked: i, firstBrokenId: row.id };
    }
    const expected = computeAuditIntegrityHash({ ...row, details: row.details });
    if (row.integrityHash !== expected) {
      return { valid: false, checked: i + 1, firstBrokenId: row.id };
    }
    priorRetainedHash = row.integrityHash;
  }
  return { valid: true, checked: rows.length };
}
