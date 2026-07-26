import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VapiWebhookPayload } from '../src/vapi/client.js';

const { findUnique, findFirst, appendAuditLog } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  appendAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    callAttempt: { findUnique },
    insuranceClaim: { findFirst },
  },
}));

vi.mock('../src/server/audit/auditLog.js', () => ({
  appendAuditLog,
}));

import { appendVapiWebhookAudit } from '../src/webhooks/vapi.js';

const payload: VapiWebhookPayload = {
  type: 'call.ended',
  call: { id: 'vapi-call-id', status: 'completed' },
  metadata: {
    practiceId: 'practice-id',
    claimId: 'claim-id',
    patientToken: 'patient-token',
    carrierId: 'sun_life',
  },
};

describe('Vapi webhook audit events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records an operational event without webhook payload or PHI', async () => {
    findUnique.mockResolvedValue({
      id: 'attempt-id',
      claim: { practiceId: 'practice-id' },
    });

    await appendVapiWebhookAudit('VAPI_WEBHOOK_RECEIVED', payload);

    expect(appendAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        practiceId: 'practice-id',
        action: 'VAPI_WEBHOOK_RECEIVED',
        subjectType: 'CallAttempt',
        subjectId: 'attempt-id',
        details: { eventType: 'call.ended' },
      }),
    );
    const auditInput = appendAuditLog.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(JSON.stringify(auditInput)).not.toContain('patient-token');
    expect(JSON.stringify(auditInput)).not.toContain('claim-id');
  });

  it('does not write an audit event for untrusted metadata', async () => {
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);

    await appendVapiWebhookAudit('VAPI_WEBHOOK_REJECTED', payload);

    expect(appendAuditLog).not.toHaveBeenCalled();
  });
});
