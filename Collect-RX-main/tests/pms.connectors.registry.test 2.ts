import { describe, expect, it } from 'vitest';
import { getPmsConnector, PMS_CONNECTORS } from '../src/server/pms/connectors/registry.js';

describe('PMS connector registry', () => {
  it('lists AbelDent as production', () => {
    const abel = getPmsConnector('abeldent');
    expect(abel?.status).toBe('production');
  });

  it('lists Dentrix as planned stub', () => {
    const dentrix = getPmsConnector('dentrix');
    expect(dentrix?.status).toBe('planned');
    expect(dentrix?.docsPath).toContain('DENTRIX');
  });

  it('has unique connector ids', () => {
    const ids = PMS_CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
