import type { CarrierId } from '@prisma/client';

export type DeskRole = 'owner' | 'front_desk';

export type LiveCallState =
  | 'idle'
  | 'queued'
  | 'dialing'
  | 'ivr_navigation'
  | 'rep_connected'
  | 'escalating'
  | 'resolving'
  | 'completed'
  | 'failed'
  | 'paused_by_staff'
  | 'carrier_blocked';

export type ActiveAgent =
  | 'IVR_Navigator'
  | 'Claims_Agent'
  | 'Escalation_Closer'
  | 'Resolution_Closer';

export interface DeskActiveCall {
  id: string;
  practiceId: string;
  claimId: string;
  claimRef: string;
  carrierId: CarrierId;
  attemptNumber: number;
  state: LiveCallState;
  activeAgent: ActiveAgent | null;
  vapiCallId: string;
  amountClaimedCents: number;
  startedAt: string;
  pausedByStaffAt: string | null;
  takenOverByStaffAt: string | null;
}

export interface DeskTranscriptLine {
  id: string;
  callId: string;
  speaker: 'agent' | 'carrier' | 'system';
  agentName: ActiveAgent | null;
  text: string;
  timestamp: string;
}

export interface DeskQueueEntry {
  id: string;
  practiceId: string;
  claimId: string;
  claimRef: string;
  carrierId: CarrierId;
  amountClaimedCents: number;
  priority: number;
  attemptsMade: number;
  heldForCarrierBlock: boolean;
  heldReason: string | null;
  dispatchDeferralCode: string | null;
  dispatchDeferralNextAction: string | null;
  dispatchDeferredAt: string | null;
  scheduledAfter: string;
  addedAt: string;
}

export interface DeskCarrierBlock {
  id: string;
  carrierId: CarrierId;
  blockedAt: string;
  blockedByCallId: string | null;
  reason: string;
  heldQueueCount: number;
}
