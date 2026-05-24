/**
 * Error strings returned in JSON from authenticated ("internal") APIs.
 * In production, never reflect `Error.message` to clients — it often contains
 * SQL, paths, hostnames, or connector details useful for attackers.
 */

export function apiErrorMessageForResponse(err: unknown): string {
  if (process.env.NODE_ENV === 'production') {
    return 'Internal server error';
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Internal server error';
}

/** 4xx / user-action failures where the message is still not trusted in production. */
export function apiClientErrorMessage(err: unknown): string {
  if (process.env.NODE_ENV === 'production') {
    return 'Request could not be completed';
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Request could not be completed';
}
