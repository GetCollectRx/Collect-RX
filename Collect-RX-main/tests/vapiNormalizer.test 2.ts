import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { normalizeVapiWebhook } from '../src/webhooks/vapiNormalizer.js';
import { coerceExtractedFacts } from '../src/server/vapi/claimsValidatorWebhook.js';
import { escalateOverdueRecoveryActions } from '../src/server/recovery/overdueActionEscalation.js';

vi.mock('../src/server/services/escalationService.js', () => ({
  createEscalation: vi.fn().mockResolvedValue({ id: 'esc-1' }),
}));
vi.mock('../src/server/services/practiceNotificationService.js', () => ({
  sendPracticeNotification: vi.fn().mockResolvedValue(undefined),
}));

import { createEscalation } from '../src/server/services/escalationService.js';
import { sendPracticeNotification } from '../src/server/services/practiceNotificationService.js';

const METADATA = {
  claimId: 'claim-1',
  carrierId: 'sun_life',
  patientToken: 'token-1',
  practiceId: 'practice-1',
};

function nativeEndOfCallReport(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      type: 'end-of-call-report',
      startedAt: '2026-07-11T14:00:00.000Z',
      endedAt: '2026-07-11T14:04:30.000Z',
      artifact: {
        transcript: 'AI: Hello. Rep: Claim is processing.',
        recordingUrl: 'https://storage.vapi.ai/rec-1.wav',
      },
      analysis: {
        summary: 'Claim is processing.',
        structuredData: { claimNumber: 'CLM-001', outcome: 'PROCESSING' },
      },
      call: {
        id: 'vapi-call-1',
        assistantOverrides: { metadata: METADATA },
      },
      ...overrides,
    },
  };
}

describe('normalizeVapiWebhook', () => {
  it('maps a native end-of-call-report to the internal call.ended shape', () => {
    const normalized = normalizeVapiWebhook(nativeEndOfCallReport());
    expect(normalized).not.toBeNull();
    expect(normalized?.type).toBe('call.ended');
    expect(normalized?.call.id).toBe('vapi-call-1');
    expect(normalized?.call.durationSeconds).toBe(270);
    expect(normalized?.transcript).toContain('Claim is processing');
    expect(normalized?.analysis?.structuredData).toEqual({
      claimNumber: 'CLM-001',
      outcome: 'PROCESSING',
    });
  });

  it('recovers tenant metadata from assistantOverrides so tampering validation still runs', () => {
    const normalized = normalizeVapiWebhook(nativeEndOfCallReport());
    expect(normalized?.metadata).toEqual(METADATA);
  });

  it('ignores metadata without a practiceId rather than fabricating tenant context', () => {
    const body = nativeEndOfCallReport({
      call: { id: 'vapi-call-1', assistantOverrides: { metadata: { foo: 'bar' } } },
    });
    const normalized = normalizeVapiWebhook(body);
    expect(normalized?.metadata).toBeUndefined();
  });

  it('maps status-update messages', () => {
    const normalized = normalizeVapiWebhook({
      message: {
        type: 'status-update',
        status: 'in-progress',
        call: { id: 'vapi-call-2', assistantOverrides: { metadata: METADATA } },
      },
    });
    expect(normalized?.type).toBe('status-update');
    expect(normalized?.call.status).toBe('in-progress');
    expect(normalized?.metadata?.practiceId).toBe('practice-1');
  });

  it('returns null for message types the backend does not consume', () => {
    expect(
      normalizeVapiWebhook({
        message: { type: 'speech-update', call: { id: 'vapi-call-3' } },
      }),
    ).toBeNull();
  });

  it('passes legacy flat payloads through unchanged', () => {
    const legacy = {
      type: 'call.ended',
      call: { id: 'vapi-call-4', status: 'ended' },
      metadata: METADATA,
    };
    expect(normalizeVapiWebhook(legacy)).toEqual(legacy);
  });

  it('returns null for garbage bodies', () => {
    expect(normalizeVapiWebhook(null)).toBeNull();
    expect(normalizeVapiWebhook('str')).toBeNull();
    expect(normalizeVapiWebhook({ message: { type: 'end-of-call-report' } })).toBeNull();
  });
});

describe('coerceExtractedFacts', () => {
  it('keeps string and boolean facts, drops other types, always yields claimNumber', () => {
    const facts = coerceExtractedFacts({
      claimNumber: 'CLM-001',
      outcome: 'CLAIM_PAID',
      escalationRequired: false,
      paymentAmount: 1250,
      repName: '',
    });
    expect(facts.claimNumber).toBe('CLM-001');
    expect(facts.outcome).toBe('CLAIM_PAID');
    expect(facts.escalationRequired).toBe(false);
    expect(facts.paymentAmount).toBeUndefined();
    expect(facts.repName).toBeUndefined();
  });

  it('defaults claimNumber to empty string when missing or non-string', () => {
    expect(coerceExtractedFacts({}).claimNumber).toBe('');
    expect(coerceExtractedFacts({ claimNumber: 42 }).claimNumber).toBe('');
  });
});

describe('escalateOverdueRecoveryActions', () => {
  function makePrisma(actions: Array<Record<string, unknown>>) {
    const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
    const prisma = {
      claimRecoveryAction: {
        findMany: vi.fn().mockResolvedValue(actions),
        update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
          updates.push(args);
          return {};
        }),
      },
    };
    return { prisma: prisma as unknown as PrismaClient, updates };
  }

  const overdueAction = {
    id: 'action-1',
    title: 'Send 2 periapical x-rays to Sun Life',
    deadline: new Date('2026-07-01'),
    claim: {
      id: 'claim-1',
      practiceId: 'practice-1',
      claimNumber: 'CLM-001',
      carrierId: 'sun_life',
      billedAmount: 450.5,
    },
  };

  it('escalates overdue actions with the owning practice and stamps escalatedAt', async () => {
    const { prisma, updates } = makePrisma([overdueAction]);
    const escalated = await escalateOverdueRecoveryActions(prisma);

    expect(escalated).toBe(1);
    expect(createEscalation).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        practiceId: 'practice-1',
        claimId: 'claim-1',
        amountClaimedCents: 45050,
      }),
    );
    expect(sendPracticeNotification).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ practiceId: 'practice-1', type: 'ACTION_OVERDUE' }),
    );
    expect(updates[0]?.data).toHaveProperty('escalatedAt');
  });

  it('only sweeps open, un-escalated, un-cleared actions', async () => {
    const { prisma } = makePrisma([]);
    await escalateOverdueRecoveryActions(prisma);
    const where = (
      prisma.claimRecoveryAction.findMany as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].where;
    expect(where.escalatedAt).toBeNull();
    expect(where.clearedAt).toBeNull();
    expect(where.status).toEqual({ in: ['OPEN', 'BLOCKING'] });
  });
});
