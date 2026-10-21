/**
 * Where the webhooks feed the hybrid call flow: the staff handoff request and
 * the end-of-call report. The phase store is mocked; its own behaviour is
 * covered by callPhaseStore.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { prismaMock, getSettings, transfer, notify, byVapiId, recordPhase, closePhases } = vi.hoisted(
  () => ({
    prismaMock: {
      practice: { findUnique: vi.fn() },
      insuranceClaim: { findUnique: vi.fn() },
      humanAssistedCallLog: { create: vi.fn() },
      callAttempt: { update: vi.fn() },
    },
    getSettings: vi.fn(),
    transfer: vi.fn(),
    notify: vi.fn(),
    byVapiId: vi.fn(),
    recordPhase: vi.fn(),
    closePhases: vi.fn(),
  }),
);

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../src/vapi/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/vapi/client')>()),
  transferVapiCall: transfer,
}));
vi.mock('../src/server/services/practiceSettingsService.js', () => ({ getPracticeSettings: getSettings }));
vi.mock('../src/server/services/practiceNotificationService.js', () => ({ sendPracticeNotification: notify }));
vi.mock('../src/server/db/rlsContext.js', () => ({ runWithRlsBypass: <T>(fn: () => T) => fn() }));
vi.mock('../src/server/frontDesk/callPhaseStore.js', () => ({
  recordCallPhaseByVapiId: byVapiId,
  recordCallPhase: recordPhase,
  closeCallPhases: closePhases,
}));
vi.mock('../src/server/frontDesk/callPhaseStore', () => ({
  recordCallPhaseByVapiId: byVapiId,
  recordCallPhase: recordPhase,
  closeCallPhases: closePhases,
}));

import vapiRouter from '../src/webhooks/vapi.js';
import { processHoldAndTransitions } from '../src/webhooks/holdTransitionProcessor.js';
import type { VapiWebhookPayload } from '../src/vapi/client.js';

const SECRET = 'hybrid-phase-hooks-secret';

function post(body: string) {
  const a = express();
  a.use('/hook', express.raw({ type: '*/*' }), vapiRouter);
  return request(a).post('/hook').set('x-vapi-secret', SECRET).set('Content-Type', 'application/json').send(body);
}

const handoffCall = JSON.stringify({
  message: {
    type: 'tool-calls',
    call: { id: 'call-1', assistantOverrides: { metadata: { claimId: 'claim-42', practiceId: 'practice-1' } } },
    toolWithToolCallList: [
      { name: 'request_staff_handoff', toolCall: { id: 'tc-1', function: { name: 'request_staff_handoff', arguments: '{}' } } },
    ],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VAPI_WEBHOOK_SECRET = SECRET;
  prismaMock.practice.findUnique.mockResolvedValue({ name: 'CollectRx Demo Practice' });
  prismaMock.insuranceClaim.findUnique.mockResolvedValue({
    claimNumber: 'CLM-42',
    practiceId: 'practice-1',
    carrierId: 'sun_life',
    outstandingAmount: 300,
    billedAmount: 300,
  });
  prismaMock.humanAssistedCallLog.create.mockResolvedValue({});
  prismaMock.callAttempt.update.mockResolvedValue({});
  notify.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('request_staff_handoff phase hooks', () => {
  it('records rep_answered, then staff_or_agent after a successful transfer', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockResolvedValue(undefined);
    await post(handoffCall);
    expect(byVapiId.mock.calls.map((c) => c[2])).toEqual(['rep_answered', 'staff_or_agent']);
    expect(byVapiId.mock.calls.every((c) => c[1] === 'call-1')).toBe(true);
  });

  it('records only rep_answered when the transfer fails', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockRejectedValue(new Error('transfer failed'));
    await post(handoffCall);
    expect(byVapiId.mock.calls.map((c) => c[2])).toEqual(['rep_answered']);
  });

  it('records only rep_answered when no staff line is configured', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '', billingPhone: '4165550100' });
    await post(handoffCall);
    expect(transfer).not.toHaveBeenCalled();
    expect(byVapiId.mock.calls.map((c) => c[2])).toEqual(['rep_answered']);
  });
});

describe('end-of-call report', () => {
  const context = { callAttemptId: 'attempt-1', vapiCallId: 'call-1', initiatedAt: new Date('2026-10-01T15:00:00Z') };
  const ended = (collectrx?: unknown): VapiWebhookPayload =>
    ({
      type: 'call.ended',
      call: { id: 'call-1', endedAt: '2026-10-01T15:10:00.000Z' },
      analysis: collectrx === undefined ? undefined : { collectrx },
    }) as unknown as VapiWebhookPayload;

  it('does nothing with the flag off', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'false');
    await processHoldAndTransitions(
      ended({ agentTransition: { toAgent: 'Resolution_Closer' } }),
      context,
    );
    expect(recordPhase).not.toHaveBeenCalled();
    expect(closePhases).not.toHaveBeenCalled();
  });

  it('records the last squad member phases and closes at the reported end time with the flag on', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    await processHoldAndTransitions(
      ended({ agentTransition: { toAgent: 'Escalation_Closer', transitionedAt: '2026-10-01T15:05:00.000Z' } }),
      context,
    );
    expect(recordPhase).toHaveBeenCalledWith(
      expect.anything(),
      'attempt-1',
      ['rep_answered', 'staff_or_agent', 'wrap_up'],
      { at: new Date('2026-10-01T15:05:00.000Z') },
    );
    expect(closePhases).toHaveBeenCalledWith(expect.anything(), 'attempt-1', new Date('2026-10-01T15:10:00.000Z'));
  });

  it('still closes the call when the report has no transition', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    await processHoldAndTransitions(ended(), context);
    expect(recordPhase).not.toHaveBeenCalled();
    expect(closePhases).toHaveBeenCalledWith(expect.anything(), 'attempt-1', new Date('2026-10-01T15:10:00.000Z'));
  });

  it('does not touch phases on events other than call.ended', async () => {
    vi.stubEnv('HYBRID_CALL_FLOW', 'true');
    await processHoldAndTransitions({ type: 'call.started', call: { id: 'call-1' } } as unknown as VapiWebhookPayload, context);
    expect(recordPhase).not.toHaveBeenCalled();
    expect(closePhases).not.toHaveBeenCalled();
  });
});
