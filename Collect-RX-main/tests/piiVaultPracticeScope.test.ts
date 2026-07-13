import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { PIIVault, type PatientPHI } from '../src/pii-vault.js';

const PHI: PatientPHI = {
  patientName: 'Jane Doe',
  dateOfBirth: '1985-03-12',
  subscriberId: 'SUB-123',
  groupPolicyNumber: 'GRP-456',
};

describe('PIIVault practice binding', () => {
  let vault: PIIVault;

  beforeEach(() => {
    vault = new PIIVault();
  });

  it('tokenize requires practiceId', () => {
    expect(() => vault.tokenize(PHI, 'test', '')).toThrow(/practiceId/);
  });

  it('detokenize succeeds only for the owning practice', () => {
    const token = vault.tokenize(PHI, 'test', 'practice-a');
    const ok = vault.detokenize(token, 'test', { practiceId: 'practice-a' });
    expect(ok.success).toBe(true);
    expect(ok.phi?.patientName).toBe('Jane Doe');

    const cross = vault.detokenize(token, 'test', { practiceId: 'practice-b' });
    expect(cross.success).toBe(false);
    expect(cross.error).toBe('PRACTICE_MISMATCH');
  });

  it('detokenize requires practiceId', () => {
    const token = vault.tokenize(PHI, 'test', 'practice-a');
    const r = vault.detokenize(token, 'test', { practiceId: '  ' });
    expect(r.success).toBe(false);
    expect(r.error).toBe('PRACTICE_ID_REQUIRED');
  });

  it('fails rehydration without deleting ciphertext when a persisted entry cannot decrypt', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const store = {
      phiVaultEntry: {
        findMany: vi.fn().mockResolvedValue([{
          token: 'persisted-token',
          practiceId: 'practice-a',
          ciphertext: 'invalid',
          iv: 'invalid',
          authTag: 'invalid',
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        }]),
        deleteMany,
      },
    } as unknown as PrismaClient;
    vault.useStore(store);

    await expect(vault.rehydrate()).rejects.toThrow(
      /rehydrate failed for persisted token persisted-token/i,
    );
    expect(deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: expect.any(Date) } },
    });
    expect(deleteMany).not.toHaveBeenCalledWith({ where: { token: 'persisted-token' } });
  });
});
