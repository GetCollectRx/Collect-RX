import { afterEach, describe, it, expect, vi } from 'vitest'
import { redactString, safeMeta, logger } from '../src/server/observability/logger.js'
import { getCorrelationId, runWithCorrelationId } from '../src/server/observability/correlationContext.js'

describe('P6-01 redact', () => {
  it('redacts email-like substrings', () => {
    expect(redactString('Contact jane@example.com please')).toMatch(/\[redacted:email\]/)
  })
  it('redacts N. American phone-like patterns', () => {
    expect(redactString('Call 555-123-4567 today')).toMatch(/\[redacted:phone\]/)
  })
  it('redacts ISO-date-shaped substrings', () => {
    expect(redactString('DOB on file: 1990-04-12')).toMatch(/\[redacted:date\]/)
  })
})

describe('safeMeta — field-name-based PHI redaction (P0.3 consolidation)', () => {
  it('fully redacts known PHI field values regardless of content', () => {
    const out = safeMeta({
      patientName: 'John Smith',
      patient_dob: '1990-04-12',
      policyNumber: 'ABC123456',
      subscriber_name: 'Jane Doe',
      claimId: 'a1b2c3d4-uuid-not-phi',
    });
    expect(out?.patientName).toBe('[redacted:phi]');
    expect(out?.patient_dob).toBe('[redacted:phi]');
    expect(out?.policyNumber).toBe('[redacted:phi]');
    expect(out?.subscriber_name).toBe('[redacted:phi]');
    // Non-PHI identifiers must survive untouched — over-redaction destroys
    // the ability to trace anything.
    expect(out?.claimId).toBe('a1b2c3d4-uuid-not-phi');
  });

  it('does not redact carrier/practice names that merely look like "First Last"', () => {
    // This is the exact false-positive the legacy logger.cjs pattern-match
    // would have hit — verifying it deliberately was NOT ported (see the
    // comment above PHI_FIELD_NAMES in logger.ts).
    const out = safeMeta({ carrierId: 'Sun Life', practiceName: 'Green Shield Dental' });
    expect(out?.carrierId).toBe('Sun Life');
    expect(out?.practiceName).toBe('Green Shield Dental');
  });

  it('redacts PHI field values nested inside an object', () => {
    const out = safeMeta({ claim: { patientName: 'John Smith', claimNumber: 'CLM-1' } });
    expect((out?.claim as Record<string, unknown>).patientName).toBe('[redacted:phi]');
    expect((out?.claim as Record<string, unknown>).claimNumber).toBe('[redacted:phi]');
  });

  it('applies substring redaction to array-of-string values', () => {
    const out = safeMeta({ notes: ['reach jane@example.com', 'no PHI here'] });
    expect(out?.notes).toEqual(['reach [redacted:email]', 'no PHI here']);
  });

  it('passes through non-string, non-object values unchanged', () => {
    const out = safeMeta({ count: 3, active: true, when: null });
    expect(out).toEqual({ count: 3, active: true, when: null });
  });

  it('returns undefined for undefined input', () => {
    expect(safeMeta(undefined)).toBeUndefined();
  });
});

describe('logger — method-style API (Contract C1)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logger.error handles a real Error, extracting message and stack', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.error('dispatch failed', { error: new Error('boom'), claimId: 'c1' });
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.msg).toBe('dispatch failed');
    expect(parsed.error).toBe('boom');
    expect(parsed.stack).toBeTruthy();
    expect(parsed.claimId).toBe('c1');
  });

  it('logger.error handles a non-Error thrown value (catch (err): unknown) without throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => logger.error('weird failure', { error: 'a string throw' })).not.toThrow();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.error).toBe('a string throw');
  });

  it('logger.error with no error field at all still logs cleanly', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logger.error('just a message', { claimId: 'c1' });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.error).toBeUndefined();
    expect(parsed.claimId).toBe('c1');
  });

  it('logger.warn/info/debug route to the matching console method as JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.warn('careful', { practiceId: 'p1' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0][0] as string)).toMatchObject({
      level: 'warn',
      msg: 'careful',
      practiceId: 'p1',
    });
  });

  it('logger.audit emits an AUDIT-prefixed info line with the event and context', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logger.audit('CALL_INITIATED', { claimId: 'c1' });
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed.msg).toBe('AUDIT: CALL_INITIATED');
    expect(parsed.audit).toBe(true);
    expect(parsed.event).toBe('CALL_INITIATED');
    expect(parsed.claimId).toBe('c1');
  });
});

describe('correlation ID propagation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getCorrelationId returns undefined outside any context', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('runWithCorrelationId makes the ID visible to nested synchronous calls', () => {
    runWithCorrelationId('corr-1', () => {
      expect(getCorrelationId()).toBe('corr-1');
    });
  });

  it('runWithCorrelationId makes the ID visible across async boundaries', async () => {
    await runWithCorrelationId('corr-async', async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(getCorrelationId()).toBe('corr-async');
    });
  });

  it('logger calls automatically pick up the ambient correlation ID', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runWithCorrelationId('corr-log-test', () => {
      logger.warn('inside request', {});
    });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.correlationId).toBe('corr-log-test');
  });

  it('an explicit correlationId in meta overrides the ambient one', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    runWithCorrelationId('ambient-id', () => {
      logger.warn('inside request', { correlationId: 'explicit-id' });
    });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.correlationId).toBe('explicit-id');
  });

  it('no correlationId field appears at all outside any context and none given', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.warn('no context here', {});
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed.correlationId).toBeUndefined();
  });
});
