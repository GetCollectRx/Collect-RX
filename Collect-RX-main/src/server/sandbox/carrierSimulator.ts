/**
 * Sandbox carrier simulator: plays each dispatched call in real time and
 * delivers the same signed server messages Vapi would to the product's real
 * webhook route. The product's own code decides what happens next: the
 * Hold_Sentinel handoff transfers the call through the mock control URL, the
 * scribe's outcome and the end-of-call report go through normal processing,
 * and CARRIER_BLOCK can end the call mid-way.
 *
 * Patient details from the dial request are held in memory for the life of
 * the call only, so the rep and staff can say them the way a real call would,
 * and are dropped when the call ends. They are never logged or stored here.
 */
import { createHmac } from 'node:crypto';
import { getHumanAssistedSquadId } from '../../vapi/client.js';
import { logger } from '../observability/logger.js';
import { sandboxLocalOrigin } from './sandboxMode.js';
import { buildCallPlan, fillLine, type CallMode, type CallPhi, type CallPlan, type PlanStep } from './callPlan.js';
import {
  findCallScenario,
  scenarioIdFromClaimNumber,
  type CallScenario,
  type OutcomeClass,
} from './scenarioRegistry.js';

/** How long Hold_Sentinel waits for the product to transfer before the rep gives up. */
export const TRANSFER_WAIT_SECONDS = 90;
const ENDED_RETENTION_MS = 60 * 60 * 1000;

/**
 * Local verification only: SANDBOX_TIME_SCALE=60 plays a 30 minute call in 30
 * seconds. Staging leaves it unset, which is real time.
 */
export function timeScale(): number {
  const n = Number(process.env.SANDBOX_TIME_SCALE ?? '1');
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export type SimCallStatus = 'queued' | 'in-progress' | 'ended';

export interface SimCallSummary {
  vapiCallId: string;
  claimNumber: string;
  scenarioId: string;
  mode: CallMode;
  outcomeClass: OutcomeClass;
  carrierId: string;
  practiceId: string;
  status: SimCallStatus;
  startedAt: string;
  endedAt: string | null;
  endedReason: string | null;
  transferredTo: string | null;
  handoffRequestedAt: string | null;
  transferredAt: string | null;
}

interface LiveCall {
  summary: SimCallSummary;
  plan: CallPlan;
  metadata: Record<string, unknown>;
  phi: CallPhi | null;
  practiceName: string;
  transcript: string[];
  timers: Array<ReturnType<typeof setTimeout>>;
  started: Date;
}

export type CallEndedListener = (call: SimCallSummary, ctx: { phi: CallPhi | null; transcript: string }) => void;

/** Used for claims that do not carry a sandbox scenario (for example claims added by hand in the UI). */
const DEFAULT_SCENARIO: CallScenario = {
  id: 'DEFAULT',
  tier: 'P2',
  name: 'Claim without a sandbox scenario: cooperative rep',
  layer: 'conversation',
  harness: 'carrier_conversation',
  carrierPersonas: ['cooperative_rep'],
  carrierName: null,
  curveball: null,
  expectedOutcomeText: null,
  outcomeClass: 'PAID',
};

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

const SPEAKER_LABEL: Record<'ivr' | 'agent' | 'rep' | 'staff', string> = { ivr: 'IVR', agent: 'AI', rep: 'Rep', staff: 'Staff' };

export class CarrierSimulator {
  private readonly calls = new Map<string, LiveCall>();
  private readonly endedListeners: CallEndedListener[] = [];

  constructor(private readonly post: (body: Record<string, unknown>) => Promise<void> = postSignedWebhook) {}

  onCallEnded(listener: CallEndedListener): void {
    this.endedListeners.push(listener);
  }

  get(vapiCallId: string): SimCallSummary | null {
    return this.calls.get(vapiCallId)?.summary ?? null;
  }

  list(limit = 50): SimCallSummary[] {
    return [...this.calls.values()].map((c) => c.summary).slice(-limit).reverse();
  }

  /** Starts a call from a POST /call body. `elapsedSeconds` > 0 resumes a call after a restart. */
  start(vapiCallId: string, body: Record<string, unknown>, opts: { started?: Date; afterTransferAt?: Date | null } = {}): SimCallSummary {
    const overrides = record(body.assistantOverrides);
    const metadata = record(overrides.metadata);
    const vars = record(overrides.variableValues);
    const mode: CallMode = str(body.squadId) === getHumanAssistedSquadId() ? 'hold_sentinel' : 'autonomous';
    const claimNumber = str(vars.claim_number);
    const scenario = findCallScenario(scenarioIdFromClaimNumber(claimNumber)) ?? DEFAULT_SCENARIO;
    const carrierId = str(vars.insurance_carrier, str(metadata.carrierId));
    const plan = buildCallPlan({ vapiCallId, scenario, carrierId, mode });
    const started = opts.started ?? new Date();
    const patientName = str(vars.patient_name);
    const call: LiveCall = {
      summary: {
        vapiCallId,
        claimNumber,
        scenarioId: scenario.id,
        mode,
        outcomeClass: plan.outcomeClass,
        carrierId,
        practiceId: str(metadata.practiceId),
        status: 'queued',
        startedAt: started.toISOString(),
        endedAt: null,
        endedReason: null,
        transferredTo: null,
        handoffRequestedAt: null,
        transferredAt: null,
      },
      plan,
      metadata,
      phi: patientName
        ? { patientName, dateOfBirth: str(vars.patient_dob), memberId: str(vars.policy_number) }
        : null,
      practiceName: str(vars.practice_name, 'the practice'),
      transcript: [],
      timers: [],
      started,
    };
    this.calls.set(vapiCallId, call);
    const elapsed = (Date.now() - started.getTime()) / 1000;
    this.schedule(call, plan.beforeHandoff, started, elapsed > 0 ? started : null);
    if (opts.afterTransferAt) {
      call.summary.handoffRequestedAt = opts.afterTransferAt.toISOString();
      call.summary.transferredAt = opts.afterTransferAt.toISOString();
      this.schedule(call, plan.afterTransfer, opts.afterTransferAt, opts.afterTransferAt);
    }
    if (elapsed > 0) this.endIfOverdue(call);
    return call.summary;
  }

  /** Mock control URL: {type:'transfer'}. */
  transfer(vapiCallId: string, destination: string): boolean {
    const call = this.calls.get(vapiCallId);
    if (!call || call.summary.status !== 'in-progress' || call.summary.transferredAt) return false;
    const now = new Date();
    call.summary.transferredTo = destination;
    call.summary.transferredAt = now.toISOString();
    call.transcript.push('System: call transferred to practice staff');
    this.schedule(call, call.plan.afterTransfer, now, null);
    return true;
  }

  /** Mock control URL: {type:'end-call'}. */
  hangUp(vapiCallId: string): boolean {
    const call = this.calls.get(vapiCallId);
    if (!call || call.summary.status === 'ended') return false;
    void this.end(call, 'assistant-ended-call');
    return true;
  }

  stopAll(): void {
    for (const call of this.calls.values()) for (const t of call.timers) clearTimeout(t);
  }

  private envelopeCall(call: LiveCall): Record<string, unknown> {
    return { id: call.summary.vapiCallId, startedAt: call.summary.startedAt, assistantOverrides: { metadata: call.metadata } };
  }

  /**
   * Schedules steps relative to `anchor`. When `skipBefore` is set (a resumed
   * call), steps whose time already passed are not replayed.
   */
  private schedule(call: LiveCall, steps: PlanStep[], anchor: Date, skipBefore: Date | null): void {
    const now = Date.now();
    for (const step of steps) {
      const due = anchor.getTime() + (step.at * 1000) / timeScale();
      if (skipBefore && due < now) {
        if (step.kind === 'status') call.summary.status = 'in-progress';
        continue;
      }
      call.timers.push(setTimeout(() => void this.fire(call, step), Math.max(0, due - now)));
    }
  }

  private endIfOverdue(call: LiveCall): void {
    const steps = call.summary.transferredAt ? call.plan.afterTransfer : call.plan.beforeHandoff;
    const anchor = call.summary.transferredAt ? Date.parse(call.summary.transferredAt) : call.started.getTime();
    const last = steps[steps.length - 1];
    if (last && anchor + (last.at * 1000) / timeScale() < Date.now()) void this.end(call, last.kind === 'end' ? last.endedReason : 'customer-ended-call');
  }

  private async fire(call: LiveCall, step: PlanStep): Promise<void> {
    if (call.summary.status === 'ended') return;
    const msgCall = this.envelopeCall(call);
    try {
      switch (step.kind) {
        case 'status':
          call.summary.status = 'in-progress';
          await this.post({ message: { type: 'status-update', status: 'in-progress', call: msgCall } });
          return;
        case 'line': {
          const phi = call.phi ?? { patientName: 'the patient', dateOfBirth: 'the date on file', memberId: 'the member ID on file' };
          const text = fillLine(step.text, phi, call.practiceName);
          call.transcript.push(`${SPEAKER_LABEL[step.speaker]}: ${text}`);
          if (step.speaker === 'rep' || step.speaker === 'ivr' || step.speaker === 'agent') {
            await this.post({
              message: { type: 'transcript', role: step.speaker === 'agent' ? 'assistant' : 'user', transcriptType: 'final', transcript: text, call: msgCall },
            });
          }
          return;
        }
        case 'handoff':
          call.summary.handoffRequestedAt = new Date().toISOString();
          await this.post({
            message: {
              type: 'tool-calls',
              call: msgCall,
              toolWithToolCallList: [{ name: 'request_staff_handoff', toolCall: { id: `${call.summary.vapiCallId}-handoff`, function: { name: 'request_staff_handoff', arguments: '{}' } } }],
            },
          });
          call.timers.push(setTimeout(() => {
            if (call.summary.status === 'ended' || call.summary.transferredAt) return;
            call.transcript.push('Rep: Hello? Is anyone there? I am going to disconnect.');
            void this.end(call, 'customer-ended-call');
          }, (TRANSFER_WAIT_SECONDS * 1000) / timeScale()));
          return;
        case 'logOutcome':
          await this.post({
            message: {
              type: 'tool-calls',
              call: msgCall,
              toolWithToolCallList: [{ name: 'log_call_outcome', toolCall: { id: `${call.summary.vapiCallId}-log`, function: { name: 'log_call_outcome', arguments: JSON.stringify(step.args) } } }],
            },
          });
          return;
        case 'end':
          await this.end(call, step.endedReason);
          return;
      }
    } catch (err) {
      logger.warn('[sandbox] simulated webhook delivery failed', {
        vapiCallId: call.summary.vapiCallId,
        step: step.kind,
        error: err instanceof Error ? err.name : 'unknown',
      });
    }
  }

  private async end(call: LiveCall, endedReason: string): Promise<void> {
    if (call.summary.status === 'ended') return;
    for (const t of call.timers) clearTimeout(t);
    call.timers = [];
    // At SANDBOX_TIME_SCALE > 1 the report carries simulated time, so the
    // product sees the call's real length (it treats a call under 30 seconds
    // as unanswered). At real time the two are the same.
    const endedAt = new Date(call.started.getTime() + (Date.now() - call.started.getTime()) * timeScale());
    call.summary.status = 'ended';
    call.summary.endedAt = endedAt.toISOString();
    call.summary.endedReason = endedReason;
    const transcript = call.transcript.join('\n');
    try {
      await this.post({
        message: {
          type: 'end-of-call-report',
          startedAt: call.summary.startedAt,
          endedAt: endedAt.toISOString(),
          endedReason,
          call: this.envelopeCall(call),
          artifact: { transcript },
          analysis: {
            summary: `Sandbox scenario ${call.summary.scenarioId}.`,
            collectrx: call.plan.holdSeconds > 0
              ? { agentTransition: { fromAgent: 'Hold_Sentinel', toAgent: 'Claims_Agent', durationSeconds: call.plan.holdSeconds } }
              : undefined,
          },
        },
      });
    } catch (err) {
      logger.warn('[sandbox] end-of-call delivery failed', { vapiCallId: call.summary.vapiCallId, error: err instanceof Error ? err.name : 'unknown' });
    }
    const ctx = { phi: call.phi, transcript };
    for (const listener of this.endedListeners) {
      try {
        listener({ ...call.summary }, ctx);
      } catch (err) {
        logger.warn('[sandbox] call-ended listener failed', { error: err instanceof Error ? err.message : 'unknown' });
      }
    }
    call.phi = null;
    call.transcript = [];
    setTimeout(() => this.calls.delete(call.summary.vapiCallId), ENDED_RETENTION_MS).unref();
  }
}

/** Delivers a server message to the product's own webhook route, signed like Vapi signs it. */
export async function postSignedWebhook(body: Record<string, unknown>): Promise<void> {
  const secret = process.env.VAPI_WEBHOOK_SECRET ?? '';
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const res = await fetch(`${sandboxLocalOrigin()}/api/webhooks/vapi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vapi-signature': signature },
    body: raw,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`webhook answered ${res.status}`);
}

export const carrierSimulator = new CarrierSimulator();
