/**
 * Live sandbox boot against a real database: the two synthetic practices,
 * their logins and claims are created through the real import pipeline, a
 * second boot changes nothing, and a call left open by a restart is resumed.
 * The full-database reset is not exercised here (it would wipe other suites'
 * fixtures); its staging-only guard is unit-tested in src/server/sandbox.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { piiVault } from '../src/pii-vault.js';
import { runWithRlsBypass } from '../src/server/db/rlsContext.js';
import { ensurePracticeClaims, ensureSandboxPractice, SANDBOX_PRACTICES } from '../src/server/sandbox/syntheticPractices.js';
import { resumeOpenCalls } from '../src/server/sandbox/bootSandbox.js';
import { CarrierSimulator } from '../src/server/sandbox/carrierSimulator.js';
import { loadCallScenarios, scenarioIdFromClaimNumber } from '../src/server/sandbox/scenarioRegistry.js';

let dbReady = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbReady = true;
} catch (e) {
  console.warn('[sandboxBoot.integration] DATABASE_URL unreachable, tests skipped:', (e as Error).message);
}

const savedPw = process.env.SANDBOX_LOGIN_PASSWORD;
const savedKey = process.env.PHI_ENCRYPTION_KEY;
const ids = SANDBOX_PRACTICES.map((p) => p.id);

async function cleanup(): Promise<void> {
  await runWithRlsBypass(async () => {
    const claims = await prisma.insuranceClaim.findMany({ where: { practiceId: { in: ids } }, select: { id: true } });
    await prisma.callAttempt.deleteMany({ where: { claimId: { in: claims.map((c) => c.id) } } });
    await prisma.callQueue.deleteMany({ where: { practiceId: { in: ids } } }).catch(() => undefined);
    await prisma.$executeRawUnsafe(`DELETE FROM pms_import_runs WHERE practice_id = ANY($1::text[])`, ids).catch(() => undefined);
    await prisma.insuranceClaim.deleteMany({ where: { practiceId: { in: ids } } });
    await prisma.user.deleteMany({ where: { practiceId: { in: ids } } });
    for (const id of ids) {
      for (let pass = 0; pass < 5; pass += 1) {
        const ok = await prisma.practice.delete({ where: { id } }).then(() => true, () => false);
        if (ok) break;
        const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
          SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name IN ('practice_id', 'practiceId')`;
        for (const { table_name: t } of tables) {
          const col = (await prisma.$queryRaw<Array<{ column_name: string }>>`
            SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${t} AND column_name IN ('practice_id', 'practiceId')`)[0]?.column_name;
          if (col) await prisma.$executeRawUnsafe(`DELETE FROM "${t.replace(/"/gu, '')}" WHERE "${col}" = $1`, id).catch(() => undefined);
        }
      }
    }
  });
}

describe.skipIf(!dbReady)('live sandbox boot (integration)', () => {
  beforeAll(async () => {
    process.env.SANDBOX_LOGIN_PASSWORD = 'sandbox-integration-placeholder';
    process.env.PHI_ENCRYPTION_KEY ||= '44'.repeat(32);
    piiVault.useStore(prisma);
    await cleanup();
  }, 120_000);

  afterAll(async () => {
    await cleanup();
    if (savedPw === undefined) delete process.env.SANDBOX_LOGIN_PASSWORD;
    else process.env.SANDBOX_LOGIN_PASSWORD = savedPw;
    if (savedKey === undefined) delete process.env.PHI_ENCRYPTION_KEY;
    else process.env.PHI_ENCRYPTION_KEY = savedKey;
  }, 120_000);

  it('creates both practices with logins and one tokenized claim per playable scenario', async () => {
    const expected = loadCallScenarios().length;
    for (const def of SANDBOX_PRACTICES) {
      const r = await runWithRlsBypass(() => ensureSandboxPractice(prisma, def));
      expect(r).toMatchObject({ created: true, claimsImported: expected, loginsUsable: true });
    }
    const practices = await runWithRlsBypass(() => prisma.practice.findMany({ where: { id: { in: ids } }, select: { id: true, billingTier: true, settings: true } }));
    const modes = Object.fromEntries(practices.map((p) => [p.id, (p.settings as { humanAssistedMode?: boolean }).humanAssistedMode]));
    expect(modes).toEqual({ [ids[0] ?? '']: true, [ids[1] ?? '']: false });
    expect(practices.every((p) => p.billingTier === 'scale')).toBe(true);

    const owner = await runWithRlsBypass(() => prisma.user.findUnique({ where: { email: SANDBOX_PRACTICES[0]?.ownerEmail ?? '' } }));
    expect(owner?.role).toBe('practice_owner');
    expect(await bcrypt.compare('sandbox-integration-placeholder', owner?.passwordHash ?? '')).toBe(true);

    const claims = await runWithRlsBypass(() => prisma.insuranceClaim.findMany({ where: { practiceId: ids[0] }, select: { claimNumber: true, patientToken: true } }));
    expect(claims).toHaveLength(expected);
    expect(claims.every((c) => scenarioIdFromClaimNumber(c.claimNumber) !== null)).toBe(true);
    expect(claims.every((c) => /^[0-9a-f-]{36}$/u.test(c.patientToken))).toBe(true);
    const sample = claims[0];
    const raw = JSON.stringify(await runWithRlsBypass(() => prisma.insuranceClaim.findFirst({ where: { claimNumber: sample?.claimNumber ?? '' } })));
    expect(raw).not.toMatch(/Fictional|Placeholder|Sampleton|Testwell|Mockford|Dummett|Synthwood|Exampleby/u);
  }, 120_000);

  it('changes nothing on a second boot', async () => {
    for (const def of SANDBOX_PRACTICES) {
      const r = await runWithRlsBypass(() => ensureSandboxPractice(prisma, def));
      expect(r).toMatchObject({ created: false, claimsImported: 0 });
    }
    expect(await runWithRlsBypass(() => prisma.insuranceClaim.count({ where: { practiceId: { in: ids } } }))).toBe(loadCallScenarios().length * 2);
  }, 60_000);

  it('finishes an interrupted claim import without duplicating or renumbering claims', async () => {
    const def = SANDBOX_PRACTICES[0];
    if (!def) throw new Error('missing practice');
    const before = await runWithRlsBypass(() => prisma.insuranceClaim.findMany({ where: { practiceId: def.id }, select: { claimNumber: true }, orderBy: { claimNumber: 'asc' } }));
    const victims = before.filter((_, i) => i % 3 === 0).map((c) => c.claimNumber);
    await runWithRlsBypass(async () => {
      const ids = (await prisma.insuranceClaim.findMany({ where: { practiceId: def.id, claimNumber: { in: victims } }, select: { id: true } })).map((c) => c.id);
      await prisma.callQueue.deleteMany({ where: { claimId: { in: ids } } });
      await prisma.insuranceClaim.deleteMany({ where: { id: { in: ids } } });
    });
    const restored = await runWithRlsBypass(() => ensurePracticeClaims(prisma, def));
    expect(restored).toBe(victims.length);
    const after = await runWithRlsBypass(() => prisma.insuranceClaim.findMany({ where: { practiceId: def.id }, select: { claimNumber: true }, orderBy: { claimNumber: 'asc' } }));
    expect(after.map((c) => c.claimNumber)).toEqual(before.map((c) => c.claimNumber));
    expect(await runWithRlsBypass(() => ensurePracticeClaims(prisma, def))).toBe(0);
  }, 120_000);

  it('resumes a sandbox call that was open when the process stopped', async () => {
    const claim = await runWithRlsBypass(() => prisma.insuranceClaim.findFirst({ where: { practiceId: ids[1] }, select: { id: true } }));
    if (!claim) throw new Error('no claim');
    await runWithRlsBypass(() => prisma.callAttempt.create({
      data: { claimId: claim.id, vapiCallId: 'sbx-resume-integration', initiatedAt: new Date(Date.now() - 60_000), liveState: 'on_hold' },
    }));
    const posted: string[] = [];
    const sim = new CarrierSimulator(async (body) => { posted.push(String((body.message as { type?: unknown }).type)); });
    const resumed = await runWithRlsBypass(() => resumeOpenCalls(prisma, sim));
    expect(resumed).toBeGreaterThanOrEqual(1);
    expect(sim.get('sbx-resume-integration')).toMatchObject({ mode: 'autonomous', practiceId: ids[1] });
    sim.stopAll();
  }, 60_000);
});
