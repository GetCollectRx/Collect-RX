import type { WsEvent } from '../types/ws';

export type HandoffEvent = Extract<WsEvent, { type: 'handoff.requested' | 'handoff.missed' }>;

export interface HandoffAlert {
  kind: 'requested' | 'missed';
  title: string;
  detail: string;
  /** Milliseconds before the banner dismisses itself. A missed call stays longer because it needs follow-up. */
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

const MISSED_REASON: Record<Extract<HandoffEvent, { type: 'handoff.missed' }>['data']['reason'], string> = {
  no_staff_available: 'Nobody was marked available.',
  staff_busy: 'Everyone available was already on a call.',
  transfer_failed: 'The transfer did not connect.',
};

/** What the person sees when a live rep answers. Never carries patient detail. */
export function describeHandoffAlert(event: HandoffEvent): HandoffAlert {
  if (event.type === 'handoff.requested') {
    const amount = event.data.amountText ? ` ${event.data.amountText}` : '';
    return {
      kind: 'requested',
      title: 'A rep is on the line. Pick up the phone.',
      detail: `${carrierLabel(event.data.carrierId)}, claim ${event.data.claimRef}${amount}. The call is ringing your staff line now.`,
      autoDismissMs: 60_000,
    };
  }
  return {
    kind: 'missed',
    title: 'A rep answered and nobody could take the call.',
    detail: `${carrierLabel(event.data.carrierId)}, claim ${event.data.claimRef}. ${MISSED_REASON[event.data.reason]} The agent asked the rep for a reference number and the claim will be retried.`,
    autoDismissMs: 120_000,
  };
}
