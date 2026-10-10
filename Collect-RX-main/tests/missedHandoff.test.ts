import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  MISSED_HANDOFF_SCENARIO,
  buildMissedHandoffScript,
  missedHandoffMessage,
  purposeFromCallMetadata,
} from '../src/server/vapi/missedHandoff.js';
import { validateRequiredDisclosure } from '../src/server/vapi/claimsValidatorWebhook.js';

const { prismaMock, getSettings, transfer, notify } = vi.hoisted(() => ({
  prismaMock: {
    practice: { findUnique: vi.fn() },
    insuranceClaim: { findUnique: vi.fn() },
    humanAssistedCallLog: { create: vi.fn() },
    callAttempt: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
  getSettings: vi.fn(),
  transfer: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../src/vapi/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/vapi/client')>()),
  transferVapiCall: transfer,
}));
vi.mock('../src/server/services/practiceSettingsService.js', () => ({ getPracticeSettings: getSettings }));
vi.mock('../src/server/services/practiceNotificationService.js', () => ({ sendPracticeNotification: notify }));
vi.mock('../src/server/db/rlsContext.js', () => ({
  runWithRlsBypass: <T>(fn: () => T) => fn(),
}));

import vapiRouter from '../src/webhooks/vapi.js';
import { VapiAmbiguousOutcomeError } from '../src/vapi/client.js';

const SECRET = 'missed-handoff-test-secret';

function app() {
  const a = express();
  a.use('/hook', express.raw({ type: '*/*' }), vapiRouter);
  return a;
}

function toolCall(name: string, args: Record<string, unknown>, metadata: Record<string, unknown>) {
  return JSON.stringify({
    message: {
      type: 'tool-calls',
      call: { id: 'call-1', assistantOverrides: { metadata } },
      toolWithToolCallList: [
        { name, toolCall: { id: 'tc-1', function: { name, arguments: JSON.stringify(args) } } },
      ],
    },
  });
}

async function post(body: string) {
  return request(app())
    .post('/hook')
    .set('x-vapi-secret', SECRET)
    .set('Content-Type', 'application/json')
    .send(body);
}

describe('missed handoff script', () => {
  it('opens with every element of the required disclosure', () => {
    const script = buildMissedHandoffScript({
      practiceName: 'CollectRx Demo Practice',
      practicePhone: '416-555-0100',
      purpose: 'claim',
    });
    expect(validateRequiredDisclosure(script)).toEqual({
      automation: true,
      practiceIdentity: true,
      claimsStatusPurpose: true,
      contact: true,
    });
    expect(script).toMatch(/reference number/);
  });

  it('names the CDCP purpose for CDCP calls', () => {
    expect(purposeFromCallMetadata({ cdcpContext: true })).toBe('cdcp_predetermination');
    expect(purposeFromCallMetadata({ preVisitType: 'eligibility' })).toBe('eligibility');
    expect(purposeFromCallMetadata({ claimId: 'c1' })).toBe('claim');
  });

  it('tells staff when no reference number was given', () => {
    expect(missedHandoffMessage({ claimLabel: 'CLM-1', carrierLabel: 'sun_life' }).message).toMatch(
      /did not give a reference number/,
    );
  });
});

describe('request_staff_handoff and log_call_outcome', () => {
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
    prismaMock.callAttempt.findUnique.mockResolvedValue({ isHumanAssisted: true, claim: { practiceId: 'practice-1' } });
    prismaMock.callAttempt.updateMany.mockResolvedValue({ count: 1 });
    notify.mockResolvedValue(undefined);
  });

  it('transfers to staff and keeps the agent silent when the transfer goes through', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockResolvedValue(undefined);
    const res = await post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));
    expect(transfer).toHaveBeenCalledWith('call-1', '4165550101');
    expect(res.body.results[0].result).toMatch(/^HANDOFF INITIATED/);
  });

  it('does not make the agent speak when only the notification fails after a successful transfer', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockResolvedValue(undefined);
    notify.mockRejectedValue(new Error('db down'));
    const res = await post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));
    expect(res.body.results[0].result).toMatch(/^HANDOFF INITIATED/);
  });

  it('asks for a reference number with the disclosure when the transfer fails', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockRejectedValue(new Error('transfer failed'));
    const res = await post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));
    const result: string = res.body.results[0].result;
    expect(result).toMatch(/Standing rule: get a reference number/);
    expect(result).toContain('automated calling system on behalf of CollectRx Demo Practice');
    expect(result).toContain('4165550100');
    expect(result).toContain(`scenario "${MISSED_HANDOFF_SCENARIO}"`);
  });

  it('asks for a reference number when no staff line is set up but a callback number is', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '', billingPhone: '4165550100' });
    const res = await post(toolCall('request_staff_handoff', {}, { practiceId: 'practice-1', cdcpContext: true }));
    expect(transfer).not.toHaveBeenCalled();
    expect(res.body.results[0].result).toContain('CDCP predetermination');
  });

  it('stays silent when there is no callback number to disclose', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '', billingPhone: '' });
    const res = await post(toolCall('request_staff_handoff', {}, { practiceId: 'practice-1' }));
    expect(res.body.results[0].result).toMatch(/Stay silent/);
  });

  it('sends the reference number to the practice as a message', async () => {
    const res = await post(
      toolCall(
        'log_call_outcome',
        {
          scenario: MISSED_HANDOFF_SCENARIO,
          referenceNumber: 'SL-889911',
          repName: 'Dana',
          callSummary: 'Staff unavailable; reference captured.',
        },
        { claimId: 'claim-42', practiceId: 'practice-1', carrierId: 'sun_life' },
      ),
    );
    expect(res.body.results[0].result).toBe('Logged.');
    expect(notify).toHaveBeenCalledWith(
      prismaMock,
      expect.objectContaining({
        practiceId: 'practice-1',
        claimId: 'claim-42',
        subject: expect.stringContaining('SL-889911'),
        message: expect.stringContaining('Representative: Dana'),
      }),
    );
  });

  it('does not message the practice for ordinary staff-handled calls', async () => {
    await post(
      toolCall(
        'log_call_outcome',
        { scenario: 'payment_confirmed', callSummary: 'Paid.' },
        { claimId: 'claim-42', practiceId: 'practice-1', carrierId: 'sun_life' },
      ),
    );
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('request_staff_handoff authorization and state', () => {
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
    prismaMock.callAttempt.findUnique.mockResolvedValue({ isHumanAssisted: true, claim: { practiceId: 'practice-1' } });
    prismaMock.callAttempt.updateMany.mockResolvedValue({ count: 1 });
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockResolvedValue(undefined);
    notify.mockResolvedValue(undefined);
  });

  const handoff = () =>
    post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));

  it('refuses a transfer on an autonomous call and never reaches the provider', async () => {
    prismaMock.callAttempt.findUnique.mockResolvedValue({ isHumanAssisted: false, claim: { practiceId: 'practice-1' } });
    const res = await handoff();
    expect(res.body.results[0].result).toMatch(/^HANDOFF REFUSED/);
    expect(transfer).not.toHaveBeenCalled();
    expect(prismaMock.callAttempt.updateMany).not.toHaveBeenCalled();
  });

  it('ignores a model-supplied human-assisted flag on an autonomous call', async () => {
    prismaMock.callAttempt.findUnique.mockResolvedValue({ isHumanAssisted: false, claim: { practiceId: 'practice-1' } });
    const res = await post(
      toolCall(
        'request_staff_handoff',
        { isHumanAssisted: true, mode: 'human_assisted', squadId: 'bbe41279-5301-4b5d-aa43-d7b23eaab5e7' },
        { claimId: 'claim-42', practiceId: 'practice-1' },
      ),
    );
    expect(res.body.results[0].result).toMatch(/^HANDOFF REFUSED/);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('refuses when no server-side call record exists after the lookup retries', async () => {
    prismaMock.callAttempt.findUnique.mockResolvedValue(null);
    const res = await handoff();
    expect(res.body.results[0].result).toMatch(/^HANDOFF REFUSED/);
    expect(prismaMock.callAttempt.findUnique).toHaveBeenCalledTimes(3);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('refuses when the authorized call belongs to a different practice', async () => {
    prismaMock.callAttempt.findUnique.mockResolvedValue({ isHumanAssisted: true, claim: { practiceId: 'practice-2' } });
    const res = await handoff();
    expect(res.body.results[0].result).toMatch(/^HANDOFF REFUSED/);
    expect(transfer).not.toHaveBeenCalled();
  });

  it('claims the call atomically with a conditional update limited to human-assisted calls', async () => {
    await handoff();
    expect(prismaMock.callAttempt.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        vapiCallId: 'call-1',
        isHumanAssisted: true,
        OR: [{ staffHandoffState: null }, { staffHandoffState: 'FAILED' }],
      },
      data: expect.objectContaining({ staffHandoffState: 'REQUESTED' }),
    });
  });

  it('a repeat request after acceptance reports it is already initiated and does not transfer again', async () => {
    // claim, settle, then the second claim, which must lose.
    prismaMock.callAttempt.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prismaMock.callAttempt.findUnique.mockImplementation(async (args: { select?: { staffHandoffState?: boolean } }) =>
      args.select?.staffHandoffState
        ? { staffHandoffState: 'PROVIDER_ACCEPTED' }
        : { isHumanAssisted: true, claim: { practiceId: 'practice-1' } },
    );
    expect((await handoff()).body.results[0].result).toMatch(/^HANDOFF INITIATED/);
    expect((await handoff()).body.results[0].result).toMatch(/^HANDOFF ALREADY INITIATED/);
    expect(transfer).toHaveBeenCalledTimes(1);
  });

  it('a provider timeout is recorded as OUTCOME_UNKNOWN and not retried by the next request', async () => {
    transfer.mockRejectedValue(new VapiAmbiguousOutcomeError('POST', '/call/call-1/transfer', new Error('timeout')));
    prismaMock.callAttempt.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    const res = await handoff();
    expect(res.body.results[0].result).toMatch(/^HANDOFF STATUS UNKNOWN/);
    expect(prismaMock.callAttempt.updateMany).toHaveBeenLastCalledWith({
      where: { vapiCallId: 'call-1', staffHandoffState: 'REQUESTED' },
      data: { staffHandoffState: 'OUTCOME_UNKNOWN', staffHandoffReason: 'PROVIDER_OUTCOME_UNKNOWN' },
    });
    prismaMock.callAttempt.updateMany.mockResolvedValue({ count: 0 });
    expect((await handoff()).body.results[0].result).toMatch(/^HANDOFF STATUS UNKNOWN/);
    expect(transfer).toHaveBeenCalledTimes(1);
  });

  it('a definitive provider rejection is recorded as FAILED and a later request may retry', async () => {
    transfer.mockRejectedValueOnce(new Error('VapiClient POST /call/call-1/transfer 422: bad destination'));
    prismaMock.callAttempt.updateMany.mockResolvedValue({ count: 1 });
    const first = await handoff();
    expect(first.body.results[0].result).toMatch(/Standing rule: get a reference number/);
    expect(prismaMock.callAttempt.updateMany).toHaveBeenCalledWith({
      where: { vapiCallId: 'call-1', staffHandoffState: 'REQUESTED' },
      data: { staffHandoffState: 'FAILED', staffHandoffReason: 'PROVIDER_REJECTED' },
    });
    expect((await handoff()).body.results[0].result).toMatch(/^HANDOFF INITIATED/);
    expect(transfer).toHaveBeenCalledTimes(2);
  });
});
