import type { CarrierId } from '@prisma/client';
import type {
  DeskActiveCall,
  DeskCarrierBlock,
  DeskQueueEntry,
  DeskTranscriptLine,
  LiveCallState,
  ActiveAgent,
} from './frontDesk.js';

/** A carrier rep answered and the call is transferring to staff right now. */
export interface DeskHandoffRequest {
  callId: string;
  claimNumber: string | null;
  carrierId: string | null;
  outstandingAmount: number | null;
  /** Display name of the practice's designated individual, when one is set. */
  designatedName: string | null;
  requestedAt: string;
}

export type WsEvent =
  | { type: 'handoff.requested'; data: DeskHandoffRequest }
  | { type: 'call.started'; data: { call: DeskActiveCall } }
  | {
      type: 'call.state_changed';
      data: { callId: string; state: LiveCallState; activeAgent: ActiveAgent | null };
    }
  | { type: 'transcript.line'; data: DeskTranscriptLine }
  | {
      type: 'call.ended';
      data: { callId: string; outcome: string; notes: string | null };
    }
  | { type: 'queue.updated'; data: { queue: DeskQueueEntry[] } }
  | {
      type: 'carrier.blocked';
      data: { block: DeskCarrierBlock; affectedQueueCount: number };
    }
  | { type: 'carrier.unblocked'; data: { carrierId: CarrierId } }
  | {
      /** A live rep answered but nobody could take the call, so the agent asked for a reference number. */
      type: 'handoff.missed';
      data: { claimRef: string; carrierId: string | null; reason: 'no_staff_available' | 'staff_busy' | 'transfer_failed'; at: string };
    };
