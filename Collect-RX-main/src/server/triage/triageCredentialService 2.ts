import type { PrismaClient } from '@prisma/client';
import {
  decryptPhiAtRest,
  encryptPhiAtRest,
  type EncryptedPhiField,
} from '../crypto/phiAtRest.js';
import { getRlsContext } from '../db/rlsContext.js';

type TriageCredentialStore = Pick<PrismaClient, 'triageCredential' | 'triageAudit'>;

export interface TriageCredentialAuditContext {
  actor?: string;
  correlationId?: string;
}

export interface SaveTriageCredentialInput extends TriageCredentialAuditContext {
  practiceId: string;
  credential: string;
}

export interface ReadTriageCredentialInput extends TriageCredentialAuditContext {
  practiceId: string;
}

export interface TriageCredentialStatus {
  enrolled: boolean;
  lastHealthCheckAt: string | null;
  lastHealthCheckStatus: 'healthy' | 'unhealthy' | null;
  lastHealthCheckErrorCode: string | null;
}

function requirePracticeRlsContext(practiceId: string): void {
  const context = getRlsContext();
  if (context?.bypass || context?.practiceId !== practiceId) {
    throw new Error('[triageCredential] practice-scoped RLS context is required');
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`[triageCredential] ${field} is required`);
  }
}

async function appendCredentialAudit(
  prisma: TriageCredentialStore,
  practiceId: string,
  credentialId: string,
  action: 'credential_saved' | 'credential_read',
  context: TriageCredentialAuditContext,
): Promise<void> {
  await prisma.triageAudit.create({
    data: {
      practiceId,
      credentialId,
      action,
      actor: context.actor,
      correlationId: context.correlationId,
    },
  });
}

/**
 * Encrypt and persist a practice's triage credential. Callers must establish
 * the matching RLS context before invoking this service.
 */
export async function saveTriageCredential(
  prisma: TriageCredentialStore,
  input: SaveTriageCredentialInput,
): Promise<{ id: string }> {
  requireNonEmpty(input.practiceId, 'practiceId');
  requireNonEmpty(input.credential, 'credential');
  requirePracticeRlsContext(input.practiceId);

  const encrypted = encryptPhiAtRest(input.credential, {
    recordId: input.practiceId,
    fieldKey: 'triageCredential',
    practiceId: input.practiceId,
    actor: input.actor,
    correlationId: input.correlationId,
  });

  const record = await prisma.triageCredential.upsert({
    where: { practiceId: input.practiceId },
    create: {
      practiceId: input.practiceId,
      ciphertext: encrypted.encryptedText,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    },
    update: {
      ciphertext: encrypted.encryptedText,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    },
    select: { id: true },
  });

  await appendCredentialAudit(prisma, input.practiceId, record.id, 'credential_saved', input);
  return record;
}

/**
 * Return decrypted credential material only to the owning practice context.
 * The credential is intentionally not returned through an HTTP API in this phase.
 */
export async function readTriageCredential(
  prisma: TriageCredentialStore,
  input: ReadTriageCredentialInput,
): Promise<string | null> {
  requireNonEmpty(input.practiceId, 'practiceId');
  requirePracticeRlsContext(input.practiceId);

  const record = await prisma.triageCredential.findUnique({
    where: { practiceId: input.practiceId },
    select: {
      id: true,
      ciphertext: true,
      iv: true,
      authTag: true,
    },
  });
  if (!record) return null;

  const encrypted: EncryptedPhiField = {
    encryptedText: record.ciphertext,
    iv: record.iv,
    authTag: record.authTag,
  };
  const credential = decryptPhiAtRest(encrypted, {
    recordId: record.id,
    fieldKey: 'triageCredential',
    practiceId: input.practiceId,
    actor: input.actor,
    correlationId: input.correlationId,
  });

  await appendCredentialAudit(prisma, input.practiceId, record.id, 'credential_read', input);
  return credential;
}

/** Metadata-only state for settings and triage channel enablement. */
export async function getTriageCredentialStatus(
  prisma: TriageCredentialStore,
  input: ReadTriageCredentialInput,
): Promise<TriageCredentialStatus> {
  requireNonEmpty(input.practiceId, 'practiceId');
  requirePracticeRlsContext(input.practiceId);

  const record = await prisma.triageCredential.findUnique({
    where: { practiceId: input.practiceId },
    select: {
      lastHealthCheckAt: true,
      lastHealthCheckStatus: true,
      lastHealthCheckErrorCode: true,
    },
  });
  if (!record) {
    return {
      enrolled: false,
      lastHealthCheckAt: null,
      lastHealthCheckStatus: null,
      lastHealthCheckErrorCode: null,
    };
  }

  return {
    enrolled: true,
    lastHealthCheckAt: record.lastHealthCheckAt?.toISOString() ?? null,
    lastHealthCheckStatus:
      record.lastHealthCheckStatus === 'healthy' || record.lastHealthCheckStatus === 'unhealthy'
        ? record.lastHealthCheckStatus
        : null,
    lastHealthCheckErrorCode: record.lastHealthCheckErrorCode ?? null,
  };
}

/**
 * Local AES-GCM integrity check. This deliberately makes no carrier or CDAnet
 * request; production claim-status transport will be a separately approved adapter.
 */
export async function checkTriageCredentialHealth(
  prisma: TriageCredentialStore,
  input: ReadTriageCredentialInput,
): Promise<TriageCredentialStatus> {
  requireNonEmpty(input.practiceId, 'practiceId');
  requirePracticeRlsContext(input.practiceId);

  const record = await prisma.triageCredential.findUnique({
    where: { practiceId: input.practiceId },
    select: { id: true, ciphertext: true, iv: true, authTag: true },
  });
  if (!record) return getTriageCredentialStatus(prisma, input);

  let status: 'healthy' | 'unhealthy' = 'healthy';
  let errorCode: string | null = null;
  try {
    decryptPhiAtRest(
      { encryptedText: record.ciphertext, iv: record.iv, authTag: record.authTag },
      {
        recordId: record.id,
        fieldKey: 'triageCredential',
        practiceId: input.practiceId,
        actor: input.actor,
        correlationId: input.correlationId,
      },
    );
  } catch {
    status = 'unhealthy';
    errorCode = 'DECRYPT_FAILED';
  }

  const updated = await prisma.triageCredential.update({
    where: { id: record.id },
    data: {
      lastHealthCheckAt: new Date(),
      lastHealthCheckStatus: status,
      lastHealthCheckErrorCode: errorCode,
    },
    select: {
      lastHealthCheckAt: true,
      lastHealthCheckStatus: true,
      lastHealthCheckErrorCode: true,
    },
  });

  return {
    enrolled: true,
    lastHealthCheckAt: updated.lastHealthCheckAt?.toISOString() ?? null,
    lastHealthCheckStatus: updated.lastHealthCheckStatus === 'unhealthy' ? 'unhealthy' : 'healthy',
    lastHealthCheckErrorCode: updated.lastHealthCheckErrorCode ?? null,
  };
}
