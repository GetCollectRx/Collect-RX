/**
 * Dispatch-layer bindings: registry scenarios D001 to D018 run against the real
 * validateDispatch gate, the real plan gate and the real initiateCall allowlist,
 * with a real PostgreSQL and synthetic practices. Level U: no webhook, no queue
 * tick, no Vapi. Nothing here touches the network.
 */
import type { CarrierId, PrismaClient } from '@prisma/client';
import { validateDispatch, CARRIER_CONFIGS, type DispatchGuard } from '../../../src/carriers/adapter.js';
import { defaultPracticeSettings, updatePracticeSettings } from '../../../src/server/services/practiceSettingsService.js';
import { canMakeCall } from '../../../src/server/plans/planBridge.js';
import { initiateCall, type VapiCallParams } from '../../../src/vapi/client.js';
import { createPracticeForTests } from '../../factories/practice.js';
import { OutboundInterceptor } from '../../sim-harness/outboundInterceptor.js';
import { fail, finding, pass, verdict, type Binding, type BindingResult } from './types.js';

const TUESDAY_10AM_ET = new Date('2026-04-14T14:00:00Z');
const SATURDAY_10AM_ET = new Date('2026-04-18T14:00:00Z');
const MONDAY_8AM_ET = new Date('2026-04-13T12:00:00Z');

type ClaimKey = 'sun_life' | 'canada_life' | 'telus' | 'manulife' | 'rbc' | 'stop_route';

export interface DispatchWorld {
  prisma: PrismaClient;
  practiceA: string;
  practiceB: string;
  practiceNoVoice: string;
  practiceTrialExpired: string;
  claims: Record<ClaimKey, string>;
  claimB: string;
  claimNoVoice: string;
  practiceIds: string[];
}

const CARRIER_FOR: Record<ClaimKey, CarrierId> = {
  sun_life: 'sun_life',
  canada_life: 'canada_life',
  telus: 'telus_adjudicare',
  manulife: 'manulife',
  rbc: 'rbc',
  stop_route: 'sun_life',
};

async function makePractice(prisma: PrismaClient, voiceAgentEnabled: boolean, authorized: CarrierId[]): Promise<string> {
  const practice = await createPracticeForTests(prisma);
  const settings = defaultPracticeSettings();
  settings.voiceAgentEnabled = voiceAgentEnabled;
  settings.carrierConfigs = settings.carrierConfigs.map((c) =>
    authorized.includes(c.carrierId) ? { ...c, enabled: true, authorizationSubmitted: true, providerNumber: 'PN-SYN-001' } : { ...c, authorizationSubmitted: false },
  );
  await updatePracticeSettings(prisma, practice.id, settings);
  return practice.id;
}

async function makeClaim(prisma: PrismaClient, practiceId: string, carrierId: CarrierId, tag: string, recoveryRoute?: 'STOP'): Promise<string> {
  const claim = await prisma.insuranceClaim.create({
    data: {
      practiceId,
      carrierId,
      claimNumber: `SYN-VL-${tag}`,
      patientToken: `syn-tok-${tag}-${practiceId.slice(0, 8)}`,
      billedAmount: 500,
      outstandingAmount: 500,
      daysOutstanding: 45,
      status: 'PENDING',
      ...(recoveryRoute ? { recoveryRoute } : {}),
    },
  });
  return claim.id;
}

export async function setupDispatchWorld(prisma: PrismaClient): Promise<DispatchWorld> {
  const authorized: CarrierId[] = ['sun_life', 'canada_life', 'telus_adjudicare', 'manulife'];
  const practiceA = await makePractice(prisma, true, authorized);
  const practiceB = await makePractice(prisma, true, authorized);
  const practiceNoVoice = await makePractice(prisma, false, authorized);
  const practiceTrialExpired = await makePractice(prisma, true, authorized);
  await prisma.practice.update({
    where: { id: practiceTrialExpired },
    data: { billingTier: 'trial', trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
  });
  const claims = {
    sun_life: await makeClaim(prisma, practiceA, 'sun_life', 'SL'),
    canada_life: await makeClaim(prisma, practiceA, 'canada_life', 'CL'),
    telus: await makeClaim(prisma, practiceA, 'telus_adjudicare', 'TE'),
    manulife: await makeClaim(prisma, practiceA, 'manulife', 'MF'),
    rbc: await makeClaim(prisma, practiceA, 'rbc', 'RBC'),
    stop_route: await makeClaim(prisma, practiceA, 'sun_life', 'STOP', 'STOP'),
  };
  return {
    prisma,
    practiceA,
    practiceB,
    practiceNoVoice,
    practiceTrialExpired,
    claims,
    claimB: await makeClaim(prisma, practiceB, 'sun_life', 'B'),
    claimNoVoice: await makeClaim(prisma, practiceNoVoice, 'sun_life', 'NV'),
    practiceIds: [practiceA, practiceB, practiceNoVoice, practiceTrialExpired],
  };
}

export async function teardownDispatchWorld(world: DispatchWorld): Promise<number> {
  const { prisma, practiceIds } = world;
  await prisma.carrierBlockEvent.deleteMany({ where: { practiceId: { in: practiceIds } } });
  await prisma.usagePeriod.deleteMany({ where: { practiceId: { in: practiceIds } } });
  await prisma.callAttempt.deleteMany({ where: { claim: { practiceId: { in: practiceIds } } } });
  await prisma.insuranceClaim.deleteMany({ where: { practiceId: { in: practiceIds } } });
  for (const id of practiceIds) await prisma.practice.delete({ where: { id } }).catch(() => undefined);
  return prisma.practice.count({ where: { id: { in: practiceIds } } });
}

function describeGuard(g: DispatchGuard): string {
  return g.allowed ? 'allowed' : `blocked:${g.code ?? 'no_code'}`;
}

export function buildDispatchBindings(world: DispatchWorld): Record<string, Binding> {
  const { prisma } = world;

  const gate = (key: ClaimKey, over: { days?: number; attempts?: number; at?: Date; status?: 'PENDING' | 'APPROVED_PENDING_PAYMENT' } = {}): Promise<DispatchGuard> =>
    validateDispatch(prisma, {
      practiceId: world.practiceA,
      claimId: world.claims[key],
      carrierId: CARRIER_FOR[key],
      daysOutstanding: over.days ?? 45,
      attemptsSoFar: over.attempts ?? 0,
      scheduledFor: over.at ?? TUESDAY_10AM_ET,
      claimStatus: over.status ?? 'PENDING',
    });

  const gateFor = (practiceId: string, claimId: string, carrierId: CarrierId): Promise<DispatchGuard> =>
    validateDispatch(prisma, { practiceId, claimId, carrierId, daysOutstanding: 45, attemptsSoFar: 0, scheduledFor: TUESDAY_10AM_ET, claimStatus: 'PENDING' });

  const withBlock = async <T>(practiceId: string, carrierId: CarrierId, fn: () => Promise<T>): Promise<T> => {
    const row = await prisma.carrierBlockEvent.create({ data: { practiceId, carrierId, notes: 'validation-lab synthetic block', blockedAt: new Date() } });
    try {
      return await fn();
    } finally {
      await prisma.carrierBlockEvent.update({ where: { id: row.id }, data: { resumedAt: new Date() } });
    }
  };

  const expectBlocked = (g: DispatchGuard, code: string, proves: string): BindingResult =>
    verdict(!g.allowed && g.code === code, 'U', describeGuard(g), proves);

  return {
    D001: async () => expectBlocked(await gate('sun_life', { days: 29 }), 'CLAIM_TOO_YOUNG', 'validateDispatch rejects a 29 day claim. Queue entry and call placement not exercised.'),
    D002: async () => expectBlocked(await gate('sun_life', { days: 91 }), 'ESCALATE_OVER_90', 'validateDispatch rejects a 91 day claim as human only. The escalation record itself is covered by the office-day suite, not here.'),
    D003: async () => expectBlocked(await gate('sun_life', { attempts: 3 }), 'MAX_ATTEMPTS', 'validateDispatch rejects a fourth attempt (3 already made).'),
    D004: async () =>
      withBlock(world.practiceA, 'sun_life', async () => {
        const own = await gate('sun_life');
        const sibling = await gateFor(world.practiceB, world.claimB, 'sun_life');
        const ownBlocked = !own.allowed && own.code === 'CARRIER_BLOCK';
        const evidence = `own practice ${describeGuard(own)}; second practice same carrier ${describeGuard(sibling)}`;
        if (!ownBlocked) return fail('U', evidence, 'The blocked practice must not dispatch to the blocked carrier.');
        if (sibling.allowed) {
          return finding('U', evidence, 'The block holds for the practice that raised it. Another practice is still allowed to dial the same carrier, which differs from the documented rule that all calls to that carrier stop. Scope is an open item in the decisions register (carrier block scope).');
        }
        return pass('U', evidence, 'The block holds for the raising practice and for a second practice on the same carrier.');
      }),
    D005: async () =>
      withBlock(world.practiceA, 'sun_life', async () => {
        const other = await gate('manulife');
        return verdict(other.allowed, 'U', describeGuard(other), 'A block on one carrier does not stop another carrier for the same practice.');
      }),
    D006: async () => expectBlocked(await gate('rbc'), 'CARRIER_NOT_AUTHORIZED', 'The authorization gate refuses a carrier with no authorization on file.'),
    D007: async () => expectBlocked(await gateFor(world.practiceNoVoice, world.claimNoVoice, 'sun_life'), 'VOICE_AGENT_DISABLED', 'The gate refuses a practice whose voice agent is off.'),
    D008: async () => {
      const g = await canMakeCall(world.practiceTrialExpired);
      return verdict(!g.allowed, 'U', g.allowed ? 'allowed' : `blocked:${String(g.reason)}`, 'The plan gate refuses a practice whose trial has ended. Queue-engine wiring of this gate is not exercised.');
    },
    D009: async () => expectBlocked(await gate('sun_life', { at: SATURDAY_10AM_ET }), 'OUTSIDE_CALL_WINDOW', 'validateDispatch refuses a Saturday 10:00 Eastern slot.'),
    D010: async () => {
      const g = await gate('sun_life', { at: MONDAY_8AM_ET });
      return verdict(g.allowed, 'U', describeGuard(g), 'The window opens at 08:00 Eastern on a Monday.');
    },
    D011: async () => expectBlocked(await gate('sun_life', { status: 'APPROVED_PENDING_PAYMENT' }), 'APPROVED_PENDING_PAYMENT', 'No carrier dial for a claim already approved and awaiting payment.'),
    D012: async () => {
      const at20 = await gate('telus', { days: 20 });
      const at25 = await gate('telus', { days: 25 });
      const evidence = `20 days ${describeGuard(at20)}; 25 days ${describeGuard(at25)}; configured minimum ${CARRIER_CONFIGS.telus_adjudicare.minWaitDays}`;
      if (at20.allowed) return fail('U', evidence, 'A 20 day TELUS claim must not dial.');
      if (!at25.allowed) {
        return finding('U', evidence, 'The 20 day claim is refused as required. A 25 day TELUS claim is also refused because dispatch uses one flat 30 day floor, while carrier-configs.json documents day 21. Enforcing the per-carrier number is a pending product decision (HUMAN-DECISIONS-PENDING item 1).');
      }
      return pass('U', evidence, 'Per-carrier minimum is enforced.');
    },
    D013: async () => {
      const g = await gate('telus', { days: 35 });
      return verdict(g.allowed, 'U', describeGuard(g), 'The gate allows a 35 day TELUS claim when other gates pass. TPA identification and the dial number are not part of this gate.');
    },
    D015: async () => {
      const interceptor = new OutboundInterceptor();
      interceptor.install();
      let message = 'no error thrown';
      try {
        const params: VapiCallParams = {
          claimId: world.claims.sun_life,
          carrierId: 'sun_life',
          practiceId: world.practiceA,
          patientToken: 'syn-tok-allowlist',
          patientName: 'SYNTHETIC PLACEHOLDER',
          patientDob: '2000-01-01',
          policyNumber: 'SYN-POLICY-0',
          carrierPhone: '+15555550100',
          claimNumber: 'SYN-VL-ALLOWLIST',
          daysOutstanding: 45,
          billedAmount: 500,
          outstandingAmount: 500,
          practiceName: 'Synthetic Practice',
          providerNumber: 'PN-SYN-001',
          practicePhone: '+15555550101',
        };
        await initiateCall(params);
      } catch (err) {
        message = err instanceof Error && err.message.includes('not a known carrier claims line') ? 'refused:not_on_allowlist' : 'threw:other_error';
      } finally {
        interceptor.uninstall();
      }
      const sent = interceptor.requests.length;
      return verdict(message === 'refused:not_on_allowlist' && sent === 0, 'U', `${message}; outbound requests ${sent}`, 'initiateCall refuses a destination that is not an allowlisted carrier line, before any request is sent. Placeholders only; nothing stored.');
    },
    D017: async () => {
      const flag = CARRIER_CONFIGS.canada_life.portalFirstDispatch === true;
      const g = await gate('canada_life');
      const evidence = `portalFirstDispatch configured=${flag}; voice dispatch ${describeGuard(g)}`;
      if (flag && g.allowed) {
        return fail('U', evidence, 'The Canada Life config says a portal check must come before a voice call, but the dispatch gate allows the voice call and no code in src reads portalFirstDispatch (searched 23 Nov). The flag is configuration with no behaviour behind it.');
      }
      return verdict(flag && !g.allowed, 'U', evidence, 'Portal-first ordering.');
    },
    D018: async () => expectBlocked(await gate('stop_route'), 'RECOVERY_GATE', 'A claim whose recovery route is not CALL_CARRIER is refused by the recovery gate.'),
  };
}
