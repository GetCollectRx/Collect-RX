import { describe, expect, it } from 'vitest';
import { getPmsConnector, PMS_CONNECTORS } from '../src/server/pms/connectors/registry.js';

describe('PMS connector registry', () => {
  it('lists Dentrix as planned stub', () => {
    const dentrix = getPmsConnector('dentrix');
    expect(dentrix?.status).toBe('planned');
    expect(dentrix?.docsPath).toContain('DENTRIX');
  });

  it('does not list any PMS-specific production connector', () => {
    expect(PMS_CONNECTORS.some((c) => c.status === 'production')).toBe(false);
  });

  it('has unique connector ids', () => {
    const ids = PMS_CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
