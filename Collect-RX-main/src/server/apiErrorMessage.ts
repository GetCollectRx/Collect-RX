/**
 * Utility helpers to produce safe error message strings for API responses.
 * Never leak internal stack traces or raw DB errors to clients.
 */

/** Message suitable for a 4xx response (client error — share the message). */
export function apiClientErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Bad request';
}

/** Message suitable for a 5xx response (server error — generic message only). */
export function apiErrorMessageForResponse(err: unknown): string {
  if (process.env.NODE_ENV !== 'production' && err instanceof Error) {
    return err.message;
  }
  return 'An unexpected error occurred';
}
