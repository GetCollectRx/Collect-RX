import { describe, expect, it } from 'vitest';
import { validateImportTotals } from '../../src/server/pms/importValidation.js';

describe('validateImportTotals', () => {
  it('passes when drift is within 1%', () => {
    const result = validateImportTotals({
      sourceRecordCount: 100,
      importedRecordCount: 100,
      sourceBalanceTotal: 10000,
      importedBalanceTotal: 10050,
    });
    expect(result.passed).toBe(true);
  });

  it('fails when balance drift exceeds threshold', () => {
    const result = validateImportTotals({
      sourceRecordCount: 100,
      importedRecordCount: 100,
      sourceBalanceTotal: 10000,
      importedBalanceTotal: 12000,
    });
    expect(result.passed).toBe(false);
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
