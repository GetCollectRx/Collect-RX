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

const { prismaMock, getSettings, transfer, notify, broadcast } = vi.hoisted(() => ({
  prismaMock: {
    practice: { findUnique: vi.fn() },
    user: { findFirst: vi.fn() },
    insuranceClaim: { findUnique: vi.fn() },
    humanAssistedCallLog: { create: vi.fn() },
  },
  getSettings: vi.fn(),
  transfer: vi.fn(),
  notify: vi.fn(),
  broadcast: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../src/vapi/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/vapi/client')>()),
  transferVapiCall: transfer,
}));
vi.mock('../src/server/services/practiceSettingsService.js', () => ({ getPracticeSettings: getSettings }));
vi.mock('../src/server/services/practiceNotificationService.js', () => ({ sendPracticeNotification: notify }));
vi.mock('../src/server/frontDesk/deskWs.js', () => ({ broadcastDesk: broadcast }));
vi.mock('../src/server/db/rlsContext.js', () => ({
  runWithRlsBypass: <T>(fn: () => T) => fn(),
}));

import vapiRouter from '../src/webhooks/vapi.js';

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
    prismaMock.user.findFirst.mockResolvedValue(null);
    broadcast.mockReset();
    notify.mockResolvedValue(undefined);
  });

  it('transfers to staff and keeps the agent silent when the transfer goes through', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockResolvedValue(undefined);
    const res = await post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));
    expect(transfer).toHaveBeenCalledWith('call-1', '4165550101');
    expect(res.body.results[0].result).toMatch(/^HANDOFF INITIATED/);
  });

  it('puts a screen alert on the desk once the transfer goes through', async () => {
    getSettings.mockResolvedValue({
      escalationPhoneNumber: '4165550101',
      billingPhone: '4165550100',
      designatedIndividualUserId: 'user-9',
    });
    prismaMock.user.findFirst.mockResolvedValue({ displayName: 'Dana Reyes' });
    transfer.mockResolvedValue(undefined);
    await post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));
    expect(broadcast).toHaveBeenCalledTimes(1);
    const [practiceId, event] = broadcast.mock.calls[0];
    expect(practiceId).toBe('practice-1');
    expect(event).toMatchObject({
      type: 'handoff.requested',
      data: {
        callId: 'call-1',
        claimNumber: 'CLM-42',
        carrierId: 'sun_life',
        outstandingAmount: 300,
        designatedName: 'Dana Reyes',
      },
    });
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'user-9', practiceId: 'practice-1' },
      select: { displayName: true },
    });
  });

  it('still alerts the desk, without a name, when no designated individual is set', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockResolvedValue(undefined);
    await post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));
    expect(broadcast.mock.calls[0][1].data.designatedName).toBeNull();
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it('does not alert the desk when the transfer fails, since no call is coming', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockRejectedValue(new Error('transfer failed'));
    await post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('does not alert the desk when no staff line is set up', async () => {
    getSettings.mockResolvedValue({ billingPhone: '4165550100' });
    await post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('keeps the agent silent even if the screen alert itself fails after the transfer', async () => {
    getSettings.mockResolvedValue({ escalationPhoneNumber: '4165550101', billingPhone: '4165550100' });
    transfer.mockResolvedValue(undefined);
    broadcast.mockImplementation(() => {
      throw new Error('socket gone');
    });
    const res = await post(toolCall('request_staff_handoff', {}, { claimId: 'claim-42', practiceId: 'practice-1' }));
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
