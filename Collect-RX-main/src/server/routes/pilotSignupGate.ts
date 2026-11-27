/**
 * B-27: PILOT_SCOPE.md limits the pilot to one practice until the Day-90
 * decision. Setting PILOT_SIGNUPS_CLOSED=true makes /register refuse new
 * accounts. Off by default so existing behavior is unchanged.
 */
export function pilotSignupsClosed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PILOT_SIGNUPS_CLOSED === 'true';
}
export const PILOT_SIGNUPS_CLOSED_MESSAGE =
  'Sign-ups are by invitation during the pilot. Contact us to request access.';
