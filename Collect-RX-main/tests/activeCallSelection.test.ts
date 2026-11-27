import { describe, expect, it } from 'vitest';
import { selectActiveCall } from '../src/server/frontDesk/activeCallSelection.js';

const A = { id: 'attempt-a', vapiCallId: 'sim-concurrent-a' };
const B = { id: 'attempt-b', vapiCallId: 'sim-concurrent-b' };

describe('selectActiveCall', () => {
  it('acts on the selected call even when another call is listed first', () => {
    const result = selectActiveCall([A, B], 'attempt-b');
    expect(result).toEqual({ ok: true, call: B });
  });

  it('refuses a selected call that is no longer active instead of falling back to another', () => {
    const result = selectActiveCall([A], 'attempt-b');
    expect(result).toEqual({ ok: false, status: 404, error: 'The selected call is no longer active' });
  });

  it('uses the only active call when no selection is sent', () => {
    expect(selectActiveCall([B], undefined)).toEqual({ ok: true, call: B });
    expect(selectActiveCall([B], '')).toEqual({ ok: true, call: B });
  });

  it('refuses to guess when several calls are active and none is selected', () => {
    const result = selectActiveCall([A, B], undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it('reports no active call when nothing is live', () => {
    expect(selectActiveCall([], 'attempt-a')).toEqual({ ok: false, status: 404, error: 'The selected call is no longer active' });
    expect(selectActiveCall([], undefined)).toEqual({ ok: false, status: 404, error: 'No active call' });
  });

  it('ignores a non-string selection and treats it as no selection', () => {
    expect(selectActiveCall([B], 42)).toEqual({ ok: true, call: B });
    expect(selectActiveCall([A, B], { id: 'attempt-a' })).toMatchObject({ ok: false, status: 409 });
  });
});
