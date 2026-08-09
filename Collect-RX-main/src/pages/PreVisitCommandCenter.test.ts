import { describe, expect, it } from 'vitest';
import { isValidTab, VALID_TABS } from './PreVisitCommandCenter';

describe('PreVisitCommandCenter tab validation', () => {
  it('accepts every known tab id', () => {
    for (const tab of VALID_TABS) {
      expect(isValidTab(tab)).toBe(true);
    }
  });

  it('rejects an unrecognized tab query param instead of silently accepting it', () => {
    expect(isValidTab('cdcp')).toBe(false);
    expect(isValidTab('bogus')).toBe(false);
    expect(isValidTab(null)).toBe(false);
  });
});
