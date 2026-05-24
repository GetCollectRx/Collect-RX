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
  if (/error|incorrect|resubmit|invalid/.test(blob)) {
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
  if (attemptNumber >= 3 && outcome !== 'RESOLVED') {
    return true;
  }
  return false;
}
