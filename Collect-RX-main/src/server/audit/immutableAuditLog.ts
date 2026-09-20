import crypto from 'crypto';
import type { PrismaClient, AuditLog } from '@prisma/client';
import { logLine } from '../observability/logger.js';

/**
 * Emergency mitigation #1: Immutable audit log with SHA-256 chaining.
 * Each entry's hash includes the previous entry's hash (blockchain-like).
 * This prevents tampering with audit history.
 *
 * For Wednesday pilot: writes to database only.
 * Post-launch: implement append-only file storage with WORM (write-once read-many).
 */

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
  hash: string; // SHA-256 of this entry + previous hash
  previousHash?: string; // Hash of previous entry (for chain verification)
}

let lastHash = '';

/**
 * Log a PHI access event with immutable chaining.
 * This is called for all sensitive operations.
 */
export async function logImmutableAuditEntry(
  prisma: PrismaClient,
  entry: Omit<ImmutableAuditEntry, 'id' | 'hash' | 'previousHash' | 'timestamp'> & { practiceId: string }
): Promise<void> {
  try {
    const timestamp = new Date();
    const previousHash = lastHash;

    // Compute hash of this entry + previous hash (chain verification)
    const entryString = JSON.stringify({
      timestamp: timestamp.toISOString(),
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      result: entry.result,
      details: entry.details,
    });

    const chainInput = entryString + previousHash;
    const hash = crypto.createHash('sha256').update(chainInput).digest('hex');

    // Store in database (audit log table)
    await prisma.auditLog.create({
      data: {
        practiceId: entry.practiceId,
        userId: entry.userId,
        action: entry.action,
        subjectType: entry.resourceType,
        subjectId: entry.resourceId,
        details: {
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          hash: hash,
          previousHash: previousHash,
          result: entry.result,
        },
      },
    });

    // Update last hash for next entry
    lastHash = hash;

    logLine('info', 'PHI access logged', {
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      result: entry.result,
      hash,
    });
  } catch (error) {
    // CRITICAL: If audit log write fails, alert immediately
    logLine('error', '[CRITICAL] Failed to write immutable audit log', {
      error: error instanceof Error ? error.message : String(error),
      action: entry.action,
      resourceType: entry.resourceType,
    });

    // Send security alert (would integrate with monitoring system)
    try {
      await sendSecurityAlert(
        `Audit log write failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } catch (alertError) {
      logLine('error', '[CRITICAL] Failed to send security alert', {
        error: alertError instanceof Error ? alertError.message : String(alertError),
      });
    }
  }
}

/**
 * Load the last hash from the database on startup.
 * This ensures chain continuity across server restarts.
 */
export async function initializeLastHash(prisma: PrismaClient): Promise<void> {
  try {
    const lastEntry = await prisma.auditLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { details: true },
    });

    if (lastEntry && lastEntry.details && typeof lastEntry.details === 'object') {
      const details = lastEntry.details as Record<string, unknown>;
      if (typeof details.hash === 'string') {
        lastHash = details.hash;
        logLine('info', 'Audit log chain initialized', { hash: lastHash });
      }
    }
  } catch (error) {
    logLine('warn', 'Could not initialize audit log chain', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Verify the integrity of an audit log entry.
 * Call this periodically or when an entry is accessed.
 */
export async function verifyAuditEntryIntegrity(
  entry: AuditLog,
  previousHash: string
): Promise<boolean> {
  try {
    const details = entry.details as Record<string, unknown> | null;
    const entryString = JSON.stringify({
      timestamp: entry.createdAt.toISOString(),
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.subjectType,
      resourceId: entry.subjectId,
      ipAddress: entry.requestIp,
      userAgent: entry.userAgent,
      result: details?.result,
      details: details?.details,
    });

    const chainInput = entryString + previousHash;
    const expectedHash = crypto.createHash('sha256').update(chainInput).digest('hex');
    const actualHash = typeof details?.hash === 'string' ? details.hash : '';

    return expectedHash === actualHash;
  } catch (error) {
    logLine('error', 'Failed to verify audit entry', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Placeholder for security alert integration.
 * Post-launch: integrate with PagerDuty, Slack, or monitoring system.
 */
async function sendSecurityAlert(message: string): Promise<void> {
  logLine('warn', '[SECURITY ALERT]', { message });
  // TODO: Post-launch: Send to monitoring system
  // - PagerDuty critical alert
  // - Slack security channel
  // - Email security team
}
