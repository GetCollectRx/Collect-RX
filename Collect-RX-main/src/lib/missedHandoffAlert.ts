import type { WsEvent } from '../types/ws';

export type MissedHandoffEvent = Extract<WsEvent, { type: 'handoff.missed' }>;

export interface MissedHandoffAlert {
  title: string;
  detail: string;
  /** Milliseconds before the banner dismisses itself. A missed call stays long because it needs follow-up. */
  autoDismissMs: number;
}

const CARRIER_LABELS: Record<string, string> = {
  sun_life: 'Sun Life',
  canada_life: 'Canada Life',
  manulife: 'Manulife',
  green_shield: 'Green Shield',
  rbc_insurance: 'RBC Insurance',
  telus_adjudicare: 'TELUS AdjudiCare',
};

function carrierLabel(carrierId: string | null): string {
  if (!carrierId) return 'a carrier';
  return CARRIER_LABELS[carrierId] ?? carrierId;
}

const MISSED_REASON: Record<MissedHandoffEvent['data']['reason'], string> = {
  no_staff_available: 'Nobody was marked available.',
  staff_busy: 'Everyone available was already on a call.',
  transfer_failed: 'The transfer did not connect.',
};

/** What staff see when a live rep answered but nobody could take the call. Never carries patient detail. */
export function describeMissedHandoff(event: MissedHandoffEvent): MissedHandoffAlert {
  return {
    title: 'A rep answered and nobody could take the call.',
    detail: `${carrierLabel(event.data.carrierId)}, claim ${event.data.claimRef}. ${MISSED_REASON[event.data.reason]} The agent asked the rep for a reference number and the claim will be retried.`,
    autoDismissMs: 120_000,
  };
}
