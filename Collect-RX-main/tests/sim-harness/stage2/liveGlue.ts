/**
 * Joins the two event streams a live Stage 2 call produces into the
 * AgentObservation that scoring.ts needs.
 *
 *  - Twin events are keyed by the Twilio call sid (ground truth for the carrier side).
 *  - Sink events (vapi_message, vapi_tool_call) are keyed by the Vapi call id.
 *
 * Both are recorded by the same twin process, so every `at` value is on one clock.
 * Vapi's own startedAt and endedAt are carried through for reference but never
 * mixed into scoring, because they come from a different clock.
 *
 * Reading is strict, like liveRunner.readCallRecord: a missing or ambiguous
 * piece aborts instead of scoring a guess.
 */
import type { TwinEvent } from './carrierTwin.js';
import type { AgentObservation } from './scoring.js';

export interface GlueDeps {
  fetchImpl: typeof fetch;
  twinBaseUrl: string;
  controlToken: string;
}

export interface GlueInput {
  scenarioId: string;
  /** Vapi call id returned by placeAndWait. Selects the sink events. */
  vapiCallId: string;
  /** Ignore twin events older than this (twin clock), so earlier runs of the same scenario cannot leak in. Default 0. */
  sinceMs?: number;
  mode?: AgentObservation['mode'];
}

export interface JoinedCall {
  observation: AgentObservation;
  /** Twin side events for this call, in the form scoreCall expects. */
  twinEvents: TwinEvent[];
  twilioCallSid: string;
  cost: number | null;
  endedReason: string;
  vapiStartedAt: string;
  vapiEndedAt: string;
  /** Ground truths this join cannot supply. Report these next to the score. */
  limitations: string[];
}

const HANDOFF_TOOL = 'request_staff_handoff';
/** Mirrors SCENARIO_MAP in humanAssistedOutcomeResolver.ts: the only scenario that auto-resolves a claim. */
const RESOLVING_SCENARIO = 'CLAIM_PAID';

export async function fetchTwinEvents(deps: GlueDeps): Promise<TwinEvent[]> {
  const res = await deps.fetchImpl(`${deps.twinBaseUrl}/twin/events`, { headers: { Authorization: `Bearer ${deps.controlToken}` } });
  if (!res.ok) throw new Error(`[stage2] GET /twin/events failed with ${res.status}`);
  return readEvents(await res.json());
}

function readEvents(raw: unknown): TwinEvent[] {
  if (!Array.isArray(raw)) throw new Error('[stage2] /twin/events did not return an array');
  return raw.map((item, i) => {
    if (typeof item !== 'object' || item === null) throw new Error(`[stage2] event ${i} is not an object`);
    const e = item as Record<string, unknown>;
    if (typeof e.at !== 'number' || typeof e.callSid !== 'string' || typeof e.scenarioId !== 'string' || typeof e.kind !== 'string' || typeof e.detail !== 'string') {
      throw new Error(`[stage2] event ${i} is missing at, callSid, scenarioId, kind or detail`);
    }
    return { at: e.at, callSid: e.callSid, scenarioId: e.scenarioId, kind: e.kind as TwinEvent['kind'], detail: e.detail };
  });
}

function field(detail: string, name: string): string {
  return new RegExp(`${name}=(\\S*)`, 'u').exec(detail)?.[1] ?? '';
}

export function joinCall(all: TwinEvent[], input: GlueInput): JoinedCall {
  const since = input.sinceMs ?? 0;
  const recent = all.filter((e) => e.at >= since);

  const sink = recent.filter((e) => e.callSid === input.vapiCallId && (e.kind === 'vapi_message' || e.kind === 'vapi_tool_call'));
  const starts = recent.filter((e) => e.kind === 'call_start' && e.scenarioId === input.scenarioId);
  const sids = [...new Set(starts.map((e) => e.callSid))];
  if (sids.length === 0) throw new Error(`[stage2] no twin call_start for scenario ${input.scenarioId}; was it armed and dialled?`);
  if (sids.length > 1) throw new Error(`[stage2] ${sids.length} twin calls match scenario ${input.scenarioId}; pass sinceMs to select one`);
  const sid = sids[0] ?? '';
  const start = starts[0];
  if (!start) throw new Error('[stage2] unreachable: call_start missing');

  const twinEvents = recent.filter((e) => e.callSid === sid);
  if (sink.length === 0) throw new Error(`[stage2] no sink events for Vapi call ${input.vapiCallId}; is the squad pointed at the sink?`);
  const strayScenario = sink.find((e) => e.scenarioId !== input.scenarioId);
  if (strayScenario) throw new Error(`[stage2] sink event for ${input.vapiCallId} was recorded under scenario ${strayScenario.scenarioId}, expected ${input.scenarioId}`);

  const report = sink.find((e) => e.kind === 'vapi_message' && e.detail.startsWith('end-of-call-report'));
  if (!report) throw new Error(`[stage2] no end-of-call-report for Vapi call ${input.vapiCallId}; aborting instead of scoring a guess`);

  const handoff = sink.find((e) => e.kind === 'vapi_tool_call' && e.detail === HANDOFF_TOOL);
  const outcomes = sink.filter((e) => e.kind === 'vapi_tool_call' && e.detail.startsWith('log_call_outcome'));
  const resolved = outcomes.some((e) => field(e.detail, 'scenario') === RESOLVING_SCENARIO);

  const costText = field(report.detail, 'cost');
  const costNum = costText === '' ? NaN : Number(costText);

  const heard = twinEvents.filter((e) => e.kind === 'agent_speech').map((e) => ({ at: e.at, text: e.detail }));

  return {
    observation: {
      mode: input.mode ?? 'human_assisted',
      dialedAt: start.at,
      endedAt: report.at,
      transferRequestedAt: handoff ? handoff.at : null,
      claimMarkedResolved: resolved,
      assistantUtterances: heard,
    },
    twinEvents,
    twilioCallSid: sid,
    cost: Number.isFinite(costNum) ? costNum : null,
    endedReason: field(report.detail, 'endedReason'),
    vapiStartedAt: field(report.detail, 'startedAt'),
    vapiEndedAt: field(report.detail, 'endedAt'),
    limitations: [
      'dialedAt is the twin call_start, so it excludes Vapi and Twilio setup time.',
      'endedAt is when the sink received end-of-call-report, which is slightly after the call ended.',
      'assistantUtterances are what the carrier side heard (twin agent_speech). The sink carries no transcript, so a human-assisted agent that speaks only to a non-rep line is not seen by the silent-during-hold check unless the twin captured it.',
      'claimMarkedResolved is true for log_call_outcome scenario CLAIM_PAID only. The sink does not record matchesExpectedAmount, so a mismatch that production would escalate still counts as resolved here.',
    ],
  };
}

export async function collectObservation(deps: GlueDeps, input: GlueInput): Promise<JoinedCall> {
  return joinCall(await fetchTwinEvents(deps), input);
}
