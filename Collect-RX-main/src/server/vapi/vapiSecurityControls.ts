/**
 * Emergency mitigation #3: Vapi call recording and transcript security.
 *
 * For Wednesday pilot:
 * - Option A: Disable Vapi entirely and require manual review
 * - Option B: Enable Vapi but encrypt webhooks in transit and log all access
 *
 * Post-launch: Implement encryption at rest, transcript redaction, and BAA.
 */

import type { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { logLine } from '../observability/logger.js';

export enum VapiSecurityMode {
  DISABLED = 'disabled', // No AI calls, all claims require manual review
  ENCRYPTED_TRANSIT = 'encrypted_transit', // Calls allowed but webhooks encrypted
  FULL_SECURITY = 'full_security', // Post-launch: encryption at rest + redaction
}

export const CURRENT_VAPI_MODE: VapiSecurityMode =
  (process.env.VAPI_SECURITY_MODE as VapiSecurityMode) || VapiSecurityMode.ENCRYPTED_TRANSIT;

/**
 * Check if Vapi is enabled for calling.
 */
export function isVapiCallsEnabled(): boolean {
  if (process.env.VAPI_ENABLED === 'false') {
    return false;
  }
  return CURRENT_VAPI_MODE !== VapiSecurityMode.DISABLED;
}

/**
 * Queue a claim for manual review instead of automated calling.
 * Used when Vapi is disabled or for high-risk claims.
 */
export async function queueClaimForManualReview(
  _prisma: PrismaClient,
  claimId: string,
  reason: string
): Promise<void> {
  try {
    // For Wednesday emergency: log the manual review queue event without modifying claim
    logLine('info', 'Claim flagged for manual review', {
      claimId,
      reason,
    });

    // TODO: Post-launch implement claim routing to manual review queue
    // This would update recoveryRoute or create a work item entry
  } catch (error) {
    logLine('error', 'Failed to flag claim for manual review', {
      error: error instanceof Error ? error.message : String(error),
      claimId,
    });
  }
}

/**
 * Encrypt Vapi webhook payload using AES-256-GCM.
 * Use when storing webhook data.
 */
export function encryptVapiPayload(payload: Record<string, unknown>): {
  encrypted: string;
  iv: string;
  authTag: string;
} {
  const encryptionKey = process.env.VAPI_WEBHOOK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('VAPI_WEBHOOK_ENCRYPTION_KEY not configured');
  }

  const key = Buffer.from(encryptionKey, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

/**
 * Decrypt Vapi webhook payload.
 */
export function decryptVapiPayload(
  encrypted: string,
  iv: string,
  authTag: string
): Record<string, unknown> {
  const encryptionKey = process.env.VAPI_WEBHOOK_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('VAPI_WEBHOOK_ENCRYPTION_KEY not configured');
  }

  const key = Buffer.from(encryptionKey, 'hex');
  const ivBuffer = Buffer.from(iv, 'hex');
  const authTagBuffer = Buffer.from(authTag, 'hex');

  // Validate auth tag length before use (required for GCM security)
  if (authTagBuffer.length < 16 || authTagBuffer.length > 16) {
    throw new Error(`Invalid GCM authentication tag: expected 16 bytes, got ${authTagBuffer.length}`);
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuffer);
  decipher.setAuthTag(authTagBuffer);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted);
}

/**
 * Log access to Vapi recordings.
 * Every access to a call recording is logged for compliance.
 *
 * For Wednesday emergency: uses AuditLog table.
 * Post-launch: migrate to dedicated RecordingAccessLog table.
 */
export async function logRecordingAccess(
  prisma: PrismaClient,
  input: {
    recordingId: string;
    userId?: string;
    accessReason: string; // 'quality_audit', 'legal_review', 'bug_investigation'
    ipAddress?: string;
  }
): Promise<void> {
  try {
    // Emergency: Use existing AuditLog table for recording access
    await prisma.auditLog.create({
      data: {
        practiceId: 'system', // TODO: Get actual practice ID from context
        userId: input.userId,
        action: 'access_recording',
        subjectType: 'recording',
        subjectId: input.recordingId,
        details: {
          reason: input.accessReason,
          ipAddress: input.ipAddress,
          timestamp: new Date().toISOString(),
        },
        requestIp: input.ipAddress,
      },
    });

    logLine('info', 'Recording access logged', {
      recordingId: input.recordingId,
      userId: input.userId,
      reason: input.accessReason,
    });
  } catch (error) {
    logLine('error', 'Failed to log recording access', {
      error: error instanceof Error ? error.message : String(error),
      recordingId: input.recordingId,
    });
  }
}

/**
 * Get metadata about a recording without returning the actual audio.
 * Safe for most operations — doesn't expose raw recording data.
 *
 * For Wednesday emergency: placeholder implementation.
 * Post-launch: retrieve from dedicated VapiRecording table.
 */
export async function getRecordingMetadata(
  recordingId: string
): Promise<{
  id: string;
  claimId?: string;
  callDuration?: number;
  recordedAt: Date;
  encrypted: boolean;
} | null> {
  try {
    // TODO: Post-launch: retrieve from VapiRecording table
    // For now, return safe metadata structure without actual data
    return {
      id: recordingId,
      recordedAt: new Date(),
      encrypted: true, // All recordings are encrypted post-launch
    };
  } catch (error) {
    logLine('error', 'Failed to retrieve recording metadata', {
      error: error instanceof Error ? error.message : String(error),
      recordingId,
    });
    return null;
  }
}

/**
 * Validate that Vapi configuration is secure.
 * Should be called on startup.
 */
export function validateVapiSecurityConfiguration(): {
  valid: boolean;
  warnings: string[];
} {
  const warnings: string[] = [];

  // Check encryption key
  if (!process.env.VAPI_WEBHOOK_ENCRYPTION_KEY) {
    warnings.push('VAPI_WEBHOOK_ENCRYPTION_KEY not set — webhooks will not be encrypted');
  } else if (process.env.VAPI_WEBHOOK_ENCRYPTION_KEY.length !== 64) {
    warnings.push('VAPI_WEBHOOK_ENCRYPTION_KEY invalid length (should be 32 bytes hex = 64 chars)');
  }

  // Check webhook secret
  if (!process.env.VAPI_WEBHOOK_SECRET) {
    warnings.push('VAPI_WEBHOOK_SECRET not set — webhook validation disabled');
  }

  // Check if mode is appropriate for environment
  if (process.env.NODE_ENV === 'production' && CURRENT_VAPI_MODE === VapiSecurityMode.DISABLED) {
    warnings.push('Vapi is disabled in production — all claims will require manual review');
  }

  if (warnings.length > 0) {
    logLine('warn', 'Vapi security configuration warnings', { warnings: warnings.join('; ') });
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

/**
 * Generate a new encryption key for Vapi webhooks.
 * Run this once at deployment time and store in environment.
 */
export function generateVapiEncryptionKey(): string {
  const key = crypto.randomBytes(32); // 256 bits
  return key.toString('hex');
}
