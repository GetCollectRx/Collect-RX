// ─────────────────────────────────────────────────────────────────────────────
// CollectRx — Call Engine Test Suite
//
// Covers the five call-engine modules (src/services/callEngine/): tokenizer
// facade correctness against the real PIIVault, state machine transition
// legality + idempotency + CARRIER_BLOCK guard + stale-call detection,
// telephony transcript extraction, polymorphic carrier schema validation,
// and aging-report reconciliation metrics/discrepancies.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import {
  tokenizePatientPHI,
  detokenizePatientPHI,
  isPatientTokenValid,
  revokePatientToken,
  CallEngineTokenError,
  type PatientPHI,
} from '../src/services/callEngine/tokenizer';
import {
  nextState,
  applyEvent,
  classifyStaleCall,
  toLiveCallState,
  toQueueStatus,
  toCallOutcome,
  InMemoryIdempotencyStore,
  InvalidCallStateTransitionError,
  CarrierBlockedError,
  type CallEngineRecord,
  type CallEngineStateStore,
} from '../src/services/callEngine/stateMachine';
import {
  stripNoiseArtifacts,
  extractClaimNumber,
  extractClientId,
  extractFinancialTotals,
  parseTelephonyTranscript,
} from '../src/services/callEngine/telephonyParser';
import {
  assertValidAdjudicationPayload,
  parseCarrierAdjudication,
  carrierDisplayName,
} from '../src/services/callEngine/schemas';
import { reconcileAgingReport, type AgingReportRow, type CallAttemptMetric } from '../src/services/callEngine/reconciler';

const SAMPLE_PHI: PatientPHI = {
  patientName: 'Jane Test Patient',
  dateOfBirth: '1990-01-01',
  subscriberId: 'SUB123456',
  groupPolicyNumber: 'GRP789',
};

describe('tokenizer.ts', () => {
  it('round-trips PHI through the canonical PIIVault', () => {
    const token = tokenizePatientPHI(SAMPLE_PHI, {
      practiceId: 'practice-1',
      callerContext: 'test:tokenize',
    });
    expect(isPatientTokenValid(token)).toBe(true);

    const resolved = detokenizePatientPHI(token, {
      practiceId: 'practice-1',
      callerContext: 'test:detokenize',
    });
    expect(resolved).toEqual(SAMPLE_PHI);

    revokePatientToken(token, 'test:cleanup');
    expect(isPatientTokenValid(token)).toBe(false);
  });

  it('refuses to resolve a token for the wrong practice', () => {
    const token = tokenizePatientPHI(SAMPLE_PHI, {
      practiceId: 'practice-a',
      callerContext: 'test:tokenize',
    });
    expect(() =>
      detokenizePatientPHI(token, { practiceId: 'practice-b', callerContext: 'test:cross-tenant' }),
    ).toThrow(CallEngineTokenError);
  });

  it('throws on an unknown token', () => {
    expect(() =>
      detokenizePatientPHI('00000000-0000-0000-0000-000000000000', {
        practiceId: 'practice-1',
        callerContext: 'test:unknown',
      }),
    ).toThrow(CallEngineTokenError);
  });
});

describe('stateMachine.ts', () => {
  function makeRecord(overrides: Partial<CallEngineRecord> = {}): CallEngineRecord {
    return {
      callAttemptId: 'attempt-1',
      claimId: 'claim-1',
      carrierId: 'sun_life',
      state: 'CLAIM_QUEUED',
      attempt: 0,
      enteredCurrentStateAt: new Date(),
      lastEvent: null,
      ...overrides,
    };
  }

  it('walks the full happy path to SUCCESS', () => {
    let state = nextState('CLAIM_QUEUED', { type: 'DISPATCH_REQUESTED' });
    expect(state).toBe('DIALING');
    state = nextState(state, { type: 'DIAL_CONNECTED' });
    expect(state).toBe('IVR_NAVIGATION');
    state = nextState(state, { type: 'HOLD_MUSIC_DETECTED' });
    expect(state).toBe('QUEUE_HOLD');
    state = nextState(state, { type: 'LIVE_REP_DETECTED' });
    expect(state).toBe('AGENT_CONNECTED');
    state = nextState(state, { type: 'TRANSCRIPT_EXTRACTION_STARTED' });
    expect(state).toBe('ADJUDICATION_EXTRACTING');
    state = nextState(state, { type: 'ADJUDICATION_PARSED' });
    expect(state).toBe('SYNC_PENDING');
    state = nextState(state, { type: 'SYNC_CONFIRMED' });
    expect(state).toBe('SUCCESS');
  });

  it('rejects a structurally invalid transition', () => {
    expect(() => nextState('CLAIM_QUEUED', { type: 'SYNC_CONFIRMED' })).toThrow(
      InvalidCallStateTransitionError,
    );
  });

  it('allows FAILED to retry back to CLAIM_QUEUED', () => {
    expect(nextState('FAILED', { type: 'RETRY_SCHEDULED' })).toBe('CLAIM_QUEUED');
  });

  it('applyEvent is idempotent for a repeated delivery of the same event', async () => {
    const store = new Map<string, CallEngineRecord>();
    const stateStore: CallEngineStateStore = {
      load: async (id) => store.get(id) ?? null,
      save: async (record) => {
        store.set(record.callAttemptId, record);
      },
    };
    store.set('attempt-1', makeRecord());
    const idempotency = new InMemoryIdempotencyStore();

    const first = await applyEvent(stateStore, idempotency, 'attempt-1', { type: 'DISPATCH_REQUESTED' }, {
      idempotencyKey: 'webhook-body-hash-1',
    });
    expect(first.applied).toBe(true);
    expect(first.record.state).toBe('DIALING');
    expect(first.record.attempt).toBe(1);

    const replay = await applyEvent(stateStore, idempotency, 'attempt-1', { type: 'DISPATCH_REQUESTED' }, {
      idempotencyKey: 'webhook-body-hash-1',
    });
    expect(replay.applied).toBe(false);
    expect(replay.record.state).toBe('DIALING');
    expect(replay.record.attempt).toBe(1);
  });

  it('refuses to enter DIALING when the carrier is CARRIER_BLOCK\'d', async () => {
    const store = new Map<string, CallEngineRecord>();
    const stateStore: CallEngineStateStore = {
      load: async (id) => store.get(id) ?? null,
      save: async (record) => {
        store.set(record.callAttemptId, record);
      },
    };
    store.set('attempt-1', makeRecord());
    const idempotency = new InMemoryIdempotencyStore();
    const isCarrierBlocked = vi.fn().mockResolvedValue(true);

    await expect(
      applyEvent(stateStore, idempotency, 'attempt-1', { type: 'DISPATCH_REQUESTED' }, {
        idempotencyKey: 'webhook-body-hash-2',
        isCarrierBlocked,
      }),
    ).rejects.toThrow(CarrierBlockedError);
    expect(isCarrierBlocked).toHaveBeenCalledWith('sun_life');
    // Rejected transitions must not be persisted.
    expect(store.get('attempt-1')?.state).toBe('CLAIM_QUEUED');
  });

  it('classifies a call stuck mid-sequence past the threshold as stale', () => {
    const staleRecord = makeRecord({
      state: 'QUEUE_HOLD',
      enteredCurrentStateAt: new Date(Date.now() - 26 * 60 * 1000),
    });
    expect(classifyStaleCall(staleRecord).isStale).toBe(true);

    const freshRecord = makeRecord({
      state: 'QUEUE_HOLD',
      enteredCurrentStateAt: new Date(),
    });
    expect(classifyStaleCall(freshRecord).isStale).toBe(false);

    // Terminal states are never "stale" — SUCCESS ended properly.
    const doneRecord = makeRecord({
      state: 'SUCCESS',
      enteredCurrentStateAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    expect(classifyStaleCall(doneRecord).isStale).toBe(false);
  });

  it('projects onto the existing LiveCallState / QueueStatus / CallOutcome enums', () => {
    expect(toLiveCallState('QUEUE_HOLD')).toBe('ivr_navigation');
    expect(toLiveCallState('AGENT_CONNECTED')).toBe('rep_connected');
    expect(toQueueStatus('SUCCESS')).toBe('COMPLETED');
    expect(toQueueStatus('FAILED')).toBe('PENDING');
    expect(toCallOutcome('SUCCESS')).toBe('RESOLVED');
    expect(toCallOutcome('FAILED')).toBe('FAILED');
  });
});

describe('telephonyParser.ts', () => {
  it('strips hold-music and filler noise', () => {
    const raw = 'Please hold. [music] [music] um, thank you for your patience.';
    expect(stripNoiseArtifacts(raw)).toBe('Please hold. thank you for your patience.');
  });

  it('extracts a carrier-stated claim number', () => {
    expect(extractClaimNumber('Sure, the claim number is SL-2024887 on file.')).toBe('SL-2024887');
    expect(extractClaimNumber('no claim data mentioned here')).toBeNull();
  });

  it('extracts a member/subscriber ID', () => {
    expect(extractClientId('Your subscriber ID is ABC12345 for that plan.')).toBe('ABC12345');
    expect(extractClientId('nothing relevant here')).toBeNull();
  });

  it('extracts and labels dollar amounts, converting to cents', () => {
    const mentions = extractFinancialTotals('The amount covered is $340.50 against a total billed of $425.00.');
    expect(mentions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'covered', amountCents: 34050 }),
        expect.objectContaining({ label: 'billed', amountCents: 42500 }),
      ]),
    );
  });

  it('parseTelephonyTranscript combines all extractors', () => {
    const result = parseTelephonyTranscript(
      '[music] The claim number is SL-2024887. Subscriber ID is ABC12345. Amount covered is $100.00.',
    );
    expect(result.claimNumber).toBe('SL-2024887');
    expect(result.clientId).toBe('ABC12345');
    expect(result.financialMentions).toHaveLength(1);
    expect(result.cleanedText).not.toContain('[music]');
  });
});

describe('schemas.ts', () => {
  const CLAIM_TOKEN = '11111111-1111-4111-8111-111111111111';

  it('produces a carrier display name from carrier-configs.json', () => {
    expect(carrierDisplayName('sun_life')).toBe('Sun Life Financial');
  });

  it('classifies a paid claim from transcript text', () => {
    const extraction = parseTelephonyTranscript('Payment issued, amount covered is $200.00.');
    const payload = parseCarrierAdjudication('sun_life', CLAIM_TOKEN, 'Payment issued, amount covered is $200.00.', extraction);
    expect(payload.adjudication_status).toBe('PAID');
    expect(payload.amount_covered_cents).toBe(20000);
    expect(payload.denial_reason_code).toBeNull();
  });

  it('classifies a denied claim with a carrier-specific reason code', () => {
    const text = 'Sorry, the annual maximum has been reached for this plan year.';
    const extraction = parseTelephonyTranscript(text);
    const payload = parseCarrierAdjudication('canada_life', CLAIM_TOKEN, text, extraction);
    expect(payload.adjudication_status).toBe('DENIED');
    expect(payload.denial_reason_code).toBe('ANNUAL_MAX_REACHED');
    expect(payload.amount_covered_cents).toBe(0);
  });

  it('rejects a malformed payload before write-back', () => {
    expect(() =>
      assertValidAdjudicationPayload({
        carrier: 'sun_life',
        claim_id_token: 'not-a-uuid',
        adjudication_status: 'PAID',
        denial_reason_code: null,
        amount_covered_cents: 100,
      }),
    ).toThrow();
  });
});

describe('reconciler.ts', () => {
  const agingReport: AgingReportRow[] = [
    { claimId: 'claim-1', carrierId: 'sun_life', outstandingAmountCents: 10000, daysOutstanding: 45 },
    { claimId: 'claim-2', carrierId: 'manulife', outstandingAmountCents: 5000, daysOutstanding: 60 },
    { claimId: 'claim-3', carrierId: 'rbc', outstandingAmountCents: 2000, daysOutstanding: 10 },
  ];

  const attempts: CallAttemptMetric[] = [
    {
      claimId: 'claim-1',
      outcome: 'RESOLVED',
      initiatedAt: new Date('2026-08-01T10:00:00Z'),
      completedAt: new Date('2026-08-01T10:05:00Z'),
      holdDurationSeconds: 120,
      carrierBlockDetected: false,
    },
    {
      claimId: 'claim-2',
      outcome: 'DENIED',
      initiatedAt: new Date('2026-08-01T11:00:00Z'),
      completedAt: new Date('2026-08-01T11:04:00Z'),
      holdDurationSeconds: 60,
      carrierBlockDetected: false,
    },
  ];

  it('computes fleet-level ROI metrics', () => {
    const report = reconcileAgingReport(agingReport, attempts);
    expect(report.metrics.totalClaims).toBe(3);
    expect(report.metrics.totalCallAttempts).toBe(2);
    expect(report.metrics.resolvedCallAttempts).toBe(1);
    expect(report.metrics.callSuccessRate).toBeCloseTo(0.5);
    expect(report.metrics.averageHoldTimeSeconds).toBeCloseTo(90);
    expect(report.metrics.totalDollarsResolvedCents).toBe(10000);
  });

  it('flags a resolved claim whose aging snapshot still shows a balance', () => {
    const report = reconcileAgingReport(agingReport, attempts);
    // claim-1's latest attempt is RESOLVED but the aging row still carries a
    // $100 balance — that combination means the EMR sync write-back is stale.
    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claimId: 'claim-1', kind: 'RESOLVED_BUT_STILL_AGED' }),
      ]),
    );
    // claim-3 is under 30 days — absence of an attempt is expected, not a discrepancy.
    expect(report.discrepancies.find((d) => d.claimId === 'claim-3')).toBeUndefined();
  });

  it('flags a call attempt whose claim is missing from the aging report', () => {
    const report = reconcileAgingReport(agingReport, [
      ...attempts,
      {
        claimId: 'claim-ghost',
        outcome: 'PENDING',
        initiatedAt: new Date(),
        completedAt: null,
        carrierBlockDetected: false,
      },
    ]);
    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claimId: 'claim-ghost', kind: 'MISSING_FROM_AGING_REPORT' }),
      ]),
    );
  });
});
