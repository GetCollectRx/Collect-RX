import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { runWithPracticeRls } from '../src/server/db/rlsContext.js';
import { TRIAGE_CHANNELS } from '../src/server/triage/claimStatusProbe.js';
import { enrolledCdanetClaimStatusAdapter } from '../src/server/triage/cdanetClaimStatusAdapter.js';

describe('triage channel registry', () => {
  it('orders PMS before the enrolled CDAnet contract adapter', () => {
    expect(TRIAGE_CHANNELS.map((channel) => channel.id)).toEqual(['pms-sync', 'cdanet']);
  });

  it('returns no CDAnet signal without a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const prisma = {
      triageCredential: {
        findUnique: async () => null,
      },
    } as unknown as PrismaClient;

    try {
      const result = await runWithPracticeRls('practice-a', () =>
        enrolledCdanetClaimStatusAdapter.probe(prisma, { practiceId: 'practice-a', claimId: 'claim-a' }),
      );
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
