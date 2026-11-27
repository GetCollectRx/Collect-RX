import type { PracticeSettings } from '../../types/practiceSettings.js';

/** B-05: the silent listener may only run for practices that acknowledged it. */
export function listenerAllowed(settings: Pick<PracticeSettings, 'listenerConsentAcknowledged'>): boolean {
  return settings.listenerConsentAcknowledged === true;
}
