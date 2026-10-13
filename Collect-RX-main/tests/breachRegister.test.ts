import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const auditSpy = vi.hoisted(() => vi.fn(async () => undefined));
const phiSpy = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../src/server/audit/auditLog.js', () => ({
  appendRequiredAuditLog: auditSpy,
  appendPhiAccessEvent: phiSpy,
}));

import {
  BREACH_PACKET_KEYS,
  BreachRegisterError,
  annualBreachCounts,
  buildBreachPacket,
  computeBreachRetainUntil,
  createBreachEntry,
  parseBreachFields,
  updateBreachEntry,
} from '../src/server/compliance/breachRegister.js';

const PRACTICE_ID = 'practice-synthetic-breach';
const TOKEN_A = '3f9c2b7e-1d4a-4e8b-9a6c-5b2d7e8f0a11';
const TOKEN_B = '8a1e6d4c-2b3f-4c5d-8e9f-0a1b2c3d4e5f';

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    category: 'THEFT',
    province: 'ON',
    circumstances: 'A staff laptop was taken from a locked vehicle.',
    periodStart: '2026-09-01T00:00:00Z',
    periodEnd: '2026-09-01T06:00:00Z',
    discoveredAt: '2026-09-02T09:00:00Z',
    dataElements: 'appointment and claim status categories, no clinical notes',
    individualsCount: 14,
    affectedTokens: [TOKEN_A, TOKEN_B],
    stepsToReduceHarm: 'Device remote-wiped. Access keys rotated. Vendor notified.',
    notificationSteps: 'Custodian notified same day. Individual notices handled by the custodian.',
    contactRole: 'Practice privacy contact',
    vendorsInvolved: 'Hosting provider (no data copied)',
    ...overrides,
  };
}

interface StoredRow extends Record<string, unknown> {
  id: string;
  practiceId: string;
  discoveredAt: Date;
  recordedAt: Date;
  closedAt: Date | null;
  category: string;
}

function fakePrisma(initial: StoredRow[] = []) {
  const rows = [...initial];
  const breachRegisterEntry = {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const row = { id: `breach-${rows.length + 1}`, ...args.data } as unknown as StoredRow;
      rows.push(row);
      return { id: row.id, retainUntil: row.retainUntil as Date };
    }),
    findFirst: vi.fn(async (args: { where: { id: string; practiceId: string } }) =>
      rows.find((r) => r.id === args.where.id && r.practiceId === args.where.practiceId) ?? null,
    ),
    findMany: vi.fn(async (args: { where: { practiceId: string; discoveredAt?: { gte: Date; lt: Date } } }) =>
      rows.filter((r) => {
        if (r.practiceId !== args.where.practiceId) return false;
        const range = args.where.discoveredAt;
        if (!range) return true;
        return r.discoveredAt >= range.gte && r.discoveredAt < range.lt;
      }),
    ),
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r.id === args.where.id);
      if (!row) throw new Error('row not found');
      Object.assign(row, args.data);
      return row;
    }),
  };
  return {
    prisma: { breachRegisterEntry } as unknown as PrismaClient,
    spies: breachRegisterEntry,
    rows,
  };
}

describe('breach fields: required elements (SOR/2018-64 s. 2(1)(a) to (g))', () => {
  it('accepts a complete, identifier-free entry', () => {
    const fields = parseBreachFields(validBody());
    expect(fields.individualsCount).toBe(14);
    expect(fields.affectedTokens).toEqual([TOKEN_A, TOKEN_B]);
  });

  it.each([
    ['circumstances'],
    ['periodStart'],
    ['discoveredAt'],
    ['dataElements'],
    ['individualsCount'],
    ['stepsToReduceHarm'],
    ['notificationSteps'],
    ['contactRole'],
  ])('rejects an entry missing %s', (field) => {
    const body = validBody();
    delete body[field];
    expect(() => parseBreachFields(body)).toThrow(BreachRegisterError);
    try {
      parseBreachFields(body);
    } catch (error) {
      expect((error as BreachRegisterError).field).toBe(field);
    }
  });

  it('rejects an unknown category and province', () => {
    expect(() => parseBreachFields(validBody({ category: 'MADE_UP' }))).toThrow(/category/);
    expect(() => parseBreachFields(validBody({ province: 'XX' }))).toThrow(/province/);
  });

  it('rejects a negative or fractional individual count', () => {
    expect(() => parseBreachFields(validBody({ individualsCount: -1 }))).toThrow(/individualsCount/);
    expect(() => parseBreachFields(validBody({ individualsCount: 2.5 }))).toThrow(/individualsCount/);
  });

  it('rejects a period that ends before it starts', () => {
    expect(() =>
      parseBreachFields(validBody({ periodStart: '2026-09-02T00:00:00Z', periodEnd: '2026-09-01T00:00:00Z' })),
    ).toThrow(/periodEnd/);
  });

  it('accepts only patient token UUIDs in affectedTokens', () => {
    expect(() => parseBreachFields(validBody({ affectedTokens: ['Jordan Alvarez'] }))).toThrow(/affectedTokens/);
  });
});

describe('free-text identifier scan at write time', () => {
  it.each([
    ['a person name', 'Staff member Jordan Alvarez lost a laptop.', 'PERSON_NAME_PATTERN'],
    ['a phone number', 'Call 416-555-0199 about the device.', 'PHONE'],
    ['a date', 'Records dated 2026-09-01 were on the device.', 'DATE'],
    ['a long number', 'Reference 48217702 was on the form.', 'DIGIT_RUN'],
  ])('rejects %s in circumstances with a reason code and no echoed text', (_label, text, reasonCode) => {
    try {
      parseBreachFields(validBody({ circumstances: text }));
      expect.fail('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BreachRegisterError);
      const err = error as BreachRegisterError;
      expect(err.code).toBe('FREE_TEXT_IDENTIFIER');
      expect(err.field).toBe('circumstances');
      expect(err.reasonCode).toBe(reasonCode);
      expect(err.message).not.toContain('Alvarez');
      expect(err.message).not.toContain('416');
    }
  });
});

describe('retention floor', () => {
  it('is at least 24 months after recording when the incident is open', () => {
    const recorded = new Date('2026-01-15T12:00:00Z');
    expect(computeBreachRetainUntil(recorded, null).toISOString()).toBe('2028-01-15T12:00:00.000Z');
  });

  it('extends to 24 months after closure when closure is later', () => {
    const recorded = new Date('2026-01-15T12:00:00Z');
    const closed = new Date('2026-06-01T00:00:00Z');
    expect(computeBreachRetainUntil(recorded, closed).toISOString()).toBe('2028-06-01T00:00:00.000Z');
  });

  it('the retention job never references the breach register', () => {
    const source = readFileSync(new URL('../src/server/jobs/dataRetentionJob.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/breachRegister|breach_register|phipaBreachNotification|PHIPABreachNotification/);
  });
});

describe('create, update and audit', () => {
  beforeEach(() => {
    auditSpy.mockClear();
    phiSpy.mockClear();
  });

  it('creates an entry, sets retainUntil, and audits without free text', async () => {
    const { prisma, spies } = fakePrisma();
    await createBreachEntry(prisma, { practiceId: PRACTICE_ID, body: validBody(), userId: 'user-synthetic' });
    const data = spies.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data.practiceId).toBe(PRACTICE_ID);
    expect(data.retainUntil).toBeInstanceOf(Date);
    const [, input] = auditSpy.mock.calls[0] as unknown as [unknown, { action: string; details: unknown }];
    expect(input.action).toBe('breach_register.created');
    expect(JSON.stringify(input.details)).not.toContain('laptop');
  });

  it('update recomputes retainUntil when closure is recorded and audits changed field names only', async () => {
    const recorded = new Date('2026-09-02T10:00:00Z');
    const { prisma, rows } = fakePrisma([
      {
        id: 'breach-existing',
        practiceId: PRACTICE_ID,
        discoveredAt: new Date('2026-09-02T09:00:00Z'),
        recordedAt: recorded,
        closedAt: null,
        category: 'THEFT',
        ...parseBreachFields(validBody()),
        retainUntil: computeBreachRetainUntil(recorded, null),
        recordedAt: recorded,
      } as unknown as StoredRow,
    ]);
    await updateBreachEntry(prisma, {
      practiceId: PRACTICE_ID,
      id: 'breach-existing',
      patch: { closedAt: '2026-11-01T00:00:00Z', regulatorNotifiedAt: '2026-10-01T00:00:00Z' },
      userId: 'user-synthetic',
    });
    expect((rows[0]?.retainUntil as Date).toISOString()).toBe('2028-11-01T00:00:00.000Z');
    const [, input] = auditSpy.mock.calls[0] as unknown as [unknown, { action: string; details: { changedFields: string[] } }];
    expect(input.action).toBe('breach_register.updated');
    expect(input.details.changedFields.sort()).toEqual(['closedAt', 'regulatorNotifiedAt']);
  });

  it('update on another practice entry is NOT_FOUND', async () => {
    const { prisma } = fakePrisma([]);
    await expect(
      updateBreachEntry(prisma, { practiceId: PRACTICE_ID, id: 'missing', patch: {} }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('custodian packet', () => {
  beforeEach(() => {
    auditSpy.mockClear();
    phiSpy.mockClear();
  });

  it('contains exactly the allowlisted keys and no other columns', async () => {
    const recorded = new Date('2026-09-02T10:00:00Z');
    const { prisma } = fakePrisma([
      {
        id: 'breach-packet',
        practiceId: PRACTICE_ID,
        discoveredAt: new Date('2026-09-02T09:00:00Z'),
        recordedAt: recorded,
        closedAt: null,
        category: 'THEFT',
        ...parseBreachFields(validBody()),
        retainUntil: computeBreachRetainUntil(recorded, null),
        userIdPlaceholder: 'must-not-appear',
      } as unknown as StoredRow,
    ]);
    const packet = await buildBreachPacket(prisma, { practiceId: PRACTICE_ID, id: 'breach-packet', userId: 'user-synthetic' });
    expect(Object.keys(packet).sort()).toEqual([...BREACH_PACKET_KEYS].sort());
    expect(JSON.stringify(packet)).not.toContain('must-not-appear');
    expect(packet.affectedTokens).toEqual([TOKEN_A, TOKEN_B]);
  });

  it('free-text fields in the packet carry no identifier patterns', async () => {
    const recorded = new Date('2026-09-02T10:00:00Z');
    const { prisma } = fakePrisma([
      {
        id: 'breach-clean',
        practiceId: PRACTICE_ID,
        discoveredAt: new Date('2026-09-02T09:00:00Z'),
        recordedAt: recorded,
        closedAt: null,
        category: 'LOSS',
        ...parseBreachFields(validBody({ category: 'LOSS' })),
        retainUntil: computeBreachRetainUntil(recorded, null),
      } as unknown as StoredRow,
    ]);
    const packet = await buildBreachPacket(prisma, { practiceId: PRACTICE_ID, id: 'breach-clean' });
    const freeText = [packet.circumstances, packet.dataElements, packet.stepsToReduceHarm, packet.notificationSteps, packet.contactRole, packet.vendorsInvolved];
    for (const text of freeText) {
      expect(String(text)).not.toMatch(/\d{6,}/);
      expect(String(text)).not.toMatch(/\d{3}-\d{3}-\d{4}/);
    }
  });

  it('records a PHI access event and an audit row when a packet is generated', async () => {
    const recorded = new Date('2026-09-02T10:00:00Z');
    const { prisma } = fakePrisma([
      {
        id: 'breach-audit',
        practiceId: PRACTICE_ID,
        discoveredAt: new Date('2026-09-02T09:00:00Z'),
        recordedAt: recorded,
        closedAt: null,
        category: 'THEFT',
        ...parseBreachFields(validBody()),
        retainUntil: computeBreachRetainUntil(recorded, null),
      } as unknown as StoredRow,
    ]);
    await buildBreachPacket(prisma, { practiceId: PRACTICE_ID, id: 'breach-audit', userId: 'user-synthetic' });
    expect(phiSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: 'breach_packet_generate', recordId: 'breach-audit', required: true }),
    );
    const [, input] = auditSpy.mock.calls[0] as unknown as [unknown, { action: string }];
    expect(input.action).toBe('breach_register.packet_generated');
  });
});

describe('annual counts (O. Reg. 329/04 s. 6.4)', () => {
  it('counts the four mapped categories for the year and reports the rest as unclassified', async () => {
    const at = (iso: string) => new Date(iso);
    const base = {
      practiceId: PRACTICE_ID,
      recordedAt: at('2026-01-01T00:00:00Z'),
      closedAt: null,
      retainUntil: at('2028-01-01T00:00:00Z'),
    };
    const { prisma } = fakePrisma([
      { ...base, id: 'a', category: 'LOSS', discoveredAt: at('2026-02-01T00:00:00Z') },
      { ...base, id: 'b', category: 'THEFT', discoveredAt: at('2026-03-01T00:00:00Z') },
      { ...base, id: 'c', category: 'UNAUTHORIZED_USE', discoveredAt: at('2026-04-01T00:00:00Z') },
      { ...base, id: 'd', category: 'UNAUTHORIZED_DISCLOSURE', discoveredAt: at('2026-05-01T00:00:00Z') },
      { ...base, id: 'e', category: 'UNAUTHORIZED_ACCESS', discoveredAt: at('2026-06-01T00:00:00Z') },
      { ...base, id: 'f', category: 'LOSS', discoveredAt: at('2025-12-31T00:00:00Z') },
    ] as unknown as StoredRow[]);
    const result = await annualBreachCounts(prisma, PRACTICE_ID, 2026);
    expect(result.counts).toEqual({ loss: 1, theft: 1, unauthorized_use: 1, unauthorized_disclosure: 1 });
    expect(result.unclassified).toBe(1);
    expect(result.total).toBe(5);
    expect(result.mappingStatus).toMatch(/PENDING_COUNSEL/);
  });

  it('rejects an invalid year', async () => {
    const { prisma } = fakePrisma([]);
    await expect(annualBreachCounts(prisma, PRACTICE_ID, 1999)).rejects.toMatchObject({ code: 'INVALID_FIELD' });
  });
});
