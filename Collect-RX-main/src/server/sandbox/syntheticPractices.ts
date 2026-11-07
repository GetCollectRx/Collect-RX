/**
 * The two sandbox practices: one in Hold Sentinel mode, one autonomous. Each
 * gets an owner and a front-desk login and one synthetic claim per playable
 * registry scenario, imported through the real PMS import pipeline so claims
 * are tokenized, aged and queued exactly as a practice's own import would be.
 *
 * Every name, date and identifier here is invented. Phone numbers use the
 * fictional 555-01xx range.
 */
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { defaultPracticeSettings } from '../services/practiceSettingsService.js';
import { parseSimpleCsv } from '../csv/parseSimple.js';
import { runPmsImportPipeline } from '../pms/pmsImportPipeline.js';
import { carrierIdForScenario, loadCallScenarios, sandboxClaimNumber, type CallScenario } from './scenarioRegistry.js';
import { seeded } from './callPlan.js';

export interface SandboxPracticeDef {
  id: string;
  key: 'hs' | 'auto';
  name: string;
  humanAssistedMode: boolean;
  ownerEmail: string;
  frontDeskEmail: string;
}

export const SANDBOX_PRACTICES: readonly SandboxPracticeDef[] = [
  {
    id: '5a0d0000-0000-4000-8000-0000000000a1',
    key: 'hs',
    name: 'SYNTHETIC Sandbox Dental (Hold Sentinel)',
    humanAssistedMode: true,
    ownerEmail: 'owner.holdsentinel@sandbox.collectrx.test',
    frontDeskEmail: 'frontdesk.holdsentinel@sandbox.collectrx.test',
  },
  {
    id: '5a0d0000-0000-4000-8000-0000000000a2',
    key: 'auto',
    name: 'SYNTHETIC Sandbox Dental (Autonomous)',
    humanAssistedMode: false,
    ownerEmail: 'owner.autonomous@sandbox.collectrx.test',
    frontDeskEmail: 'frontdesk.autonomous@sandbox.collectrx.test',
  },
];

/** Fictional staff line the Hold Sentinel handoff transfers to. */
export const SANDBOX_STAFF_PHONE = '+16135550150';

const CSV_CARRIER_NAME: Record<string, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc: 'RBC',
  telus_adjudicare: 'TELUS AdjudiCare',
};
const CARRIER_ROTATION = Object.keys(CSV_CARRIER_NAME);

const FIRST = ['Avery', 'Rowan', 'Quinn', 'Sage', 'Emerson', 'Harper', 'Reese', 'Morgan', 'Parker', 'Skyler', 'Dakota', 'Finley'];
const LAST = ['Fictional', 'Placeholder', 'Sampleton', 'Testwell', 'Mockford', 'Dummett', 'Synthwood', 'Exampleby'];
const CDT = ['D0120', 'D1110', 'D2330', 'D2740', 'D4341', 'D7140', 'D0274', 'D2391'];

function csvField(v: string): string {
  return /[",\n]/u.test(v) ? `"${v.replace(/"/gu, '""')}"` : v;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Days outstanding for a scenario: dispatchable (32 to 88) for call scenarios. */
function ageFor(seed: string): number {
  return seeded(seed, 'age', 32, 88);
}

export function buildSandboxCsv(practice: SandboxPracticeDef, scenarios: CallScenario[]): string {
  const header = [
    'claim_number', 'patient_first_name', 'patient_last_name', 'patient_dob', 'subscriber_id',
    'group_policy_number', 'insurance_carrier', 'procedure_code', 'treatment_codes', 'treatment_date',
    'submitted_date', 'amount_billed', 'amount_outstanding', 'expected_amount', 'days_outstanding',
  ];
  const rows = scenarios.map((s, i) => {
    const seed = `${practice.key}-${s.id}`;
    const carrier = carrierIdForScenario(s) ?? CARRIER_ROTATION[i % CARRIER_ROTATION.length] ?? 'sun_life';
    const age = ageFor(seed);
    const billed = seeded(seed, 'amount', 120, 2400);
    const code = CDT[seeded(seed, 'cdt', 0, CDT.length - 1)] ?? 'D1110';
    const dobYear = seeded(seed, 'dob-y', 1950, 2015);
    const dob = `${dobYear}-${String(seeded(seed, 'dob-m', 1, 12)).padStart(2, '0')}-${String(seeded(seed, 'dob-d', 1, 28)).padStart(2, '0')}`;
    return [
      sandboxClaimNumber(s.id, i + 1),
      FIRST[seeded(seed, 'first', 0, FIRST.length - 1)] ?? 'Avery',
      LAST[seeded(seed, 'last', 0, LAST.length - 1)] ?? 'Fictional',
      dob,
      `SBXM${String(seeded(seed, 'member', 100000, 999999))}`,
      `SBXG${String(seeded(seed, 'group', 1000, 9999))}`,
      CSV_CARRIER_NAME[carrier] ?? 'Sun Life',
      code,
      code,
      isoDaysAgo(age + 3),
      isoDaysAgo(age),
      `${billed}.00`,
      `${billed}.00`,
      `${billed}.00`,
      String(age),
    ].map(csvField).join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

export async function passwordHashForSandbox(): Promise<{ hash: string; usable: boolean }> {
  const pw = process.env.SANDBOX_LOGIN_PASSWORD?.trim();
  if (pw && pw.length >= 12) return { hash: await bcrypt.hash(pw, 10), usable: true };
  return { hash: await bcrypt.hash(randomBytes(32).toString('hex'), 10), usable: false };
}

function practiceSettings(def: SandboxPracticeDef): Prisma.InputJsonValue {
  const base = defaultPracticeSettings();
  return JSON.parse(JSON.stringify({
    ...base,
    humanAssistedMode: def.humanAssistedMode,
    voiceAgentEnabled: true,
    escalationPhoneNumber: SANDBOX_STAFF_PHONE,
    billingPhone: '+16135550101',
    carrierConfigs: base.carrierConfigs.map((c) => ({
      ...c,
      authorizationSubmitted: true,
      authorizationSubmittedAt: new Date().toISOString(),
      providerNumber: 'SBX-PROV-0001',
    })),
  })) as Prisma.InputJsonValue;
}

export interface EnsureResult {
  practiceId: string;
  created: boolean;
  claimsImported: number;
  loginsUsable: boolean;
}

/** Creates the practice, its two logins and its claims if they are missing. Safe to run on every boot. */
export async function ensureSandboxPractice(prisma: PrismaClient, def: SandboxPracticeDef): Promise<EnsureResult> {
  const { hash, usable } = await passwordHashForSandbox();
  const existing = await prisma.practice.findUnique({ where: { id: def.id }, select: { id: true } });
  if (!existing) {
    await prisma.practice.create({
      data: {
        id: def.id,
        name: def.name,
        timezone: 'America/Toronto',
        passwordHash: hash,
        billingPhone: '+16135550101',
        practiceAddress: '100 Example Street, Ottawa ON K1A 0A1',
        billingTier: 'scale',
        subscriptionStatus: 'active',
        settings: practiceSettings(def),
      },
    });
  }
  for (const [email, role, displayName] of [
    [def.ownerEmail, 'practice_owner', 'Sandbox Owner'],
    [def.frontDeskEmail, 'front_desk', 'Sandbox Front Desk'],
  ] as const) {
    await prisma.user.upsert({
      where: { email },
      create: { practiceId: def.id, email, passwordHash: hash, role, displayName },
      update: usable ? { passwordHash: hash, isActive: true } : {},
    });
  }
  const claimCount = await prisma.insuranceClaim.count({ where: { practiceId: def.id } });
  let imported = 0;
  if (claimCount === 0) {
    const csv = buildSandboxCsv(def, loadCallScenarios());
    const result = await runPmsImportPipeline(prisma, { practiceId: def.id, pmsSource: 'other', rows: parseSimpleCsv(csv) });
    imported = result.imported;
  }
  return { practiceId: def.id, created: !existing, claimsImported: imported, loginsUsable: usable };
}
