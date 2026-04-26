/** Base URL for patient-facing links (emails, SMS, printed letters). No trailing slash. */
export function getPublicAppBaseUrl(): string {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:5173';
  return raw.replace(/\/$/, '');
}
