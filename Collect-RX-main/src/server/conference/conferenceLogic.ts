/**
 * Pure logic for the per-call conference handoff (B-01, B-03, B-07, B-10, B-11).
 * No network, no Twilio client: these functions only build TwiML text and make
 * decisions from values the Twilio webhooks report, so they can be tested now
 * and wired in once the Phase 1 spike is approved.
 */

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Conference room names are opaque ids; reject anything that could carry data or markup. */
export function isSafeRoomName(name: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(name);
}

export interface ParticipantOptions {
  /** Listener legs are muted so they can never be heard. */
  muted: boolean;
  /** Staff leaving should not end the carrier leg until the rep hangs up. */
  endConferenceOnExit?: boolean;
  /** Spoken to this participant only, before they join (B-07). */
  whisper?: string;
}

export function participantTwiml(room: string, opts: ParticipantOptions): string {
  if (!isSafeRoomName(room)) throw new Error('Unsafe conference room name');
  const say = opts.whisper ? `<Say>${xmlEscape(opts.whisper)}</Say>` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Dial><Conference` +
    ` beep="false" startConferenceOnEnter="true"` +
    ` endConferenceOnExit="${opts.endConferenceOnExit ? 'true' : 'false'}"` +
    ` muted="${opts.muted ? 'true' : 'false'}" record="do-not-record">${room}</Conference></Dial></Response>`
  );
}

/** B-07: what staff hear at pickup. Carrier, claim label and amount only, never patient data. */
export function whisperText(input: { carrierName: string; claimLabel: string; amountCents: number }): string {
  const dollars = (input.amountCents / 100).toFixed(2);
  return `CollectRx call. ${input.carrierName}. Claim ${input.claimLabel}. Outstanding ${dollars} dollars. Connecting you now.`;
}

export type StaffLegOutcome = 'answered' | 'voicemail' | 'busy' | 'no_answer' | 'failed';

/**
 * B-03: classify the staff leg from Twilio's status callback. `AnsweredBy` is
 * only present when machine detection is on; without it a voicemail looks like
 * an answer, which is why short "answers" are treated as suspect.
 */
export function classifyStaffLeg(input: {
  callStatus: string;
  answeredBy?: string;
  durationSeconds?: number;
}): StaffLegOutcome {
  const s = input.callStatus.toLowerCase();
  if (s === 'busy') return 'busy';
  if (s === 'no-answer') return 'no_answer';
  if (s === 'failed' || s === 'canceled') return 'failed';
  const ab = (input.answeredBy ?? '').toLowerCase();
  if (ab.startsWith('machine') || ab === 'fax') return 'voicemail';
  return 'answered';
}

/** Only an answered leg keeps the rep; everything else triggers the fallback script. */
export function shouldFallBackToReferenceScript(o: StaffLegOutcome): boolean {
  return o !== 'answered';
}

/**
 * B-11: ring order for several front-desk numbers. Each number is tried once,
 * primary first, skipping numbers already attempted on this call.
 */
export function nextStaffNumber(numbers: string[], attempted: string[]): string | null {
  const seen = new Set(attempted);
  for (const n of numbers) if (!seen.has(n)) return n;
  return null;
}

/**
 * B-10: compare minutes the product meters (Vapi duration, which stops at a
 * transfer) with minutes Twilio bills for the same calls. A positive gap is
 * unmetered cost.
 */
export function meteringGap(calls: Array<{ meteredMinutes: number; twilioBilledMinutes: number }>): {
  meteredMinutes: number;
  twilioMinutes: number;
  unmeteredMinutes: number;
  unmeteredShare: number;
} {
  const metered = calls.reduce((s, c) => s + c.meteredMinutes, 0);
  const twilio = calls.reduce((s, c) => s + c.twilioBilledMinutes, 0);
  const gap = Math.max(0, twilio - metered);
  return { meteredMinutes: metered, twilioMinutes: twilio, unmeteredMinutes: gap, unmeteredShare: twilio ? gap / twilio : 0 };
}

/**
 * Spike only (B-01): a scripted "carrier rep" leg for one-phone testing.
 * Speaks fixed, fictional lines (no patient data), then joins the room unmuted.
 */
export function scriptedRepTwiml(room: string): string {
  if (!isSafeRoomName(room)) throw new Error('Unsafe conference room name');
  const lines = [
    'Thank you for calling the test carrier. This is a scripted rep for a CollectRx test.',
    'The claim status is processed. The reference number is test one two three four.',
  ];
  const say = lines.map((l) => `<Say>${xmlEscape(l)}</Say>`).join('<Pause length="2"/>');
  return (
    `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="2"/>${say}<Dial><Conference` +
    ` beep="false" startConferenceOnEnter="true" endConferenceOnExit="false"` +
    ` muted="false" record="do-not-record">${room}</Conference></Dial></Response>`
  );
}
