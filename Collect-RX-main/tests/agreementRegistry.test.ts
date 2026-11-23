import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_KINDS,
  CURRENT_AGREEMENTS,
  checkAcceptedAgreements,
  type AcceptedAgreement,
} from '../src/server/agreements/agreementRegistry.js';

const full: AcceptedAgreement[] = CURRENT_AGREEMENTS.map((a) => ({ kind: a.kind, version: a.version }));

describe('agreement registry', () => {
  it('defines every agreement kind exactly once', () => {
    expect(CURRENT_AGREEMENTS.map((a) => a.kind).sort()).toEqual([...AGREEMENT_KINDS].sort());
  });

  it('accepts a full set at current versions', () => {
    const result = checkAcceptedAgreements(full);
    expect(result.ok).toBe(true);
  });

  it('rejects an empty submission and lists every kind as missing', () => {
    const result = checkAcceptedAgreements([]);
    expect(result).toEqual({ ok: false, missing: [...AGREEMENT_KINDS], stale: [] });
  });

  it('reports a single missing agreement', () => {
    const result = checkAcceptedAgreements(full.filter((a) => a.kind !== 'call_listening_consent'));
    expect(result).toEqual({ ok: false, missing: ['call_listening_consent'], stale: [] });
  });

  it('reports an out-of-date version as stale, not accepted', () => {
    const result = checkAcceptedAgreements(
      full.map((a) => (a.kind === 'terms_of_service' ? { ...a, version: '1999-01-01' } : a)),
    );
    expect(result).toEqual({ ok: false, missing: [], stale: ['terms_of_service'] });
  });

  it('ignores duplicates by letting the last entry for a kind decide', () => {
    const result = checkAcceptedAgreements([
      ...full,
      { kind: 'terms_of_service', version: '1999-01-01' },
    ]);
    expect(result.ok).toBe(false);
  });
});
