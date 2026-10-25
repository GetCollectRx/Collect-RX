/**
 * Compatibility wrappers for the former process-local "immutable" audit API.
 * The real control is a per-tenant, database-serialized, tamper-evident chain
 * for the configured retention window. It is not WORM storage.
 */
import type { AuditLog, PrismaClient } from '@prisma/client';
import { appendRequiredAuditLog, computeAuditIntegrityHash } from './auditLog.js';

export interface ImmutableAuditEntry {
  id: string;
  timestamp: Date;
  practiceId: string;
  userId?: string;
  action: 'read' | 'write' | 'delete' | 'export' | 'access_recording';
  resourceType: 'patient' | 'claim' | 'recording' | 'practice_setting' | 'other';
  resourceId: string;
  ipAddress?: string;
  userAgent?: string;
  result: 'success' | 'failure';
  details?: string;
  hash: string;
  previousHash?: string;
}

/** @deprecated Use appendRequiredAuditLog. */
export async function logImmutableAuditEntry(
  prisma: PrismaClient,
  entry: Omit<ImmutableAuditEntry, 'id' | 'hash' | 'previousHash' | 'timestamp'>,
): Promise<void> {
  await appendRequiredAuditLog(prisma, {
    practiceId: entry.practiceId,
    userId: entry.userId,
    action: entry.action,
    subjectType: entry.resourceType,
    subjectId: entry.resourceId,
    details: {
      result: entry.result,
      purpose: entry.details,
      suppliedIp: entry.ipAddress,
      suppliedUserAgent: entry.userAgent,
    },
  });
}

/** No process-local initialization is needed; chain state lives in Postgres. */
export async function initializeLastHash(_prisma: PrismaClient): Promise<void> {}

export async function verifyAuditEntryIntegrity(
  entry: AuditLog,
  previousHash: string,
): Promise<boolean> {
  if (!entry.integrityHash || entry.previousHash !== (previousHash || null)) return false;
  return entry.integrityHash === computeAuditIntegrityHash({ ...entry, details: entry.details });
}
