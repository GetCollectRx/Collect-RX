import { describe, it, expect, vi } from 'vitest';
import { importIndustryClaims, ImportRejectedError, type VaultLike } from './industryClaimImport';

const CSV = [
  'RO #,VIN,Insurance Company,Claim #,Customer Name,Date of Loss,Total Gross Estimate,Insurance Balance',
  'RO-1,1HGCM82633A004352,Intact,CL-1,Jane Doe,2026-09-01,$4200.00,$1200.00',
  'RO-2,2T1BR32E04C123456,Aviva,CL-2,John Roe,2026-09-02,$900.00,$0.00',
].join('\n');

function makeVault() {
  const live = new Map<string, unknown>();
  let n = 0;
  const vault: VaultLike = {
    tokenize: (phi) => {
      const t = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
      live.set(t, phi);
      return t;
    },
    expireToken: (t) => void live.delete(t),
  };
  return { vault, live };
}

type PrismaArg = Parameters<typeof importIndustryClaims>[0];

interface ExistingRow {
  claimNumber: string;
  industryType: string;
  carrierId: string;
}

interface UpsertArg {
  where: unknown;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

// Test double for the Prisma client; only the methods the importer calls are stubbed.
function makePrisma(existing: ExistingRow[] = [], failUpsert = false) {
  const upserts: UpsertArg[] = [];
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const tx = {
    insuranceClaim: {
      upsert: async (arg: UpsertArg) => {
        if (failUpsert) throw new Error('db down');
        upserts.push(arg);
      },
      update: async (arg: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(arg);
      },
    },
  };
  const stub = {
    insuranceClaim: { findMany: vi.fn(async () => existing) },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  };
  return { prisma: stub as unknown as PrismaArg, upserts, updates };
}

describe('importIndustryClaims', () => {
  it('tokenizes PHI, stores carrier other, skips zero balances, never stores raw VIN or name', async () => {
    const { vault } = makeVault();
    const { prisma, upserts } = makePrisma();
    const res = await importIndustryClaims(prisma, vault, { practiceId: 'p1', industryType: 'AUTO_COLLISION', csvText: CSV, dateFormat: 'MDY' });
    expect(res.imported).toBe(1);
    expect(res.skippedZeroBalance).toBe(1);
    const [first] = upserts;
    if (!first) throw new Error('expected one upsert');
    const data = first.create;
    expect(data.carrierId).toBe('other');
    expect(data.industryType).toBe('AUTO_COLLISION');
    expect(data.primaryReferenceId).toBe('RO-1');
    expect(data.secondaryReferenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(data)).not.toContain('1HGCM82633A004352');
    expect(JSON.stringify(data)).not.toContain('Jane');
    expect(data.patientToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('zeroes an existing claim the export now shows as paid, without minting a token for it', async () => {
    const { vault, live } = makeVault();
    const { prisma, upserts, updates } = makePrisma([{ claimNumber: 'CL-2', industryType: 'AUTO_COLLISION', carrierId: 'other' }]);
    const res = await importIndustryClaims(prisma, vault, { practiceId: 'p1', industryType: 'AUTO_COLLISION', csvText: CSV, dateFormat: 'MDY' });
    expect(res.zeroedExisting).toBe(1);
    expect(res.skippedZeroBalance).toBe(0);
    expect(updates).toEqual([
      { where: { practiceId_claimNumber: { practiceId: 'p1', claimNumber: 'CL-2' } }, data: { outstandingAmount: '0.00' } },
    ]);
    expect(upserts.map((u) => u.create.claimNumber)).toEqual(['CL-1']);
    // CL-1 mints a patient token and a VIN token; CL-2 mints none.
    expect(live.size).toBe(2);
  });

  it('rejects DENTAL', async () => {
    const { vault } = makeVault();
    const { prisma } = makePrisma();
    await expect(importIndustryClaims(prisma, vault, { practiceId: 'p1', industryType: 'DENTAL', csvText: CSV, dateFormat: 'MDY' })).rejects.toThrow(ImportRejectedError);
  });

  it('blocks the whole file when a claim number belongs to another vertical, minting no tokens', async () => {
    const { vault, live } = makeVault();
    const { prisma, upserts } = makePrisma([{ claimNumber: 'CL-1', industryType: 'DENTAL', carrierId: 'sun_life' }]);
    await expect(importIndustryClaims(prisma, vault, { practiceId: 'p1', industryType: 'AUTO_COLLISION', csvText: CSV, dateFormat: 'MDY' })).rejects.toMatchObject({ status: 409 });
    expect(upserts).toHaveLength(0);
    expect(live.size).toBe(0);
  });

  it('expires every minted token when the transaction fails', async () => {
    const { vault, live } = makeVault();
    const { prisma } = makePrisma([], true);
    await expect(importIndustryClaims(prisma, vault, { practiceId: 'p1', industryType: 'AUTO_COLLISION', csvText: CSV, dateFormat: 'MDY' })).rejects.toThrow('db down');
    expect(live.size).toBe(0);
  });
  it('rejects a missing or invalid dateFormat before minting any token', async () => {
    const { vault, live } = makeVault();
    const { prisma, upserts } = makePrisma();
    for (const bad of [undefined, '', 'dmy', 'XYZ']) {
      await expect(
        importIndustryClaims(prisma, vault, { practiceId: 'p1', industryType: 'AUTO_COLLISION', csvText: CSV, dateFormat: bad as never }),
      ).rejects.toThrow(ImportRejectedError);
    }
    expect(live.size).toBe(0);
    expect(upserts.length).toBe(0);
  });
});
