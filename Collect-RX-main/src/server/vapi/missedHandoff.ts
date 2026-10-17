/**
 * Standing rule for V1 Hold Sentinel calls (founder decision, ADR 0003): when a
 * live rep answers and staff cannot be connected, the agent never just goes
 * silent. It gives the CRTC disclosure, asks the rep for a reference number for
 * the call, logs it, and the practice receives it as a message so staff can
 * follow up without losing the call entirely.
 *
 * Speaking to the rep is an exception to V1's "AI never converses" rule, so the
 * script is fixed text built here, not left to the model, and it opens with
 * the canonical disclosure from docs/compliance/crtc-disclosure-decision.md.
 */

export const MISSED_HANDOFF_SCENARIO = 'staff_unavailable';

export type MissedHandoffPurpose = 'claim' | 'cdcp_predetermination' | 'eligibility';

const PURPOSE_TEXT: Record<MissedHandoffPurpose, string> = {
  claim: 'I am following up on a claim',
  cdcp_predetermination: 'I am following up on a CDCP predetermination',
  eligibility: "I am confirming a patient's coverage before an appointment",
};

export function buildMissedHandoffScript(params: {
  practiceName: string;
  practicePhone: string;
  purpose: MissedHandoffPurpose;
}): string {
  return (
    `Thank you for taking my call. I am an automated calling system on behalf of ${params.practiceName}'s billing department. ` +
    `You can reach us at ${params.practicePhone}. This call may be recorded for quality purposes. ` +
    `${PURPOSE_TEXT[params.purpose]}. Our staff member is not able to join right now. ` +
    'Could you please give me a reference number for this call, so they can follow up with you?'
  );
}

export function missedHandoffToolResult(script: string): string {
  return (
    'HANDOFF FAILED — staff could not be connected. Standing rule: get a reference number. ' +
    `Say exactly: "${script}" ` +
    'Then listen for the reference number and the representative\'s name. Do not discuss the claim or answer questions about it; ' +
    'if asked, say staff will call back. Thank them, then call log_call_outcome with ' +
    `scenario "${MISSED_HANDOFF_SCENARIO}", referenceNumber, repName, and a one-line callSummary.`
  );
}

export function purposeFromCallMetadata(meta: {
  claimId?: string;
  cdcpContext?: boolean;
  preVisitType?: string;
} | undefined): MissedHandoffPurpose {
  if (meta?.cdcpContext || meta?.preVisitType === 'cdcp_predet') return 'cdcp_predetermination';
  if (!meta?.claimId && meta?.preVisitType === 'eligibility') return 'eligibility';
  return 'claim';
}

export function missedHandoffMessage(params: {
  claimLabel: string;
  carrierLabel: string;
  referenceNumber?: string;
  repName?: string;
}): { subject: string; message: string } {
  const ref = params.referenceNumber?.trim();
  const rep = params.repName?.trim();
  return {
    subject: ref
      ? `Missed rep call — reference ${ref} (claim ${params.claimLabel})`
      : `Missed rep call — no reference given (claim ${params.claimLabel})`,
    message:
      `A ${params.carrierLabel} representative answered on claim ${params.claimLabel}, but staff were not connected. ` +
      (ref ? `Reference number: ${ref}.` : 'The representative did not give a reference number.') +
      (rep ? ` Representative: ${rep}.` : '') +
      ' Call the carrier back and quote the reference to continue.',
  };
}
