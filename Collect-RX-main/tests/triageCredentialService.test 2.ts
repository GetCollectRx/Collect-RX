import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runWithPracticeRls } from '../src/server/db/rlsContext.js';
import {
  checkTriageCredentialHealth,
  getTriageCredentialStatus,
  readTriageCredential,
  saveTriageCredential,
} from '../src/server/triage/triageCredentialService.js';

interface StoredCredential {
  id: string;
  practiceId: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  lastHealthCheckAt?: Date | null;
  lastHealthCheckStatus?: string | null;
  lastHealthCheckErrorCode?: string | null;
}

interface StoredAudit {
  practiceId: string;
  credentialId: string;
  action: string;
  actor?: string;
  correlationId?: string;
}

function triagePrisma() {
  let credential: StoredCredential | null = null;
  const audits: StoredAudit[] = [];

  const prisma = {
    triageCredential: {
      upsert: async (args: {
        create: Omit<StoredCredential, 'id'>;
        update: Omit<StoredCredential, 'id' | 'practiceId'>;
      }) => {
        credential = {
          id: credential?.id ?? 'credential-1',
          practiceId: credential?.practiceId ?? args.create.practiceId,
          ciphertext: args.update.ciphertext,
          iv: args.update.iv,
          authTag: args.update.authTag,
        };
        return { id: credential.id };
      },
      findUnique: async () => credential,
      update: async (args: {
        data: Pick<StoredCredential, 'lastHealthCheckAt' | 'lastHealthCheckStatus' | 'lastHealthCheckErrorCode'>;
      }) => {
        if (!credential) throw new Error('missing credential');
        credential = { ...credential, ...args.data };
        return credential;
      },
    },
    triageAudit: {
      create: async (args: { data: StoredAudit }) => {
        audits.push(args.data);
        return args.data;
      },
    },
  } as unknown as Pick<PrismaClient, 'triageCredential' | 'triageAudit'>;

  return {
    prisma,
    getCredential: () => credential,
    audits,
  };
}

describe('triageCredentialService', () => {
  beforeEach(() => {
    process.env.PHI_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });

  afterEach(() => {
    delete process.env.PHI_ENCRYPTION_KEY;
  });

  it('persists only AES-GCM encrypted credential material and audits save/read', async () => {
    const store = triagePrisma();
    const practiceId = 'practice-a';
    const secret = 'portal-access-token';

    await runWithPracticeRls(practiceId, () =>
      saveTriageCredential(store.prisma, {
        practiceId,
        credential: secret,
        actor: 'user-1',
        correlationId: 'request-1',
      }),
    );

    const stored = store.getCredential();
    expect(stored).not.toBeNull();
    expect(stored?.ciphertext).not.toContain(secret);
    expect(stored?.iv).toHaveLength(24);
    expect(stored?.authTag).toHaveLength(32);

    const decrypted = await runWithPracticeRls(practiceId, () =>
      readTriageCredential(store.prisma, {
        practiceId,
        actor: 'triage-worker',
        correlationId: 'job-1',
      }),
    );

    expect(decrypted).toBe(secret);
    expect(store.audits).toEqual([
      {
        practiceId,
        credentialId: 'credential-1',
        action: 'credential_saved',
        actor: 'user-1',
        correlationId: 'request-1',
      },
      {
        practiceId,
        credentialId: 'credential-1',
        action: 'credential_read',
        actor: 'triage-worker',
        correlationId: 'job-1',
      },
    ]);
    expect(JSON.stringify(store.audits)).not.toContain(secret);
  });

  it('requires the credential owner practice RLS context', async () => {
    const store = triagePrisma();

    await expect(
      saveTriageCredential(store.prisma, {
        practiceId: 'practice-a',
        credential: 'portal-access-token',
      }),
    ).rejects.toThrow(/practice-scoped RLS context is required/);

    await expect(
      runWithPracticeRls('practice-b', () =>
        saveTriageCredential(store.prisma, {
          practiceId: 'practice-a',
          credential: 'portal-access-token',
        }),
      ),
    ).rejects.toThrow(/practice-scoped RLS context is required/);
  });

  it('exposes only metadata and performs local health checks', async () => {
    const store = triagePrisma();
    const practiceId = 'practice-a';
    await runWithPracticeRls(practiceId, () =>
      saveTriageCredential(store.prisma, { practiceId, credential: 'portal-access-token' }),
    );

    const status = await runWithPracticeRls(practiceId, () =>
      getTriageCredentialStatus(store.prisma, { practiceId }),
    );
    expect(status).toMatchObject({ enrolled: true, lastHealthCheckAt: null });
    expect(JSON.stringify(status)).not.toContain('portal-access-token');

    const checked = await runWithPracticeRls(practiceId, () =>
      checkTriageCredentialHealth(store.prisma, { practiceId, actor: 'test' }),
    );
    expect(checked.lastHealthCheckStatus).toBe('healthy');
    expect(checked.lastHealthCheckErrorCode).toBeNull();
  });
});
