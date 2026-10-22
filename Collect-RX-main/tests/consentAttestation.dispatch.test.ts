/**
 * Consent attestation gate against the real dispatch guard. validateDispatch()
 * is the single check both the scheduled queue and the manual trigger call, so
 * this suite asserts the gate there, not in either caller.
 *
 * DB-dependent. Like workflowDispatchSafetyRules, this file throws when the
 * database is unreachable instead of skipping, so a consent-gate regression
 * cannot pass CI by silence.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { createPracticeForTests } from './factories/practice.js';
import { validateDispatch } from '../src/carriers/adapter.js';
import {
  CONSENT_ATTESTATION_ENFORCED_ENV,
  CONSENT_ATTESTATION_TEXT_VERSION,
  createConsentAttestation,
  grantAgentPermission,
  revokeConsentAttestation,
} from '../src/server/compliance/consentAttestation.js';

try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
} catch (e) {
  throw new Error(
    'consentAttestation.dispatch requires a live DATABASE_URL. This consent gate sits on every ' +
      `carrier dial and must not silently skip. Original error: ${(e as Error).message}`,
  );
}

const TUESDAY_10AM_ET = new Date('2026-04-14T14:00:00Z');
const CONSENT_CODES = new Set([
  'CONSENT_ATTESTATION_MISSING',
  'CONSENT_ATTESTATION_REVOKED',
  'CONSENT_ATTESTATION_VERSION_STALE',
  'AGENT_PERMISSION_MISSING',
]);

describe('consent attestation gate in validateDispatch()', () => {
  const original = process.env[CONSENT_ATTESTATION_ENFORCED_ENV];
  let practiceId: string;

  beforeAll(async () => {
    const practice = await createPracticeForTests(prisma);
    practiceId = practice.id;
  });

  afterEach(() => {
    if (original === undefined) delete process.env[CONSENT_ATTESTATION_ENFORCED_ENV];
    else process.env[CONSENT_ATTESTATION_ENFORCED_ENV] = original;
  });

  afterAll(async () => {
    await prisma.practiceAgentPermission.deleteMany({ where: { practiceId } });
    await prisma.practiceConsentAttestation.deleteMany({ where: { practiceId } });
    await prisma.$disconnect();
  });

  function dispatch() {
    return validateDispatch(prisma, {
      practiceId,
      claimId: 'claim-consent-gate-synthetic',
      carrierId: 'sun_life',
      daysOutstanding: 45,
      attemptsSoFar: 0,
      claimStatus: 'PENDING',
      scheduledFor: TUESDAY_10AM_ET,
    });
  }

  it('blocks with a consent code when enforced and no attestation exists', async () => {
    process.env[CONSENT_ATTESTATION_ENFORCED_ENV] = '1';
    const guard = await dispatch();
    expect(guard.allowed).toBe(false);
    expect(CONSENT_CODES.has(guard.code ?? '')).toBe(true);
    expect(guard.code).toBe('CONSENT_ATTESTATION_MISSING');
  });

  it('does not block on consent when the flag is off, even with no attestation', async () => {
    delete process.env[CONSENT_ATTESTATION_ENFORCED_ENV];
    const guard = await dispatch();
    expect(CONSENT_CODES.has(guard.code ?? '')).toBe(false);
  });

  it('passes the consent gate once attested with an active agent permission', async () => {
    process.env[CONSENT_ATTESTATION_ENFORCED_ENV] = '1';
    await createConsentAttestation(prisma, {
      practiceId,
      textVersion: CONSENT_ATTESTATION_TEXT_VERSION,
      signerName: 'Synthetic Owner',
      signerRole: 'Practice Owner',
    });
    await grantAgentPermission(prisma, { practiceId });
    const guard = await dispatch();
    expect(CONSENT_CODES.has(guard.code ?? '')).toBe(false);
  });

  it('blocks again once the attestation is revoked', async () => {
    process.env[CONSENT_ATTESTATION_ENFORCED_ENV] = '1';
    await revokeConsentAttestation(prisma, { practiceId, reason: 'synthetic revocation test' });
    const guard = await dispatch();
    expect(guard.allowed).toBe(false);
    expect(guard.code).toBe('CONSENT_ATTESTATION_REVOKED');
  });
});
