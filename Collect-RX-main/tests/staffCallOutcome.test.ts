import { describe, it, expect, vi } from 'vitest';
import { submitStaffCallOutcome } from '../src/server/frontDesk/staffCallOutcome';
import { NO_LOG_OUTCOME_DETAIL } from '../src/outcome/humanAssistedOutcomeResolver';

function mk(opts: { attempt?: any; existing?: any } = {}) {
  const create = vi.fn(async ({ data }: any) => ({ ...data, unresolvedFields: null }));
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const attempt = 'attempt' in opts ? opts.attempt : { id: 'a', vapiCallId: 'v', claimId: 'c', claim: { carrierId: 'SUN_LIFE' } };
  const prisma: any = {
    callAttempt: {
      findFirst: vi.fn(async (q: any) => (q.select?.vapiCallId ? attempt : { id: 'a', completedAt: new Date(), outcomeDetail: NO_LOG_OUTCOME_DETAIL, transcriptUrl: null, durationSeconds: 3 })),
      updateMany,
    },
    humanAssistedCallLog: { findUnique: async () => opts.existing ?? null, create },
  };
  return { prisma, create, updateMany };
}
const base = { practiceId: 'p', callAttemptId: 'a', scenario: 'CLAIM_PAID', summary: 'Paid, call 613-501-8951.' };

describe('submitStaffCallOutcome', () => {
  it('rejects unknown scenarios and empty summaries', async () => {
    expect(await submitStaffCallOutcome(mk().prisma, { ...base, scenario: 'NOPE' })).toMatchObject({ ok: false, status: 400 });
    expect(await submitStaffCallOutcome(mk().prisma, { ...base, summary: ' ' })).toMatchObject({ ok: false, status: 400 });
  });
  it('404s for another practice or unknown attempt, 409s on duplicate', async () => {
    expect(await submitStaffCallOutcome(mk({ attempt: null }).prisma, base)).toMatchObject({ ok: false, status: 404 });
    expect(await submitStaffCallOutcome(mk({ existing: { id: 'x' } }).prisma, base)).toMatchObject({ ok: false, status: 409 });
  });
  it('logs a scrubbed summary and fills the attempt', async () => {
    const m = mk();
    expect(await submitStaffCallOutcome(m.prisma, base)).toEqual({ ok: true });
    expect(m.create.mock.calls[0][0].data.callSummary).not.toMatch(/8951/);
    expect(m.updateMany).toHaveBeenCalled();
  });
});
