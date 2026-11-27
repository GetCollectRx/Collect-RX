import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { VapiWebhookPayload } from '../src/vapi/client.js';

const deletePostCallAudio = vi.fn().mockResolvedValue(undefined);
const processRecoveryCallEnded = vi.fn().mockResolvedValue(undefined);
const applyCarrierBlock = vi.fn().mockResolvedValue({ heldQueueCount: 0 });
const recordCallUsage = vi.fn().mockResolvedValue({ recorded: false });
const appendAuditLog = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/server/vapi/vapiWebhook.js', () => ({
  deletePostCallAudio: (...args: unknown[]) => deletePostCallAudio(...args),
  processRecoveryCallEnded: (...args: unknown[]) => processRecoveryCallEnded(...args),
  scrubTranscriptPhi: (text: string) => text,
}));
vi.mock('../src/server/frontDesk/carrierBlockService.js', () => ({
  applyCarrierBlock: (...args: unknown[]) => applyCarrierBlock(...args),
}));
vi.mock('../src/server/plans/planBridge.js', () => ({
  recordCallUsage: (...args: unknown[]) => recordCallUsage(...args),
}));
vi.mock('../src/server/plans/planUsageAlertService.js', () => ({
  maybeSendPlanUsageAlertEmails: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/server/audit/auditLog.js', () => ({
  appendAuditLog: (...args: unknown[]) => appendAuditLog(...args),
}));
vi.mock('../src/server/frontDesk/deskWs.js', () => ({ broadcastDesk: vi.fn() }));
vi.mock('../src/server/frontDesk/deskQueueBroadcast.js', () => ({
  refreshDeskQueueBroadcast: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/server/frontDesk/sentimentEscalationService.js', () => ({
  checkAndTriggerEscalation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/server/preVisit/preVisitWebhook.js', () => ({
  processPreVisitCallEnded: vi.fn().mockResolvedValue(undefined),
}));

import { processVapiDeskWebhook } from '../src/server/frontDesk/vapiDeskEvents.js';

const VAPI_CALL_ID = 'vapi-call-blocked-1';
const ATTEMPT_ID = 'attempt-blocked-1';

type AttemptRow = {
  id: string;
  completedAt: Date | null;
  claimId: string;
  liveState: string;
};

function endOfCallPayload(): VapiWebhookPayload {
  return {
    type: 'call.ended',
    call: {
      id: VAPI_CALL_ID,
      status: 'ended',
      startedAt: '2026-11-21T14:00:00.000Z',
      endedAt: '2026-11-21T14:04:00.000Z',
    },
    recordingUrl: 'https://storage.example.invalid/rec.wav',
    metadata: {
      claimId: 'claim-1',
      carrierId: 'canada_life',
      patientToken: 'token-1',
      practiceId: 'practice-1',
    },
  } as unknown as VapiWebhookPayload;
}

function fakePrisma(opts: { attempt: AttemptRow; adadRecorded: boolean }): PrismaClient {
  const callAttempt = {
    findUnique: vi.fn(async (args: { select?: Record<string, boolean> }) => {
      if (args.select && 'completedAt' in args.select) return opts.attempt;
      return { id: ATTEMPT_ID, outcome: 'BLOCK_DETECTED', outcomeDetail: 'blocked' };
    }),
    update: vi.fn().mockResolvedValue({}),
  };
  return {
    callAttempt,
    insuranceClaim: {
      findUnique: vi.fn().mockResolvedValue({
        practiceId: 'practice-1',
        id: 'claim-1',
        carrierId: 'canada_life',
      }),
    },
    auditLog: {
      findFirst: vi.fn().mockResolvedValue(opts.adadRecorded ? { id: 'audit-1' } : null),
    },
  } as unknown as PrismaClient;
}

describe('end-of-call side effects after a live carrier refusal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('still deletes audio, writes the ADAD entry and meters usage when the live block already completed the attempt', async () => {
    const prisma = fakePrisma({
      attempt: { id: ATTEMPT_ID, completedAt: new Date(), claimId: 'claim-1', liveState: 'carrier_blocked' },
      adadRecorded: false,
    });

    await processVapiDeskWebhook(prisma, endOfCallPayload(), { rawBody: {} });

    expect(deletePostCallAudio).toHaveBeenCalledTimes(1);
    expect(deletePostCallAudio).toHaveBeenCalledWith(prisma, expect.objectContaining({ attemptId: ATTEMPT_ID }));
    expect(recordCallUsage).toHaveBeenCalledWith({ practiceId: 'practice-1', vapiCallId: VAPI_CALL_ID });
    expect(appendAuditLog).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'ADAD_DISCLOSURE_UNVERIFIED', subjectId: ATTEMPT_ID }),
    );
  });

  it('does not block the carrier twice or run claim recovery for a live-blocked call', async () => {
    const prisma = fakePrisma({
      attempt: { id: ATTEMPT_ID, completedAt: new Date(), claimId: 'claim-1', liveState: 'carrier_blocked' },
      adadRecorded: false,
    });

    await processVapiDeskWebhook(prisma, endOfCallPayload(), { rawBody: {} });

    expect(applyCarrierBlock).not.toHaveBeenCalled();
    expect(processRecoveryCallEnded).not.toHaveBeenCalled();
  });

  it('does nothing when end-of-call already ran for a live-blocked call', async () => {
    const prisma = fakePrisma({
      attempt: { id: ATTEMPT_ID, completedAt: new Date(), claimId: 'claim-1', liveState: 'carrier_blocked' },
      adadRecorded: true,
    });

    await processVapiDeskWebhook(prisma, endOfCallPayload(), { rawBody: {} });

    expect(deletePostCallAudio).not.toHaveBeenCalled();
    expect(recordCallUsage).not.toHaveBeenCalled();
    expect(appendAuditLog).not.toHaveBeenCalled();
  });

  it('treats an ordinary completed attempt as a duplicate delivery', async () => {
    const prisma = fakePrisma({
      attempt: { id: ATTEMPT_ID, completedAt: new Date(), claimId: 'claim-1', liveState: 'dialing' },
      adadRecorded: false,
    });

    await processVapiDeskWebhook(prisma, endOfCallPayload(), { rawBody: {} });

    expect(deletePostCallAudio).not.toHaveBeenCalled();
    expect(recordCallUsage).not.toHaveBeenCalled();
  });
});
