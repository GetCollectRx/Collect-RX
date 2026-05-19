/**
 * Railway dashboard sometimes uses display labels instead of canonical env keys.
 * Read canonical names first, then common aliases set in the UI.
 */
function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const v = process.env[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function readPublicAppUrl(): string {
  return readEnv(
    'PUBLIC_APP_URL',
    'Public_APP_URL',
    'public_app_url',
    'FRONTEND_URL',
  );
}

export function readServerUrl(): string {
  return readEnv('SERVER_URL', 'Server', 'server_url', 'PUBLIC_APP_URL', 'Public_APP_URL');
}

export function readAllowedOriginsRaw(): string {
  return readEnv('ALLOWED_ORIGINS', 'Allowed Origins', 'ALLOWED_ORIGIN', 'allowed_origins');
}
