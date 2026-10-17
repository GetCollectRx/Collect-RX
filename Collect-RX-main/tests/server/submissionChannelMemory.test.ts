import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  recordSubmissionChannelObservation,
  getKnownSubmissionChannel,
} from '../../src/server/learning/submissionChannelMemory.js';
import {
  recordSubmissionChannelFromFacts,
  type ValidatorExtractedFacts,
} from '../../src/server/vapi/claimsValidatorWebhook.js';

function channelPrisma(overrides: { findUnique?: unknown; upsert?: unknown } = {}) {
  const upsertMock = vi.fn().mockResolvedValue({});
  const findUniqueMock = vi.fn().mockResolvedValue(null);
  const prisma = {
    carrierSubmissionChannel: {
      findUnique: overrides.findUnique ?? findUniqueMock,
      upsert: overrides.upsert ?? upsertMock,
    },
  };
  return { prisma: prisma as unknown as PrismaClient, upsertMock, findUniqueMock };
}

describe('recordSubmissionChannelObservation', () => {
  it('no-ops when submissionMethod is empty/whitespace', async () => {
    const { prisma, upsertMock, findUniqueMock } = channelPrisma();
    await recordSubmissionChannelObservation(prisma, {
      carrierId: 'sun_life' as never,
      channelType: 'CLAIM_RESUBMISSION' as never,
      submissionMethod: '   ',
      submissionDestination: 'fax 555-0100',
    });
    expect(upsertMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('no-ops when submissionDestination is empty/whitespace', async () => {
    const { prisma, upsertMock } = channelPrisma();
    await recordSubmissionChannelObservation(prisma, {
      carrierId: 'sun_life' as never,
      channelType: 'CLAIM_RESUBMISSION' as never,
      submissionMethod: 'fax',
      submissionDestination: '  ',
    });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('upserts with create data matching the observation when no existing row', async () => {
    const { prisma, upsertMock } = channelPrisma({
      findUnique: vi.fn().mockResolvedValue(null),
    });
    await recordSubmissionChannelObservation(prisma, {
      carrierId: 'manulife' as never,
      channelType: 'DOCUMENTATION' as never,
      submissionMethod: ' fax ',
      submissionDestination: ' 555-0199 ',
      sourceCallAttemptId: 'attempt-1',
    });
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0][0];
    expect(call.create).toMatchObject({
      carrierId: 'manulife',
      channelType: 'DOCUMENTATION',
      submissionMethod: 'fax',
      submissionDestination: '555-0199',
      timesConfirmed: 1,
      sourceCallAttemptId: 'attempt-1',
    });
  });

  it('increments timesConfirmed when existing row matches method+destination exactly', async () => {
    const { prisma, upsertMock } = channelPrisma({
      findUnique: vi.fn().mockResolvedValue({
        submissionMethod: 'fax',
        submissionDestination: '555-0100',
      }),
    });
    await recordSubmissionChannelObservation(prisma, {
      carrierId: 'green_shield' as never,
      channelType: 'CLAIM_RESUBMISSION' as never,
      submissionMethod: 'fax',
      submissionDestination: '555-0100',
    });
    const call = upsertMock.mock.calls[0][0];
    expect(call.update.timesConfirmed).toEqual({ increment: 1 });
  });

  it('resets timesConfirmed to 1 when existing row has a different method or destination', async () => {
    const { prisma, upsertMock } = channelPrisma({
      findUnique: vi.fn().mockResolvedValue({
        submissionMethod: 'mail',
        submissionDestination: 'PO Box 100',
      }),
    });
    await recordSubmissionChannelObservation(prisma, {
      carrierId: 'green_shield' as never,
      channelType: 'CLAIM_RESUBMISSION' as never,
      submissionMethod: 'fax',
      submissionDestination: '555-0100',
    });
    const call = upsertMock.mock.calls[0][0];
    expect(call.update.timesConfirmed).toBe(1);
  });

  it('resets timesConfirmed to 1 when destination changes but method matches', async () => {
    const { prisma, upsertMock } = channelPrisma({
      findUnique: vi.fn().mockResolvedValue({
        submissionMethod: 'fax',
        submissionDestination: '555-0100',
      }),
    });
    await recordSubmissionChannelObservation(prisma, {
      carrierId: 'green_shield' as never,
      channelType: 'CLAIM_RESUBMISSION' as never,
      submissionMethod: 'fax',
      submissionDestination: '555-0199',
    });
    const call = upsertMock.mock.calls[0][0];
    expect(call.update.timesConfirmed).toBe(1);
  });
});

describe('getKnownSubmissionChannel', () => {
  it("returns '' when findUnique resolves null", async () => {
    const { prisma } = channelPrisma({ findUnique: vi.fn().mockResolvedValue(null) });
    const result = await getKnownSubmissionChannel(prisma, 'sun_life' as never, 'CLAIM_RESUBMISSION' as never);
    expect(result).toBe('');
  });

  it('returns "<method> to <destination>" when a row exists', async () => {
    const { prisma } = channelPrisma({
      findUnique: vi.fn().mockResolvedValue({
        submissionMethod: 'fax',
        submissionDestination: '555-0100',
      }),
    });
    const result = await getKnownSubmissionChannel(prisma, 'sun_life' as never, 'CLAIM_RESUBMISSION' as never);
    expect(result).toBe('fax to 555-0100');
  });
});

// recordSubmissionChannelFromFacts calls the real recordSubmissionChannelObservation
// (no module mocking) — a fake prisma client with findUnique/upsert spies lets us
// assert on the outcome->channelType mapping via what actually reaches the upsert.
describe('recordSubmissionChannelFromFacts', () => {
  it('maps CLAIM_NOT_RECEIVED with both fields present to CLAIM_RESUBMISSION and writes it', async () => {
    const { prisma, upsertMock } = channelPrisma();
    const facts: ValidatorExtractedFacts = {
      claimNumber: 'C-1',
      outcome: 'CLAIM_NOT_RECEIVED',
      submissionMethod: 'fax',
      submissionDestination: '555-0100',
    };
    await recordSubmissionChannelFromFacts(prisma, 'sun_life' as never, 'attempt-1', facts);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0][0];
    expect(call.create).toMatchObject({
      carrierId: 'sun_life',
      channelType: 'CLAIM_RESUBMISSION',
      submissionMethod: 'fax',
      submissionDestination: '555-0100',
      sourceCallAttemptId: 'attempt-1',
    });
  });

  it('maps NEED_INFORMATION with both fields present to DOCUMENTATION and writes it', async () => {
    const { prisma, upsertMock } = channelPrisma();
    const facts: ValidatorExtractedFacts = {
      claimNumber: 'C-2',
      outcome: 'NEED_INFORMATION',
      submissionMethod: 'mail',
      submissionDestination: 'PO Box 100',
    };
    await recordSubmissionChannelFromFacts(prisma, 'manulife' as never, 'attempt-2', facts);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const call = upsertMock.mock.calls[0][0];
    expect(call.create).toMatchObject({
      carrierId: 'manulife',
      channelType: 'DOCUMENTATION',
      submissionMethod: 'mail',
      submissionDestination: 'PO Box 100',
      sourceCallAttemptId: 'attempt-2',
    });
  });

  it('does not write for CLAIM_PAID (or any other unmapped outcome)', async () => {
    const { prisma, upsertMock, findUniqueMock } = channelPrisma();
    const facts: ValidatorExtractedFacts = {
      claimNumber: 'C-3',
      outcome: 'CLAIM_PAID',
      submissionMethod: 'fax',
      submissionDestination: '555-0100',
    };
    await recordSubmissionChannelFromFacts(prisma, 'sun_life' as never, 'attempt-3', facts);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('does not write when CLAIM_NOT_RECEIVED but submissionMethod is missing', async () => {
    const { prisma, upsertMock, findUniqueMock } = channelPrisma();
    const facts: ValidatorExtractedFacts = {
      claimNumber: 'C-4',
      outcome: 'CLAIM_NOT_RECEIVED',
      submissionDestination: '555-0100',
    };
    await recordSubmissionChannelFromFacts(prisma, 'sun_life' as never, 'attempt-4', facts);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
  });
});
