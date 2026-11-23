/**
 * Where Vapi's API lives. Every module that calls Vapi reads it here so a test
 * or staging environment can point the whole app at a stand-in with one setting.
 * A call that ignores it would still reach the real service, which for recording
 * deletion means PHI cleanup could not be tested without touching production.
 */
export function vapiBaseUrl(): string {
  return (process.env.VAPI_BASE_URL || 'https://api.vapi.ai').replace(/\/$/u, '');
}
