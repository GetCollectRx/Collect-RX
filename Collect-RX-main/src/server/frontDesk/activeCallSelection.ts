/**
 * Chooses which live call a desk action (pause, end, take over) applies to.
 *
 * The console shows one call and sends its id. Without an id the server must
 * not guess among several live calls: acting on the wrong call connects staff
 * to, or ends, a different patient's live carrier call.
 */

export type ActiveCallSelection<T extends { id: string }> =
  | { ok: true; call: T }
  | { ok: false; status: 404 | 409; error: string };

export function selectActiveCall<T extends { id: string }>(
  active: readonly T[],
  requestedId: unknown,
): ActiveCallSelection<T> {
  if (typeof requestedId === 'string' && requestedId.trim().length > 0) {
    const match = active.find((call) => call.id === requestedId.trim());
    if (!match) {
      return { ok: false, status: 404, error: 'The selected call is no longer active' };
    }
    return { ok: true, call: match };
  }
  if (active.length === 0) {
    return { ok: false, status: 404, error: 'No active call' };
  }
  const only = active[0];
  if (active.length === 1 && only) {
    return { ok: true, call: only };
  }
  return { ok: false, status: 409, error: 'Several calls are active; select the call to act on' };
}
