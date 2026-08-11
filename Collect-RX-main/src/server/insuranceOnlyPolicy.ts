/**
 * CollectRx is insurance-carrier recovery only. Patient SMS, email, and pay-link
 * outreach are permanently disabled in production code paths.
 */
import { logger } from './observability/logger.js';

export const PATIENT_OUTBOUND_CONTACT_DISABLED = true;

export function isPatientOutboundContactAllowed(): boolean {
  return !PATIENT_OUTBOUND_CONTACT_DISABLED;
}

export function patientContactDisabledMessage(): string {
  return 'CollectRx is insurance-carrier recovery only. Patient reminders and payment outreach are disabled.';
}

/** Log once per blocked attempt; returns false so callers treat send as skipped. */
export function blockPatientOutboundContact(channel: string, context?: string): false {
  logger.warn('[insurance-only] blocked patient outreach', { channel, context });
  return false;
}
