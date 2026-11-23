/**
 * Post-call bindings: registry scenarios in the post_call and handoff layers that
 * can be decided by the real outcome code, with no database and no network:
 * classifyOutcome, resolveOutcomeFromWebhookPayload and the financial gate in
 * resolveGatedClaimStatus. Level U.
 *
 * Data policy (register D-01): the transcripts below are short synthetic carrier
 * phrases with no patient identifiers. They exist only in memory during the run.
 * Bindings report outcome codes only, never the text, and the runner test fails if
 * any of these strings reaches the report or the run log.
 */
import type { VapiWebhookPayload } from '../../../src/vapi/client.js';
import { classifyOutcome } from '../../../src/outcome/processor.js';
import { extractStructuredClaimStatus, resolveOutcomeFromWebhookPayload } from '../../../src/outcome/webhookOutcomeResolver.js';
import { resolveGatedClaimStatus } from '../../../src/server/recovery/recoveryLoopService.js';
import { fail, finding, verdict, type Binding } from './types.js';

const T = {
  paidWithRef: 'The payment was processed yesterday. The reference number is SL20260001.',
  paidNoRef: 'The payment was processed yesterday.',
  pendingPhrase: 'The claim is still in process. Please allow 10 business days.',
  blockAutomated: 'We are unable to process automated calls on this line.',
  blockBot: 'Our system flagged bot activity detected on this number.',
  blockLegacy: 'Result: carrier_block. The representative ended the call.',
  blockRobot: 'This is not a real person calling, we cannot continue.',
  deniedWithCode: 'The claim has been denied. Denial code 52 applies to this line item.',
  notInSystem: 'We have no record of that claim, it is not in our system.',
  partialPayment: 'A partial payment was issued for part of the amount billed.',
  waitingPeriodLiteral: 'Waiting period not met for that procedure.',
  waitingPeriodNatural: 'The waiting period has not been met for that procedure.',
  partialPaymentWithRef: 'A partial payment was issued for part of the amount billed. The reference number is SL20260002.',
  conflictText: 'The claim has been denied by the carrier.',
  empty: '',
} as const;

/** Every synthetic phrase, so the runner can prove none of them reaches an artifact at rest. */
export const SYNTHETIC_TRANSCRIPT_PHRASES: readonly string[] = Object.values(T).filter((s) => s.length > 0);

function call(transcript: string, over: Partial<VapiWebhookPayload> = {}): VapiWebhookPayload {
  return { type: 'call.ended', call: { id: 'syn-call-1', status: 'ended', durationSeconds: 120 }, transcript, ...over };
}

function squad(outcome: string, referenceNumber?: string): VapiWebhookPayload {
  return call('', { analysis: { structuredData: { claimNumber: 'SYN-VL-POST', outcome, ...(referenceNumber ? { referenceNumber } : {}) } } });
}

function gated(p: VapiWebhookPayload): { outcome: string; claimStatus: string; blockDetected: boolean; reference: string } {
  const processed = resolveOutcomeFromWebhookPayload(p);
  const g = resolveGatedClaimStatus(processed, extractStructuredClaimStatus(p), 50_000);
  return { outcome: processed.outcome, claimStatus: g.gatedClaimStatus, blockDetected: processed.carrierBlockDetected, reference: processed.referenceNumber ? 'present' : 'none' };
}

const fmt = (g: ReturnType<typeof gated>): string => `outcome=${g.outcome} claimStatus=${g.claimStatus} block=${g.blockDetected} reference=${g.reference}`;

function blockCase(text: string, proves: string): Binding {
  return async () => {
    const o = classifyOutcome(call(text));
    return verdict(o.outcome === 'BLOCK_DETECTED' && o.carrierBlockDetected, 'U', `outcome=${o.outcome} block=${o.carrierBlockDetected}`, proves);
  };
}

export function buildPostCallBindings(): Record<string, Binding> {
  return {
    P001: async () => {
      const g = gated(call(T.paidNoRef));
      return verdict(g.claimStatus === 'ESCALATED', 'U', fmt(g), 'A paid outcome with no reference number and no structured payload is downgraded to ESCALATED by the financial gate. Persistence of that status is not exercised.');
    },
    P002: async () => {
      const g = gated(call(T.paidWithRef));
      return verdict(g.claimStatus === 'RESOLVED', 'U', fmt(g), 'A paid outcome with a reference of at least 4 characters stays RESOLVED. Whether a spoken reference is enough evidence for the word paid is a product-brief question this does not answer.');
    },
    P003: async () => {
      const g = gated(call(T.conflictText, { analysis: { collectrx: { schemaVersion: 1, callOutcome: 'RESOLVED', claimStatus: 'RESOLVED' } } }));
      return verdict(g.outcome === 'RESOLVED' && g.claimStatus === 'RESOLVED', 'U', fmt(g), 'A valid structured payload wins over the transcript and counts as corroboration.');
    },
    P004: async () => {
      const g = gated(call(T.pendingPhrase));
      return verdict(g.outcome === 'PENDING' && g.claimStatus !== 'APPROVED_PENDING_PAYMENT' && g.claimStatus !== 'RESOLVED', 'U', fmt(g), 'Still-in-process wording classifies as PENDING and never as approved or resolved.');
    },
    P005: blockCase(T.blockLegacy, 'The legacy carrier_block wording is detected at end of call. The block protocol itself (suspending the carrier) is not exercised here.'),
    P006: blockCase(T.blockAutomated, 'An automated-call refusal at end of call is classified as BLOCK_DETECTED.'),
    P007: async () => {
      const g = gated(call(T.paidNoRef));
      return verdict(g.claimStatus !== 'RESOLVED', 'U', fmt(g), 'Paid wording without a check or reference number is not closed as resolved; a human verifies it.');
    },
    P008: async () => {
      const o = resolveOutcomeFromWebhookPayload(call(T.deniedWithCode));
      const hasCodeField = Object.prototype.hasOwnProperty.call(o, 'denialCode');
      const evidence = `outcome=${o.outcome} denialCodeField=${hasCodeField}`;
      if (o.outcome !== 'DENIED') return fail('U', evidence, 'A denial with a code in the text must classify as DENIED.');
      if (!hasCodeField) {
        return fail('U', evidence, 'The outcome is DENIED, but the processed outcome has no field that carries a denial code, so the code in the text is not extracted. The registry expects DENIED plus the code.');
      }
      return verdict(true, 'U', evidence, 'Denied with code extracted.');
    },
    P009: async () => {
      const g = gated(call(T.notInSystem));
      return verdict(g.outcome !== 'DENIED' && g.claimStatus !== 'DENIED', 'U', fmt(g), 'A claim the carrier has no record of is not classified as denied.');
    },
    P010: async () => {
      const g = gated(call(T.empty));
      return verdict(g.claimStatus === 'IN_QUEUE' && g.outcome === 'HUNG_UP', 'U', fmt(g), 'An empty transcript yields a safe non-terminal outcome that stays in the queue.');
    },
    P014: async () => {
      const structured = gated(squad('PARTIAL_PAYMENT'));
      const text = gated(call(T.partialPayment));
      const textWithRef = gated(call(T.partialPaymentWithRef));
      const evidence = `structured: ${fmt(structured)} | transcript only: ${fmt(text)} | transcript with spoken reference: ${fmt(textWithRef)}`;
      if (structured.claimStatus === 'RESOLVED' || text.claimStatus === 'RESOLVED') return fail('U', evidence, 'A partial payment must not close the claim.');
      if (textWithRef.claimStatus !== 'ESCALATED') {
        return finding('U', evidence, 'The structured partial payment path is safe (ESCALATED), and a transcript-only partial payment is held by the financial gate. Once the rep speaks any reference number, the same partial-payment wording becomes an approved-awaiting-payment claim, so the shortfall is not routed to a human for reconciliation. The Claims_Agent prompt says a short payment is pending reconciliation.');
      }
      return verdict(true, 'U', evidence, 'Partial payment never resolves the claim.');
    },
    P019: blockCase(T.blockLegacy, 'The legacy carrier_block string is detected.'),
    P020: blockCase(T.blockBot, 'Bot-activity wording is classified as a carrier block.'),
    P021: async () => {
      const g = gated(squad('CLAIM_PAID', 'SYN12345'));
      return verdict(g.outcome === 'RESOLVED' && g.claimStatus === 'RESOLVED', 'U', fmt(g), 'The squad CLAIM_PAID outcome with a reference maps to RESOLVED.');
    },
    P022: async () => {
      const g = gated(squad('MAX_BENEFITS_REACHED'));
      return verdict(g.outcome === 'DENIED', 'U', fmt(g), 'The squad MAX_BENEFITS_REACHED outcome maps to a denial.');
    },
    P023: async () => {
      const literal = gated(call(T.waitingPeriodLiteral));
      const natural = gated(call(T.waitingPeriodNatural));
      const evidence = `registry wording: ${fmt(literal)} | natural wording: ${fmt(natural)}`;
      if (literal.outcome !== 'DENIED') return fail('U', evidence, 'Waiting-period wording must classify as a denial reason.');
      if (natural.outcome !== 'DENIED') {
        return finding('U', evidence, 'The exact words "waiting period not met" classify as DENIED. The natural wording "has not been met" does not, and falls to a manual-review outcome. Detection depends on one literal phrase.');
      }
      return verdict(true, 'U', evidence, 'Waiting-period wording classifies as a denial reason.');
    },
    P024: async () => {
      const withSquad = resolveOutcomeFromWebhookPayload(squad('PROCESSING'));
      const fallback = resolveOutcomeFromWebhookPayload(call(T.pendingPhrase));
      return verdict(withSquad.outcome === 'PENDING' && fallback.outcome === 'PENDING', 'U', `structured outcome=${withSquad.outcome}; fallback outcome=${fallback.outcome}`, 'The resolver uses the structured path when present and falls back to the transcript classifier otherwise.');
    },
    E005: async () => {
      const g = gated(call(T.paidNoRef));
      return verdict(g.claimStatus === 'ESCALATED', 'U', fmt(g), 'The post-call financial gate downgrades an uncorroborated paid result to ESCALATED.');
    },
    E009: async () => {
      const g = gated(call(T.empty));
      return verdict(g.claimStatus === 'IN_QUEUE', 'U', fmt(g), 'An empty transcript gives a non-terminal outcome.');
    },
    E010: async () => {
      const g = gated(call(T.conflictText, { analysis: { collectrx: { schemaVersion: 1, callOutcome: 'RESOLVED', claimStatus: 'RESOLVED' } } }));
      return verdict(g.outcome === 'RESOLVED', 'U', fmt(g), 'When the structured payload and the transcript disagree, the structured payload wins.');
    },
    T003: blockCase(T.blockRobot, 'A rep saying the caller is not a real person is classified as a carrier block.'),
    H006: async () => {
      const o = resolveOutcomeFromWebhookPayload(squad('CLAIM_PAID', 'SYN12345'));
      return verdict(o.referenceNumber === 'SYN12345', 'U', `reference carried=${o.referenceNumber === 'SYN12345'}`, 'The reference number in the structured payload reaches the processed outcome. Backend half only: whether the agents pass it between each other is a conversation-layer question.');
    },
    H015: async () => {
      const g = gated(call(T.conflictText, { analysis: { collectrx: { schemaVersion: 1, callOutcome: 'ESCALATED', claimStatus: 'ESCALATED' } } }));
      return verdict(g.outcome === 'ESCALATED', 'U', fmt(g), 'A structured collectrx payload is read and takes the high-trust path. Backend half only.');
    },
  };
}
