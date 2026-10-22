import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const auditSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/server/audit/auditLog.js', () => ({ appendRequiredAuditLog: auditSpy }));

import {
  AGENT_PERMISSION_PURPOSE,
  CONSENT_ATTESTATION_ENFORCED_ENV,
  CONSENT_ATTESTATION_TEXT_VERSION,
  ConsentAttestationError,
  checkConsentDispatchGate,
  createConsentAttestation,
  evaluateConsentGate,
  grantAgentPermission,
  revokeAgentPermission,
  revokeConsentAttestation,
} from '../src/server/compliance/consentAttestation.js';
import { settleBlockedCandidate } from '../src/server/frontDesk/queueEngine.js';

type Row = Record<string, unknown> & { id: string; practiceId: string };

const PRACTICE_A = 'practice-synthetic-a';
const PRACTICE_B = 'practice-synthetic-b';
const T0 = new Date('2026-10-01T12:00:00Z');
const T1 = new Date('2026-10-02T12:00:00Z');

interface FakeState {
  attestations: Row[];
  permissions: Row[];
}

function matchesWhere(where: Record<string, unknown>, row: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === null) return row[key] === null || row[key] === undefined;
    return row[key] === expected;
  });
}

function fakePrisma(state: FakeState) {
  const practiceConsentAttestation = {
    findFirst: vi.fn(async (args: { where: Record<string, unknown> }) => {
      const rows = state.attestations
        .filter((row) => matchesWhere(args.where, row))
        .sort((a, b) => (b.attestedAt as Date).getTime() - (a.attestedAt as Date).getTime());
      return rows[0] ?? null;
    }),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const row: Row = {
        id: `att-${state.attestations.length + 1}`,
        attestedAt: T1,
        revokedAt: null,
        revokedByUserId: null,
        revocationReason: null,
        supersededAt: null,
        ...args.data,
      } as Row;
      state.attestations.push(row);
      return row;
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.attestations.find((r) => r.id === args.where.id);
      if (!row) throw new Error('row not found');
      Object.assign(row, args.data);
      return row;
    }),
  };
  const practiceAgentPermission = {
    findUnique: vi.fn(async (args: { where: { practiceId_purpose: { practiceId: string; purpose: string } } }) => {
      const { practiceId, purpose } = args.where.practiceId_purpose;
      return state.permissions.find((p) => p.practiceId === practiceId && p.purpose === purpose) ?? null;
    }),
    upsert: vi.fn(async (args: {
      where: { practiceId_purpose: { practiceId: string; purpose: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const { practiceId, purpose } = args.where.practiceId_purpose;
      const existing = state.permissions.find((p) => p.practiceId === practiceId && p.purpose === purpose);
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const row = { id: `perm-${state.permissions.length + 1}`, revokedAt: null, grantedAt: T1, ...args.create } as Row;
      state.permissions.push(row);
      return row;
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.permissions.find((p) => p.id === args.where.id);
      if (!row) throw new Error('permission not found');
      Object.assign(row, args.data);
      return row;
    }),
  };
  const callQueue = { update: vi.fn(async () => ({})) };
  return {
    prisma: {
      practiceConsentAttestation,
      practiceAgentPermission,
      callQueue,
    } as unknown as PrismaClient,
    spies: { practiceConsentAttestation, practiceAgentPermission, callQueue },
  };
}

function validAttestation(overrides: Partial<Row> = {}): Row {
  return {
    id: 'att-valid',
    practiceId: PRACTICE_A,
    textVersion: CONSENT_ATTESTATION_TEXT_VERSION,
    signerName: 'Synthetic Signer',
    signerRole: 'Practice Owner',
    attestedAt: T0,
    revokedAt: null,
    supersededAt: null,
    ...overrides,
  };
}

function activePermission(overrides: Partial<Row> = {}): Row {
  return {
    id: 'perm-valid',
    practiceId: PRACTICE_A,
    purpose: AGENT_PERMISSION_PURPOSE,
    secondaryUseAllowed: false,
    revokedAt: null,
    grantedAt: T0,
    ...overrides,
  };
}

describe('evaluateConsentGate', () => {
  it('blocks when no attestation exists', async () => {
    const { prisma } = fakePrisma({ attestations: [], permissions: [] });
    expect(await evaluateConsentGate(prisma, PRACTICE_A)).toMatchObject({
      allowed: false,
      code: 'CONSENT_ATTESTATION_MISSING',
    });
  });

  it('blocks when the latest attestation was revoked', async () => {
    const { prisma } = fakePrisma({
      attestations: [validAttestation({ revokedAt: T1 })],
      permissions: [activePermission()],
    });
    expect(await evaluateConsentGate(prisma, PRACTICE_A)).toMatchObject({
      allowed: false,
      code: 'CONSENT_ATTESTATION_REVOKED',
    });
  });

  it('does not let an older valid attestation override a newer revocation', async () => {
    const { prisma } = fakePrisma({
      attestations: [
        validAttestation({ id: 'att-old', attestedAt: T0 }),
        validAttestation({ id: 'att-new', attestedAt: T1, revokedAt: T1 }),
      ],
      permissions: [activePermission()],
    });
    expect(await evaluateConsentGate(prisma, PRACTICE_A)).toMatchObject({
      code: 'CONSENT_ATTESTATION_REVOKED',
    });
  });

  it('blocks when the attestation text version is stale', async () => {
    const { prisma } = fakePrisma({
      attestations: [validAttestation({ textVersion: 'PENDING_COUNSEL-v-old' })],
      permissions: [activePermission()],
    });
    expect(await evaluateConsentGate(prisma, PRACTICE_A)).toMatchObject({
      code: 'CONSENT_ATTESTATION_VERSION_STALE',
    });
  });

  it('blocks when the agent permission is missing', async () => {
    const { prisma } = fakePrisma({ attestations: [validAttestation()], permissions: [] });
    expect(await evaluateConsentGate(prisma, PRACTICE_A)).toMatchObject({
      code: 'AGENT_PERMISSION_MISSING',
    });
  });

  it('blocks when the agent permission was revoked', async () => {
    const { prisma } = fakePrisma({
      attestations: [validAttestation()],
      permissions: [activePermission({ revokedAt: T1 })],
    });
    expect(await evaluateConsentGate(prisma, PRACTICE_A)).toMatchObject({
      code: 'AGENT_PERMISSION_MISSING',
    });
  });

  it('allows a valid attestation with an active permission', async () => {
    const { prisma } = fakePrisma({
      attestations: [validAttestation()],
      permissions: [activePermission()],
    });
    expect(await evaluateConsentGate(prisma, PRACTICE_A)).toEqual({ allowed: true });
  });

  it('scopes decisions to the practice: practice B has nothing even when A is valid', async () => {
    const { prisma } = fakePrisma({
      attestations: [validAttestation()],
      permissions: [activePermission()],
    });
    expect(await evaluateConsentGate(prisma, PRACTICE_B)).toMatchObject({
      code: 'CONSENT_ATTESTATION_MISSING',
    });
  });
});

describe('checkConsentDispatchGate and the enforcement flag', () => {
  const original = process.env[CONSENT_ATTESTATION_ENFORCED_ENV];

  beforeEach(() => {
    auditSpy.mockClear();
    delete process.env[CONSENT_ATTESTATION_ENFORCED_ENV];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[CONSENT_ATTESTATION_ENFORCED_ENV];
    else process.env[CONSENT_ATTESTATION_ENFORCED_ENV] = original;
  });

  it('is off by default: allows without querying, so dispatch is unchanged', async () => {
    const { prisma, spies } = fakePrisma({ attestations: [], permissions: [] });
    expect(await checkConsentDispatchGate(prisma, PRACTICE_A)).toEqual({ allowed: true });
    expect(spies.practiceConsentAttestation.findFirst).not.toHaveBeenCalled();
  });

  it('enforces when the flag is 1 or true, and blocks with a logged code', async () => {
    const { prisma } = fakePrisma({ attestations: [], permissions: [] });
    for (const value of ['1', 'true']) {
      process.env[CONSENT_ATTESTATION_ENFORCED_ENV] = value;
      expect(await checkConsentDispatchGate(prisma, PRACTICE_A)).toMatchObject({
        allowed: false,
        code: 'CONSENT_ATTESTATION_MISSING',
      });
    }
  });

  it('treats any other flag value as off', async () => {
    const { prisma } = fakePrisma({ attestations: [], permissions: [] });
    process.env[CONSENT_ATTESTATION_ENFORCED_ENV] = '0';
    expect(await checkConsentDispatchGate(prisma, PRACTICE_A)).toEqual({ allowed: true });
  });
});

describe('attestation lifecycle and audit events', () => {
  beforeEach(() => {
    auditSpy.mockClear();
  });

  it('rejects an attestation for a text version other than the current one', async () => {
    const { prisma, spies } = fakePrisma({ attestations: [], permissions: [] });
    await expect(
      createConsentAttestation(prisma, {
        practiceId: PRACTICE_A,
        textVersion: 'not-current',
        signerName: 'Synthetic Signer',
        signerRole: 'Practice Owner',
      }),
    ).rejects.toMatchObject({ code: 'STALE_TEXT_VERSION' });
    expect(spies.practiceConsentAttestation.create).not.toHaveBeenCalled();
  });

  it('rejects a blank signer name or role', async () => {
    const { prisma } = fakePrisma({ attestations: [], permissions: [] });
    await expect(
      createConsentAttestation(prisma, {
        practiceId: PRACTICE_A,
        textVersion: CONSENT_ATTESTATION_TEXT_VERSION,
        signerName: '   ',
        signerRole: 'Practice Owner',
      }),
    ).rejects.toBeInstanceOf(ConsentAttestationError);
  });

  it('writes a created audit event without the signer name in its details', async () => {
    const { prisma } = fakePrisma({ attestations: [], permissions: [] });
    await createConsentAttestation(prisma, {
      practiceId: PRACTICE_A,
      textVersion: CONSENT_ATTESTATION_TEXT_VERSION,
      signerName: 'Synthetic Signer',
      signerRole: 'Practice Owner',
      userId: 'user-synthetic',
    });
    expect(auditSpy).toHaveBeenCalledTimes(1);
    const [, input] = auditSpy.mock.calls[0] as unknown as [unknown, { action: string; details: Record<string, unknown> }];
    expect(input.action).toBe('consent_attestation.created');
    expect(JSON.stringify(input.details)).not.toContain('Synthetic Signer');
  });

  it('refuses a second active attestation for the same version', async () => {
    const { prisma } = fakePrisma({ attestations: [validAttestation()], permissions: [] });
    await expect(
      createConsentAttestation(prisma, {
        practiceId: PRACTICE_A,
        textVersion: CONSENT_ATTESTATION_TEXT_VERSION,
        signerName: 'Synthetic Signer',
        signerRole: 'Practice Owner',
      }),
    ).rejects.toMatchObject({ code: 'ALREADY_ATTESTED' });
  });

  it('supersedes an older version and writes a version_changed audit event', async () => {
    const state = {
      attestations: [validAttestation({ id: 'att-old', textVersion: 'PENDING_COUNSEL-v-old' })],
      permissions: [],
    };
    const { prisma } = fakePrisma(state);
    await createConsentAttestation(prisma, {
      practiceId: PRACTICE_A,
      textVersion: CONSENT_ATTESTATION_TEXT_VERSION,
      signerName: 'Synthetic Signer',
      signerRole: 'Practice Owner',
    });
    expect(state.attestations.find((a) => a.id === 'att-old')?.supersededAt).toBeInstanceOf(Date);
    const actions = auditSpy.mock.calls.map((c) => (c as unknown as [unknown, { action: string }])[1].action);
    expect(actions).toEqual(['consent_attestation.version_changed', 'consent_attestation.created']);
  });

  it('revokes the active attestation and writes a revoked audit event', async () => {
    const state = { attestations: [validAttestation()], permissions: [] };
    const { prisma } = fakePrisma(state);
    await revokeConsentAttestation(prisma, { practiceId: PRACTICE_A, userId: 'user-synthetic', reason: 'withdrawn' });
    expect(state.attestations[0]?.revokedAt).toBeInstanceOf(Date);
    const [, input] = auditSpy.mock.calls[0] as unknown as [unknown, { action: string }];
    expect(input.action).toBe('consent_attestation.revoked');
  });

  it('reports not found when there is nothing active to revoke', async () => {
    const { prisma } = fakePrisma({ attestations: [], permissions: [] });
    await expect(revokeConsentAttestation(prisma, { practiceId: PRACTICE_A, reason: '' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('grants the agent permission with secondary use fixed to false', async () => {
    const state = { attestations: [], permissions: [] as Row[] };
    const { prisma, spies } = fakePrisma(state);
    await grantAgentPermission(prisma, { practiceId: PRACTICE_A, userId: 'user-synthetic' });
    const upsertArgs = spies.practiceAgentPermission.upsert.mock.calls[0] as unknown as [
      { create: { secondaryUseAllowed: boolean } },
    ];
    expect(upsertArgs[0].create.secondaryUseAllowed).toBe(false);
    const [, input] = auditSpy.mock.calls[0] as unknown as [unknown, { action: string }];
    expect(input.action).toBe('agent_permission.granted');
  });

  it('revokes the agent permission and writes an audit event', async () => {
    const state = { attestations: [], permissions: [activePermission()] };
    const { prisma } = fakePrisma(state);
    await revokeAgentPermission(prisma, { practiceId: PRACTICE_A });
    expect(state.permissions[0]?.revokedAt).toBeInstanceOf(Date);
    const [, input] = auditSpy.mock.calls[0] as unknown as [unknown, { action: string }];
    expect(input.action).toBe('agent_permission.revoked');
  });
});

describe('queue engine settlement of consent codes', () => {
  const entry = {
    id: 'queue-synthetic-1',
    practiceId: PRACTICE_A,
    claimId: 'claim-synthetic-1',
    attempts: 0,
    claim: { claimNumber: 'CLM-SYNTHETIC-1', carrierId: 'sun_life' as const, outstandingAmount: 100 },
  };

  it.each([
    'CONSENT_ATTESTATION_MISSING',
    'CONSENT_ATTESTATION_REVOKED',
    'CONSENT_ATTESTATION_VERSION_STALE',
    'AGENT_PERMISSION_MISSING',
  ] as const)('defers the entry with code %s and the reason as next action', async (code) => {
    const { prisma, spies } = fakePrisma({ attestations: [], permissions: [] });
    const disposition = await settleBlockedCandidate(prisma, entry, code, 'Practice owner must record consent.');
    expect(disposition).toBe('skip');
    expect(spies.callQueue.update).toHaveBeenCalledWith({
      where: { id: entry.id },
      data: expect.objectContaining({
        dispatchDeferralCode: code,
        dispatchDeferralNextAction: 'Practice owner must record consent.',
      }),
    });
  });
});
