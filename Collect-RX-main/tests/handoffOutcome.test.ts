import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  countHandoffOutcomes,
  recordHandoffOutcome,
  summarizeHandoffOutcomes,
} from '../src/server/vapi/handoffOutcome.js';

describe('summarizeHandoffOutcomes', () => {
  it('counts each handoff outcome and ignores rows with no recognised outcome', () => {
    const counts = summarizeHandoffOutcomes([
      { outcome: 'transfer_initiated' },
      { outcome: 'transfer_initiated' },
      { outcome: 'no_escalation_number' },
      { outcome: 'handoff_error' },
      { outcome: 'something_else' },
      { outcome: 42 },
      null,
    ]);
    expect(counts).toEqual({
      transfer_initiated: 2,
      no_escalation_number: 1,
      handoff_error: 1,
      missing_context: 0,
    });
  });

  it('returns zero for every outcome when there are no rows', () => {
    expect(summarizeHandoffOutcomes([])).toEqual({
      transfer_initiated: 0,
      no_escalation_number: 0,
      handoff_error: 0,
      missing_context: 0,
    });
  });
});

const appendAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/server/audit/auditLog.js', () => ({
  appendAuditLog: (...args: unknown[]) => appendAuditLog(...args),
}));

describe('recordHandoffOutcome', () => {
  it('appends a chained audit row carrying only the outcome code and the call id', async () => {
    const prisma = {} as PrismaClient;

    await recordHandoffOutcome(prisma, {
      practiceId: 'practice-1',
      vapiCallId: 'vapi-call-1',
      outcome: 'transfer_initiated',
    });

    expect(appendAuditLog).toHaveBeenCalledTimes(1);
    const input = appendAuditLog.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input).toMatchObject({
      practiceId: 'practice-1',
      action: 'frontdesk.handoff.outcome',
      subjectType: 'VapiCall',
      subjectId: 'vapi-call-1',
      details: { outcome: 'transfer_initiated' },
    });
    expect(JSON.stringify(input)).not.toMatch(/name|dob|patient/i);
  });
});

describe('countHandoffOutcomes', () => {
  it('reads the practice rows in the window and summarizes them', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { details: { outcome: 'transfer_initiated' } },
      { details: { outcome: 'no_escalation_number' } },
    ]);
    const prisma = { auditLog: { findMany } } as unknown as PrismaClient;
    const since = new Date('2026-11-01T00:00:00Z');

    const counts = await countHandoffOutcomes(prisma, 'practice-1', since);

    expect(counts.transfer_initiated).toBe(1);
    expect(counts.no_escalation_number).toBe(1);
    const arg = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({
      practiceId: 'practice-1',
      action: 'frontdesk.handoff.outcome',
      createdAt: { gte: since },
    });
  });
});
