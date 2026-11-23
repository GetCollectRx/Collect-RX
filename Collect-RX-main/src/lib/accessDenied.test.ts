import { describe, expect, it } from 'vitest';
import { accessDeniedGuidance, isAccessDeniedMessage } from './accessDenied';

describe('access denial messages', () => {
  it('recognises the denials the crawl saw', () => {
    expect(isAccessDeniedMessage('No auditor grant for this practice')).toBe(true);
    expect(isAccessDeniedMessage("Role 'group_admin' does not have access to patient PHI endpoints.")).toBe(true);
    expect(isAccessDeniedMessage('Forbidden')).toBe(true);
  });

  it('does not hide real faults', () => {
    expect(isAccessDeniedMessage('Request failed (500)')).toBe(false);
    expect(isAccessDeniedMessage('Failed to fetch')).toBe(false);
    expect(isAccessDeniedMessage('Internal server error')).toBe(false);
  });

  it('tells a missing grant apart from a role that never has the page', () => {
    expect(accessDeniedGuidance('No auditor grant for this practice')).toMatch(/owner/iu);
    expect(accessDeniedGuidance("Role 'group_admin' does not have access to patient PHI endpoints.")).toMatch(/menu/iu);
  });
});
