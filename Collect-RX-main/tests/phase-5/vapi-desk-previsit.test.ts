import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { VapiWebhookPayload } from '../../src/vapi/client.js';

vi.mock('../../src/server/vapi/vapiWebhook.js', () => ({
  processRecoveryCallEnded: vi.fn().mockResolvedValue(undefined),
  scrubTranscriptPhi: vi.fn((t: string) => t),
}));

vi.mock('../../src/server/preVisit/preVisitWebhook.js', () => ({
  processPreVisitCallEnded: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/server/observability/metrics.js', () => ({
  recordVapiWebhook: vi.fn(),
}));

import { processVapiDeskWebhook } from '../../src/server/frontDesk/vapiDeskEvents.js';
import { processPreVisitCallEnded } from '../../src/server/preVisit/preVisitWebhook.js';
import { processRecoveryCallEnded } from '../../src/server/vapi/vapiWebhook.js';

function endedPayload(metadata: Record<string, unknown>): VapiWebhookPayload {
  return {
    type: 'call.ended',
    call: {
      id: 'vapi-call-1',
      status: 'ended',
      endedAt: '2026-06-26T12:00:00.000Z',
    },
    metadata: metadata as VapiWebhookPayload['metadata'],
  };
}

describe('processVapiDeskWebhook — call.ended routing', () => {
  const prisma = {
    callAttempt: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  } as unknown as PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes pre-visit calls to processPreVisitCallEnded when appointmentVerificationId is set', async () => {
    await processVapiDeskWebhook(
      prisma,
      endedPayload({
        appointmentVerificationId: 'verification-1',
        practiceId: 'practice-1',
        patientToken: '00000000-0000-4000-8000-00000000a001',
        carrierId: 'sun_life',
      }),
    );

    expect(processPreVisitCallEnded).toHaveBeenCalledTimes(1);
    expect(processRecoveryCallEnded).not.toHaveBeenCalled();
  });

  it('does not route pre-visit calls through recovery when claimId is absent', async () => {
    await processVapiDeskWebhook(
      prisma,
      endedPayload({
        appointmentVerificationId: 'verification-2',
        practiceId: 'practice-1',
      }),
    );

    expect(processRecoveryCallEnded).not.toHaveBeenCalled();
  });
});
