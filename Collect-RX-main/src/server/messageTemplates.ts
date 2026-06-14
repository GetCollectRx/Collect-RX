import { blockPatientOutboundContact } from './insuranceOnlyPolicy.js';

/** Legacy patient outreach templates — disabled; insurance-carrier product only. */
export function generateMessageBody(
  templateKey: string,
  _patientDisplayName: string,
  _amount: number,
  _balanceId: string,
  _daysOutstanding: number,
  _practiceName: string,
): string {
  blockPatientOutboundContact('message template', templateKey);
  return '';
}
