import type { CarrierId } from '@prisma/client';
import type {
  DeskActiveCall,
  DeskCarrierBlock,
  DeskQueueEntry,
  DeskTranscriptLine,
  LiveCallState,
  ActiveAgent,
} from './frontDesk.js';

export type WsEvent =
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
  | { type: 'carrier.unblocked'; data: { carrierId: CarrierId } };
