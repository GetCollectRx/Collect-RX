import type { CallOutcome } from '@prisma/client';

export interface ClassifierTranscriptLine {
  speaker: string;
  text: string;
  agentName?: string | null;
}

export interface ClassifierCallContext {
  takenOverByStaffId?: string | null;
  liveState?: string | null;
  activeAgent?: string | null;
  durationSeconds?: number | null;
  attemptNumber?: number;
}

export function classifyOutcome(
  _vapiEndReason: string,
  transcript: ClassifierTranscriptLine[],
  call: ClassifierCallContext,
): { outcome: CallOutcome; notes: string } {
  if (call.takenOverByStaffId) {
    return { outcome: 'ESCALATED', notes: 'Staff took over the call' };
  }
  if (call.liveState === 'carrier_blocked') {
    return { outcome: 'BLOCK_DETECTED', notes: 'Carrier block detected during call' };
  }

  const blob = transcript.map((l) => l.text).join(' ').toLowerCase();

  if (/payment processing|approved|adjudicated/.test(blob)) {
    return { outcome: 'RESOLVED', notes: 'Carrier indicated approval or payment processing' };
  }
  if (/pending|processing|under review/.test(blob)) {
    return { outcome: 'PENDING', notes: 'Claim still pending adjudication' };
  }
  if (/pre-authorization|missing documentation|additional info/.test(blob)) {
    return { outcome: 'DENIED', notes: 'Missing documentation or pre-auth required' };
  }
  // M-1: 'resubmit' is a recoverable signal — the practice must correct and
  // resubmit. Terminal DENIED would close the claim permanently. Route to
  // ESCALATED with outcomeDetail 'resubmit_required' so claimRouter assigns
  // a PRACTICE_GATE action and the practice can action it.
  if (/resubmit/.test(blob)) {
    return { outcome: 'ESCALATED', notes: 'Carrier requested resubmission — routing to practice gate' };
  }
  if (/error|incorrect|invalid/.test(blob)) {
    return { outcome: 'DENIED', notes: 'Carrier reported submission error' };
  }
  const duration = call.durationSeconds ?? 0;
  if (duration < 30 || /voicemail|leave a message/.test(blob)) {
    return { outcome: 'NO_ANSWER', notes: 'Reached voicemail or very short call' };
  }
  if (
    call.activeAgent === 'IVR_Navigator' ||
    (!call.activeAgent && !transcript.some((l) => l.speaker === 'agent' && l.agentName !== 'IVR_Navigator'))
  ) {
    const neverPastIvr = !transcript.some(
      (l) => l.agentName && l.agentName !== 'IVR_Navigator',
    );
    if (neverPastIvr) {
      return { outcome: 'FAILED', notes: 'Call never advanced past IVR navigation' };
    }
  }
  if (/wrong number|not a dental/.test(blob)) {
    return { outcome: 'FAILED', notes: 'Wrong number or non-dental line' };
  }
  return { outcome: 'FAILED', notes: 'Unable to classify — defaulting to IVR failure' };
}

export function shouldAutoEscalate(
  outcome: CallOutcome,
  attemptNumber: number,
): boolean {
  if (outcome === 'DENIED') {
    return true;
  }
  // M-5: NO_ANSWER and PENDING are handled by the retry/recall loop in claimRouter.
  // Auto-escalating them after 3 attempts fills the escalation inbox with cases
  // a human cannot resolve faster than an AI retry (carrier phone was busy or
  // claim is still in adjudication). Only escalate outcomes where human action
  // is actually needed: FAILED, BLOCK_DETECTED, ESCALATED.
  const retriableOutcomes: CallOutcome[] = ['NO_ANSWER', 'PENDING', 'RESOLVED'];
  if (attemptNumber >= 3 && !retriableOutcomes.includes(outcome)) {
    return true;
  }
  return false;
}
