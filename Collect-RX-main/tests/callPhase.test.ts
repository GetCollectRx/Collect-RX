import { afterEach, describe, expect, it } from 'vitest';
import { BillingTier, CarrierId } from '@prisma/client';
import { effectiveHumanAssisted } from '../src/billing/entitlements.js';
import {
  CALL_PHASES,
  applyTransition,
  canTransition,
  hybridAttemptFields,
  hybridCallFlowEnabled,
  parsePhaseHistory,
  phasesForAgent,
  segmentSeconds,
  selectCallEnding,
  type CallPhase,
  type PhaseEntry,
} from '../src/server/frontDesk/callPhase.js';
import { approvedCarriers, evaluateGraduation } from '../src/server/learning/autonomyGraduation.js';

const T0 = new Date('2026-04-14T14:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const entry = (phase: CallPhase, seconds: number): PhaseEntry => ({ phase, at: at(seconds).toISOString() });

describe('phase transitions', () => {
  const allowed: Record<CallPhase, CallPhase[]> = {
    dialing: ['phone_menu', 'hold', 'rep_answered', 'wrap_up'],
    phone_menu: ['hold', 'rep_answered', 'wrap_up'],
    hold: ['phone_menu', 'rep_answered', 'wrap_up'],
    rep_answered: ['hold', 'staff_or_agent', 'wrap_up'],
    staff_or_agent: ['wrap_up'],
    wrap_up: [],
  };

  it.each(CALL_PHASES.flatMap((from) => CALL_PHASES.map((to) => [from, to] as const)))(
    '%s -> %s',
    (from, to) => {
      expect(canTransition(from, to)).toBe(allowed[from].includes(to));
    },
  );

  it('appends a legal transition with its timestamp', () => {
    const result = applyTransition([entry('dialing', 0)], 'phone_menu', at(5));
    expect(result).toEqual({ applied: true, history: [entry('dialing', 0), entry('phone_menu', 5)] });
  });

  it('ignores a repeat of the current phase', () => {
    const result = applyTransition([entry('dialing', 0)], 'dialing', at(5));
    expect(result).toMatchObject({ applied: false, reason: 'same_phase' });
  });

  it('refuses to rewind a call and leaves history untouched', () => {
    const history = [entry('dialing', 0), entry('rep_answered', 30), entry('staff_or_agent', 32)];
    const result = applyTransition(history, 'hold', at(40));
    expect(result).toMatchObject({ applied: false, reason: 'not_allowed' });
    expect(result.history).toEqual(history);
  });

  it('cannot enter staff_or_agent without a rep answering first', () => {
    expect(applyTransition([entry('dialing', 0), entry('hold', 5)], 'staff_or_agent', at(9))).toMatchObject({
      applied: false,
      reason: 'not_allowed',
    });
  });

  it('clamps a late event so time never runs backwards', () => {
    const result = applyTransition([entry('dialing', 0), entry('hold', 60)], 'rep_answered', at(10));
    expect(result.applied && result.history[2]?.at).toBe(at(60).toISOString());
  });

  it('survives an invalid event date', () => {
    const result = applyTransition([entry('dialing', 0)], 'hold', new Date('not a date'));
    expect(result.applied && result.history[1]?.at).toBe(at(0).toISOString());
  });

  it('reports no_history for an empty history', () => {
    expect(applyTransition([], 'hold', at(1))).toMatchObject({ applied: false, reason: 'no_history' });
  });
});

describe('parsePhaseHistory', () => {
  it('accepts a well formed history', () => {
    const history = [entry('dialing', 0), entry('hold', 4)];
    expect(parsePhaseHistory(history)).toEqual(history);
  });

  it.each([
    ['null', null],
    ['an empty array', []],
    ['a string', 'dialing'],
    ['an unknown phase', [{ phase: 'bogus', at: at(0).toISOString() }]],
    ['a bad timestamp', [{ phase: 'hold', at: 'yesterday-ish' }]],
    ['a non-object entry', ['hold']],
  ])('treats %s as no history', (_label, value) => {
    expect(parsePhaseHistory(value)).toBeNull();
  });
});

describe('segmentSeconds', () => {
  it('sums repeat visits and closes the last phase at the end time', () => {
    const history = [
      entry('dialing', 0),
      entry('phone_menu', 10),
      entry('hold', 40),
      entry('phone_menu', 100),
      entry('hold', 110),
      entry('rep_answered', 400),
      entry('staff_or_agent', 412),
      entry('wrap_up', 700),
    ];
    expect(segmentSeconds(history, at(730))).toEqual({
      menuSeconds: 40,
      holdSeconds: 350,
      repSeconds: 12,
      staffAgentSeconds: 288,
      wrapUpSeconds: 30,
    });
  });

  it('leaves phases the call never entered as null, not zero', () => {
    const history = [entry('dialing', 0), entry('hold', 20), entry('wrap_up', 90)];
    expect(segmentSeconds(history, at(100))).toEqual({
      menuSeconds: null,
      holdSeconds: 70,
      repSeconds: null,
      staffAgentSeconds: null,
      wrapUpSeconds: 10,
    });
  });

  it('never reports a negative duration when the close time is early', () => {
    const history = [entry('dialing', 0), entry('wrap_up', 50)];
    expect(segmentSeconds(history, at(10)).wrapUpSeconds).toBe(0);
  });
});

describe('phasesForAgent', () => {
  it.each([
    ['IVR_Navigator', ['phone_menu']],
    ['Hold_Sentinel', ['hold']],
    ['Claims_Scribe', ['rep_answered']],
    ['Claims_Agent', ['rep_answered', 'staff_or_agent']],
    ['Escalation_Closer', ['rep_answered', 'staff_or_agent', 'wrap_up']],
    ['Resolution_Closer', ['rep_answered', 'staff_or_agent', 'wrap_up']],
    ['Somebody_Else', []],
  ])('%s', (agent, expected) => {
    expect(phasesForAgent(agent)).toEqual(expected);
  });
});

describe('selectCallEnding', () => {
  const savedPlans = process.env.AUTONOMOUS_PLAN_TIERS;
  const savedCarriers = process.env.AUTONOMOUS_APPROVED_CARRIERS;
  afterEach(() => {
    if (savedPlans === undefined) delete process.env.AUTONOMOUS_PLAN_TIERS;
    else process.env.AUTONOMOUS_PLAN_TIERS = savedPlans;
    if (savedCarriers === undefined) delete process.env.AUTONOMOUS_APPROVED_CARRIERS;
    else process.env.AUTONOMOUS_APPROVED_CARRIERS = savedCarriers;
  });

  const tiers = Object.values(BillingTier);
  const settings = [true, false, undefined] as const;
  const planConfigs = ['', 'core', 'core,growth,scale', 'sentinel,trial', 'core,growth,scale,sentinel,trial'];

  it('always agrees with effectiveHumanAssisted, for every plan config, tier, setting and graduation state', () => {
    for (const planConfig of planConfigs) {
      process.env.AUTONOMOUS_PLAN_TIERS = planConfig;
      for (const tier of [...tiers, null, undefined]) {
        for (const humanAssistedMode of settings) {
          for (const carrierGraduated of [true, false]) {
            const decision = selectCallEnding({ tier, humanAssistedMode, carrierGraduated });
            expect(decision.humanAssisted).toBe(
              effectiveHumanAssisted(tier, humanAssistedMode, { carrierGraduated }),
            );
            expect(decision.ending).toBe(decision.humanAssisted ? 'staff' : 'agent');
            expect(decision.reason === 'autonomous_allowed').toBe(decision.ending === 'agent');
          }
        }
      }
    }
  });

  it('with no plan opened (the default) every tier, setting and carrier gets the staff ending', () => {
    delete process.env.AUTONOMOUS_PLAN_TIERS;
    for (const tier of tiers) {
      for (const humanAssistedMode of settings) {
        const decision = selectCallEnding({ tier, humanAssistedMode, carrierGraduated: true });
        expect(decision).toEqual({ ending: 'staff', humanAssisted: true, reason: 'plan_excludes_autonomous' });
      }
    }
  });

  const passingStats = {
    staffHandledCalls: 80,
    referenceCaptured: 79,
    unresolved: 2,
    automationSuspicion: 0,
    profileCategoriesCovered: 4,
  };
  const failingStats = { ...passingStats, staffHandledCalls: 10 };

  it('gives the agent ending only when plan, practice setting, evidence and founder approval all agree, per carrier', () => {
    process.env.AUTONOMOUS_PLAN_TIERS = 'core,growth,scale';
    const carriers = Object.values(CarrierId);
    const approvalSets: Array<[string, string[]]> = [
      ['none approved', []],
      ['all approved', carriers],
      ...carriers.map((c): [string, string[]] => [`only ${c} approved`, [c]]),
    ];
    for (const [, approved] of approvalSets) {
      process.env.AUTONOMOUS_APPROVED_CARRIERS = approved.join(',');
      for (const carrier of carriers) {
        for (const evidencePasses of [true, false]) {
          const graduated = evaluateGraduation(
            carrier,
            evidencePasses ? passingStats : failingStats,
            approvedCarriers().has(carrier),
          ).graduated;
          for (const tier of tiers) {
            for (const humanAssistedMode of settings) {
              const decision = selectCallEnding({ tier, humanAssistedMode, carrierGraduated: graduated });
              const planOpen = ['core', 'growth', 'scale'].includes(tier);
              const expectAgent =
                planOpen && approved.includes(carrier) && evidencePasses && humanAssistedMode === false;
              expect(decision.ending, `${tier} ${carrier} ${String(humanAssistedMode)} ${evidencePasses}`).toBe(
                expectAgent ? 'agent' : 'staff',
              );
            }
          }
        }
      }
    }
  });

  it.each([
    ['trial', false, true, 'plan_excludes_autonomous'],
    ['core', false, false, 'carrier_not_graduated'],
    ['core', true, true, 'practice_keeps_hold_sentinel'],
    ['core', undefined, true, 'practice_keeps_hold_sentinel'],
    ['core', false, true, 'autonomous_allowed'],
  ] as const)('explains the decision: %s mode=%s graduated=%s -> %s', (tier, mode, graduated, reason) => {
    process.env.AUTONOMOUS_PLAN_TIERS = 'core';
    expect(selectCallEnding({ tier, humanAssistedMode: mode, carrierGraduated: graduated }).reason).toBe(reason);
  });
});

describe('HYBRID_CALL_FLOW flag', () => {
  const decision = { ending: 'staff', humanAssisted: true, reason: 'plan_excludes_autonomous' } as const;

  it('is off unless exactly true', () => {
    expect(hybridCallFlowEnabled({})).toBe(false);
    expect(hybridCallFlowEnabled({ HYBRID_CALL_FLOW: 'false' })).toBe(false);
    expect(hybridCallFlowEnabled({ HYBRID_CALL_FLOW: '1' })).toBe(false);
    expect(hybridCallFlowEnabled({ HYBRID_CALL_FLOW: 'true' })).toBe(true);
  });

  it('adds nothing to the call attempt insert when off', () => {
    expect(hybridAttemptFields(decision, T0, {})).toEqual({});
  });

  it('seeds the phase history and records the ending when on', () => {
    expect(hybridAttemptFields(decision, T0, { HYBRID_CALL_FLOW: 'true' })).toEqual({
      callPhase: 'dialing',
      phaseHistory: [{ phase: 'dialing', at: T0.toISOString() }],
      callEnding: 'staff',
      callEndingReason: 'plan_excludes_autonomous',
    });
  });
});
