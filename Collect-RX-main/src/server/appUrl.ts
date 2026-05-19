import { readPublicAppUrl } from './envRailway.js';

/** Base URL for patient-facing links (emails, SMS, printed letters). No trailing slash. */
export function getPublicAppBaseUrl(): string {
  const raw = readPublicAppUrl() || 'http://localhost:5173';
  return raw.replace(/\/$/, '');
}
