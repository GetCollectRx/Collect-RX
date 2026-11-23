/**
 * Stateful dispatch bindings: scenarios that need the queue tick, the manual
 * trigger route or the PHI vault. Level S: the real pipeline and routes with a
 * stubbed Vapi and synthetic data. The call window is forced open for the tick
 * (as in Stage 1), so window behaviour is covered by the U-level bindings.
 */
import { validateDispatch, type DispatchGuard } from '../../../src/carriers/adapter.js';
import { identifyTelusPlan } from '../../../src/services/eligibility/engine.js';
import { claimTickLease } from '../../../src/server/frontDesk/queueEngine.js';
import { fail, verdict, type Binding, type BindingResult } from './types.js';
import type { StatefulWorld } from './statefulWorld.js';

const describeGuard = (g: DispatchGuard): string => (g.allowed ? 'allowed' : `blocked:${g.code ?? 'no_code'}`);

export function buildStatefulBindings(world: StatefulWorld): Record<string, Binding> {
  const { plain } = world;

  return {
    D014: async (): Promise<BindingResult> => {
      const office = await world.makeOffice({ label: 'D014 manual trigger' });
      const [young, over, blocked] = await world.importRows(office.id, [
        { tag: 'D014Y', opts: { days: 20 } },
        { tag: 'D014O', opts: { days: 120 } },
        { tag: 'D014B', opts: { days: 45 } },
      ]);
      const cases: Array<{ label: string; claimId: string; days: number }> = [
        { label: 'young', claimId: young ?? '', days: 20 },
        { label: 'over90', claimId: over ?? '', days: 120 },
      ];
      const parts: string[] = [];
      let allEqual = true;
      const deskAttempt = await world.trigger(young ?? '', office.token);
      parts.push(`front desk role route=${deskAttempt.status}`);
      const before = (await world.tickFor(office.id, 0)).dials.length;
      for (const c of cases) {
        // Gate first: an over-90 trigger escalates the claim, which would change what the gate sees.
        const gate = await validateDispatch(plain, { practiceId: office.id, claimId: c.claimId, carrierId: 'sun_life', daysOutstanding: c.days, attemptsSoFar: 0, claimStatus: 'PENDING' });
        const route = await world.trigger(c.claimId, office.ownerToken);
        const same = route.code === gate.code;
        allEqual = allEqual && same;
        parts.push(`${c.label} route=${route.status}:${route.code ?? route.error ?? 'none'} gate=${describeGuard(gate)}`);
      }
      const row = await plain.carrierBlockEvent.create({ data: { practiceId: office.id, carrierId: 'sun_life', notes: 'validation-lab synthetic block', blockedAt: new Date() } });
      try {
        const route = await world.trigger(blocked ?? '', office.ownerToken);
        const gate = await validateDispatch(plain, { practiceId: office.id, claimId: blocked ?? '', carrierId: 'sun_life', daysOutstanding: 45, attemptsSoFar: 0, claimStatus: 'PENDING' });
        allEqual = allEqual && route.code === gate.code;
        parts.push(`blocked route=${route.status}:${route.code ?? 'none'} gate=${describeGuard(gate)}`);
      } finally {
        await plain.carrierBlockEvent.update({ where: { id: row.id }, data: { resumedAt: new Date() } });
      }
      const dials = (await world.tickFor(office.id, 0)).dials.length - before;
      return verdict(allEqual && dials === 0, 'S', `${parts.join(' | ')} | dials ${dials}`, 'The manual trigger route refuses with the same code as validateDispatch for a young claim, an over-90 claim and a blocked carrier, and places no call. The route needs the practice owner role: a front desk session is refused with 403 before any gate runs. It does not check staff hours or presence by design. The allowed path is not exercised.');
    },

    D016: async (): Promise<BindingResult> => {
      const withPrefix = identifyTelusPlan('SYNMEMBER0001', 'A100200');
      const letters = 'ABCDEFGHIJKLM'.split('');
      const dialable = letters.filter((l) => identifyTelusPlan('SYNMEMBER0001', `${l}100200`).dialPhone !== null);
      const evidence = `prefix A tpa=${withPrefix.identifiedTpa ?? 'none'} confidence=${withPrefix.confidence}; prefixes with a verified dial number ${dialable.length} of ${letters.length}`;
      if (dialable.length > 0) return fail('U', evidence, 'A verified dial number exists, so the variable injection can now be run through the tick. Bind it.');
      return { status: 'UNVERIFIED', level: 'U', observed: evidence, proves: 'TPA identification from the group prefix works. No TPA has a verified provider phone, by policy, so no TELUS call is ever dispatched and "TPA in variables" cannot be observed. Runnable once an operator verifies one TPA phone.' };
    },

    D019: async (): Promise<BindingResult> => {
      // Production overlap is stopped by the scheduler's in-process latch and, across replicas, by the database lease.
      await plain.$executeRaw`DELETE FROM queue_engine_lease`;
      try {
        const first = await claimTickLease(plain, 'validation-lab-replica-a');
        const second = await claimTickLease(plain, 'validation-lab-replica-b');
        const renewed = await claimTickLease(plain, 'validation-lab-replica-a');
        const evidence = `replica A claims ${first}; replica B while A holds it ${second}; replica A renews ${renewed}`;
        return verdict(first && !second && renewed, 'S', evidence, 'The database lease lets one replica run the tick body at a time, so two replicas cannot dispatch the same claim in one cycle. Not proved: the in-process latch (a closure in the scheduler), and separate processes dialling for real. A direct second call of runDeskQueueTick inside the same process is not guarded by the lease, because the same instance may renew it. That call is not reachable from the scheduler today.');
      } finally {
        await plain.$executeRaw`DELETE FROM queue_engine_lease`;
      }
    },

    E004: async (): Promise<BindingResult> => {
      const office = await world.makeOffice({ label: 'E004 capacity' });
      const [claimId] = await world.importRows(office.id, [{ tag: 'E004', opts: { days: 45 } }]);
      world.setEnv('VAPI_MAX_CONCURRENT_CALLS', '0');
      let t;
      try {
        t = await world.tickFor(office.id);
      } finally {
        world.setEnv('VAPI_MAX_CONCURRENT_CALLS', undefined);
      }
      const entry = await plain.callQueue.findFirst({ where: { claimId: claimId ?? '' }, select: { status: true, dispatchDeferralCode: true } });
      const evidence = `dials ${t.dials.length}; queue status ${entry?.status ?? 'none'}; deferral code ${entry?.dispatchDeferralCode ?? 'none'}`;
      return verdict(t.dials.length === 0 && entry?.dispatchDeferralCode === 'VAPI_CAPACITY_EXHAUSTED', 'S', evidence, 'When the fleet call budget is exhausted the tick places no call and defers the queue entry with a staff-visible code. A real Vapi 429 response is not exercised; the budget is the product guard.');
    },

    E008: async (): Promise<BindingResult> => {
      const office = await world.makeOffice({ label: 'E008 token expiry' });
      const [tickClaim, routeClaim] = await world.importRows(office.id, [
        { tag: 'E008T', opts: { days: 45 } },
        { tag: 'E008R', opts: { days: 45 } },
      ]);
      const claims = await plain.insuranceClaim.findMany({ where: { id: { in: [tickClaim ?? '', routeClaim ?? ''] } }, select: { id: true, patientToken: true } });
      for (const c of claims) world.expireToken(c.patientToken);
      const route = await world.trigger(routeClaim ?? '', office.ownerToken);
      const t = await world.tickFor(office.id);
      const entry = await plain.callQueue.findFirst({ where: { claimId: tickClaim ?? '' }, select: { dispatchDeferralCode: true } });
      const evidence = `route ${route.status}; tick dials ${t.dials.length}; tick deferral code ${entry?.dispatchDeferralCode ?? 'none'}`;
      return verdict(route.status === 422 && t.dials.length === 0 && entry?.dispatchDeferralCode === 'CLAIM_DATA_UNAVAILABLE', 'S', evidence, 'An expired PHI token stops the call on both paths: the manual trigger answers 422 and the queue tick defers the claim as CLAIM_DATA_UNAVAILABLE. No call is placed.');
    },
  };
}
