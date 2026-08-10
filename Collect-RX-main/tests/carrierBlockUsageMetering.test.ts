/**
 * A call that ends in a carrier block still consumed a Vapi/Twilio line and
 * still costs money. The block path used to return before usage was recorded,
 * so those minutes never reached the usage period the cost breaker reads —
 * and a carrier block is exactly the scenario likely to produce a burst of
 * long, fruitless calls, so it is the worst case to leave unmetered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyCarrierBlockMock = vi.fn();
const recordCallUsageMock = vi.fn();
const resolveOutcomeMock = vi.fn();

vi.mock('../src/server/frontDesk/carrierBlockService.js', () => ({
  applyCarrierBlock: (...args: unknown[]) => applyCarrierBlockMock(...args),
}));
vi.mock('../src/server/plans/planBridge.js', () => ({
  recordCallUsage: (...args: unknown[]) => recordCallUsageMock(...args),
}));
vi.mock('../src/server/plans/planUsageAlertService.js', () => ({
  maybeSendPlanUsageAlertEmails: vi.fn(),
}));
vi.mock('../src/outcome/webhookOutcomeResolver.js', () => ({
  resolveOutcomeFromWebhookPayload: (...args: unknown[]) => resolveOutcomeMock(...args),
}));
vi.mock('../src/server/observability/metrics.js', () => ({ recordVapiWebhook: vi.fn() }));
vi.mock('../src/server/frontDesk/deskWs.js', () => ({ broadcastDesk: vi.fn() }));
vi.mock('../src/server/frontDesk/deskMappers.js', () => ({
  mapActiveCall: vi.fn(() => ({})),
  mapTranscriptLine: vi.fn(() => ({})),
}));
vi.mock('../src/server/frontDesk/deskQueueBroadcast.js', () => ({
  refreshDeskQueueBroadcast: vi.fn(),
}));
vi.mock('../src/server/vapi/vapiWebhook.js', () => ({
  processRecoveryCallEnded: vi.fn(),
  scrubTranscriptPhi: (t: string) => t,
}));
vi.mock('../src/server/preVisit/preVisitWebhook.js', () => ({
  processPreVisitCallEnded: vi.fn(),
}));
vi.mock('../src/server/audit/auditLog.js', () => ({ appendAuditLog: vi.fn() }));
vi.mock('../src/server/frontDesk/sentimentEscalationService.js', () => ({
  checkAndTriggerEscalation: vi.fn(),
}));
vi.mock('../src/server/frontDesk/carrierBlockPhrases.js', () => ({
  matchedCarrierBlockPhrase: vi.fn(() => null),
  transcriptSignalsCarrierBlock: vi.fn(() => false),
}));

import { processVapiDeskWebhook } from '../src/server/frontDesk/vapiDeskEvents.js';

function prismaStub() {
  return {
    callAttempt: {
      findUnique: vi.fn(async () => ({ id: 'attempt-1', completedAt: null, claimId: 'claim-1' })),
      update: vi.fn(async () => ({})),
    },
    insuranceClaim: {
      findUnique: vi.fn(async () => ({
        id: 'claim-1',
        practiceId: 'practice-1',
        carrierId: 'sun_life',
      })),
    },
  };
}

const blockedPayload = {
  type: 'call.ended' as const,
  call: { id: 'vapi-1', status: 'ended', durationSeconds: 420 },
  metadata: { claimId: 'claim-1', carrierId: 'sun_life', patientToken: 't', practiceId: 'practice-1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  recordCallUsageMock.mockResolvedValue({ recorded: true, minutesBilled: 7 });
  applyCarrierBlockMock.mockResolvedValue({ heldQueueCount: 0 });
  resolveOutcomeMock.mockReturnValue({
    outcome: 'BLOCK_DETECTED',
    outcomeDetail: 'Carrier detected automation',
    durationSeconds: 420,
    carrierBlockDetected: true,
    repName: null,
    referenceNumber: null,
    transcriptUrl: null,
  });
});

describe('carrier block usage metering', () => {
  it('records the minutes a blocked call consumed', async () => {
    const prisma = prismaStub();

    await processVapiDeskWebhook(prisma as never, blockedPayload as never);

    expect(applyCarrierBlockMock).toHaveBeenCalledTimes(1);
    expect(recordCallUsageMock).toHaveBeenCalledWith({
      practiceId: 'practice-1',
      vapiCallId: 'vapi-1',
    });
  });

  it('stores the call duration so the minutes are billable', async () => {
    const prisma = prismaStub();

    await processVapiDeskWebhook(prisma as never, blockedPayload as never);

    // recordCallUsage derives minutes from durationSeconds; leaving it null
    // makes the usage write a silent no-op.
    const update = prisma.callAttempt.update.mock.calls[0]?.[0] as {
      data: { durationSeconds?: number | null };
    };
    expect(update.data.durationSeconds).toBe(420);
  });

  it('does not fail the webhook when usage recording throws', async () => {
    const prisma = prismaStub();
    recordCallUsageMock.mockRejectedValue(new Error('usage backend down'));

    await expect(
      processVapiDeskWebhook(prisma as never, blockedPayload as never),
    ).resolves.not.toThrow();

    expect(applyCarrierBlockMock).toHaveBeenCalledTimes(1);
  });
});
